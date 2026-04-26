//! axum AppState: handler 共有状態 (Phase 9.x / DB pool 配線)
//!
//! **責務**:
//!   - PgPool (= sqlx 接続プール) を `Option<PgPool>` で持ち、handler から
//!     `axum::extract::State<AppState>` で取り出せるようにする。
//!   - `Option` にしている理由は `db::try_init_pool()` が DB 不在を許容する
//!     (= MVP の dev 環境 / pool なしでも server を起動できる) ため。
//!
//! **設計判断**:
//!   - `Clone` 派生: axum の `State<S>` は `S: Clone` を要求する。`PgPool` は
//!     内部で Arc を持つので clone は安価 (= 参照カウントの増分のみ)。
//!   - `Default` 派生: ハンドラの単体テストで `State(AppState::default())` を
//!     渡せると便利。デフォルトは pool 無し (= 全 repo 呼び出しが in-memory
//!     fallback に倒れる)。
//!   - 将来 `cookie_secret` / `feature_flags` / `metrics_handle` 等を持たせる
//!     ならここに足す。フィールド追加は破壊的でないので AppState を 1 箇所に
//!     集めておく価値が高い。

use sqlx::PgPool;

/// handler 共通の dependency container。
///
/// 通常は `main.rs` で `db::try_init_pool().await` の結果を `db` に詰めて構築する。
/// テストや bench では `AppState::default()` で pool 無しを表現できる。
#[derive(Clone, Default, Debug)]
pub struct AppState {
    /// PostgreSQL 接続プール。`None` の場合は repo が in-memory fallback に倒れる。
    pub db: Option<PgPool>,
}

impl AppState {
    /// pool がある場合のみ `&PgPool` を返す。多くの repo 関数がこの形を受け取る。
    pub fn db(&self) -> Option<&PgPool> {
        self.db.as_ref()
    }
}
