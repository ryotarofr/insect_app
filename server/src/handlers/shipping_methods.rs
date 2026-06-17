//! `/api/v1/shipping_methods` (C2C 配送方法マスタの公開)
//!
//! - `GET /api/v1/shipping_methods` → active な配送方法を sort_order 昇順で返す。
//!
//! **責務**:
//!   wizard Step 3 の「対応可能な配送方法」チェックボックス UI のために、
//!   client に配送方法マスタを公開する。cart / checkout でも将来同 endpoint
//!   を使い回せる。
//!
//! **認証**: 公開 (= anonymous OK)。マスタデータは秘匿性が無い。
//!
//! **キャッシュ**:
//!   `repos::shipping_methods::cached_methods_sorted()` を使う。`main.rs` 起動時に
//!   `warm_methods_cache` を 1 度呼んでいるので、本 endpoint はメモリ HashMap を引くだけ。

use axum::{Json, extract::State};
use serde::Serialize;

use crate::error::AppError;
use crate::repos::shipping_methods;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShippingMethodResponse {
    /// "cold" / "normal" / "pickup" 等の id (= seed table の primary key)。
    pub id: String,
    /// sort_order 昇順で返るが、client 側で再ソートしたい時のため返す。
    pub sort_order: i32,
    /// 既定の送料 (税込・JPY)。出品者カスタム送料は将来 listing_shipping_methods.extra_fee_jpy
    /// で個別 override する設計。
    pub amount_jpy: i64,
    pub is_active: bool,
    /// 翻訳名 (= "クール便（推奨）")。
    pub name: String,
    pub description: String,
}

impl From<shipping_methods::ShippingMethodView> for ShippingMethodResponse {
    fn from(v: shipping_methods::ShippingMethodView) -> Self {
        Self {
            id: v.id,
            sort_order: v.sort_order,
            amount_jpy: v.amount_jpy,
            is_active: v.is_active,
            name: v.name,
            description: v.description,
        }
    }
}

/// `GET /api/v1/shipping_methods` — active な配送方法を sort_order 昇順で返す。
///
/// 公開 endpoint (= anonymous OK)。出品 wizard / 検索フィルタ / cart / checkout で共用する。
#[utoipa::path(
    get,
    path = "/shipping_methods",
    tag = "shipping_methods",
    responses(
        (status = 200, description = "active な配送方法を sort_order 昇順で返す", body = Vec<ShippingMethodResponse>),
    ),
)]
pub async fn list_active(
    State(_state): State<AppState>,
) -> Result<Json<Vec<ShippingMethodResponse>>, AppError> {
    // cached_methods_sorted は warm 済み HashMap を sort_order 昇順で返す。
    // warm が走っていないケース (= main.rs::warm_methods_cache が失敗した) でも空配列を返すだけで
    // 5xx にしない (= UI 側は「該当無し」表示で graceful degrade)。
    let rows = shipping_methods::cached_methods_sorted();
    Ok(Json(rows.into_iter().map(ShippingMethodResponse::from).collect()))
}
