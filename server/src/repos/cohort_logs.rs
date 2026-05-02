//! cohort_logs (群単位の作業ログ) への永続化
//!
//! **責務**:
//!   - cohort_id ごとの ログ INSERT / list (新→古)
//!   - feed / mat / death / observation の 4 種
//!   - DB 不在時 (= pool=None) は in-memory fallback

use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct CohortLogRow {
    pub id: Uuid,
    pub cohort_id: Uuid,
    pub log_type: String,
    pub count_delta: Option<i32>,
    pub metrics: Option<JsonValue>,
    pub body: Option<String>,
    pub logged_at: DateTime<Utc>,
    pub author_user_id: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct CohortLogInsert {
    pub cohort_id: Uuid,
    pub log_type: String,
    pub count_delta: Option<i32>,
    pub metrics: Option<JsonValue>,
    pub body: Option<String>,
    pub author_user_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum CohortLogRepoError {
    #[error("invalid cohort log: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

const ALLOWED_LOG_TYPES: &[&str] = &["feed", "mat", "death", "observation"];

pub async fn insert(
    pool: Option<&PgPool>,
    payload: CohortLogInsert,
) -> Result<Uuid, CohortLogRepoError> {
    if !ALLOWED_LOG_TYPES.contains(&payload.log_type.as_str()) {
        return Err(CohortLogRepoError::Invalid(format!(
            "log_type must be one of {ALLOWED_LOG_TYPES:?}, got {}",
            payload.log_type
        )));
    }
    match pool {
        Some(p) => insert_db(p, payload).await,
        None => {
            let id = Uuid::new_v4();
            let now = Utc::now();
            memory_store_lock().push(CohortLogRow {
                id,
                cohort_id: payload.cohort_id,
                log_type: payload.log_type,
                count_delta: payload.count_delta,
                metrics: payload.metrics,
                body: payload.body,
                logged_at: now,
                author_user_id: payload.author_user_id,
                created_at: now,
            });
            Ok(id)
        }
    }
}

pub async fn list_by_cohort(
    pool: Option<&PgPool>,
    cohort_id: Uuid,
    limit: i64,
) -> Result<Vec<CohortLogRow>, CohortLogRepoError> {
    match pool {
        Some(p) => list_by_cohort_db(p, cohort_id, limit).await,
        None => {
            let mut rows: Vec<CohortLogRow> = memory_store_lock()
                .iter()
                .filter(|r| r.cohort_id == cohort_id)
                .cloned()
                .collect();
            rows.sort_by(|a, b| b.logged_at.cmp(&a.logged_at));
            rows.truncate(limit as usize);
            Ok(rows)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

const SELECT_FIELDS: &str = r#"
    id, cohort_id, log_type, count_delta, metrics, body,
    logged_at, author_user_id, created_at
"#;

async fn insert_db(
    pool: &PgPool,
    payload: CohortLogInsert,
) -> Result<Uuid, CohortLogRepoError> {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO cohort_logs (
            id, cohort_id, log_type, count_delta, metrics, body, author_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(id)
    .bind(payload.cohort_id)
    .bind(&payload.log_type)
    .bind(payload.count_delta)
    .bind(&payload.metrics)
    .bind(&payload.body)
    .bind(payload.author_user_id)
    .execute(pool)
    .await
    .map_err(CohortLogRepoError::Db)?;
    Ok(id)
}

async fn list_by_cohort_db(
    pool: &PgPool,
    cohort_id: Uuid,
    limit: i64,
) -> Result<Vec<CohortLogRow>, CohortLogRepoError> {
    let q = format!(
        r#"
        SELECT {SELECT_FIELDS}
        FROM cohort_logs
        WHERE cohort_id = $1
        ORDER BY logged_at DESC
        LIMIT $2
        "#
    );
    sqlx::query_as::<_, CohortLogRow>(&q)
        .bind(cohort_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(CohortLogRepoError::Db)
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<CohortLogRow>> {
    static S: OnceLock<Mutex<Vec<CohortLogRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_store_lock() -> std::sync::MutexGuard<'static, Vec<CohortLogRow>> {
    memory_store()
        .lock()
        .expect("cohort_logs memory mutex poisoned")
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_store().lock() {
        s.clear();
    }
}
