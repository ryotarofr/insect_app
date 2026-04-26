use axum::{
    Router,
    routing::{delete, get, patch, post},
};

use crate::handlers;
use crate::session::session_middleware;
use crate::state::AppState;

/// `/api/v1` 配下のルート定義。
///
/// 機能追加時はここに `.nest()` または `.route()` を追加していく。
/// 例：
///   .nest("/specimens", specimens::router())
///   .nest("/orders", orders::router())
///
/// **Phase 9.x AppState 配線**:
///   呼び出し側 (= main.rs::build_app) から `AppState` を受け取り、最後に
///   `with_state(state)` で全 route に注入する。`State<AppState>` を受け取る
///   handler だけが pool にアクセスする (= 既存 handler は変更不要)。
pub fn api_v1(state: AppState) -> Router {
    Router::new()
        .route("/hello", get(handlers::hello::hello))
        // SDUI: 商品ハイライトカード (product_feature)。詳細は handlers::cards 参照。
        // **登録順注意**: より具体的な `/{id}` の前に list (`/`) を置く必要はないが、
        // axum 0.8 は path 衝突しないかぎり順不同。明示的に list を上に書くと
        // ハンドラ追加時の見落としが減る。
        .route("/cards/products", get(handlers::cards::list_product_cards))
        .route(
            "/cards/products/{id}",
            get(handlers::cards::get_product_card),
        )
        // 詳細ページ用 (product_detail テンプレート)。
        // 一覧 (`product_feature`) と詳細では region 構成が違うため別エンドポイント。
        .route(
            "/cards/products/{id}/detail",
            get(handlers::cards::get_product_detail_card),
        )
        // Phase 7: カート画面 (cart テンプレート)。
        // プロセス内 cart store のスナップショットを CardBlock::Cart に組み直して返す。
        // 1 ユーザにつき 1 枚しかないので path に id を取らず固定 endpoint。
        .route("/cards/cart", get(handlers::cards::get_cart_card))
        // SDUI Action endpoints (Phase 2.5 / 7):
        //   - POST   /cart                    → カート追加 (returns undoToken)
        //   - DELETE /cart/items/{token}      → Undo / 削除 (Toast から / Cart 画面の "削除" から)
        //   - PATCH  /cart/items/{token}      → qty 直接書き換え (Phase 7: +/- ボタン)
        //   - POST   /watch/{productId}       → ウォッチトグル
        // クライアント側 CtaBlockView / LineItemView がこれらを呼ぶ。詳細は各ハンドラ参照。
        .route("/cart", post(handlers::cart::add_to_cart))
        .route(
            "/cart/items/{token}",
            delete(handlers::cart::delete_cart_item).patch(handlers::cart::patch_cart_item),
        )
        .route("/watch/{product_id}", post(handlers::watch::toggle_watch))
        // Phase 8: チェックアウト (配送先 / 配送方法) 用 PATCH エンドポイント。
        //   - PATCH /checkout/shipping_field/{name} → 配送先 1 フィールドを更新
        //   - PATCH /checkout/shipping_method      → 配送方法 (cold / normal) を切替
        //   - GET   /checkout                      → 現在 state の snapshot (debug 用)
        // クライアント側 FormFieldView / ShippingMethodPickerView がこれらを呼ぶ。
        .route(
            "/checkout/shipping_field/{name}",
            patch(handlers::checkout::patch_shipping_field),
        )
        .route(
            "/checkout/shipping_method",
            patch(handlers::checkout::patch_shipping_method),
        )
        .route("/checkout", get(handlers::checkout::get_checkout_snapshot))
        // Phase 9.1: Stripe Checkout 統合 (mock provider)。
        // クライアント (CtaBlockView の stripe_checkout 分岐) が叩く。
        // レスポンス JSON `{ orderId, sessionUrl }` の sessionUrl で window.location.href 遷移。
        .route(
            "/checkout/submit",
            post(handlers::checkout::post_checkout_submit),
        )
        // SDUI Analytics ingest (Phase 3):
        //   - POST /events           → batch ingest (impression / click)
        //   - GET  /events?limit=N   → 直近 N 件 (debug 用、新しい順)
        // クライアント側 sdui/analytics.ts が定期 flush で叩く。
        .route("/events", post(handlers::events::post_events))
        .route("/events", get(handlers::events::list_events))
        // Phase 9.1: Stripe webhook stub (HMAC 検証は scaffolding)。
        // 本番では POST /api/v1/stripe/webhook に Stripe の event が届く。
        // 現状は MockStripeEvent を JSON で受け、orders.status を遷移させる。
        .route(
            "/stripe/webhook",
            post(handlers::stripe_webhook::post_stripe_webhook),
        )
        // Phase 9.E 補助: 全 /api/v1/* に session middleware を適用。
        // /health は外側 (main.rs::build_app) で別途 nest しているので影響なし。
        // `from_fn_with_state` で middleware に AppState を渡し、新規 session 発行時に
        // user_sessions テーブルへ INSERT する (= pool 不在時はスキップ)。
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            session_middleware,
        ))
        .with_state(state)
}
