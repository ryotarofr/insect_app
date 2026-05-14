//! specimen_status_history への永続化 (DB設計書 v2 §3.4)
//!
//! **責務**:
//!   - `specimens.life_status` の遷移履歴を不可逆に積む append-only テーブル
//!   - 上位 (= `repos::specimens::update_life_status`) から transactional に INSERT される
//!   - 単独 INSERT も可能だが運用上は specimens 側の wrapper 経由が望ましい
//!
//! **設計判断**:
//!   - status 値域は specimens.life_status と完全一致 (= 'active' / 'deceased' /
//!     'transferred' / 'escaped'), CHECK 制約と Rust validation で二重に握る
//!   - `changed_at` (DATE) はユーザ入力。`created_at` (TIMESTAMPTZ) は record 時刻

use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct StatusHistoryRow {
    pub id: Uuid,
    pub specimen_id: Uuid,
    pub status: String,
    pub changed_at: NaiveDate,
    pub note: Option<String>,
    pub author_user_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct StatusHistoryInsert {
    pub specimen_id: Uuid,
    pub status: String,
    pub changed_at: NaiveDate,
    pub note: Option<String>,
    pub author_user_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum StatusHistoryRepoError {
    #[error("invalid status: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

pub const ALLOWED_STATUSES: &[&str] = &["active", "deceased", "transferred", "escaped"];

/// status の値域を check する。CHECK 制約と一致させ、handler 層で先に弾けるようにする。
pub fn validate_status(s: &str) -> Result<(), StatusHistoryRepoError> {
    if !ALLOWED_STATUSES.contains(&s) {
        return Err(StatusHistoryRepoError::Invalid(format!(
            "invalid status: {s} (must be one of {ALLOWED_STATUSES:?})"
        )));
    }
    Ok(())
}

pub async fn insert(
    pool: Option<&PgPool>,
    p: StatusHistoryInsert,
) -> Result<Uuid, StatusHistoryRepoError> {
    validate_status(&p.status)?;
    match pool {
        Some(pool) => {
            let row: (Uuid,) = sqlx::query_as(
                r#"
                INSERT INTO specimen_status_history
                    (specimen_id, status, changed_at, note, author_user_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
                "#,
            )
            .bind(p.specimen_id)
            .bind(&p.status)
            .bind(p.changed_at)
            .bind(p.note.as_deref())
            .bind(p.author_user_id)
            .fetch_one(pool)
            .await
            .map_err(StatusHistoryRepoError::Db)?;
            Ok(row.0)
        }
        None => {
            let id = Uuid::new_v4();
            memory_lock_mut().push(StatusHistoryRow {
                id,
                specimen_id: p.specimen_id,
                status: p.status,
                changed_at: p.changed_at,
                note: p.note,
                author_user_id: p.author_user_id,
                created_at: Utc::now(),
            });
            Ok(id)
        }
    }
}

/// 1 specimen の履歴を changed_at 降順 (= 新しい遷移順) で返す。
pub async fn list_by_specimen(
    pool: Option<&PgPool>,
    specimen_id: Uuid,
) -> Result<Vec<StatusHistoryRow>, StatusHistoryRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, StatusHistoryRow>(
            r#"
            SELECT id, specimen_id, status, changed_at, note, author_user_id, created_at
            FROM specimen_status_history
            WHERE specimen_id = $1
            ORDER BY changed_at DESC, created_at DESC, id
            "#,
        )
        .bind(specimen_id)
        .fetch_all(p)
        .await
        .map_err(StatusHistoryRepoError::Db),
        None => {
            let mut rows: Vec<StatusHistoryRow> = memory_lock()
                .iter()
                .filter(|r| r.specimen_id == specimen_id)
                .cloned()
                .collect();
            rows.sort_by(|a, b| {
                b.changed_at
                    .cmp(&a.changed_at)
                    .then_with(|| b.created_at.cmp(&a.created_at))
                    .then_with(|| a.id.cmp(&b.id))
            });
            Ok(rows)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<StatusHistoryRow>> {
    static S: OnceLock<Mutex<Vec<StatusHistoryRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_lock() -> std::sync::MutexGuard<'static, Vec<StatusHistoryRow>> {
    memory_store()
        .lock()
        .expect("specimen_status_history memory mutex poisoned")
}

fn memory_lock_mut() -> std::sync::MutexGuard<'static, Vec<StatusHistoryRow>> {
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

    fn specimen() -> Uuid {
        Uuid::parse_str("d0d0d0d0-0000-4000-8000-00000000d0d0").unwrap()
    }
    fn author() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }

    fn payload(status: &str, day: &str) -> StatusHistoryInsert {
        StatusHistoryInsert {
            specimen_id: specimen(),
            status: status.to_string(),
            changed_at: NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap(),
            note: None,
            author_user_id: author(),
        }
    }

    #[tokio::test]
    async fn validate_rejects_unknown_status() {
        let _g = memory_guard();
        match insert(None, payload("dancing", "2026-04-01")).await {
            Err(StatusHistoryRepoError::Invalid(msg)) => assert!(msg.contains("status")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_by_specimen_orders_by_changed_at_desc() {
        let _g = memory_guard();
        reset_memory_for_test();
        let _ = insert(None, payload("active", "2024-01-01")).await.unwrap();
        let _ = insert(None, payload("transferred", "2026-04-01")).await.unwrap();
        let _ = insert(None, payload("deceased", "2025-08-12")).await.unwrap();

        let rows = list_by_specimen(None, specimen()).await.unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].status, "transferred");
        assert_eq!(rows[1].status, "deceased");
        assert_eq!(rows[2].status, "active");
    }

    #[tokio::test]
    async fn list_by_specimen_filters_other_specimens() {
        let _g = memory_guard();
        reset_memory_for_test();
        let mut other = payload("active", "2026-04-01");
        other.specimen_id = Uuid::new_v4();
        let _ = insert(None, other).await.unwrap();
        let _ = insert(None, payload("active", "2026-04-02")).await.unwrap();

        let rows = list_by_specimen(None, specimen()).await.unwrap();
        assert_eq!(rows.len(), 1, "他 specimen の履歴は混ざらない");
    }

    #[test]
    fn validate_status_accepts_all_check_values() {
        for s in ALLOWED_STATUSES {
            assert!(validate_status(s).is_ok(), "{s} should be valid");
        }
    }
}
