//! email_outbox (メール送信ジョブの outbox) への永続化 (Sprint 2 / N1-N2)
//!
//! **責務**:
//!   - handler 側からの `enqueue` (= 同 idempotency_key 衝突は OK で吸収)
//!   - worker 側の `claim_pending` (= `FOR UPDATE SKIP LOCKED` で並行 worker 安全)
//!   - 成功は `mark_sent`、失敗は `mark_failed` で retry_count + scheduled_at backoff
//!
//! **冪等性**:
//!   `(kind, idempotency_key)` の UNIQUE 部分 index (= 0015 で定義) で同一事象 2 回 enqueue を
//!   構造的に排除する。本 repo は ON CONFLICT DO NOTHING + RETURNING で「既存 row の id」を
//!   取得して呼び出し側に返す (= caller は新規 / 既存を区別せず enqueue を呼べる)。
//!
//! **retry / dead letter**:
//!   失敗時 retry_count を 1 ずつ増やし、`scheduled_at = now() + 60s * (retry+1)` の線形 backoff。
//!   `MAX_RETRY` (= 5) 到達で status='failed' に遷移して放置 (= ops が手動 reset / 再送)。
//!
//! **in-memory fallback**:
//!   pool 不在の dev / test 用。同モジュール内 Mutex<Vec<OutboxRow>> で挙動 (= UNIQUE 含む) を
//!   再現する。SKIP LOCKED 並行性は in-memory では不要 (= 単一 spawned task 想定)。

use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// 1 回の処理で worker が claim する最大件数。世間並みは 10-100 / 本実装は 25。
pub const CLAIM_BATCH: i64 = 25;

/// 失敗時の最大 retry 回数。これを超えたら `status='failed'` に遷移して放置。
pub const MAX_RETRY: i32 = 5;

/// retry 時の線形バックオフ秒数 (= scheduled_at = now() + RETRY_BACKOFF_SEC * (retry+1))。
pub const RETRY_BACKOFF_SEC: i64 = 60;

#[derive(Debug, Clone, FromRow)]
pub struct OutboxRow {
    pub id: Uuid,
    pub kind: String,
    pub to_email: String,
    pub template_args: Value,
    pub idempotency_key: Option<String>,
    pub status: String,
    pub retry_count: i32,
    pub last_error: Option<String>,
    pub scheduled_at: DateTime<Utc>,
    pub sent_at: Option<DateTime<Utc>>,
    pub owner_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// `enqueue` 入力。kind / to_email / template_args は必須、idempotency_key と owner_user_id は任意。
#[derive(Debug, Clone)]
pub struct OutboxEnqueue {
    pub kind: String,
    pub to_email: String,
    pub template_args: Value,
    pub idempotency_key: Option<String>,
    pub owner_user_id: Option<Uuid>,
}

#[derive(Debug, thiserror::Error)]
pub enum OutboxRepoError {
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// outbox に 1 行 enqueue する。idempotency_key 指定時は同 (kind, idempotency_key) の
/// 既存行があれば **その id をそのまま返す** (= 衝突を ok 扱い、caller は新規 / 既存を意識しない)。
pub async fn enqueue(
    pool: Option<&PgPool>,
    payload: OutboxEnqueue,
) -> Result<Uuid, OutboxRepoError> {
    validate(&payload)?;
    match pool {
        Some(p) => enqueue_db(p, payload).await,
        None => Ok(enqueue_memory(payload)),
    }
}

/// 送信待ちの outbox 行を batch_size 件まで claim する (= status を `sending` に遷移)。
/// DB モードは `FOR UPDATE SKIP LOCKED` で並行 worker 安全。in-memory は逐次 lock 経由。
pub async fn claim_pending(
    pool: Option<&PgPool>,
    batch_size: i64,
) -> Result<Vec<OutboxRow>, OutboxRepoError> {
    match pool {
        Some(p) => claim_pending_db(p, batch_size).await,
        None => Ok(claim_pending_memory(batch_size)),
    }
}

/// 送信成功を記録 (= status='sent', sent_at=now, last_error=NULL)。
pub async fn mark_sent(pool: Option<&PgPool>, id: Uuid) -> Result<(), OutboxRepoError> {
    match pool {
        Some(p) => {
            sqlx::query(
                r#"
                UPDATE email_outbox
                SET status = 'sent',
                    sent_at = now(),
                    last_error = NULL
                WHERE id = $1
                "#,
            )
            .bind(id)
            .execute(p)
            .await
            .map_err(OutboxRepoError::Db)?;
            Ok(())
        }
        None => {
            let mut store = memory_lock_mut();
            if let Some(row) = store.iter_mut().find(|r| r.id == id) {
                row.status = "sent".to_string();
                row.sent_at = Some(Utc::now());
                row.last_error = None;
                row.updated_at = Utc::now();
            }
            Ok(())
        }
    }
}

/// 送信失敗を記録。retry_count をインクリメントし、`MAX_RETRY` 未満なら `pending` に戻して
/// 線形 backoff を scheduled_at に設定。到達なら `failed` に遷移して dead letter 化。
pub async fn mark_failed(
    pool: Option<&PgPool>,
    id: Uuid,
    err_msg: &str,
) -> Result<(), OutboxRepoError> {
    match pool {
        Some(p) => {
            sqlx::query(
                r#"
                UPDATE email_outbox
                SET retry_count = retry_count + 1,
                    last_error  = $2,
                    status      = CASE
                                    WHEN retry_count + 1 >= $3 THEN 'failed'
                                    ELSE 'pending'
                                  END,
                    scheduled_at = CASE
                                    WHEN retry_count + 1 >= $3 THEN scheduled_at
                                    ELSE now() + ($4::bigint * (retry_count + 2))::text::interval
                                  END
                WHERE id = $1
                "#,
            )
            .bind(id)
            .bind(err_msg)
            .bind(MAX_RETRY)
            .bind(RETRY_BACKOFF_SEC)
            .execute(p)
            .await
            .map_err(OutboxRepoError::Db)?;
            Ok(())
        }
        None => {
            let mut store = memory_lock_mut();
            if let Some(row) = store.iter_mut().find(|r| r.id == id) {
                row.retry_count += 1;
                row.last_error = Some(err_msg.to_string());
                row.updated_at = Utc::now();
                if row.retry_count >= MAX_RETRY {
                    row.status = "failed".to_string();
                } else {
                    row.status = "pending".to_string();
                    let backoff_secs = RETRY_BACKOFF_SEC * (row.retry_count as i64 + 1);
                    row.scheduled_at =
                        Utc::now() + chrono::Duration::seconds(backoff_secs);
                }
            }
            Ok(())
        }
    }
}

/// テスト / ops 用: 1 件取得 (= status / 件数の検証用)。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<OutboxRow>, OutboxRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, OutboxRow>(
            r#"
            SELECT id, kind, to_email, template_args, idempotency_key, status,
                   retry_count, last_error, scheduled_at, sent_at, owner_user_id,
                   created_at, updated_at
            FROM email_outbox
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(p)
        .await
        .map_err(OutboxRepoError::Db),
        None => Ok(memory_lock().iter().find(|r| r.id == id).cloned()),
    }
}

// ──────────────────────────────────────────────────────────────────────
// validation
// ──────────────────────────────────────────────────────────────────────

const ALLOWED_KINDS: &[&str] = &[
    "order_confirmation",
    "password_reset",
    "eclosion_reminder",
];

fn validate(p: &OutboxEnqueue) -> Result<(), OutboxRepoError> {
    if !ALLOWED_KINDS.contains(&p.kind.as_str()) {
        return Err(OutboxRepoError::Invalid(format!(
            "kind must be one of {ALLOWED_KINDS:?}, got {}",
            p.kind
        )));
    }
    if p.to_email.is_empty() || !p.to_email.contains('@') {
        return Err(OutboxRepoError::Invalid(format!(
            "to_email invalid: {}",
            p.to_email
        )));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn enqueue_db(pool: &PgPool, payload: OutboxEnqueue) -> Result<Uuid, OutboxRepoError> {
    // idempotency_key が None なら通常 INSERT、Some なら ON CONFLICT で既存 id を返す。
    // 0015 の UNIQUE 部分 index は (kind, idempotency_key) WHERE idempotency_key IS NOT NULL
    // なので idempotency_key=None の行は衝突しない (= 同一事象は idempotency_key 経路で握る)。
    let row: (Uuid,) = sqlx::query_as(
        r#"
        WITH ins AS (
            INSERT INTO email_outbox
                (kind, to_email, template_args, idempotency_key, owner_user_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (kind, idempotency_key)
                WHERE idempotency_key IS NOT NULL
            DO NOTHING
            RETURNING id
        )
        SELECT id FROM ins
        UNION ALL
        SELECT id FROM email_outbox
            WHERE kind = $1 AND idempotency_key = $4 AND $4 IS NOT NULL
        LIMIT 1
        "#,
    )
    .bind(&payload.kind)
    .bind(&payload.to_email)
    .bind(&payload.template_args)
    .bind(&payload.idempotency_key)
    .bind(payload.owner_user_id)
    .fetch_one(pool)
    .await
    .map_err(OutboxRepoError::Db)?;
    Ok(row.0)
}

async fn claim_pending_db(
    pool: &PgPool,
    batch_size: i64,
) -> Result<Vec<OutboxRow>, OutboxRepoError> {
    // FOR UPDATE SKIP LOCKED で別 worker と競合せず claim → 同 transaction で sending に遷移。
    sqlx::query_as::<_, OutboxRow>(
        r#"
        UPDATE email_outbox
        SET status = 'sending',
            updated_at = now()
        WHERE id IN (
            SELECT id
            FROM email_outbox
            WHERE status = 'pending'
              AND scheduled_at <= now()
            ORDER BY scheduled_at
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, kind, to_email, template_args, idempotency_key, status,
                  retry_count, last_error, scheduled_at, sent_at, owner_user_id,
                  created_at, updated_at
        "#,
    )
    .bind(batch_size)
    .fetch_all(pool)
    .await
    .map_err(OutboxRepoError::Db)
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<OutboxRow>> {
    static S: OnceLock<Mutex<Vec<OutboxRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_lock() -> std::sync::MutexGuard<'static, Vec<OutboxRow>> {
    memory_store().lock().expect("email_outbox memory poisoned")
}

fn memory_lock_mut() -> std::sync::MutexGuard<'static, Vec<OutboxRow>> {
    memory_lock()
}

fn enqueue_memory(payload: OutboxEnqueue) -> Uuid {
    let mut store = memory_lock_mut();
    // idempotency_key 一致行があればその id を返す
    if let Some(key) = payload.idempotency_key.as_deref() {
        if let Some(existing) = store
            .iter()
            .find(|r| r.kind == payload.kind && r.idempotency_key.as_deref() == Some(key))
        {
            return existing.id;
        }
    }
    let id = Uuid::new_v4();
    let now = Utc::now();
    store.push(OutboxRow {
        id,
        kind: payload.kind,
        to_email: payload.to_email,
        template_args: payload.template_args,
        idempotency_key: payload.idempotency_key,
        status: "pending".to_string(),
        retry_count: 0,
        last_error: None,
        scheduled_at: now,
        sent_at: None,
        owner_user_id: payload.owner_user_id,
        created_at: now,
        updated_at: now,
    });
    id
}

fn claim_pending_memory(batch_size: i64) -> Vec<OutboxRow> {
    let mut store = memory_lock_mut();
    let now = Utc::now();
    let mut claimed = Vec::new();
    let limit = batch_size.max(0) as usize;
    for row in store.iter_mut() {
        if claimed.len() >= limit {
            break;
        }
        if row.status == "pending" && row.scheduled_at <= now {
            row.status = "sending".to_string();
            row.updated_at = now;
            claimed.push(row.clone());
        }
    }
    // ORDER BY scheduled_at と整合させるため sort
    claimed.sort_by(|a, b| a.scheduled_at.cmp(&b.scheduled_at));
    claimed
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

    fn payload() -> OutboxEnqueue {
        OutboxEnqueue {
            kind: "order_confirmation".to_string(),
            to_email: "alice@example.com".to_string(),
            template_args: json!({"order_id": "abc"}),
            idempotency_key: Some("order:abc".to_string()),
            owner_user_id: None,
        }
    }

    #[tokio::test]
    async fn enqueue_then_claim_then_mark_sent_round_trip() {
        let _g = memory_guard();
        reset_memory_for_test();
        let id = enqueue(None, payload()).await.unwrap();
        let claimed = claim_pending(None, CLAIM_BATCH).await.unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].id, id);
        assert_eq!(claimed[0].status, "sending");
        mark_sent(None, id).await.unwrap();
        let row = find_by_id(None, id).await.unwrap().unwrap();
        assert_eq!(row.status, "sent");
        assert!(row.sent_at.is_some());
    }

    #[tokio::test]
    async fn enqueue_with_same_idempotency_key_returns_existing_id() {
        let _g = memory_guard();
        reset_memory_for_test();
        let id1 = enqueue(None, payload()).await.unwrap();
        let id2 = enqueue(None, payload()).await.unwrap();
        assert_eq!(id1, id2);
        // 行は 1 つしか存在しない
        let claimed = claim_pending(None, CLAIM_BATCH).await.unwrap();
        assert_eq!(claimed.len(), 1);
    }

    #[tokio::test]
    async fn claim_pending_skips_already_claimed_rows() {
        let _g = memory_guard();
        reset_memory_for_test();
        enqueue(None, payload()).await.unwrap();
        let first = claim_pending(None, CLAIM_BATCH).await.unwrap();
        assert_eq!(first.len(), 1);
        // 2 回目は claim 済 (= status=sending) なので空
        let second = claim_pending(None, CLAIM_BATCH).await.unwrap();
        assert!(second.is_empty());
    }

    #[tokio::test]
    async fn mark_failed_under_limit_returns_to_pending_with_backoff() {
        let _g = memory_guard();
        reset_memory_for_test();
        let id = enqueue(None, payload()).await.unwrap();
        claim_pending(None, CLAIM_BATCH).await.unwrap();
        mark_failed(None, id, "smtp 500").await.unwrap();
        let row = find_by_id(None, id).await.unwrap().unwrap();
        assert_eq!(row.status, "pending");
        assert_eq!(row.retry_count, 1);
        assert_eq!(row.last_error.as_deref(), Some("smtp 500"));
        // scheduled_at が将来 (= backoff) に設定されていること
        assert!(row.scheduled_at > Utc::now());
    }

    #[tokio::test]
    async fn mark_failed_over_limit_transitions_to_dead_letter() {
        let _g = memory_guard();
        reset_memory_for_test();
        let id = enqueue(None, payload()).await.unwrap();
        // MAX_RETRY 回 失敗させる
        for _ in 0..MAX_RETRY {
            mark_failed(None, id, "always fails").await.unwrap();
        }
        let row = find_by_id(None, id).await.unwrap().unwrap();
        assert_eq!(row.status, "failed");
        assert_eq!(row.retry_count, MAX_RETRY);
    }

    #[tokio::test]
    async fn enqueue_rejects_invalid_kind() {
        let _g = memory_guard();
        reset_memory_for_test();
        let bad = OutboxEnqueue {
            kind: "unknown_kind".to_string(),
            ..payload()
        };
        let res = enqueue(None, bad).await;
        assert!(matches!(res, Err(OutboxRepoError::Invalid(_))));
    }

    #[tokio::test]
    async fn enqueue_rejects_invalid_email() {
        let _g = memory_guard();
        reset_memory_for_test();
        let bad = OutboxEnqueue {
            to_email: "not-an-email".to_string(),
            ..payload()
        };
        let res = enqueue(None, bad).await;
        assert!(matches!(res, Err(OutboxRepoError::Invalid(_))));
    }

    #[tokio::test]
    async fn null_idempotency_key_does_not_dedupe() {
        let _g = memory_guard();
        reset_memory_for_test();
        let p1 = OutboxEnqueue {
            idempotency_key: None,
            ..payload()
        };
        let p2 = p1.clone();
        let id1 = enqueue(None, p1).await.unwrap();
        let id2 = enqueue(None, p2).await.unwrap();
        assert_ne!(id1, id2, "idempotency_key=None は別行扱い");
    }
}
