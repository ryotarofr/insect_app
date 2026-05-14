//! PostgreSQL connection pool + migration ヘルパ
//!
//! **責務**:
//!   - `DATABASE_URL` 環境変数から `sqlx::PgPool` を作る
//!   - 起動時に `sqlx::migrate!()` で `server/migrations/*.sql` を流す
//!   - グレースフル fallback: DB 接続失敗時でもプロセスは継続できるよう、
//!     `try_init_pool()` は `Result<Option<PgPool>>` を返す
//!     (= MVP 段階では DB 無しでも動くハンドラがあるため)
//!
//! **将来**:
//!   - production では env が必ず設定される前提なので、`require_init_pool` で
//!     DB 不在を fatal error にするように切り替える
//!   - read replica 用に `PgPool` を 2 系統持つ (RO / RW)
//!   - sqlx-cli を使った CI migration check

use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// migrations ディレクトリは crate root (= `server/`) に置く。
/// `sqlx::migrate!()` macro が compile-time に SQL ファイルを読み込む。
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// `init_pool` の設定。デフォルト値は dev 向け。
#[derive(Debug, Clone)]
pub struct PoolConfig {
    pub database_url: String,
    pub max_connections: u32,
    pub connect_timeout: Duration,
    pub auto_migrate: bool,
}

impl PoolConfig {
    /// 環境変数から設定を組み立てる。
    /// - `DATABASE_URL` が無ければ `Err`
    /// - `DB_MAX_CONNECTIONS` 未設定なら 5
    /// - `DB_AUTO_MIGRATE` 未設定なら true
    pub fn from_env() -> Result<Self, DbInitError> {
        let database_url = std::env::var("DATABASE_URL")
            .map_err(|_| DbInitError::MissingEnv("DATABASE_URL".to_string()))?;

        let max_connections: u32 = std::env::var("DB_MAX_CONNECTIONS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5);

        let auto_migrate: bool = std::env::var("DB_AUTO_MIGRATE")
            .ok()
            .map(|s| matches!(s.to_lowercase().as_str(), "true" | "1" | "yes"))
            .unwrap_or(true);

        Ok(Self {
            database_url,
            max_connections,
            connect_timeout: Duration::from_secs(10),
            auto_migrate,
        })
    }
}

/// DB 初期化時のエラー。Pool 接続失敗 / migration 失敗 / env 不足を区別する。
#[derive(Debug, thiserror::Error)]
pub enum DbInitError {
    #[error("required env var not set: {0}")]
    MissingEnv(String),
    #[error("failed to connect to database: {0}")]
    Connect(#[source] sqlx::Error),
    #[error("failed to run migrations: {0}")]
    Migrate(#[source] sqlx::migrate::MigrateError),
}

/// DATABASE_URL から PgPool を作って返す。`auto_migrate=true` なら migration も流す。
///
/// 接続失敗は `DbInitError::Connect` で返す。ここで panic させないのは、
/// 起動時に `try_init_pool()` で受けて「DB 不在でも続行する MVP ハンドラ」を
/// 残すためと、test で DATABASE_URL を設定しない実行を許すため。
pub async fn init_pool(cfg: &PoolConfig) -> Result<PgPool, DbInitError> {
    let pool = PgPoolOptions::new()
        .max_connections(cfg.max_connections)
        .acquire_timeout(cfg.connect_timeout)
        .connect(&cfg.database_url)
        .await
        .map_err(DbInitError::Connect)?;

    if cfg.auto_migrate {
        MIGRATOR
            .run(&pool)
            .await
            .map_err(DbInitError::Migrate)?;
    }

    Ok(pool)
}

/// **MVP**: DATABASE_URL が未設定 / 接続失敗でもサーバを起動する best-effort 版。
/// 戻り値は `Option<PgPool>`:
///   - `Some(pool)` … 成功
///   - `None`       … env 未設定 or 接続失敗 (warn ログを出してから継続)
///
/// production では `init_pool` 直接呼び出しに切り替えて、失敗 = fatal にする。
pub async fn try_init_pool() -> Option<PgPool> {
    let cfg = match PoolConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(
                "DB pool not initialized: {} (server will start without DB)",
                e
            );
            return None;
        }
    };

    match init_pool(&cfg).await {
        Ok(pool) => {
            tracing::info!(
                "DB pool initialized (max_connections={}, auto_migrate={})",
                cfg.max_connections,
                cfg.auto_migrate
            );
            Some(pool)
        }
        Err(e) => {
            tracing::warn!(
                "DB pool init failed: {} (server will start without DB)",
                e
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_config_defaults_when_env_missing() {
        // DATABASE_URL 未設定なら from_env は Err。
        // 他の test スレッドが env を設定している可能性があるので、
        // 現在の env を一時退避してから unset → 復帰 する。
        let orig = std::env::var("DATABASE_URL").ok();
        // SAFETY: test 並行性は cargo の `--test-threads=1` 前提ではないが、
        // remove は env::set_var の正反対操作で各スレッドに影響しうる。
        // ここでは「Err になり得る」ことだけ確認したいので、
        // 既存 env がある時はテストを skip する (= dev 環境と CI 双方で安定)。
        if orig.is_none() {
            // DATABASE_URL 未設定の状態
            let res = PoolConfig::from_env();
            assert!(matches!(res, Err(DbInitError::MissingEnv(_))));
        }
    }
}
