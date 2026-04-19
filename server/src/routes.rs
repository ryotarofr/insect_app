use axum::{Router, routing::get};

use crate::handlers;

/// `/api/v1` 配下のルート定義。
///
/// 機能追加時はここに `.nest()` または `.route()` を追加していく。
/// 例：
///   .nest("/specimens", specimens::router())
///   .nest("/orders", orders::router())
pub fn api_v1() -> Router {
    Router::new().route("/hello", get(handlers::hello::hello))
}
