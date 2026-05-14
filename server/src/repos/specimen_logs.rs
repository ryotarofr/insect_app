//! specimen_logs (飼育ログ) への永続化 (DB設計書 v2 §3.5)
//!
//! **責務**:
//!   - 体重 / 餌 / マット / 脱皮 / 観察 の 5 種のログを 1 specimen に紐付けて記録
//!   - DB / in-memory fallback の両方をサポート
//!   - log_type は CHECK 制約と同値の 5 値にコード側 enum で揃える
//!
//! **未実装 (= 後続)**:
//!   - logs に photo を添付するための object storage 連携
//!   - log の編集 / 削除 (= MVP は append-only)

use std::sync::{Mutex, OnceLock};

use chrono::{NaiveDate, NaiveTime};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct SpecimenLogRow {
    pub id: Uuid,
    pub specimen_id: Uuid,
    pub author_user_id: Uuid,
    pub log_type: String,                               // "weight" / "feed" / "mat" / "molt" / "observation"
    pub logged_at: NaiveDate,
    pub logged_at_time: Option<NaiveTime>,
    pub title: String,
    pub body: String,
    pub has_photo: bool,
    pub metrics: Value,                                 // JSONB
}

#[derive(Debug, Clone)]
pub struct SpecimenLogInsert {
    pub specimen_id: Uuid,
    pub author_user_id: Uuid,
    pub log_type: String,
    pub logged_at: NaiveDate,
    pub logged_at_time: Option<NaiveTime>,
    pub title: String,
    pub body: String,
    pub has_photo: bool,
    pub metrics: Value,
}

#[derive(Debug, thiserror::Error)]
pub enum SpecimenLogRepoError {
    #[error("invalid log: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

const ALLOWED_LOG_TYPES: &[&str] = &["weight", "feed", "mat", "molt", "observation"];

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

pub async fn insert(
    pool: Option<&PgPool>,
    p: SpecimenLogInsert,
) -> Result<Uuid, SpecimenLogRepoError> {
    if !ALLOWED_LOG_TYPES.contains(&p.log_type.as_str()) {
        return Err(SpecimenLogRepoError::Invalid(format!(
            "invalid log_type: {} (must be one of {ALLOWED_LOG_TYPES:?})",
            p.log_type
        )));
    }
    if p.title.trim().is_empty() {
        return Err(SpecimenLogRepoError::Invalid("title is empty".to_string()));
    }

    match pool {
        Some(pool) => {
            let row: (Uuid,) = sqlx::query_as(
                r#"
                INSERT INTO specimen_logs (
                    specimen_id, author_user_id, log_type, logged_at, logged_at_time,
                    title, body, has_photo, metrics
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
                "#,
            )
            .bind(p.specimen_id)
            .bind(p.author_user_id)
            .bind(&p.log_type)
            .bind(p.logged_at)
            .bind(p.logged_at_time)
            .bind(&p.title)
            .bind(&p.body)
            .bind(p.has_photo)
            .bind(&p.metrics)
            .fetch_one(pool)
            .await
            .map_err(SpecimenLogRepoError::Db)?;
            Ok(row.0)
        }
        None => {
            let id = Uuid::new_v4();
            memory_lock_mut().push(SpecimenLogRow {
                id,
                specimen_id: p.specimen_id,
                author_user_id: p.author_user_id,
                log_type: p.log_type,
                logged_at: p.logged_at,
                logged_at_time: p.logged_at_time,
                title: p.title,
                body: p.body,
                has_photo: p.has_photo,
                metrics: p.metrics,
            });
            Ok(id)
        }
    }
}

/// 1 user の所有 specimens 全体のログを横断で返す (= マイページ「今月のログ」KPI 等)。
/// ORDER は logged_at + logged_at_time の降順。in-memory モードは空 Vec を返す
/// (= 本経路は login 必須で DB 前提のため、in-memory では試験的なテストフィクスチャ未対応)。
pub async fn list_by_user_id(
    pool: Option<&PgPool>,
    user_id: Uuid,
) -> Result<Vec<SpecimenLogRow>, SpecimenLogRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, SpecimenLogRow>(
            r#"
            SELECT sl.id, sl.specimen_id, sl.author_user_id, sl.log_type,
                   sl.logged_at, sl.logged_at_time, sl.title, sl.body,
                   sl.has_photo, sl.metrics
            FROM specimen_logs sl
            JOIN specimens s ON s.id = sl.specimen_id
            WHERE s.owner_user_id = $1
            ORDER BY sl.logged_at DESC, sl.logged_at_time DESC NULLS LAST, sl.id
            "#,
        )
        .bind(user_id)
        .fetch_all(p)
        .await
        .map_err(SpecimenLogRepoError::Db),
        None => Ok(vec![]),
    }
}

/// 1 specimen のログを logged_at + logged_at_time の降順で返す。
pub async fn list_by_specimen(
    pool: Option<&PgPool>,
    specimen_id: Uuid,
) -> Result<Vec<SpecimenLogRow>, SpecimenLogRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, SpecimenLogRow>(
            r#"
            SELECT id, specimen_id, author_user_id, log_type, logged_at, logged_at_time,
                   title, body, has_photo, metrics
            FROM specimen_logs
            WHERE specimen_id = $1
            ORDER BY logged_at DESC, logged_at_time DESC NULLS LAST, id
            "#,
        )
        .bind(specimen_id)
        .fetch_all(p)
        .await
        .map_err(SpecimenLogRepoError::Db),
        None => {
            let mut rows: Vec<SpecimenLogRow> = memory_lock()
                .iter()
                .filter(|r| r.specimen_id == specimen_id)
                .cloned()
                .collect();
            rows.sort_by(|a, b| {
                b.logged_at
                    .cmp(&a.logged_at)
                    .then_with(|| b.logged_at_time.cmp(&a.logged_at_time))
                    .then_with(|| a.id.cmp(&b.id))
            });
            Ok(rows)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<SpecimenLogRow>> {
    static S: OnceLock<Mutex<Vec<SpecimenLogRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_lock() -> std::sync::MutexGuard<'static, Vec<SpecimenLogRow>> {
    memory_store().lock().expect("specimen_logs memory mutex poisoned")
}

fn memory_lock_mut() -> std::sync::MutexGuard<'static, Vec<SpecimenLogRow>> {
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
    use serde_json::json;

    fn specimen() -> Uuid {
        Uuid::parse_str("d0d0d0d0-0000-4000-8000-00000000d0d0").unwrap()
    }
    fn author() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }

    fn payload(log_type: &str, day: NaiveDate, time: Option<NaiveTime>) -> SpecimenLogInsert {
        SpecimenLogInsert {
            specimen_id: specimen(),
            author_user_id: author(),
            log_type: log_type.to_string(),
            logged_at: day,
            logged_at_time: time,
            title: "test".to_string(),
            body: "".to_string(),
            has_photo: false,
            metrics: json!({}),
        }
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[tokio::test]
    async fn validate_rejects_unknown_log_type() {
        let _g = memory_guard();
        match insert(None, payload("dance", d("2026-04-01"), None)).await {
            Err(SpecimenLogRepoError::Invalid(msg)) => assert!(msg.contains("log_type")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_empty_title() {
        let _g = memory_guard();
        let mut p = payload("weight", d("2026-04-01"), None);
        p.title = "".to_string();
        match insert(None, p).await {
            Err(SpecimenLogRepoError::Invalid(msg)) => assert!(msg.contains("title")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_by_specimen_orders_by_date_desc() {
        let _g = memory_guard();
        reset_memory_for_test();
        // 3 件挿入 (= 順番をバラバラに作る)
        let _ = insert(None, payload("weight", d("2026-04-01"), None)).await.unwrap();
        let _ = insert(None, payload("feed", d("2026-04-03"), None)).await.unwrap();
        let _ = insert(None, payload("mat", d("2026-04-02"), None)).await.unwrap();

        let rows = list_by_specimen(None, specimen()).await.unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].logged_at, d("2026-04-03"));
        assert_eq!(rows[1].logged_at, d("2026-04-02"));
        assert_eq!(rows[2].logged_at, d("2026-04-01"));
    }

    #[tokio::test]
    async fn list_by_specimen_filters_other_specimens() {
        let _g = memory_guard();
        reset_memory_for_test();
        let other = Uuid::new_v4();
        let _ = insert(None, payload("weight", d("2026-04-01"), None)).await.unwrap();
        let mut other_p = payload("weight", d("2026-04-05"), None);
        other_p.specimen_id = other;
        let _ = insert(None, other_p).await.unwrap();

        let rows = list_by_specimen(None, specimen()).await.unwrap();
        assert_eq!(rows.len(), 1, "他 specimen のログは混ざらない");
    }

    #[tokio::test]
    async fn list_by_specimen_orders_by_time_within_same_date() {
        let _g = memory_guard();
        reset_memory_for_test();
        let day = d("2026-04-01");
        let _ = insert(
            None,
            payload(
                "weight",
                day,
                Some(NaiveTime::from_hms_opt(9, 0, 0).unwrap()),
            ),
        )
        .await
        .unwrap();
        let _ = insert(
            None,
            payload(
                "feed",
                day,
                Some(NaiveTime::from_hms_opt(15, 0, 0).unwrap()),
            ),
        )
        .await
        .unwrap();

        let rows = list_by_specimen(None, specimen()).await.unwrap();
        assert_eq!(rows.len(), 2);
        // 同日内では time 降順 (= 15:00 → 09:00)
        assert_eq!(rows[0].log_type, "feed");
        assert_eq!(rows[1].log_type, "weight");
    }
}
