use axum::{
    Router,
    routing::{delete, get, patch, post},
};

use crate::handlers;
use crate::session::{csrf_middleware, session_middleware};
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
        // Phase 9.G: 認証 (= login flow)。register / login / logout / me を提供。
        // session_middleware が cookie の SessionId を extension に詰める前提で、
        // 各 handler は `Extension<SessionId>` 経由で識別子を受け取る。
        .route("/auth/register", post(handlers::auth::post_register))
        .route("/auth/login", post(handlers::auth::post_login))
        .route("/auth/logout", post(handlers::auth::post_logout))
        .route("/auth/me", get(handlers::auth::get_me))
        // PR N-5: パスワードリセット (= request → email link → confirm の 2 step)。
        // 両 endpoint 共に anonymous で叩ける (= login 不要 / cookie session で識別)。
        .route(
            "/auth/password_reset_request",
            post(handlers::auth::post_password_reset_request),
        )
        .route(
            "/auth/password_reset_confirm",
            post(handlers::auth::post_password_reset_confirm),
        )
        // 種マスタ (= /api/v1/species?locale=ja)。認証不要 / public。
        .route("/species", get(handlers::species::list_species))
        // 商品一覧 (= /api/v1/products?locale=ja)。認証不要 / public。
        // 既存 /cards/products は SDUI block 形式、本 endpoint は raw JSON で
        // CommandPalette / Hero / breadcrumb 等の軽量参照用。
        .route("/products", get(handlers::products::list_products))
        // Phase 9.D: 個体カルテ (specimens) 用 endpoint。
        // - /specimens/me と POST / archive は login 必須 (401)、GET /{public_id} は public 閲覧 OK。
        .route("/specimens/me", get(handlers::specimens::list_my_specimens))
        .route("/specimens", post(handlers::specimens::create_specimen))
        .route("/specimens/{public_id}", get(handlers::specimens::get_specimen))
        .route(
            "/specimens/{id}/archive",
            post(handlers::specimens::archive_specimen),
        )
        // 個体メモ更新 (= /specimens/{id}/notes PATCH)。owner 必須 / 空文字 = 削除。
        // PR #5b で localStorage 永続化を廃止して server 化。
        .route(
            "/specimens/{id}/notes",
            patch(handlers::specimens::patch_specimen_notes),
        )
        // 飼育ログ (= /specimens/{id}/logs)。{id} は specimen の internal UUID。
        .route(
            "/specimens/{id}/logs",
            get(handlers::specimen_logs::list_logs)
                .post(handlers::specimen_logs::create_log),
        )
        // 自分の全 specimen 横断ログ (= フロント listLogs() の DB 化)。login 必須。
        .route("/me/logs", get(handlers::specimen_logs::list_my_logs))
        // life_status 遷移 + 履歴 (= Medium #3 規律 / 必ず history 経由で更新)
        .route(
            "/specimens/{id}/life_status",
            post(handlers::specimens::change_life_status),
        )
        .route(
            "/specimens/{id}/status_history",
            get(handlers::specimens::list_status_history),
        )
        // 注文履歴 (= /orders/me)。Phase 9.G: orders.user_id を引いて自分の注文だけ返す。
        .route("/orders/me", get(handlers::orders::list_my_orders))
        // 注文詳細 (= /orders/{id})。所有者のみ閲覧可、line_items 込み。
        .route("/orders/{id}", get(handlers::orders::get_order_detail))
        // 交配記録 (= /mating_records)。breeder = current user に固定。
        .route(
            "/mating_records",
            post(handlers::mating_records::create_record),
        )
        .route(
            "/mating_records/me",
            get(handlers::mating_records::list_my_records),
        )
        .route(
            "/mating_records/{id}/status",
            post(handlers::mating_records::update_status_handler),
        )
        .route(
            "/mating_records/{id}/egg_count",
            post(handlers::mating_records::update_egg_count_handler),
        )
        // Phase 9.E: C2C marketplace (= listings / bids / listing_watches)。
        .route("/listings", get(handlers::listings::list_active))
        .route("/listings", post(handlers::listings::create_listing))
        .route("/listings/{public_id}", get(handlers::listings::get_listing))
        .route(
            "/listings/{id}/cancel",
            post(handlers::listings::cancel_listing),
        )
        .route("/listings/{id}/bids", post(handlers::listings::place_bid))
        .route(
            "/listings/{id}/watch",
            post(handlers::listings::toggle_watch_listing),
        )
        // Week 2 / F4: 画像アップロード基盤 (= local mode で完結する 3 リクエスト構成)。
        //   POST /uploads/sign            → asset 行を pending で作る + upload URL 返す
        //   PUT  /uploads/local/{id}      → local mode の body 受信 (dev 専用)
        //   POST /uploads/complete        → 完了通知 (= status を uploaded に遷移)
        //   GET  /assets/{id}             → public 取得 (= image src 用)
        .route("/uploads/sign", post(handlers::uploads::post_sign))
        .route(
            "/uploads/local/{asset_id}",
            axum::routing::put(handlers::uploads::put_local_upload),
        )
        .route("/uploads/complete", post(handlers::uploads::post_complete))
        .route("/assets/{asset_id}", get(handlers::uploads::get_asset))
        // Phase 9.E 補助: 全 /api/v1/* に session middleware を適用。
        // /health は外側 (main.rs::build_app) で別途 nest しているので影響なし。
        // `from_fn_with_state` で middleware に AppState を渡し、新規 session 発行時に
        // user_sessions テーブルへ INSERT する (= pool 不在時はスキップ)。
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            session_middleware,
        ))
        // Phase 9.x hardening: CSRF (= Origin ヘッダ照合)。state-changing メソッドのみ。
        // session_middleware より外側 (= 後に追加 = 先に走る) に置き、Origin 不一致は
        // session 発行前に 403 で弾く。stripe webhook は middleware 内部で path で skip。
        .layer(axum::middleware::from_fn(csrf_middleware))
        .with_state(state)
}
