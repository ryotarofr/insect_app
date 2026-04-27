//! `/api/v1/orders/*` (Phase 9.G / login user の注文履歴 API)
//!
//! - `GET /api/v1/orders/me` → 自分の注文一覧 (= login 必須)
//!
//! 注文の作成は `/api/v1/checkout/submit` 経由なので本 module には POST 系は無い。
//! 個別注文詳細 (= /orders/{id}) や status 変更 (= 管理用) は将来追加。

use axum::{
    Extension, Json,
    extract::{Path, State},
};
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderLineView {
    pub product_id: String,
    pub product_uuid: Option<String>,
    pub title: String,
    pub unit_price_jpy: i64,
    pub qty: i32,
    pub subtotal_jpy: i64,
}

impl From<orders::OrderLineRow> for OrderLineView {
    fn from(r: orders::OrderLineRow) -> Self {
        Self {
            product_id: r.product_id,
            product_uuid: r.product_uuid.map(|u| u.to_string()),
            title: r.title,
            unit_price_jpy: r.unit_price_jpy,
            qty: r.qty,
            subtotal_jpy: r.subtotal_jpy,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDetailView {
    #[serde(flatten)]
    pub order: OrderView,
    pub line_items: Vec<OrderLineView>,
}

/// `GET /api/v1/orders/{id}` — 自分の注文 1 件 + line_items を返す。
///
/// **Auth ポリシー**: 所有者 (= orders.user_id == current user) のみ閲覧可能。
/// 匿名 session で発行された注文 (= user_id = NULL / session_id 文字列のみ) は、
/// 同じ session_id を提示している場合に閲覧可能 (= "ログインしないでも自分のカートで
/// 買った直後の確認画面" を許す)。それ以外は 404 で吸収。
pub async fn get_order_detail(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(id): Path<String>,
) -> Result<Json<OrderDetailView>, AppError> {
    let order_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let order = orders::find_by_id(state.db(), order_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("order lookup: {e}")))?
        .ok_or(AppError::NotFound)?;

    // 所有者チェック: user 経由 OR session_id 経由
    let session_str = session_id.0.to_string();
    let user_owns = match user_sessions::find_by_id(state.db(), session_id.0).await {
        Ok(Some(s)) => s.user_id.is_some_and(|u| order.user_id == Some(u)),
        _ => false,
    };
    let session_owns = order.session_id == session_str;
    if !user_owns && !session_owns {
        return Err(AppError::NotFound);
    }

    let items = orders::list_items_by_order_id(state.db(), order_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("order_items fetch: {e}")))?;

    Ok(Json(OrderDetailView {
        order: OrderView::from(order),
        line_items: items.into_iter().map(OrderLineView::from).collect(),
    }))
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
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
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
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
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

    // ── /orders/{id} 詳細 ─────────────────────────────────────────

    #[tokio::test]
    async fn order_detail_returns_order_with_line_items_for_owner() {
        let _g = lock_all();
        reset_all();
        let (session, user_id) = login_session().await;

        let rec = orders::insert_order(None, order_req(Some(user_id), 5000)).await.unwrap();
        let res = get_order_detail(st(), ext(session), Path(rec.id.to_string()))
            .await
            .unwrap();
        assert_eq!(res.0.order.id, rec.id.to_string());
        assert_eq!(res.0.order.amount_jpy, 5000);
        assert_eq!(res.0.line_items.len(), 1);
        assert_eq!(res.0.line_items[0].product_id, "p-x");
        assert_eq!(res.0.line_items[0].subtotal_jpy, 5000);
    }

    #[tokio::test]
    async fn order_detail_404_for_other_users_order() {
        let _g = lock_all();
        reset_all();
        let (_session_a, user_a) = login_session().await;
        let rec = orders::insert_order(None, order_req(Some(user_a), 1000)).await.unwrap();

        // 別 user の session で取りに行く → 404
        let (session_b, _) = login_session().await;
        match get_order_detail(st(), ext(session_b), Path(rec.id.to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound for cross-user, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn order_detail_allows_anonymous_session_for_own_order() {
        let _g = lock_all();
        reset_all();
        // anonymous session を用意し、その session_id 文字列を orders.session_id に詰めて INSERT
        let session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        let mut req = order_req(None, 3000);
        req.session_id = session.to_string();
        let rec = orders::insert_order(None, req).await.unwrap();

        // 同じ anonymous session で詳細を取りに行く → OK (= "決済直後の確認画面")
        let res = get_order_detail(st(), ext(session), Path(rec.id.to_string()))
            .await
            .unwrap();
        assert_eq!(res.0.order.amount_jpy, 3000);

        // 別 anonymous session では 404
        let other_session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, other_session).await.unwrap();
        match get_order_detail(st(), ext(other_session), Path(rec.id.to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound for other anonymous, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn order_detail_404_for_unknown_uuid() {
        let _g = lock_all();
        reset_all();
        let (session, _) = login_session().await;
        match get_order_detail(st(), ext(session), Path(Uuid::new_v4().to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn order_detail_404_for_invalid_uuid_path() {
        let _g = lock_all();
        reset_all();
        let (session, _) = login_session().await;
        match get_order_detail(st(), ext(session), Path("not-a-uuid".to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}
