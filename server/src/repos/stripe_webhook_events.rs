//! stripe_webhook_events への永続化 (Phase 9.1 hardening / event_id 冪等性)
//!
//! **責務**:
//!   - INSERT ON CONFLICT DO NOTHING RETURNING で「初回処理かどうか」を bool で返す
//!   - DB 不在時は in-memory HashSet<event_id> で同等の挙動
//!
//! **使い方**:
//!   ```ignore
//!   match stripe_webhook_events::record_if_new(pool, "evt_test_123", "checkout.session.completed", &payload).await? {
//!       RecordOutcome::FirstSeen => { /* 通常処理 */ }
//!       RecordOutcome::AlreadySeen => { /* 200 で no-op */ }
//!   }
//!   ```

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;
use sqlx::PgPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordOutcome {
    /// 初回受信 (= INSERT が走った / handler は通常処理)
    FirstSeen,
    /// 既に受信済 (= ON CONFLICT で弾かれた / handler は 200 no-op)
    AlreadySeen,
}

#[derive(Debug, thiserror::Error)]
pub enum StripeWebhookEventRepoError {
    #[error("invalid event id: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

/// `event_id` を受信履歴に記録する。既に同じ id があれば `AlreadySeen` を返す。
pub async fn record_if_new(
    pool: Option<&PgPool>,
    event_id: &str,
    event_type: &str,
    payload_json: &Value,
) -> Result<RecordOutcome, StripeWebhookEventRepoError> {
    if event_id.trim().is_empty() {
        return Err(StripeWebhookEventRepoError::Invalid(
            "event_id is empty".to_string(),
        ));
    }

    match pool {
        Some(p) => record_if_new_db(p, event_id, event_type, payload_json).await,
        None => Ok(record_if_new_memory(event_id)),
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn record_if_new_db(
    pool: &PgPool,
    event_id: &str,
    event_type: &str,
    payload_json: &Value,
) -> Result<RecordOutcome, StripeWebhookEventRepoError> {
    // INSERT ON CONFLICT DO NOTHING RETURNING で「INSERT が走ったか」を判定。
    let inserted: Option<(String,)> = sqlx::query_as(
        r#"
        INSERT INTO stripe_webhook_events (id, event_type, payload_json)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(event_id)
    .bind(event_type)
    .bind(payload_json)
    .fetch_optional(pool)
    .await
    .map_err(StripeWebhookEventRepoError::Db)?;

    if inserted.is_some() {
        Ok(RecordOutcome::FirstSeen)
    } else {
        Ok(RecordOutcome::AlreadySeen)
    }
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_set() -> &'static Mutex<HashSet<String>> {
    static S: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashSet::new()))
}

fn record_if_new_memory(event_id: &str) -> RecordOutcome {
    let mut set = memory_set()
        .lock()
        .expect("stripe_webhook_events memory mutex poisoned");
    if set.insert(event_id.to_string()) {
        RecordOutcome::FirstSeen
    } else {
        RecordOutcome::AlreadySeen
    }
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_set().lock() {
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

    #[tokio::test]
    async fn first_seen_then_already_seen_for_same_id() {
        let _g = memory_guard();
        reset_memory_for_test();
        let payload = json!({"type":"checkout.session.completed"});

        let r1 = record_if_new(None, "evt_test_1", "checkout.session.completed", &payload)
            .await
            .unwrap();
        assert_eq!(r1, RecordOutcome::FirstSeen);

        let r2 = record_if_new(None, "evt_test_1", "checkout.session.completed", &payload)
            .await
            .unwrap();
        assert_eq!(r2, RecordOutcome::AlreadySeen);
    }

    #[tokio::test]
    async fn distinct_event_ids_are_each_first_seen() {
        let _g = memory_guard();
        reset_memory_for_test();
        let payload = json!({});
        for id in ["evt_a", "evt_b", "evt_c"] {
            let r = record_if_new(None, id, "any", &payload).await.unwrap();
            assert_eq!(r, RecordOutcome::FirstSeen, "first time for {id}");
        }
    }

    #[tokio::test]
    async fn empty_event_id_is_invalid() {
        let _g = memory_guard();
        match record_if_new(None, "", "x", &json!({})).await {
            Err(StripeWebhookEventRepoError::Invalid(_)) => {}
            other => panic!("expected Invalid, got {other:?}"),
        }
        match record_if_new(None, "   ", "x", &json!({})).await {
            Err(StripeWebhookEventRepoError::Invalid(_)) => {}
            other => panic!("expected Invalid for whitespace, got {other:?}"),
        }
    }
}
