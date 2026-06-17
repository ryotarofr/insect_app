use axum::{
    Router,
    routing::{delete, get, patch, post},
};

use crate::handlers;
use crate::session::{csrf_middleware, session_middleware};
use crate::state::AppState;

/// `/api/v1` 配下のルート定義。
///
/// ルートはドメインごとに `*_routes()` ヘルパーへ分割し、ここで `.merge()` する。
/// 機能追加時は該当ドメインのヘルパーに `.route()` を足すか、新ドメインなら
/// `*_routes()` を新設して merge 行を 1 行追加する。
///
/// **AppState 配線**:
///   呼び出し側 (= main.rs::build_app) から `AppState` を受け取り、最後に
///   `with_state(state)` で全 route に注入する。`State<AppState>` を受け取る
///   handler だけが pool にアクセスする (= 既存 handler は変更不要)。
pub fn api_v1(state: AppState) -> Router {
    Router::new()
        .route("/hello", get(handlers::hello::hello))
        .merge(cart_routes())
        .merge(checkout_routes())
        .merge(events_routes())
        .merge(stripe_webhook_routes())
        .merge(auth_routes())
        .merge(account_routes())
        .merge(master_routes())
        .merge(specimen_routes())
        .merge(order_routes())
        .merge(mating_record_routes())
        .merge(cohort_routes())
        .merge(listing_routes())
        .merge(upload_routes())
        // 全 /api/v1/* に session middleware を適用。
        // /health は外側 (main.rs::build_app) で別途 nest しているので影響なし。
        // `from_fn_with_state` で middleware に AppState を渡し、新規 session 発行時に
        // user_sessions テーブルへ INSERT する (= pool 不在時はスキップ)。
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            session_middleware,
        ))
        // CSRF (= Origin ヘッダ照合)。state-changing メソッドのみ。
        // session_middleware より外側 (= 後に追加 = 先に走る) に置き、Origin 不一致は
        // session 発行前に 403 で弾く。stripe webhook は middleware 内部で path で skip。
        .layer(axum::middleware::from_fn(csrf_middleware))
        .with_state(state)
}

/// カート操作 (action endpoint は listing_id を受ける形)。
///   - POST   /cart                    → カート追加 ({ listingId })
///   - DELETE /cart/items/{token}      → Undo / 削除
///   - PATCH  /cart/items/{token}      → qty 直接書き換え
///
/// cart の SDUI カード生成はクライアント側で listings から組み立てる暫定方針。
fn cart_routes() -> Router<AppState> {
    Router::new()
        .route("/cart", post(handlers::cart::add_to_cart))
        .route(
            "/cart/items/{token}",
            delete(handlers::cart::delete_cart_item).patch(handlers::cart::patch_cart_item),
        )
}

/// チェックアウト (配送先 / 配送方法、Stripe Checkout 統合)。
///   - PATCH /checkout/shipping_field/{name} → 配送先 1 フィールドを更新
///   - PATCH /checkout/shipping_method      → 配送方法 (cold / normal) を切替
///   - GET   /checkout                      → 現在 state の snapshot (debug 用)
///   - POST  /checkout/submit               → `{ orderId, sessionUrl }` を返す
///
/// クライアント側 FormFieldView / ShippingMethodPickerView / CtaBlockView が叩く。
fn checkout_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/checkout/shipping_field/{name}",
            patch(handlers::checkout::patch_shipping_field),
        )
        .route(
            "/checkout/shipping_method",
            patch(handlers::checkout::patch_shipping_method),
        )
        .route("/checkout", get(handlers::checkout::get_checkout_snapshot))
        .route(
            "/checkout/submit",
            post(handlers::checkout::post_checkout_submit),
        )
}

/// SDUI Analytics ingest。
///   - POST /events           → batch ingest (impression / click)
///   - GET  /events?limit=N   → 直近 N 件 (debug 用、新しい順)
///
/// クライアント側 sdui/analytics.ts が定期 flush で叩く。
fn events_routes() -> Router<AppState> {
    Router::new()
        .route("/events", post(handlers::events::post_events))
        .route("/events", get(handlers::events::list_events))
}

/// Stripe webhook (決済、Connect)。
///   - POST /stripe/webhook         → 決済 event (orders.status を遷移)
///   - POST /stripe/connect_webhook → account.updated 等 (別 signing secret)
///
/// 本番では Stripe から event が届く。dev では Mock event を JSON で受ける。
fn stripe_webhook_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/stripe/webhook",
            post(handlers::stripe_webhook::post_stripe_webhook),
        )
        .route(
            "/stripe/connect_webhook",
            post(handlers::stripe_connect_webhook::post_stripe_connect_webhook),
        )
}

/// 認証 (login flow + パスワードリセット)。
///   - register / login / logout / me
///   - password_reset_request / password_reset_confirm (anonymous で叩ける)
///
/// session_middleware が cookie の SessionId を extension に詰める前提で、
/// 各 handler は `Extension<SessionId>` 経由で識別子を受け取る。
fn auth_routes() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(handlers::auth::post_register))
        .route("/auth/login", post(handlers::auth::post_login))
        .route("/auth/logout", post(handlers::auth::post_logout))
        .route("/auth/me", get(handlers::auth::get_me))
        .route(
            "/auth/password_reset_request",
            post(handlers::auth::post_password_reset_request),
        )
        .route(
            "/auth/password_reset_confirm",
            post(handlers::auth::post_password_reset_confirm),
        )
}

/// アカウント設定 (Stripe Connect 連携 = 出品者の売上受取口座)。login 必須。
fn account_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/account/stripe_connect/onboarding",
            post(handlers::account_stripe_connect::post_onboarding),
        )
        .route(
            "/account/stripe_connect/status",
            get(handlers::account_stripe_connect::get_status),
        )
}

/// マスタ参照 (認証不要 / public)。
///   - GET /species          → 種マスタ (?locale=ja)
///   - GET /shipping_methods  → 配送方法マスタ (wizard Step 3 で使う)
fn master_routes() -> Router<AppState> {
    Router::new()
        .route("/species", get(handlers::species::list_species))
        .route(
            "/shipping_methods",
            get(handlers::shipping_methods::list_active),
        )
}

/// 個体カルテ (specimens) + 飼育ログ + life_status 履歴。
///   - /specimens/me, POST /specimens, /archive は login 必須
///   - GET /specimens/{public_id} は public 閲覧 OK
///   - {id} は specimen の internal UUID
fn specimen_routes() -> Router<AppState> {
    Router::new()
        .route("/specimens/me", get(handlers::specimens::list_my_specimens))
        .route("/specimens/search", get(handlers::specimens::search_specimens))
        .route("/specimens", post(handlers::specimens::create_specimen))
        .route("/specimens/{public_id}", get(handlers::specimens::get_specimen))
        .route(
            "/specimens/{id}/archive",
            post(handlers::specimens::archive_specimen),
        )
        // 個体メモ更新 (owner 必須 / 空文字 = 削除)。
        .route(
            "/specimens/{id}/notes",
            patch(handlers::specimens::patch_specimen_notes),
        )
        .route(
            "/specimens/{id}/logs",
            get(handlers::specimen_logs::list_logs)
                .post(handlers::specimen_logs::create_log),
        )
        // 自分の全 specimen 横断ログ (= フロント listLogs() の DB 化)。login 必須。
        .route("/me/logs", get(handlers::specimen_logs::list_my_logs))
        // life_status 遷移 + 履歴 (= Medium #3 規律 / 必ず history 経由で更新)。
        .route(
            "/specimens/{id}/life_status",
            post(handlers::specimens::change_life_status),
        )
        .route(
            "/specimens/{id}/status_history",
            get(handlers::specimens::list_status_history),
        )
}

/// 注文。
///   - GET /orders/me    → orders.user_id を引いて自分の注文だけ返す
///   - GET /orders/{id}  → 注文詳細 (所有者のみ閲覧可、line_items 込み)
fn order_routes() -> Router<AppState> {
    Router::new()
        .route("/orders/me", get(handlers::orders::list_my_orders))
        .route("/orders/{id}", get(handlers::orders::get_order_detail))
}

/// 交配記録 (= /mating_records)。breeder = current user に固定。
fn mating_record_routes() -> Router<AppState> {
    Router::new()
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
}

/// 群飼育 (Cohort / = /cohorts)。
fn cohort_routes() -> Router<AppState> {
    Router::new()
        .route("/cohorts/me", get(handlers::cohorts::list_my_cohorts))
        .route("/cohorts", post(handlers::cohorts::create_cohort))
        .route("/cohorts/{public_id}", get(handlers::cohorts::get_cohort))
        .route(
            "/cohorts/{public_id}/promote",
            post(handlers::cohorts::promote_cohort),
        )
        .route(
            "/cohorts/{public_id}/archive",
            post(handlers::cohorts::archive_cohort),
        )
        .route(
            "/cohorts/{public_id}/cohort_logs",
            post(handlers::cohorts::add_cohort_log),
        )
}

/// C2C marketplace (listings / bids / listing_watches)。
///
/// 静的 `/listings/me` を `{public_id}` より先に定義し、axum 0.8 の
/// "static-first" routing でも意図を明示する。
fn listing_routes() -> Router<AppState> {
    Router::new()
        .route("/listings", get(handlers::listings::list_active))
        .route("/listings", post(handlers::listings::create_listing))
        .route("/listings/me", get(handlers::listings::list_my_listings))
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
}

/// 画像アップロード基盤 (local mode で完結する 3 リクエスト構成)。
///   POST /uploads/sign       → asset 行を pending で作る + upload URL 返す
///   PUT  /uploads/local/{id} → local mode の body 受信 (dev 専用)
///   POST /uploads/complete   → 完了通知 (= status を uploaded に遷移)
///   GET  /assets/{id}        → public 取得 (= image src 用)
fn upload_routes() -> Router<AppState> {
    Router::new()
        .route("/uploads/sign", post(handlers::uploads::post_sign))
        .route(
            "/uploads/local/{asset_id}",
            axum::routing::put(handlers::uploads::put_local_upload),
        )
        .route("/uploads/complete", post(handlers::uploads::post_complete))
        .route("/assets/{asset_id}", get(handlers::uploads::get_asset))
}
