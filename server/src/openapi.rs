//! OpenAPI 仕様書 (Phase 1 / A1)
//!
//! **責務**:
//!   - 全 handler / DTO を `#[derive(utoipa::OpenApi)]` で 1 つの `ApiDoc` に集約
//!   - `runtime_openapi_json()` で JSON を生成 (= CI で fetch して TS 型生成に流す)
//!   - `/openapi.json` + `/swagger-ui` の Router を提供 (= axum と統合)
//!
//! **設計判断**:
//!   - **段階的に handler を追加**: PR O-1 では空の `paths(...)` で skeleton のみ。
//!     PR O-2 以降で `paths(handlers::auth::post_register, ...)` のように足していく。
//!   - **error schema 統一**: `AppError` 由来の error response を `ErrorResponse` 1 種に固定
//!     (= 全 endpoint で `{ "error": "..." }` 形式)
//!   - **info 設定**: title / version は workspace metadata から取らず手動指定 (= MVP)。
//!     将来 `cargo metadata` 経由で拾う

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
        // PR O-2: auth (= 6 endpoint)
        crate::handlers::auth::post_register,
        crate::handlers::auth::post_login,
        crate::handlers::auth::post_logout,
        crate::handlers::auth::get_me,
        crate::handlers::auth::post_password_reset_request,
        crate::handlers::auth::post_password_reset_confirm,
        // PR O-3 以降で追加していく。
    ),
    components(
        schemas(
            ErrorResponse,
            // PR O-2: auth DTO
            crate::handlers::auth::RegisterRequest,
            crate::handlers::auth::RegisterResponse,
            crate::handlers::auth::LoginRequest,
            crate::handlers::auth::LoginResponse,
            crate::handlers::auth::MeResponse,
            crate::handlers::auth::PasswordResetRequest,
            crate::handlers::auth::PasswordResetConfirmRequest,
        )
    ),
    tags(
        // tag は handler 側で `tag = "..."` 指定で参照される。
        (name = "auth", description = "認証 / セッション"),
        (name = "products", description = "商品マスタ"),
        (name = "specimens", description = "個体カルテ"),
        (name = "orders", description = "注文"),
        (name = "cart", description = "カート"),
        (name = "checkout", description = "チェックアウト"),
        (name = "listings", description = "C2C マーケットプレイス"),
        (name = "uploads", description = "画像 / アセットアップロード"),
        (name = "species", description = "種マスタ"),
        (name = "events", description = "SDUI analytics"),
        (name = "stripe", description = "Stripe webhook"),
        (name = "meta", description = "ヘルスチェック / メタ情報"),
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
