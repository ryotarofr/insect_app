//! mating_records (交配記録) への永続化 (Phase 9.D / DB設計書 v2 §3.6)
//!
//! **責務**:
//!   - 交配の試行 → 採卵 → 孵化 までのライフサイクルを breeder ごとに記録
//!   - 親 (specimens への FK) を持つ場合と持たない場合 (= "野生" 等の自由 label) に対応
//!   - status 値域は `'planned' / 'mated' / 'eggs_laid' / 'hatched' / 'failed'` の 5 値
//!
//! **設計判断**:
//!   - father_id / mother_id は specimens への FK だが、`father_label` /
//!     `mother_label` の自由テキストでも代替可 (= 設計書 §8.3 の野生親 fallback)
//!   - status 遷移の妥当性 (= planned → mated → ... の順序) は MVP では DB 側でも
//!     handler 側でもチェックしない (= ops が手動で巻き戻す場合もあるため柔軟に)

use std::sync::{Mutex, OnceLock};

use chrono::NaiveDate;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct MatingRecordRow {
    pub id: Uuid,
    pub breeder_user_id: Uuid,
    pub father_id: Option<Uuid>,
    pub mother_id: Option<Uuid>,
    pub father_label: Option<String>,
    pub mother_label: Option<String>,
    pub mated_at: NaiveDate,
    pub egg_count: Option<i32>,
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MatingRecordInsert {
    pub breeder_user_id: Uuid,
    pub father_id: Option<Uuid>,
    pub mother_id: Option<Uuid>,
    pub father_label: Option<String>,
    pub mother_label: Option<String>,
    pub mated_at: NaiveDate,
    pub egg_count: Option<i32>,
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MatingRepoError {
    #[error("invalid mating record: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("mating record not found: {0}")]
    NotFound(Uuid),
}

pub const ALLOWED_STATUSES: &[&str] = &["planned", "mated", "eggs_laid", "hatched", "failed"];

fn validate_status(s: &str) -> Result<(), MatingRepoError> {
    if !ALLOWED_STATUSES.contains(&s) {
        return Err(MatingRepoError::Invalid(format!(
            "invalid status: {s} (must be one of {ALLOWED_STATUSES:?})"
        )));
    }
    Ok(())
}

fn validate_payload(p: &MatingRecordInsert) -> Result<(), MatingRepoError> {
    validate_status(&p.status)?;
    // 親情報が一つも無いのは怪しい (= 系図不能)。father_id / mother_id / father_label /
    // mother_label のうち少なくとも 1 つは Some を要求する。
    if p.father_id.is_none()
        && p.mother_id.is_none()
        && p.father_label.as_ref().is_none_or(|s| s.trim().is_empty())
        && p.mother_label.as_ref().is_none_or(|s| s.trim().is_empty())
    {
        return Err(MatingRepoError::Invalid(
            "at least one parent (father_id / mother_id / father_label / mother_label) required"
                .to_string(),
        ));
    }
    if let Some(n) = p.egg_count
        && n < 0
    {
        return Err(MatingRepoError::Invalid(format!(
            "egg_count must be >= 0, got {n}"
        )));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

pub async fn insert(
    pool: Option<&PgPool>,
    p: MatingRecordInsert,
) -> Result<Uuid, MatingRepoError> {
    validate_payload(&p)?;
    match pool {
        Some(pool) => {
            let row: (Uuid,) = sqlx::query_as(
                r#"
                INSERT INTO mating_records (
                    breeder_user_id, father_id, mother_id, father_label, mother_label,
                    mated_at, egg_count, status, notes
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
                "#,
            )
            .bind(p.breeder_user_id)
            .bind(p.father_id)
            .bind(p.mother_id)
            .bind(p.father_label.as_deref())
            .bind(p.mother_label.as_deref())
            .bind(p.mated_at)
            .bind(p.egg_count)
            .bind(&p.status)
            .bind(p.notes.as_deref())
            .fetch_one(pool)
            .await
            .map_err(MatingRepoError::Db)?;
            Ok(row.0)
        }
        None => {
            let id = Uuid::new_v4();
            memory_lock_mut().push(MatingRecordRow {
                id,
                breeder_user_id: p.breeder_user_id,
                father_id: p.father_id,
                mother_id: p.mother_id,
                father_label: p.father_label,
                mother_label: p.mother_label,
                mated_at: p.mated_at,
                egg_count: p.egg_count,
                status: p.status,
                notes: p.notes,
            });
            Ok(id)
        }
    }
}

pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<MatingRecordRow>, MatingRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, MatingRecordRow>(
            r#"
            SELECT id, breeder_user_id, father_id, mother_id, father_label, mother_label,
                   mated_at, egg_count, status, notes
            FROM mating_records WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(p)
        .await
        .map_err(MatingRepoError::Db),
        None => Ok(memory_lock().iter().find(|r| r.id == id).cloned()),
    }
}

/// 1 breeder の交配記録を mated_at 降順で返す。
pub async fn list_by_breeder(
    pool: Option<&PgPool>,
    breeder_user_id: Uuid,
) -> Result<Vec<MatingRecordRow>, MatingRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, MatingRecordRow>(
            r#"
            SELECT id, breeder_user_id, father_id, mother_id, father_label, mother_label,
                   mated_at, egg_count, status, notes
            FROM mating_records
            WHERE breeder_user_id = $1
            ORDER BY mated_at DESC, id
            "#,
        )
        .bind(breeder_user_id)
        .fetch_all(p)
        .await
        .map_err(MatingRepoError::Db),
        None => {
            let mut rows: Vec<MatingRecordRow> = memory_lock()
                .iter()
                .filter(|r| r.breeder_user_id == breeder_user_id)
                .cloned()
                .collect();
            rows.sort_by(|a, b| b.mated_at.cmp(&a.mated_at).then_with(|| a.id.cmp(&b.id)));
            Ok(rows)
        }
    }
}

pub async fn update_status(
    pool: Option<&PgPool>,
    id: Uuid,
    new_status: &str,
) -> Result<(), MatingRepoError> {
    validate_status(new_status)?;
    match pool {
        Some(p) => {
            let res = sqlx::query("UPDATE mating_records SET status = $2 WHERE id = $1")
                .bind(id)
                .bind(new_status)
                .execute(p)
                .await
                .map_err(MatingRepoError::Db)?;
            if res.rows_affected() == 0 {
                return Err(MatingRepoError::NotFound(id));
            }
            Ok(())
        }
        None => {
            let mut store = memory_lock_mut();
            let row = store
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(MatingRepoError::NotFound(id))?;
            row.status = new_status.to_string();
            Ok(())
        }
    }
}

pub async fn update_egg_count(
    pool: Option<&PgPool>,
    id: Uuid,
    egg_count: i32,
) -> Result<(), MatingRepoError> {
    if egg_count < 0 {
        return Err(MatingRepoError::Invalid(format!(
            "egg_count must be >= 0, got {egg_count}"
        )));
    }
    match pool {
        Some(p) => {
            let res = sqlx::query("UPDATE mating_records SET egg_count = $2 WHERE id = $1")
                .bind(id)
                .bind(egg_count)
                .execute(p)
                .await
                .map_err(MatingRepoError::Db)?;
            if res.rows_affected() == 0 {
                return Err(MatingRepoError::NotFound(id));
            }
            Ok(())
        }
        None => {
            let mut store = memory_lock_mut();
            let row = store
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(MatingRepoError::NotFound(id))?;
            row.egg_count = Some(egg_count);
            Ok(())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<MatingRecordRow>> {
    static S: OnceLock<Mutex<Vec<MatingRecordRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_lock() -> std::sync::MutexGuard<'static, Vec<MatingRecordRow>> {
    memory_store().lock().expect("mating_records memory mutex poisoned")
}

fn memory_lock_mut() -> std::sync::MutexGuard<'static, Vec<MatingRecordRow>> {
    memory_lock()
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_store().lock() {
        s.clear();
    }
}

#[cfg(test)]
pub fn memory_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    GUARD.lock().unwrap_or_else(|p| p.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn breeder() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn payload(status: &str, day: &str) -> MatingRecordInsert {
        MatingRecordInsert {
            breeder_user_id: breeder(),
            father_id: None,
            mother_id: None,
            father_label: Some("野生 ♂".to_string()),
            mother_label: Some("自家累代 ♀".to_string()),
            mated_at: d(day),
            egg_count: None,
            status: status.to_string(),
            notes: None,
        }
    }

    #[tokio::test]
    async fn validate_rejects_unknown_status() {
        let _g = memory_guard();
        let mut p = payload("planned", "2026-04-01");
        p.status = "wedding".to_string();
        match insert(None, p).await {
            Err(MatingRepoError::Invalid(msg)) => assert!(msg.contains("status")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_no_parents() {
        let _g = memory_guard();
        let mut p = payload("planned", "2026-04-01");
        p.father_id = None;
        p.mother_id = None;
        p.father_label = None;
        p.mother_label = None;
        match insert(None, p).await {
            Err(MatingRepoError::Invalid(msg)) => assert!(msg.contains("parent")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_negative_egg_count() {
        let _g = memory_guard();
        let mut p = payload("planned", "2026-04-01");
        p.egg_count = Some(-1);
        match insert(None, p).await {
            Err(MatingRepoError::Invalid(msg)) => assert!(msg.contains("egg_count")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_by_breeder_orders_by_mated_at_desc() {
        let _g = memory_guard();
        reset_memory_for_test();
        let _ = insert(None, payload("planned", "2025-01-01")).await.unwrap();
        let _ = insert(None, payload("hatched", "2026-04-01")).await.unwrap();
        let _ = insert(None, payload("eggs_laid", "2025-08-01")).await.unwrap();

        let rows = list_by_breeder(None, breeder()).await.unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].mated_at, d("2026-04-01"));
        assert_eq!(rows[1].mated_at, d("2025-08-01"));
        assert_eq!(rows[2].mated_at, d("2025-01-01"));
    }

    #[tokio::test]
    async fn update_status_then_egg_count() {
        let _g = memory_guard();
        reset_memory_for_test();
        let id = insert(None, payload("planned", "2026-04-01")).await.unwrap();

        update_status(None, id, "eggs_laid").await.unwrap();
        update_egg_count(None, id, 42).await.unwrap();
        let row = find_by_id(None, id).await.unwrap().unwrap();
        assert_eq!(row.status, "eggs_laid");
        assert_eq!(row.egg_count, Some(42));
    }

    #[tokio::test]
    async fn update_status_unknown_id_returns_not_found() {
        let _g = memory_guard();
        reset_memory_for_test();
        let unknown = Uuid::new_v4();
        match update_status(None, unknown, "hatched").await {
            Err(MatingRepoError::NotFound(id)) => assert_eq!(id, unknown),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}
