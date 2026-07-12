//! insect_app_r2 API — SDUI 最小POC
//!
//! 検証仮説: 閉じたスキーマ + DB管理の画面定義なら、AIエージェントが安全に画面を運用できる。
//! 設計の詳細は `docs/PLAN.md`。

pub mod auth;
pub mod error;
pub mod hydrate;
pub mod sdui;

/// アプリ共有状態(main と extractor の両方から使うため lib 側に置く)
#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}
