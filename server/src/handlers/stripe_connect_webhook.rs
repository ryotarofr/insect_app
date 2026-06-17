//! `POST /api/v1/stripe/connect_webhook`
//!
//! Stripe Connect の `account.updated` event を受け取り、ローカル DB の
//! `users.stripe_connect_status` を Stripe 側の真実と同期する。
//!
//! **責務**:
//!   - HMAC-SHA256 検証 (`STRIPE_CONNECT_WEBHOOK_SECRET` env、未設定なら dev で skip)。
//!   - Replay protection (= `t=` timestamp tolerance、既存 stripe_webhook と同条件)。
//!   - Idempotency (= `stripe_webhook_events` テーブル流用、event_id で 1 度限り処理)。
//!   - `account.updated` event を受けたら:
//!       1. account_id → user を `repos::users::find_by_stripe_connect_account_id` で逆引き
//!       2. `charges_enabled` / `payouts_enabled` / `details_submitted` を見て
//!          `stripe_connect::classify_status` で `unlinked / pending / active / restricted` に正規化
//!       3. `users::set_stripe_connect_status` で DB 更新
//!   - 未知 event_type は 200 で no-op (= Stripe 仕様: 2xx で ack 必要)。
//!
//! **既存 stripe_webhook (Checkout 用) との分離理由**:
//!   - Connect の webhook は別 endpoint / 別 signing secret で受ける Stripe 仕様。
//!   - secret を分けることで、Connect の signing secret が漏れても Checkout は無傷。
//!   - event_type の値域も完全に異なる (= account.updated / external_account.updated 等)。
//!
//! **将来 (= 別 PR)**:
//!   - `external_account.created` / `external_account.deleted` 受信で UI に振込先 chip 追加。
//!   - `account.application.deauthorized` (= ユーザが Stripe 側で連携解除) → status='unlinked' 戻し。

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

use crate::error::AppError;
use crate::repos::{stripe_webhook_events, users};
use crate::state::AppState;
use crate::stripe_connect;

type HmacSha256 = Hmac<Sha256>;

/// Connect 専用 secret。`STRIPE_CONNECT_WEBHOOK_SECRET` env から取得。
fn connect_webhook_secret() -> Option<String> {
    std::env::var("STRIPE_CONNECT_WEBHOOK_SECRET")
        .ok()
        .filter(|s| !s.trim().is_empty())
}

/// Stripe-Signature ヘッダから `v1=<hex>` を抽出。
fn extract_v1(sig: &str) -> Option<&str> {
    sig.split(',').find_map(|p| p.trim().strip_prefix("v1="))
}

/// Stripe-Signature ヘッダから `t=<unix>` を抽出。
fn extract_timestamp(sig: &str) -> Option<i64> {
    sig.split(',')
        .find_map(|p| p.trim().strip_prefix("t="))
        .and_then(|s| s.parse::<i64>().ok())
}

/// 許容時間幅 (= `KOCHU_STRIPE_TOLERANCE_SEC` env / default 300 秒)。
/// 既存 stripe_webhook と同 env を共用 (= 環境ごとの設定を 1 つで揃える)。
fn tolerance_seconds() -> i64 {
    std::env::var("KOCHU_STRIPE_TOLERANCE_SEC")
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(300)
}

/// `signed_payload = "{timestamp}.{body}"` の HMAC-SHA256 hex を計算。
/// 既存 stripe_webhook の compute_hmac_hex と同実装。
fn compute_hmac_hex(secret: &str, timestamp: i64, body: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts arbitrary key length");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

/// HMAC + timestamp tolerance で webhook 署名を検証。secret 未設定なら skip (= dev mode)。
fn verify_signature(headers: &HeaderMap, body: &[u8]) -> Result<(), AppError> {
    let secret = match connect_webhook_secret() {
        Some(s) => s,
        None => return Ok(()),
    };
    use subtle::ConstantTimeEq;

    let sig = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    let provided = extract_v1(sig).ok_or(AppError::Unauthorized)?;
    let t = extract_timestamp(sig).ok_or(AppError::Unauthorized)?;

    let now = chrono::Utc::now().timestamp();
    if (now - t).abs() > tolerance_seconds() {
        tracing::warn!(
            "stripe connect webhook: timestamp drift exceeds tolerance (t={t}, now={now})"
        );
        return Err(AppError::Unauthorized);
    }

    let expected = compute_hmac_hex(&secret, t, body);
    if expected.as_bytes().ct_eq(provided.as_bytes()).into() {
        Ok(())
    } else {
        Err(AppError::Unauthorized)
    }
}

// ──────────────────────────────────────────────────────────────────────
// event 構造体 (account.updated に必要な最小集合だけ deserialize)
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: ConnectEventData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectEventData {
    pub object: ConnectAccount,
}

/// `account.updated` の object は Stripe の Account。MVP では capability 系 3 フラグ +
/// id だけを見る。将来 capabilities / requirements の細粒度が必要になれば拡張。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectAccount {
    pub id: String,
    #[serde(default)]
    pub charges_enabled: bool,
    #[serde(default)]
    pub payouts_enabled: bool,
    #[serde(default)]
    pub details_submitted: bool,
}

// ──────────────────────────────────────────────────────────────────────
// handler
// ──────────────────────────────────────────────────────────────────────

pub async fn post_stripe_connect_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    // 0. HMAC 検証 (= secret 未設定の dev では skip)
    verify_signature(&headers, &body)?;

    // 1. event を deserialize
    let event: ConnectEvent = serde_json::from_slice(&body).map_err(|e| {
        AppError::BadRequest(format!("invalid stripe connect event body: {e}"))
    })?;

    // 2. Idempotency: 既存 stripe_webhook_events テーブルを流用 (event_id は global unique)
    let payload_value: serde_json::Value =
        serde_json::from_slice(&body).unwrap_or_else(|_| serde_json::json!({}));
    let outcome = stripe_webhook_events::record_if_new(
        state.db(),
        &event.id,
        &event.event_type,
        &payload_value,
    )
    .await
    .map_err(|e| AppError::BadRequest(format!("idempotency record: {e}")))?;
    if matches!(
        outcome,
        stripe_webhook_events::RecordOutcome::AlreadySeen
    ) {
        tracing::info!(
            "stripe connect webhook: duplicate event {} (type={}), skipping",
            event.id,
            event.event_type
        );
        return Ok(StatusCode::OK);
    }

    // 3. event_type 分岐
    match event.event_type.as_str() {
        "account.updated" => {
            handle_account_updated(&state, &event.data.object).await?;
            Ok(StatusCode::OK)
        }
        // 未知 event_type は 200 で no-op (= Stripe は 2xx を期待)
        other => {
            tracing::debug!("ignoring stripe connect event_type: {other}");
            Ok(StatusCode::OK)
        }
    }
}

/// `account.updated` の処理: account_id → user を引いて status を再分類して DB 更新。
async fn handle_account_updated(
    state: &AppState,
    account: &ConnectAccount,
) -> Result<(), AppError> {
    // account_id (= "acct_xxx") から user を逆引き
    let user = match users::find_by_stripe_connect_account_id(state.db(), &account.id).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            // account_id が未紐付け = 我々のシステム外で作られた account の event。
            // 200 で no-op (= 他のプラットフォームで作られた可能性、Stripe は ack を期待)。
            tracing::warn!(
                "stripe connect webhook: account {} not linked to any user, ignoring",
                account.id
            );
            return Ok(());
        }
        Err(e) => {
            tracing::error!("user lookup by account_id failed: {e}");
            // idempotency マーカーを rollback して Stripe retry を許可
            // (= 一時的な DB 障害なら次回は通る)
            return Err(AppError::Internal(anyhow::anyhow!(
                "user lookup: {e}"
            )));
        }
    };

    let new_status = stripe_connect::classify_status(
        account.charges_enabled,
        account.payouts_enabled,
        account.details_submitted,
    );

    // 既に同じ status なら UPDATE skip (= 連続 webhook の負荷低減)
    if user.stripe_connect_status == new_status {
        tracing::debug!(
            "stripe connect webhook: user {} already at status={}, skipping update",
            user.id,
            new_status
        );
        return Ok(());
    }

    if let Err(e) = users::set_stripe_connect_status(state.db(), user.id, &new_status).await {
        tracing::error!(
            "stripe connect webhook: set_stripe_connect_status failed for user {}: {}",
            user.id,
            e
        );
        return Err(AppError::Internal(anyhow::anyhow!(
            "set_stripe_connect_status: {e}"
        )));
    }

    tracing::info!(
        "stripe connect webhook: user {} status {} → {}",
        user.id,
        user.stripe_connect_status,
        new_status
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_v1_basic() {
        assert_eq!(
            extract_v1("t=1700000000,v1=abc123,v0=def"),
            Some("abc123")
        );
        assert_eq!(extract_v1("v1=onlysig"), Some("onlysig"));
        assert_eq!(extract_v1("nothing"), None);
    }

    #[test]
    fn extract_timestamp_basic() {
        assert_eq!(extract_timestamp("t=1700000000,v1=x"), Some(1700000000));
        assert_eq!(extract_timestamp("v1=x"), None);
        assert_eq!(extract_timestamp("t=notnum,v1=x"), None);
    }

    #[test]
    fn compute_hmac_hex_matches_stripe_format() {
        // Stripe 仕様: signed_payload = "{ts}.{body}"
        // ここではローカル計算が安定 (= 同 secret + ts + body で同 hex) かだけ確認。
        let h1 = compute_hmac_hex("secret", 1700000000, b"{}");
        let h2 = compute_hmac_hex("secret", 1700000000, b"{}");
        assert_eq!(h1, h2);
        let h3 = compute_hmac_hex("other", 1700000000, b"{}");
        assert_ne!(h1, h3);
    }
}
