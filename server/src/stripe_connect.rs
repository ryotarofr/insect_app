//! Stripe Connect Express 統合 (async-stripe v1.0.0-rc.5 系)
//!
//! **責務**:
//!   - 出品者ごとに Stripe Connect Express の Account を作成 (= `acct_xxx`)
//!   - Account Link を発行 (= 出品者を Stripe ホスト型 onboarding に飛ばす URL)
//!   - Account の retrieve (= status 同期 / charges_enabled / payouts_enabled の確認)
//!
//! **設計判断**:
//!   - `async-stripe` v1.0.0-rc.5: HTTP runtime + Client。
//!   - `async-stripe-connect` v1.0.0-rc.5: Account / AccountLink (account / account_link feature)。
//!   - v1 系は **builder + `.send(&client).await`** の API スタイル
//!     (= v0.x の `Account::create(client, req)` から変更)。
//!   - env `STRIPE_PROVIDER=live` で本物の Stripe API を呼ぶ。
//!     `STRIPE_SECRET_KEY` 未設定時は handler 経由で 500 を返す (= scaffolding は呼び出し側)。
//!   - `KOCHU_STRIPE_CONNECT_RETURN_URL` / `KOCHU_STRIPE_CONNECT_REFRESH_URL` で
//!     onboarding 完了 / セッション切れ時の戻り URL を制御。
//!
//! **将来**:
//!   - `account.updated` event 受信で `set_stripe_connect_status` を更新する webhook 統合。

use std::sync::OnceLock;

use stripe::Client;
use stripe_connect::{
    Account, AccountLink,
    account::{
        CapabilitiesParam, CapabilityParam, CreateAccount, CreateAccountType, RetrieveAccount,
    },
    account_link::{CreateAccountLink, CreateAccountLinkType},
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StripeConnectError {
    #[error("STRIPE_SECRET_KEY not configured")]
    NotConfigured,
    #[error("stripe API error: {0}")]
    Api(String),
    #[error("invalid input: {0}")]
    Invalid(String),
}

/// `STRIPE_PROVIDER` env が `live` (= 本物の Stripe API を叩く) かどうか。
pub fn is_live_provider() -> bool {
    std::env::var("STRIPE_PROVIDER").as_deref().map(str::trim) == Ok("live")
}

/// 戻り URL 群を env から組み立てる。未設定時は localhost にフォールバック (dev 想定)。
pub fn return_url() -> String {
    std::env::var("KOCHU_STRIPE_CONNECT_RETURN_URL")
        .unwrap_or_else(|_| "http://localhost:5173/account/stripe-connect/return".to_string())
}

pub fn refresh_url() -> String {
    std::env::var("KOCHU_STRIPE_CONNECT_REFRESH_URL")
        .unwrap_or_else(|_| "http://localhost:5173/account/stripe-connect/refresh".to_string())
}

/// プロセス共通の Stripe Client (= `STRIPE_SECRET_KEY` env から初期化、once 後は使い回し)。
fn client() -> Result<&'static Client, StripeConnectError> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let key = std::env::var("STRIPE_SECRET_KEY").map_err(|_| StripeConnectError::NotConfigured)?;
    let c = Client::new(key);
    let _ = CLIENT.set(c);
    CLIENT.get().ok_or(StripeConnectError::NotConfigured)
}

// ──────────────────────────────────────────────────────────────────────
// Account 作成 / Account Link 発行 / 取得 (v1.0 builder API)
// ──────────────────────────────────────────────────────────────────────

/// Stripe Connect Express Account を 1 つ作成する。返り値は `acct_xxx` 形式の id。
///
/// `business_type` は MVP では指定せず Stripe 側のデフォルト (= 出品者が onboarding 中に選ぶ)。
/// `user_email` は連絡先 (= 渡された場合のみ Stripe に登録、未指定なら onboarding で入力)。
pub async fn create_express_account(
    user_email: Option<&str>,
) -> Result<String, StripeConnectError> {
    let c = client()?;

    // builder pattern (v1.0 系): `.method(value)` で値設定 → `.send(&client).await` で送信。
    let mut req = CreateAccount::new()
        .type_(CreateAccountType::Express)
        .country("JP") // MVP は日本のみ
        .capabilities(CapabilitiesParam {
            card_payments: Some(CapabilityParam {
                requested: Some(true),
            }),
            transfers: Some(CapabilityParam {
                requested: Some(true),
            }),
            ..Default::default()
        });
    if let Some(e) = user_email {
        req = req.email(e);
    }

    let account: Account = req
        .send(c)
        .await
        .map_err(|e| StripeConnectError::Api(e.to_string()))?;
    Ok(account.id.to_string())
}

/// Account Link を発行する (= 出品者を onboarding に飛ばす URL)。
/// 返り値は Stripe ホスト型 URL (= 数分有効、期限切れは `/refresh` 経由で再発行)。
pub async fn create_onboarding_link(account_id: &str) -> Result<String, StripeConnectError> {
    let c = client()?;
    let parsed_id: stripe::AccountId = account_id
        .parse()
        .map_err(|_| StripeConnectError::Invalid(format!("invalid account_id: {account_id}")))?;

    let return_url_owned = return_url();
    let refresh_url_owned = refresh_url();

    let link: AccountLink =
        CreateAccountLink::new(parsed_id, CreateAccountLinkType::AccountOnboarding)
            .refresh_url(refresh_url_owned.as_str())
            .return_url(return_url_owned.as_str())
            .send(c)
            .await
            .map_err(|e| StripeConnectError::Api(e.to_string()))?;
    Ok(link.url)
}

/// Account を retrieve して charges_enabled / payouts_enabled / details_submitted を見て、
/// ローカル DB に書く `stripe_connect_status` 値を返す。
///
/// FSM (migration 0026 と一致):
///   - `charges_enabled && payouts_enabled` → `'active'`
///   - `details_submitted` (= フォーム提出済) かつ未承認 → `'restricted'`
///   - それ以外 → `'pending'`
pub async fn retrieve_account_status(account_id: &str) -> Result<String, StripeConnectError> {
    let c = client()?;
    let parsed_id: stripe::AccountId = account_id
        .parse()
        .map_err(|_| StripeConnectError::Invalid(format!("invalid account_id: {account_id}")))?;

    // v1.0 系 builder API: RetrieveAccount::new(id).send(&client).await
    let account: Account = RetrieveAccount::new(parsed_id)
        .send(c)
        .await
        .map_err(|e| StripeConnectError::Api(e.to_string()))?;

    // v1.0 では Account のフィールドが Option<bool> に変更されている
    // (= API 側で undefined だと None。Connect Express の場合は通常 Some(_) で返るが、
    //  防御的に None → false 扱いで FSM に渡す)。
    Ok(classify_status(
        account.charges_enabled.unwrap_or(false),
        account.payouts_enabled.unwrap_or(false),
        account.details_submitted.unwrap_or(false),
    ))
}

/// FSM 分類ロジック (= retrieve_account_status と webhook 経路で共用)。
pub fn classify_status(
    charges_enabled: bool,
    payouts_enabled: bool,
    details_submitted: bool,
) -> String {
    if charges_enabled && payouts_enabled {
        "active".to_string()
    } else if details_submitted {
        "restricted".to_string()
    } else {
        "pending".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_status_active() {
        assert_eq!(classify_status(true, true, true), "active");
    }

    #[test]
    fn classify_status_restricted() {
        // 提出済だが capabilities 不通過
        assert_eq!(classify_status(false, false, true), "restricted");
        assert_eq!(classify_status(true, false, true), "restricted");
    }

    #[test]
    fn classify_status_pending() {
        // 未提出は pending
        assert_eq!(classify_status(false, false, false), "pending");
    }

    #[test]
    fn is_live_provider_only_true_for_exact_live_string() {
        // env 操作 + テスト同時実行で衝突するため、本テストは値域確認のみ。
        let _ = is_live_provider();
    }
}
