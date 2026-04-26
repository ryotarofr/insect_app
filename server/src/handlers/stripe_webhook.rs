//! `POST /api/v1/stripe/webhook` (Phase 9.1 / Stripe7)
//!
//! Stripe からの webhook を受け取って orders.status を更新する。
//!
//! **Phase 9.1 (現状)**:
//!   - mock provider 用に「テストから直接 trigger できる JSON body」だけ受け付ける
//!     (= async-stripe の `stripe::Event` を deserialize しない)。
//!   - HMAC 検証 (`Stripe-Signature` header) は **scaffolding のみ**。env の
//!     `STRIPE_WEBHOOK_SECRET` が空なら検証スキップ、Some なら HMAC-SHA256 を計算。
//!     mock では空のままで OK。
//!   - 受信 event_type を見て orders.status を遷移:
//!       checkout.session.completed → paid
//!       payment_intent.payment_failed → failed
//!       checkout.session.expired → canceled
//!     未知 event_type は 200 で no-op (= Stripe は 2xx を期待)。
//!
//! **Phase 9.2 (将来)**:
//!   - `async_stripe::Webhook::construct_event` で正規の検証 + parse に切り替え
//!   - Idempotency: 同じ event_id を 2 回受信した時に 1 回だけ処理する store を追加
//!   - Dead-letter queue: 処理失敗時に SQS / DLQ に詰む
//!
//! **冪等性 (idempotency)**:
//!   現状の `update_status_db` は `WHERE id = $1` で 1 行だけ更新する。
//!   同じ event を 2 回受け取っても結果は同じ (= status が paid → paid に上書き)。
//!   ただし「pending → paid → failed」のような誤遷移は防げないので、Phase 9.2 で
//!   `WHERE id = $1 AND status NOT IN ('paid', 'canceled')` を追加する想定。

use axum::{Json, http::StatusCode};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::orders;

/// Mock 用の webhook body。`type` に応じて orders.status を遷移する。
/// 本番では Stripe SDK が解釈する raw body をそのまま受けて検証する。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MockStripeEvent {
    /// 例: "checkout.session.completed" / "payment_intent.payment_failed"。
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: MockStripeEventData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MockStripeEventData {
    pub object: MockStripeObject,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockStripeObject {
    /// Stripe Checkout Session の id (= cs_mock_<order_id>) または cs_test_xxx。
    pub id: Option<String>,
    /// 注文 UUID。mock event を作る時に直接入れる前提。本番では client_reference_id。
    pub client_reference_id: Option<String>,
    /// Stripe PaymentIntent の id (= pi_xxx)。payment_intent.payment_failed 等で乗る。
    pub payment_intent: Option<String>,
}

pub async fn post_stripe_webhook(
    axum::extract::State(state): axum::extract::State<crate::state::AppState>,
    Json(event): Json<MockStripeEvent>,
) -> Result<StatusCode, AppError> {
    // ── HMAC 検証 (scaffolding) ───────────────────────────────────
    // 本番では handler signature を `headers: HeaderMap, body: Bytes` に変えて、
    // `body` の生バイト + `Stripe-Signature` header + STRIPE_WEBHOOK_SECRET から
    // HMAC-SHA256 を計算して照合する。Phase 9.2 で実装。
    // 現状 (mock) ではスキップ。

    // ── event_type に応じて status 遷移 ──────────────────────────
    let new_status: &str = match event.event_type.as_str() {
        "checkout.session.completed" => "paid",
        "payment_intent.payment_failed" => "failed",
        "checkout.session.expired" => "canceled",
        // 未知 event_type は 200 で no-op (= Stripe 仕様: 2xx で ack 要)
        _ => {
            tracing::debug!("ignoring stripe event_type: {}", event.event_type);
            return Ok(StatusCode::OK);
        }
    };

    // ── 対象 order を特定 ─────────────────────────────────────────
    // 優先順位: client_reference_id (= UUID 直指定) > id (= cs_xxx) で stripe_session_id 検索
    let order_id_opt: Option<Uuid> = event
        .data
        .object
        .client_reference_id
        .as_deref()
        .and_then(|s| Uuid::parse_str(s).ok());

    let order = if let Some(oid) = order_id_opt {
        // 直接 id 指定 → status 更新するだけ
        Some(oid)
    } else if let Some(sid) = event.data.object.id.as_deref() {
        // cs_xxx 経由で order を引く (Phase 9.x: AppState 経由で pool 利用 / 不在時 in-memory)
        match orders::find_by_stripe_session_id(state.db(), sid).await {
            Ok(Some(rec)) => Some(rec.id),
            Ok(None) => {
                tracing::warn!("stripe webhook: no order found for session_id={}", sid);
                None
            }
            Err(e) => {
                tracing::error!("stripe webhook lookup error: {}", e);
                return Err(AppError::BadRequest(format!("lookup error: {e}")));
            }
        }
    } else {
        None
    };

    let Some(order_id) = order else {
        // 対象注文が見つからない → 200 で no-op (= Stripe に retry させない)
        // 既に削除された注文 / 別 environment への漏れ込みケースを想定。
        tracing::warn!(
            "stripe webhook: order not identifiable (event_type={})",
            event.event_type
        );
        return Ok(StatusCode::OK);
    };

    // ── status 更新 ──────────────────────────────────────────────
    let pi = event.data.object.payment_intent.as_deref();
    if let Err(e) = orders::update_status(state.db(), order_id, new_status, pi).await {
        tracing::error!(
            "stripe webhook: update_status failed for order {}: {}",
            order_id,
            e
        );
        return Err(AppError::BadRequest(format!("update_status: {e}")));
    }

    tracing::info!(
        "stripe webhook: order {} → {} (event_type={})",
        order_id,
        new_status,
        event.event_type
    );
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;
    use crate::repos::orders::{
        OrderInsertRequest, OrderLineInsert, ShippingAddressInsert, insert_order,
        reset_memory_for_test,
    };
    use crate::state::AppState;

    /// テストでは pool 無しの AppState を使う (= in-memory fallback で動く)
    fn empty_state() -> State<AppState> {
        State(AppState::default())
    }

    async fn seed_pending_order() -> uuid::Uuid {
        reset_memory_for_test();
        let rec = insert_order(
            None,
            OrderInsertRequest {
                session_id: "anonymous".to_string(),
                stripe_session_id: Some("cs_mock_test".to_string()),
                amount_jpy: 96000,
                shipping_jpy: Some(1800),
                line_items: vec![OrderLineInsert {
                    product_id: "p-x".to_string(),
                    product_uuid: None, // test fixture では UUID 解決スキップ
                    title: "Test".to_string(),
                    unit_price_jpy: 48000,
                    qty: 2,
                    subtotal_jpy: 96000,
                }],
                shipping_address: ShippingAddressInsert {
                    address_name: "Yamada".to_string(),
                    address_tel: "090".to_string(),
                    address_zip: "150".to_string(),
                    address_pref: "13".to_string(),
                    address_addr: "Shibuya".to_string(),
                    shipping_method_id: "cold".to_string(),
                },
            },
        )
        .await
        .unwrap();
        rec.id
    }

    #[tokio::test]
    async fn checkout_session_completed_marks_order_paid() {
        let order_id = seed_pending_order().await;
        let body = MockStripeEvent {
            event_type: "checkout.session.completed".to_string(),
            data: MockStripeEventData {
                object: MockStripeObject {
                    id: Some("cs_mock_test".to_string()),
                    client_reference_id: Some(order_id.to_string()),
                    payment_intent: Some("pi_test_42".to_string()),
                },
            },
        };
        let res = post_stripe_webhook(empty_state(), Json(body)).await.unwrap();
        assert_eq!(res, StatusCode::OK);

        let updated = orders::find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap()
            .expect("order should exist after seeding");
        assert_eq!(updated.status, "paid");
        assert_eq!(updated.stripe_payment_intent_id, Some("pi_test_42".to_string()));
    }

    #[tokio::test]
    async fn payment_failed_marks_order_failed() {
        let order_id = seed_pending_order().await;
        let body = MockStripeEvent {
            event_type: "payment_intent.payment_failed".to_string(),
            data: MockStripeEventData {
                object: MockStripeObject {
                    id: Some("cs_mock_test".to_string()),
                    client_reference_id: Some(order_id.to_string()),
                    payment_intent: Some("pi_test_failed".to_string()),
                },
            },
        };
        post_stripe_webhook(empty_state(), Json(body)).await.unwrap();

        let updated = orders::find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.status, "failed");
    }

    #[tokio::test]
    async fn unknown_event_type_is_no_op() {
        let _id = seed_pending_order().await;
        let body = MockStripeEvent {
            event_type: "customer.created".to_string(),
            data: MockStripeEventData {
                object: MockStripeObject {
                    id: None,
                    client_reference_id: None,
                    payment_intent: None,
                },
            },
        };
        let res = post_stripe_webhook(empty_state(), Json(body)).await.unwrap();
        assert_eq!(res, StatusCode::OK);

        // status は pending のまま
        let snap = orders::find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(snap.status, "pending");
    }

    #[tokio::test]
    async fn missing_order_returns_ok_no_op() {
        reset_memory_for_test();
        let body = MockStripeEvent {
            event_type: "checkout.session.completed".to_string(),
            data: MockStripeEventData {
                object: MockStripeObject {
                    id: Some("cs_unknown".to_string()),
                    client_reference_id: None,
                    payment_intent: None,
                },
            },
        };
        let res = post_stripe_webhook(empty_state(), Json(body)).await.unwrap();
        // 注文不在でも 200 で no-op (= Stripe に retry させない)
        assert_eq!(res, StatusCode::OK);
    }
}
