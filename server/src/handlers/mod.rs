pub mod account_stripe_connect;
pub mod auth;
pub mod cart;
pub mod checkout;
pub mod cohorts;
pub mod events;
pub mod health;
pub mod hello;
pub mod listings;
pub mod mating_records;
pub mod orders;
pub mod shipping_methods;
pub mod species;
pub mod specimen_fulfillment;
pub mod specimen_logs;
pub mod specimens;
pub mod stripe_connect_webhook;
pub mod stripe_webhook;
pub mod uploads;

use uuid::Uuid;

use crate::error::AppError;
use crate::repos::user_sessions;
use crate::state::AppState;

/// session_id から login user の UUID を引く共通 auth guard。
///
/// session 行が無い、または anonymous session (= `session.user_id` が NULL) なら
/// `Unauthorized`。DB エラーは `BadRequest` にマップする。
pub(crate) async fn require_user_id(
    state: &AppState,
    session_id: Uuid,
) -> Result<Uuid, AppError> {
    let session = user_sessions::find_by_id(state.db(), session_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("session lookup: {e}")))?
        .ok_or(AppError::Unauthorized)?;
    session.user_id.ok_or(AppError::Unauthorized)
}
