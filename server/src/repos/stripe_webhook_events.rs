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

/// `record_if_new` で記録した event_id を取り消す (review fix: major)。
///
/// **冪等性 + 部分失敗ロールバック用途のみ**:
///   `record_if_new` が `FirstSeen` を返した直後に、後続の side effect
///   (orders::update_status 等) が失敗した場合、idempotency マーカーだけが
///   残ってしまい Stripe retry でも再処理できなくなる。それを回避するため、
///   呼び出し側で best-effort に取り消すための I/F。
///
/// **注意**: 真のトランザクション境界が無いので、record_if_new と本関数の間で
/// 同じ event の retry が来ると 2 重処理になる窓が残る。完全解決には
/// `&mut PgConnection` を取り回す TX 統一が必要 (= 別 PR で対応)。
pub async fn delete_by_id(
    pool: Option<&PgPool>,
    event_id: &str,
) -> Result<(), StripeWebhookEventRepoError> {
    match pool {
        Some(p) => {
            sqlx::query("DELETE FROM stripe_webhook_events WHERE id = $1")
                .bind(event_id)
                .execute(p)
                .await
                .map_err(StripeWebhookEventRepoError::Db)?;
            Ok(())
        }
        None => {
            if let Ok(mut set) = memory_set().lock() {
                set.remove(event_id);
            }
            Ok(())
        }
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

    /// review fix (major): 部分失敗ロールバックで idempotency マーカーを取り消したら、
    /// 同じ event_id を再度 record_if_new した時に FirstSeen に戻ること。
    #[tokio::test]
    async fn delete_by_id_allows_replay_for_same_event() {
        let _g = memory_guard();
        reset_memory_for_test();
        let payload = json!({"type":"checkout.session.completed"});

        let r1 = record_if_new(None, "evt_replay", "any", &payload).await.unwrap();
        assert_eq!(r1, RecordOutcome::FirstSeen);

        let r2 = record_if_new(None, "evt_replay", "any", &payload).await.unwrap();
        assert_eq!(r2, RecordOutcome::AlreadySeen);

        delete_by_id(None, "evt_replay").await.unwrap();

        let r3 = record_if_new(None, "evt_replay", "any", &payload).await.unwrap();
        assert_eq!(
            r3,
            RecordOutcome::FirstSeen,
            "delete_by_id 後は同じ event_id を replay 可能"
        );
    }

    /// 取り消す event_id が存在しなくてもエラーにしない (= idempotent な best-effort)。
    #[tokio::test]
    async fn delete_by_id_is_noop_for_unknown_id() {
        let _g = memory_guard();
        reset_memory_for_test();
        delete_by_id(None, "evt_does_not_exist").await.unwrap();
    }
}
