//! `insect_app_server` ライブラリエントリ。
//!
//! バイナリ (`main.rs`) と integration test (`tests/`) の両方からアクセスできるよう、
//! 各モジュールを `pub mod` で公開する。
//! 旧来 `main.rs` 側の `mod` 宣言は本ファイルに移管した。

pub mod db;
pub mod error;
pub mod handlers;
pub mod repos;
pub mod routes;
pub mod sdui;
pub mod stripe;
