use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}

/// `GET /health` — ヘルスチェック (= 常に `{ status: "ok" }`)。
///
/// **OpenAPI 非掲載**: `/api/v1` の外 (= ルート直下) にマウントされており、utoipa の
/// global `servers = ["/api/v1"]` と整合させられない (utoipa 5 は per-operation servers
/// 上書きに非対応)。infra/ops 用 endpoint なので OpenAPI 契約から外し、監視は別経路で持つ。
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}
