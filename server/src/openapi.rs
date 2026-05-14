//! OpenAPI 仕様書
//!
//! **責務**:
//!   - 全 handler / DTO を `#[derive(utoipa::OpenApi)]` で 1 つの `ApiDoc` に集約
//!   - `runtime_openapi_json()` で JSON を生成 (= CI で fetch して TS 型生成に流す)
//!   - `/openapi.json` + `/swagger-ui` の Router を提供 (= axum と統合)
//!
//! **設計判断**:
//!   - **段階的に handler を追加**: `paths(handlers::auth::post_register, ...)` の
//!     ように 1 つずつ足していく。
//!   - **error schema 統一**: `AppError` 由来の error response を `ErrorResponse` 1 種に固定
//!     (= 全 endpoint で `{ "error": "..." }` 形式)
//!   - **info 設定**: title / version は workspace metadata から取らず手動指定 (= MVP)。
//!     将来 `cargo metadata` 経由で拾う
//!
//! ## Coverage matrix
//!
//! | tag       | endpoints | DTO 戦略                                    |
//! |-----------|-----------|---------------------------------------------|
//! | auth      | 6         | フル型化                                    |
//! | products  | 1 + watch | フル型化                                  |
//! | species   | 1         | フル型化                                    |
//! | specimens | 7 + 3 (logs) | フル型化                              |
//! | listings  | 6         | フル型化                                    |
//! | cart      | 3         | フル型化                                    |
//! | orders    | 2         | フル型化 (= flatten は allOf で表現)       |
//! | checkout  | 4         | フル型化                                    |
//! | uploads   | 4         | フル型化 (binary は `String` + octet-stream) |
//! | mating    | 4         | フル型化                                    |
//! | events    | 2         | フル型化 (sdui::analytics への ToSchema 派生) |
//! | cards     | 4         | **opaque body** (= `serde_json::Value`)     |
//!
//! ## OpenAPI 非掲載 (= rationale 付き)
//!
//! - **`/health`** ([handlers::health]): `/api/v1` の外 (= ルート直下) に mount されている。
//!   utoipa 5 は per-operation `servers` 上書きをサポートしないため、global
//!   `servers = ["/api/v1"]` と整合させると spec が `/api/v1/health` 扱いになり実態と乖離する。
//!   infra/ops 用 endpoint なので OpenAPI 契約から外し、監視は別経路で持つ。
//! - **Stripe webhook** ([handlers::stripe_webhook]): Stripe → server の片方向。
//!   フロント client は存在せず OpenAPI 化の価値が低い。Stripe 側仕様 (= 公式 SDK) が真実。
//! - **`/hello`** ([handlers::hello]): demo / smoke test 用。削除候補。
//! - **`specimen_fulfillment::fulfill_paid_order`** ([handlers::specimen_fulfillment]):
//!   HTTP handler ではなく内部関数 (= stripe_webhook から呼ばれる)。OpenAPI 対象外。
//!
//! ## SDUI 型化の方針 (= cards `opaque body` の根拠)
//!
//! [crate::sdui] 配下の Block / Region 型 (`CardBlock` 等 46 struct/enum) は既に
//! [ts-rs](https://github.com/Aleph-Alpha/ts-rs) で TypeScript に bind されており、
//! フロントは [client_solid/src/sdui](../../client_solid/src/sdui) 側でこれを真実値として
//! Block 構造を validate する。utoipa で同じ型を二重定義すると、serde 特殊属性
//! (`tag = "kind"` の polymorphic enum / `flatten` 等) のすり合わせコストが大きく、
//! かつ schema 衝突対策も必要になる。
//!
//! そのため、cards の HTTP 経路は OpenAPI 上 `body = serde_json::Value` (= opaque object) で
//! URL surface だけ documentate し、Block 内部構造は ts-rs 側に委ねる方針を採る。
//! 後続で必要が出れば独立して SDUI 型の utoipa 化を進められる。

use axum::Router;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

/// 全 endpoint の共通エラーレスポンス。
/// `AppError::IntoResponse` の出力形式 `{ "error": "<message>" }` と完全一致。
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ErrorResponse {
    /// エラーメッセージ (= 人間向け、英語 / 日本語混在)。
    pub error: String,
}

/// OpenAPI 仕様書 root。`utoipa::OpenApi` derive で `paths(...)` / `components(schemas(...))` を集約。
///
/// **追加方法**: handler に `#[utoipa::path]` を付け、`paths(...)` リストに足す。
/// DTO に `#[derive(utoipa::ToSchema)]` を付け、`components(schemas(...))` リストに足す。
#[derive(OpenApi)]
#[openapi(
    info(
        title = "KOCHU API",
        version = "0.1.0",
        description = "昆虫EC × 飼育管理プラットフォームの REST API",
        contact(
            name = "KOCHU dev",
            email = "dev@kochu.example"
        )
    ),
    servers(
        (url = "/api/v1", description = "v1 API base"),
    ),
    paths(
        // auth (= 6 endpoint)
        crate::handlers::auth::post_register,
        crate::handlers::auth::post_login,
        crate::handlers::auth::post_logout,
        crate::handlers::auth::get_me,
        crate::handlers::auth::post_password_reset_request,
        crate::handlers::auth::post_password_reset_confirm,
        crate::handlers::species::list_species,
        // 配送方法マスタ
        crate::handlers::shipping_methods::list_active,
        // Stripe Connect オンボーディング
        crate::handlers::account_stripe_connect::post_onboarding,
        crate::handlers::account_stripe_connect::get_status,
        // 飼育ログ (specimen_logs)
        crate::handlers::specimen_logs::list_my_logs,
        crate::handlers::specimen_logs::list_logs,
        crate::handlers::specimen_logs::create_log,
        // C2C marketplace (listings)
        crate::handlers::listings::list_active,
        crate::handlers::listings::list_my_listings,
        crate::handlers::listings::create_listing,
        crate::handlers::listings::get_listing,
        crate::handlers::listings::cancel_listing,
        crate::handlers::listings::place_bid,
        crate::handlers::listings::toggle_watch_listing,
        // 個体カルテ (specimens)
        crate::handlers::specimens::list_my_specimens,
        crate::handlers::specimens::create_specimen,
        crate::handlers::specimens::get_specimen,
        crate::handlers::specimens::change_life_status,
        crate::handlers::specimens::list_status_history,
        crate::handlers::specimens::patch_specimen_notes,
        crate::handlers::specimens::archive_specimen,
        // cart + orders (= EC 閲覧フロー)
        crate::handlers::cart::add_to_cart,
        crate::handlers::cart::delete_cart_item,
        crate::handlers::cart::patch_cart_item,
        crate::handlers::orders::list_my_orders,
        crate::handlers::orders::get_order_detail,
        // checkout (= 配送先 + Stripe submit)
        crate::handlers::checkout::patch_shipping_field,
        crate::handlers::checkout::patch_shipping_method,
        crate::handlers::checkout::get_checkout_snapshot,
        crate::handlers::checkout::post_checkout_submit,
        // 画像アップロード基盤 (uploads + assets)
        crate::handlers::uploads::post_sign,
        crate::handlers::uploads::put_local_upload,
        crate::handlers::uploads::post_complete,
        crate::handlers::uploads::get_asset,
        // 交配記録 (mating_records)
        crate::handlers::mating_records::create_record,
        crate::handlers::mating_records::list_my_records,
        crate::handlers::mating_records::update_status_handler,
        crate::handlers::mating_records::update_egg_count_handler,
        // SDUI analytics ingest (events)
        crate::handlers::events::post_events,
        crate::handlers::events::list_events,
        // cohorts (= 群飼育 6 endpoint)。`/cohorts/me` 一覧 / 作成 / 詳細 /
        //   個体化 (promote) / archive / cohort_log 追加。詳細 DTO は handlers::cohorts。
        crate::handlers::cohorts::list_my_cohorts,
        crate::handlers::cohorts::create_cohort,
        crate::handlers::cohorts::get_cohort,
        crate::handlers::cohorts::promote_cohort,
        crate::handlers::cohorts::archive_cohort,
        crate::handlers::cohorts::add_cohort_log,
        // 非掲載 endpoint と rationale は本ファイルの module doc コメントを参照。
    ),
    components(
        schemas(
            ErrorResponse,
            // auth DTO
            crate::handlers::auth::RegisterRequest,
            crate::handlers::auth::RegisterResponse,
            crate::handlers::auth::LoginRequest,
            crate::handlers::auth::LoginResponse,
            crate::handlers::auth::MeResponse,
            crate::handlers::auth::PasswordResetRequest,
            crate::handlers::auth::PasswordResetConfirmRequest,
            crate::handlers::species::SpeciesResponse,
            // 配送方法マスタ
            crate::handlers::shipping_methods::ShippingMethodResponse,
            // Stripe Connect DTO
            crate::handlers::account_stripe_connect::OnboardingResponse,
            crate::handlers::account_stripe_connect::ConnectStatusResponse,
            // 飼育ログ DTO
            crate::handlers::specimen_logs::SpecimenLogView,
            crate::handlers::specimen_logs::CreateSpecimenLogRequest,
            crate::handlers::specimen_logs::CreateSpecimenLogResponse,
            // marketplace DTO
            crate::handlers::listings::ListingView,
            crate::handlers::listings::ListingViewWithCounts,
            crate::handlers::listings::CreateListingRequest,
            crate::handlers::listings::CreateListingResponse,
            crate::handlers::listings::PlaceBidRequest,
            crate::handlers::listings::PlaceBidResponse,
            crate::handlers::listings::ToggleWatchResponse,
            // 個体カルテ DTO
            crate::handlers::specimens::SpecimenView,
            crate::handlers::specimens::CreateSpecimenRequest,
            crate::handlers::specimens::CreateSpecimenResponse,
            crate::handlers::specimens::ChangeLifeStatusRequest,
            crate::handlers::specimens::StatusHistoryView,
            crate::handlers::specimens::UpdateNotesRequest,
            // cart + orders DTO
            crate::handlers::cart::AddToCartRequest,
            crate::handlers::cart::AddToCartResponse,
            crate::handlers::cart::PatchCartItemRequest,
            crate::handlers::cart::PatchCartItemResponse,
            crate::handlers::orders::OrderView,
            crate::handlers::orders::OrderLineView,
            crate::handlers::orders::OrderDetailView,
            // checkout DTO
            crate::handlers::checkout::PatchShippingFieldRequest,
            crate::handlers::checkout::PatchShippingFieldResponse,
            crate::handlers::checkout::PatchShippingMethodRequest,
            crate::handlers::checkout::PatchShippingMethodResponse,
            crate::handlers::checkout::CheckoutSnapshotResponse,
            crate::handlers::checkout::CheckoutSubmitResponse,
            // uploads DTO
            crate::handlers::uploads::SignRequest,
            crate::handlers::uploads::SignResponse,
            crate::handlers::uploads::CompleteRequest,
            crate::handlers::uploads::CompleteResponse,
            // 交配記録 DTO
            crate::handlers::mating_records::MatingRecordView,
            crate::handlers::mating_records::CreateMatingRequest,
            crate::handlers::mating_records::CreateMatingResponse,
            crate::handlers::mating_records::UpdateStatusRequest,
            crate::handlers::mating_records::UpdateEggCountRequest,
            // SDUI analytics DTO
            crate::sdui::analytics::AnalyticsEvent,
            crate::sdui::analytics::AnalyticsEventBatch,
            crate::sdui::analytics::AnalyticsEventType,
            // cohorts DTO (= 群飼育)
            crate::handlers::cohorts::CohortView,
            crate::handlers::cohorts::CohortLogView,
            crate::handlers::cohorts::CohortDetailView,
            crate::handlers::cohorts::CreateCohortRequest,
            crate::handlers::cohorts::CreateCohortResponse,
            crate::handlers::cohorts::PromoteSpecimenPayload,
            crate::handlers::cohorts::PromoteLogPayload,
            crate::handlers::cohorts::PromoteCohortRequest,
            crate::handlers::cohorts::PromoteCohortResponse,
            crate::handlers::cohorts::PromotedSpecimenView,
            crate::handlers::cohorts::PromoteSessionState,
            crate::handlers::cohorts::CreateCohortLogRequest,
        )
    ),
    tags(
        // tag は handler 側で `tag = "..."` 指定で参照される。
        (name = "auth", description = "認証 / セッション"),
        (name = "specimens", description = "個体カルテ"),
        (name = "orders", description = "取引履歴"),
        (name = "cart", description = "カート (C2C 出品入り)"),
        (name = "checkout", description = "チェックアウト"),
        (name = "listings", description = "C2C マーケットプレイス"),
        (name = "uploads", description = "画像 / アセットアップロード"),
        (name = "species", description = "種マスタ"),
        (name = "mating", description = "交配記録"),
        (name = "events", description = "SDUI analytics"),
        (name = "stripe", description = "Stripe webhook"),
        (name = "meta", description = "ヘルスチェック / メタ情報"),
        (name = "cards", description = "SDUI Card blocks (= /cards/*, opaque body)"),
        (name = "cohorts", description = "群飼育 (= /cohorts/*)"),
    ),
)]
pub struct ApiDoc;

/// `/openapi.json` + `/swagger-ui` の Router を生成。
///
/// 利用側:
/// ```ignore
/// let api_router = openapi::router();
/// let app = Router::new().merge(api_router).nest("/api/v1", routes::api_v1(state));
/// ```
pub fn router() -> Router {
    Router::new().merge(
        SwaggerUi::new("/swagger-ui")
            .url("/openapi.json", ApiDoc::openapi()),
    )
}

/// CI / ops 用に OpenAPI JSON 文字列を返す。`bun run gen:openapi` から server 起動して
/// `/openapi.json` を fetch しても良いし、本関数を直接呼ぶ binary を用意しても良い。
pub fn runtime_openapi_json() -> String {
    ApiDoc::openapi()
        .to_pretty_json()
        .unwrap_or_else(|e| format!("{{\"error\": \"openapi serialization failed: {e}\"}}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openapi_json_can_be_serialized() {
        let json = runtime_openapi_json();
        assert!(json.contains("KOCHU API"));
        assert!(json.contains("openapi"));
        // ErrorResponse schema が含まれていること
        assert!(json.contains("ErrorResponse"));
    }

    #[test]
    fn openapi_has_expected_tags() {
        let json = runtime_openapi_json();
        for tag in ["auth", "specimens", "orders", "cart", "listings"] {
            assert!(json.contains(tag), "tag {tag} not found in openapi");
        }
    }
}
