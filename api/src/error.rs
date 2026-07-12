//! API エラーの共通表現。
//!
//! `(StatusCode, String)` は axum が `IntoResponse` を実装済みのためタプルのまま使い、
//! 生成ヘルパだけをここに一元化する(auth / main での二重定義を解消)。

use axum::http::StatusCode;

pub type ApiError = (StatusCode, String);

pub fn internal<E: std::fmt::Display>(e: E) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

/// ドメイン書込の DB エラーは一律 422(一意制約違反・不正な日付など)
pub fn domain_err<E: std::fmt::Display>(e: E) -> ApiError {
    (StatusCode::UNPROCESSABLE_ENTITY, e.to_string())
}

pub fn unauthorized() -> ApiError {
    (StatusCode::UNAUTHORIZED, "ログインが必要です".to_string())
}

pub fn invalid(msg: &str) -> ApiError {
    (StatusCode::UNPROCESSABLE_ENTITY, msg.to_string())
}
