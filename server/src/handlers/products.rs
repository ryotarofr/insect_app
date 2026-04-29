//! `/api/v1/products` (商品一覧 / フロント data.ts 移行)
//!
//! **責務**:
//!   - `GET /api/v1/products?locale=ja` で全 active 商品を id 昇順で返す
//!   - フロントの `interface Product` (= data.ts) と同じ shape に整形して返す
//!     (= `kind: "生体" | "用品"`, `badge: "血統書付"` 等の display 文字列)
//!
//! **設計判断**:
//!   - **shop 名 / species 学名は repos に揃える前に手動 hardcode**: DB seed に shops は
//!     1 件 (= ANCHOR BEETLE CO.) しか無く、in-memory products の shop_id も nil UUID。
//!     MVP では全商品 = 1 ショップで統一し、複数ショップ対応は Phase 7 で再設計。
//!   - **badge_kind → ja ラベル**: server 側に i18n 系統が無いため本ハンドラ内で
//!     hardcode dict を持つ。将来 SDUI の i18n と統合する。
//!   - **kind: "live" → "生体"** を server 側で変換: 客側で再変換する手間を避ける。
//!     英語表示が要る将来 (= en locale) は kind ラベルも locale で出し分ける。
//!   - **認証不要** (= 商品マスタは public 情報)。

use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::repos::products;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ProductsQuery {
    /// 取得する翻訳の locale。未指定なら `ja`。
    #[serde(default = "default_locale")]
    pub locale: String,
}

fn default_locale() -> String {
    "ja".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductResponse {
    /// public_id 文字列。例: `p-hh-m-142`
    pub id: String,
    /// 表示種別。`生体` / `用品` (= ja locale)。
    pub kind: String,
    /// 商品タイトル (locale 翻訳済)。
    pub title: String,
    /// 学名。supply は null。
    pub sci: Option<String>,
    /// 税込価格 (JPY)。
    pub price: i64,
    /// 表示バッジ (= 「血統書付」「ペア割」等)。
    pub badge: Option<String>,
    /// 系統。例: `CBF2`。supply は null。
    pub generation: Option<String>,
    /// ショップ表示名。例: `ANCHOR BEETLE CO.`
    pub shop: String,
    /// 配色トーン (= フロント CSS 用)。`forest` / `amber`。
    pub tone: String,
    /// プレースホルダ画像のラベル (= 1 文字)。
    pub ph_label: String,
}

/// `GET /api/v1/products?locale=ja` — 全 active 商品を id 昇順で返す。
pub async fn list_products(
    State(state): State<AppState>,
    Query(q): Query<ProductsQuery>,
) -> Result<Json<Vec<ProductResponse>>, AppError> {
    let rows = products::find_all(state.db(), true)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("products lookup: {e}")))?;

    let species_list = crate::repos::species::find_all(state.db(), &q.locale)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("species lookup: {e}")))?;

    let mut res: Vec<ProductResponse> = rows
        .into_iter()
        .map(|p| {
            let sci = p
                .row
                .species_id
                .as_deref()
                .and_then(|sid| species_list.iter().find(|s| s.id == sid))
                .map(|s| s.sci_name.clone());

            ProductResponse {
                id: p.row.public_id.clone(),
                kind: kind_label(&p.row.kind),
                title: p.title(&q.locale),
                sci,
                price: p.row.price_jpy,
                badge: p.row.badge_kind.as_deref().map(badge_label).map(String::from),
                generation: p.row.generation,
                shop: SHOP_NAME_FALLBACK.to_string(),
                tone: p.row.tone,
                ph_label: p.row.ph_label,
            }
        })
        .collect();

    res.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Json(res))
}

/// MVP 用: shops テーブルは 1 件しか seed されていないため全商品で固定値を返す。
/// 複数ショップ対応 (Phase 7) で products.shop_id → shops.name の JOIN に置き換える。
const SHOP_NAME_FALLBACK: &str = "ANCHOR BEETLE CO.";

fn kind_label(kind: &str) -> String {
    match kind {
        "live" => "生体".to_string(),
        "supply" => "用品".to_string(),
        other => other.to_string(),
    }
}

/// `badge_kind` トークン → ja 表示文字列。未知トークンはそのまま返す。
fn badge_label(kind: &str) -> &'static str {
    match kind {
        "recommended" => "血統書付",
        "larva" => "CBF3",
        "warning" => "ペア割",
        "rare" => "WF1",
        "consumable" => "消耗品",
        "popular" => "人気",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st() -> State<AppState> {
        State(AppState::default())
    }

    fn q(locale: &str) -> Query<ProductsQuery> {
        Query(ProductsQuery {
            locale: locale.to_string(),
        })
    }

    #[tokio::test]
    async fn list_returns_6_products_in_id_order() {
        let res = list_products(st(), q("ja")).await.expect("ok");
        let body = res.0;
        assert_eq!(body.len(), 6);
        // id 昇順
        let ids: Vec<&str> = body.iter().map(|p| p.id.as_str()).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids, sorted);
    }

    #[tokio::test]
    async fn live_product_has_translated_kind_and_sci() {
        let res = list_products(st(), q("ja")).await.expect("ok");
        let dhh = res.0.iter().find(|p| p.id == "p-hh-m-142").unwrap();
        assert_eq!(dhh.kind, "生体");
        assert_eq!(dhh.title, "ヘラクレスオオカブト ♂ 142mm");
        assert_eq!(dhh.sci.as_deref(), Some("Dynastes hercules hercules"));
        assert_eq!(dhh.price, 48000);
        assert_eq!(dhh.badge.as_deref(), Some("血統書付"));
        assert_eq!(dhh.generation.as_deref(), Some("CBF2"));
        assert_eq!(dhh.shop, "ANCHOR BEETLE CO.");
        assert_eq!(dhh.tone, "forest");
    }

    #[tokio::test]
    async fn supply_product_has_no_sci_and_translated_kind() {
        let res = list_products(st(), q("ja")).await.expect("ok");
        let jelly = res.0.iter().find(|p| p.id == "p-jelly").unwrap();
        assert_eq!(jelly.kind, "用品");
        assert_eq!(jelly.sci, None);
        assert_eq!(jelly.generation, None);
        assert_eq!(jelly.tone, "amber");
        assert_eq!(jelly.badge.as_deref(), Some("消耗品"));
    }

    #[test]
    fn badge_label_maps_known_tokens() {
        assert_eq!(badge_label("recommended"), "血統書付");
        assert_eq!(badge_label("rare"), "WF1");
        assert_eq!(badge_label("unknown_token"), "");
    }

    #[test]
    fn kind_label_maps_live_and_supply() {
        assert_eq!(kind_label("live"), "生体");
        assert_eq!(kind_label("supply"), "用品");
        assert_eq!(kind_label("other"), "other");
    }
}
