//! バックグラウンド worker
//!
//! **設計判断** (= 別途調査の結論 / docs/sdui-three-layer-model* と独立):
//!   - apalis を採用しない / 自前 `FOR UPDATE SKIP LOCKED` relay loop で十分
//!   - lettre crate を Mailer 抽象として採用 (= `StubTransport` for dev, `AsyncSmtpTransport` for prod)
//!   - 同一バイナリ + tokio::spawn で起動。production では `KOCHU_ROLE=web|worker` で role 分離
//!
//! **モジュール構成 (= 段階的に追加)**:
//!   - `mailer`        : `Mailer` trait + `StubMailer` (= log 出力 only / dev 既定)
//!   - `email_send`    : email_outbox の relay loop
//!   - `eclosion_daily`: 03:00 JST daily で eclosion 7 日前を outbox enqueue
//!
//! **spawn 戦略**:
//!   `spawn_all(state)` は `KOCHU_WORKER_ENABLE` env を読み、`true` の時だけ全 worker を spawn。
//!   dev は default `false` (= `cargo test` 中に worker が裏で動かない)。
//!   prod は ECS task で `KOCHU_WORKER_ENABLE=true` を web 用 / worker 用に分けて起動する想定。

pub mod eclosion_daily;
pub mod email_send;
pub mod mailer;

use std::sync::Arc;

use crate::state::AppState;
use crate::workers::mailer::{Mailer, StubMailer};

/// 全 worker を tokio::spawn で起動する (= `KOCHU_WORKER_ENABLE=true` 時のみ)。
/// 起動順序は冪等で、worker 同士に依存はない。
///
/// **現在 spawn 中**:
///   - email_send     : email_outbox の relay loop
///   - eclosion_daily : 03:00 JST の羽化予測 daily job
pub fn spawn_all(state: AppState) {
    if !is_worker_enabled() {
        tracing::info!("workers disabled (KOCHU_WORKER_ENABLE != true)");
        return;
    }
    tracing::info!("workers enabled — spawning background tasks");

    // 1 プロセスで 1 回しか作らない Mailer 実体 (= MVP は StubMailer 固定)。
    // production で SMTP 化する時は env (KOCHU_MAILER_PROVIDER) で出し分ける。
    let mailer: Arc<dyn Mailer> = Arc::new(StubMailer::new());
    let pool = state.db().cloned();

    tokio::spawn(email_send::run(pool.clone(), mailer));
    tokio::spawn(eclosion_daily::run(pool));
}

/// `KOCHU_WORKER_ENABLE=true` 時のみ worker を起動する。
/// 厳密に "true" 文字列のみ許可 (= production env の typo を防ぐ)。
fn is_worker_enabled() -> bool {
    std::env::var("KOCHU_WORKER_ENABLE").as_deref() == Ok("true")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// env を弄るテストを直列化する poison-tolerant guard。
    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
        GUARD.lock().unwrap_or_else(|p| p.into_inner())
    }

    #[test]
    fn worker_enabled_only_for_true_string() {
        let _g = env_guard();
        unsafe {
            std::env::remove_var("KOCHU_WORKER_ENABLE");
        }
        assert!(!is_worker_enabled());

        unsafe { std::env::set_var("KOCHU_WORKER_ENABLE", "true") };
        assert!(is_worker_enabled());

        // typo / 1 / yes 等は false に倒す
        unsafe { std::env::set_var("KOCHU_WORKER_ENABLE", "1") };
        assert!(!is_worker_enabled());

        unsafe { std::env::set_var("KOCHU_WORKER_ENABLE", "TRUE") };
        assert!(!is_worker_enabled());

        unsafe { std::env::remove_var("KOCHU_WORKER_ENABLE") };
    }
}
