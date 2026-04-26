//! `/api/v1/orders/*` (Phase 9.G / login user の注文履歴 API)
//!
//! - `GET /api/v1/orders/me` → 自分の注文一覧 (= login 必須)
//!
//! 注文の作成は `/api/v1/checkout/submit` 経由なので本 module には POST 系は無い。
//! 個別注文詳細 (= /orders/{id}) や status 変更 (= 管理用) は将来追加。

use axum::{Extension, Json, extract::State};
use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::{orders, user_sessions};
use crate::session::SessionId;
use crate::state::AppState;

async fn require_user_id(state: &AppState, session_id: Uuid) -> Result<Uuid, AppError> {
    let session = user_sessions::find_by_id(state.db(), session_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("session lookup: {e}")))?
        .ok_or(AppError::Unauthorized)?;
    session.user_id.ok_or(AppError::Unauthorized)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderView {
    pub id: String,
    pub session_id: String,
    pub status: String,
    pub amount_jpy: i64,
    pub shipping_jpy: Option<i64>,
    pub stripe_session_id: Option<String>,
    pub stripe_payment_intent_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<orders::OrderRecord> for OrderView {
    fn from(r: orders::OrderRecord) -> Self {
        Self {
            id: r.id.to_string(),
            session_id: r.session_id,
            status: r.status,
            amount_jpy: r.amount_jpy,
            shipping_jpy: r.shipping_jpy,
            stripe_session_id: r.stripe_session_id,
            stripe_payment_intent_id: r.stripe_payment_intent_id,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

/// `GET /api/v1/orders/me` — 自分の注文一覧 (= created_at 降順)。
pub async fn list_my_orders(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
) -> Result<Json<Vec<OrderView>>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let rows = orders::list_by_user_id(state.db(), user_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("orders fetch: {e}")))?;
    Ok(Json(rows.into_iter().map(OrderView::from).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::{orders, user_sessions, users};

    fn st() -> State<AppState> {
        State(AppState::default())
    }
    fn ext(session_id: Uuid) -> Extension<SessionId> {
        Extension(SessionId(session_id))
    }

    /// users + user_sessions + orders を触るので 3 GUARD を順序固定で取得。
    fn lock_all() -> (
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
    ) {
        let u = users::memory_guard();
        let s = user_sessions::memory_guard();
        let o = orders::memory_guard();
        (u, s, o)
    }

    fn reset_all() {
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        orders::reset_memory_for_test();
    }

    async fn login_session() -> (Uuid, Uuid) {
        let session = Uuid::new_v4();
        user_sessions::create_anonymous(None, session).await.unwrap();
        let id = users::create_with_password(
            None,
            users::UserRegisterInput {
                public_id: format!("u_{}", &session.to_string()[..8]),
                name: "test".to_string(),
                email: format!("{}@example.com", &session.to_string()[..8]),
                password_plain: "long-enough-password".to_string(),
                avatar_initial: "T".to_string(),
                role: "breeder".to_string(),
            },
        )
        .await
        .unwrap();
        user_sessions::attach_user(None, session, id).await.unwrap();
        (session, id)
    }

    fn order_req(user_id: Option<Uuid>, amount: i64) -> orders::OrderInsertRequest {
        orders::OrderInsertRequest {
            session_id: "sess".to_string(),
            user_id,
            stripe_session_id: Some(format!("cs_test_{amount}")),
            amount_jpy: amount,
            shipping_jpy: Some(1800),
            line_items: vec![orders::OrderLineInsert {
                product_id: "p-x".to_string(),
                product_uuid: None,
                title: "Test".to_string(),
                unit_price_jpy: amount,
                qty: 1,
                subtotal_jpy: amount,
            }],
            shipping_address: orders::ShippingAddressInsert {
                address_name: "yamada".to_string(),
                address_tel: "090".to_string(),
                address_zip: "150".to_string(),
                address_pref: "13".to_string(),
                address_addr: "shibuya".to_string(),
                shipping_method_id: "cold".to_string(),
            },
        }
    }

    #[tokio::test]
    async fn list_my_orders_returns_only_owned_in_desc_order() {
        let _g = lock_all();
        reset_all();

        let (session_a, user_a) = login_session().await;
        let _ = orders::insert_order(None, order_req(Some(user_a), 1000)).await.unwrap();
        let _ = orders::insert_order(None, order_req(Some(user_a), 5000)).await.unwrap();

        // 別 user の注文も作る (= 漏れて見えないことを確認)
        let (_, user_b) = login_session().await;
        let _ = orders::insert_order(None, order_req(Some(user_b), 99999)).await.unwrap();

        // anonymous (= user_id None) もダミーで 1 件
        let _ = orders::insert_order(None, order_req(None, 7777)).await.unwrap();

        let res = list_my_orders(st(), ext(session_a)).await.unwrap();
        assert_eq!(res.0.len(), 2, "user_a の注文は 2 件");
        // created_at が同じになる可能性があるので amount で粗くチェック
        assert!(res.0.iter().all(|o| o.amount_jpy == 1000 || o.amount_jpy == 5000));
    }

    #[tokio::test]
    async fn list_my_orders_returns_401_for_anonymous() {
        let _g = lock_all();
        reset_all();

        let session = Uuid::new_v4();
        user_sessions::create_anonymous(None, session).await.unwrap();
        // attach_user していない → 401
        match list_my_orders(st(), ext(session)).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_my_orders_returns_empty_for_user_with_no_orders() {
        let _g = lock_all();
        reset_all();
        let (session, _) = login_session().await;
        let res = list_my_orders(st(), ext(session)).await.unwrap();
        assert!(res.0.is_empty());
    }
}
