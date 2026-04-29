//! `insect_app_server` ライブラリエントリ。
//!
//! バイナリ (`main.rs`) と integration test (`tests/`) の両方からアクセスできるよう、
//! 各モジュールを `pub mod` で公開する。
//! 旧来 `main.rs` 側の `mod` 宣言は本ファイルに移管した。

// 日本語 doc コメント内の箇条書きは clippy の Markdown 解釈と整合しないため、
// doc 系の 2 lint は crate 全体で許可する (= 機能に影響なし)。
#![allow(clippy::doc_lazy_continuation, clippy::doc_overindented_list_items)]
// テストでは `Mutex` でテスト直列化する都合で MutexGuard を await 跨ぎで保持する。
// 本番コードには登場しないため test build のみ許可する。
#![cfg_attr(test, allow(clippy::await_holding_lock))]

pub mod db;
pub mod error;
pub mod handlers;
pub mod openapi;
pub mod repos;
pub mod routes;
pub mod sdui;
pub mod session;
pub mod state;
pub mod stripe;
pub mod workers;

// ──────────────────────────────────────────────────────────────────────
// production env 必須化アサーション (review fix: blocker)
// ──────────────────────────────────────────────────────────────────────
//
// `STRIPE_WEBHOOK_SECRET` / `KOCHU_ALLOWED_ORIGINS` / `KOCHU_COOKIE_SECURE` の
// 3 系統はいずれも「env 未設定なら scaffolding mode で skip」する設計。
// dev / test では便利だが production で 1 つでも欠けると、
//   - Stripe Webhook が任意 payload を受理 (HMAC スキップ)
//   - 状態変更 POST が任意 origin から通る (CSRF スキップ)
//   - Cookie が平文 HTTP に乗る (Secure 属性なし)
// が同時に発生する fail-open になる。`KOCHU_ENV=production` の時だけ
// 起動時に必須 env を検証して、欠けていれば panic で起動を止める。

/// production 環境 (= `KOCHU_ENV=production`) で必須 env が揃っているかを確認する。
/// 1 つでも欠けていれば panic して起動を止める (fail-fast)。
///
/// dev / test (= env 未設定 or `KOCHU_ENV != "production"`) では何もしない。
/// `main.rs` の bootstrap で必ず呼ぶ。
pub fn ensure_production_env_or_panic() {
    let is_prod = std::env::var("KOCHU_ENV").as_deref() == Ok("production");
    if !is_prod {
        return;
    }

    // 必須 env: 空文字 / 未設定 はいずれも欠落扱い
    let required = [
        "STRIPE_WEBHOOK_SECRET",
        "KOCHU_ALLOWED_ORIGINS",
        "KOCHU_COOKIE_SECURE",
    ];
    let missing: Vec<&str> = required
        .iter()
        .copied()
        .filter(|k| {
            std::env::var(k)
                .map(|v| v.trim().is_empty())
                .unwrap_or(true)
        })
        .collect();
    assert!(
        missing.is_empty(),
        "production missing required env: {missing:?} (set them via Secrets Manager / .env)"
    );

    // KOCHU_COOKIE_SECURE は厳密に "true" を要求 (session.rs と同じ完全一致比較)
    let cookie_secure = std::env::var("KOCHU_COOKIE_SECURE").unwrap_or_default();
    assert_eq!(
        cookie_secure, "true",
        "production must set KOCHU_COOKIE_SECURE=\"true\" (got {cookie_secure:?})"
    );
}

#[cfg(test)]
mod env_guard_tests {
    use super::ensure_production_env_or_panic;

    /// `KOCHU_ENV` / 必須 env を弄る本テスト群を逐次化する poison-tolerant guard。
    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
        GUARD.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn unset_all() {
        // SAFETY: edition 2024 では set_var が unsafe。本テスト群は env_guard で逐次化。
        unsafe {
            std::env::remove_var("KOCHU_ENV");
            std::env::remove_var("STRIPE_WEBHOOK_SECRET");
            std::env::remove_var("KOCHU_ALLOWED_ORIGINS");
            std::env::remove_var("KOCHU_COOKIE_SECURE");
        }
    }

    #[test]
    fn dev_mode_is_noop() {
        let _g = env_guard();
        unset_all();
        ensure_production_env_or_panic();
    }

    #[test]
    fn production_with_all_envs_passes() {
        let _g = env_guard();
        unset_all();
        unsafe {
            std::env::set_var("KOCHU_ENV", "production");
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_xxx");
            std::env::set_var("KOCHU_ALLOWED_ORIGINS", "https://kochu.example");
            std::env::set_var("KOCHU_COOKIE_SECURE", "true");
        }
        ensure_production_env_or_panic();
        unset_all();
    }

    #[test]
    #[should_panic(expected = "production missing required env")]
    fn production_panics_on_missing_stripe_secret() {
        let _g = env_guard();
        unset_all();
        unsafe {
            std::env::set_var("KOCHU_ENV", "production");
            std::env::set_var("KOCHU_ALLOWED_ORIGINS", "https://kochu.example");
            std::env::set_var("KOCHU_COOKIE_SECURE", "true");
        }
        ensure_production_env_or_panic();
    }

    #[test]
    #[should_panic(expected = "KOCHU_COOKIE_SECURE")]
    fn production_panics_when_cookie_secure_is_not_true() {
        let _g = env_guard();
        unset_all();
        unsafe {
            std::env::set_var("KOCHU_ENV", "production");
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_xxx");
            std::env::set_var("KOCHU_ALLOWED_ORIGINS", "https://kochu.example");
            std::env::set_var("KOCHU_COOKIE_SECURE", "1");
        }
        ensure_production_env_or_panic();
    }

    #[test]
    #[should_panic(expected = "production missing required env")]
    fn production_panics_on_empty_origins() {
        let _g = env_guard();
        unset_all();
        unsafe {
            std::env::set_var("KOCHU_ENV", "production");
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_xxx");
            std::env::set_var("KOCHU_ALLOWED_ORIGINS", "   ");
            std::env::set_var("KOCHU_COOKIE_SECURE", "true");
        }
        ensure_production_env_or_panic();
    }
}
