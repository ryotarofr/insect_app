//! `/api/v1/account/stripe_connect/*` (Stripe Connect オンボーディング)
//!
//! - `POST /api/v1/account/stripe_connect/onboarding` → Express Account 発行 + Account Link URL を返す
//! - `GET  /api/v1/account/stripe_connect/status`    → 現在の連携状態を返す + Stripe API で再同期
//!
//! **責務**:
//!   出品者が Stripe Connect Express で売上受取口座を連携するためのエントリポイント。
//!   フロー:
//!     1. ユーザがマイページで「Stripe Connect 連携」ボタンを押す
//!     2. POST /onboarding を叩く
//!        - account_id 未割当なら Stripe API で新規作成して users に書く + status='pending'
//!        - 既存 account_id があれば再利用
//!        - Account Link を発行 (= Stripe ホスト型 URL)
//!     3. クライアントは window.location = url で onboarding に遷移
//!     4. 出品者が Stripe で書類入力 → return URL に戻ってくる
//!     5. /account/stripe-connect/return ページが GET /status を叩いて再同期
//!     6. webhook でも account.updated を受けて自動同期
//!
//! **Auth**: login 必須 (= seller でない anonymous は 401)。

use axum::{Extension, Json, extract::State};
use serde::Serialize;

use crate::error::AppError;
use crate::handlers::require_user_id;
use crate::repos::users;
use crate::session::SessionId;
use crate::state::AppState;
use crate::stripe_connect;

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingResponse {
    /// クライアントが `window.location = url` で遷移する Stripe ホスト型 URL。
    /// 数分で期限切れ (= Stripe 仕様)、切れたら `/refresh` 経由で再発行。
    pub onboarding_url: String,
    /// 作成 / 取得された Stripe Connect Account の id (= "acct_xxx")。debug 用。
    pub account_id: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectStatusResponse {
    /// `unlinked` / `pending` / `active` / `restricted` のいずれか。
    pub status: String,
    /// 連携済 (= account_id がある) なら id を返す。debug 用。
    pub account_id: Option<String>,
}

/// `POST /api/v1/account/stripe_connect/onboarding` — Express Account を作成 (or 既存を再利用)
/// + Account Link URL を発行して返す。
///
/// **エラー**:
///   - 401: 未ログイン
///   - 500: STRIPE_SECRET_KEY 未設定 / Stripe API 失敗 / DB エラー
#[utoipa::path(
    post,
    path = "/account/stripe_connect/onboarding",
    tag = "stripe_connect",
    responses(
        (status = 200, description = "Account 作成 + Link URL 返却", body = OnboardingResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
        (status = 500, description = "Stripe 未設定 / API 失敗", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn post_onboarding(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
) -> Result<Json<OnboardingResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;

    let user = users::find_by_id(state.db(), user_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("user lookup: {e}")))?
        .ok_or(AppError::Unauthorized)?;

    // 既存 account_id があれば再利用、無ければ create_express_account で発行。
    let account_id = match user.stripe_connect_account_id.clone() {
        Some(existing) => existing,
        None => {
            let new_id = stripe_connect::create_express_account(user.email.as_deref())
                .await
                .map_err(|e| match e {
                    stripe_connect::StripeConnectError::NotConfigured => {
                        AppError::Internal(anyhow::anyhow!(
                            "Stripe is not configured (set STRIPE_SECRET_KEY)"
                        ))
                    }
                    other => AppError::Internal(anyhow::anyhow!(
                        "stripe create_express_account: {other}"
                    )),
                })?;
            // DB に書く + status を 'pending' に
            users::set_stripe_connect_account_id(state.db(), user_id, &new_id)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("set account_id: {e}")))?;
            users::set_stripe_connect_status(state.db(), user_id, "pending")
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("set status: {e}")))?;
            new_id
        }
    };

    let url = stripe_connect::create_onboarding_link(&account_id)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("stripe create_onboarding_link: {e}")))?;

    Ok(Json(OnboardingResponse {
        onboarding_url: url,
        account_id,
    }))
}

/// `GET /api/v1/account/stripe_connect/status` — 現在の連携状態を返す。
/// クライアントが return URL ページから叩く想定。Stripe API で実状態を再同期する。
///
/// **同期ロジック**:
///   - account_id があれば Stripe API で `Account.retrieve` を呼び、charges_enabled / payouts_enabled
///     を見て `unlinked / pending / active / restricted` に正規化、ローカル DB を上書き。
///   - account_id 無しなら 'unlinked' をそのまま返す (= API 呼び出し skip)。
///   - Stripe API 失敗時は warn + ローカル DB の値をそのまま返す (= graceful degrade)。
#[utoipa::path(
    get,
    path = "/account/stripe_connect/status",
    tag = "stripe_connect",
    responses(
        (status = 200, description = "現在の連携状態", body = ConnectStatusResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn get_status(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
) -> Result<Json<ConnectStatusResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;

    let user = users::find_by_id(state.db(), user_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("user lookup: {e}")))?
        .ok_or(AppError::Unauthorized)?;

    let mut current_status = user.stripe_connect_status.clone();

    // account_id がある時のみ Stripe API で再同期。失敗は warn 止めで現在値を返す。
    if let Some(ref aid) = user.stripe_connect_account_id {
        match stripe_connect::retrieve_account_status(aid).await {
            Ok(fresh) => {
                if fresh != current_status {
                    if let Err(e) =
                        users::set_stripe_connect_status(state.db(), user_id, &fresh).await
                    {
                        tracing::warn!(
                            "get_status: failed to update local status for user {}: {}",
                            user_id,
                            e
                        );
                    }
                    current_status = fresh;
                }
            }
            Err(e) => {
                tracing::warn!(
                    "get_status: stripe retrieve failed for {}: {} (returning local status)",
                    aid,
                    e
                );
            }
        }
    }

    Ok(Json(ConnectStatusResponse {
        status: current_status,
        account_id: user.stripe_connect_account_id,
    }))
}
