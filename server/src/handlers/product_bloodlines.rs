//! `/api/v1/product_bloodlines` (商品血統情報 / フロント PRODUCT_BLOODLINE 移行)
//!
//! **責務**:
//!   - `GET /api/v1/product_bloodlines` で全商品の血統データを返す
//!     (= フロントの `bloodline-fixture.ts::PRODUCT_BLOODLINE` を DB 経由で配信)
//!
//! **設計判断**:
//!   - **bulk 返却** (= 1 リクエストで全件): 商品一覧 / カート / 商品詳細の 3 画面で
//!     同時に必要になるため、4 件程度なら一括 fetch + cache が単純で速い
//!   - **camelCase serialize**: フロント `BlAncestor` / `ProductBloodline` 型と key を
//!     完全一致させ、変換層を最小化
//!   - **認証不要**: 商品血統は購入動線で公開する情報

use axum::{Json, extract::State};
use serde::Serialize;

use crate::error::AppError;
use crate::repos::product_bloodlines;
use crate::state::AppState;

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AncestorResponse {
    /// 役割。`father` / `mother` / `paternal_father` / `paternal_mother` /
    /// `maternal_father` / `maternal_mother`
    pub role: String,
    /// 表示 ID。例: `#DHH-0150` / `#WILD-DHH-A`
    pub id: String,
    pub name: String,
    /// 性別 (= `m` / `f`)。フロント `BlAncestor.sex` 型と一致。
    pub sex: String,
    /// 世代タグ。例: `WILD` / `F0` / `CBF1`
    ///
    /// JSON 上の key は `gen` (= フロント `BlAncestor.gen` と一致)。
    /// Rust 2024 の予約語 `gen` を避けるため Rust 側は `gen_label` で持ち、
    /// `#[serde(rename = "gen")]` で wire format だけ短縮名に倒す。
    #[serde(rename = "gen")]
    pub gen_label: String,
    /// 体長 (mm)。WILD 等で未計測なら null。
    pub size_mm: Option<f64>,
    /// WILD = 野生個体。色合いを変える指標。
    pub is_wild: bool,
    /// 「故 (2025-10-02)」のような死亡注記 (任意)。
    pub deceased_note: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProductBloodlineResponse {
    /// 商品 public_id。例: `p-hh-m-142`
    pub product_id: String,
    /// 商品自身の世代タグ。例: `CBF2` / `WF1`
    pub generation: String,
    /// 近交係数 (Wright's F)。0..1。
    pub inbreeding_coef: f64,
    pub breeder_certified: bool,
    pub third_party_verified: bool,
    /// 起源・累代の要約。サマリで 2 行 / modal で全文。
    pub pedigree_notes: String,
    /// 親 / 祖父母 (= 最大 6 役割、最少 2)。順序は固定しない。
    pub ancestors: Vec<AncestorResponse>,
}

/// `GET /api/v1/product_bloodlines` — 全商品の血統データを public_id 昇順で返す。
#[utoipa::path(
    get,
    path = "/product_bloodlines",
    tag = "products",
    responses(
        (status = 200, description = "全商品の血統データを public_id 昇順で返す", body = Vec<ProductBloodlineResponse>),
    ),
)]
pub async fn list_product_bloodlines(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProductBloodlineResponse>>, AppError> {
    let rows = product_bloodlines::find_all(state.db())
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("product_bloodlines lookup: {e}")))?;

    let res: Vec<ProductBloodlineResponse> = rows
        .into_iter()
        .map(|b| ProductBloodlineResponse {
            product_id: b.product_public_id,
            generation: b.generation,
            inbreeding_coef: b.inbreeding_coef,
            breeder_certified: b.breeder_certified,
            third_party_verified: b.third_party_verified,
            pedigree_notes: b.pedigree_notes,
            ancestors: b
                .ancestors
                .into_iter()
                .map(|a| AncestorResponse {
                    role: a.role,
                    id: a.ancestor_public_id,
                    name: a.name,
                    sex: a.sex,
                    gen_label: a.generation_label,
                    size_mm: a.size_mm,
                    is_wild: a.is_wild,
                    deceased_note: a.deceased_note,
                })
                .collect(),
        })
        .collect();

    Ok(Json(res))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st() -> State<AppState> {
        State(AppState::default())
    }

    #[tokio::test]
    async fn list_returns_four_bloodlines_in_id_order() {
        let res = list_product_bloodlines(st()).await.expect("ok");
        let body = res.0;
        assert_eq!(body.len(), 4);
        let ids: Vec<&str> = body.iter().map(|p| p.product_id.as_str()).collect();
        assert_eq!(ids, vec!["p-aki", "p-cat-l", "p-hh-m-142", "p-neo-m"]);
    }

    #[tokio::test]
    async fn p_hh_response_shape_matches_fixture() {
        let res = list_product_bloodlines(st()).await.expect("ok");
        let dhh = res
            .0
            .iter()
            .find(|p| p.product_id == "p-hh-m-142")
            .expect("p-hh-m-142 present");
        assert_eq!(dhh.generation, "CBF2");
        assert!((dhh.inbreeding_coef - 0.05).abs() < 1e-9);
        assert!(dhh.breeder_certified);
        assert!(!dhh.third_party_verified);
        assert_eq!(dhh.ancestors.len(), 6);

        let father = dhh.ancestors.iter().find(|a| a.role == "father").unwrap();
        assert_eq!(father.id, "#DHH-0213");
        assert_eq!(father.name, "漆黒");
        assert_eq!(father.sex, "m");
        assert_eq!(father.gen_label, "CBF1");
        assert_eq!(father.size_mm, Some(152.0));
        assert!(!father.is_wild);
    }

    #[tokio::test]
    async fn p_aki_has_only_father_and_mother() {
        let res = list_product_bloodlines(st()).await.expect("ok");
        let aki = res
            .0
            .iter()
            .find(|p| p.product_id == "p-aki")
            .expect("p-aki present");
        assert_eq!(aki.ancestors.len(), 2);
        assert!(aki.ancestors.iter().all(|a| a.is_wild));
    }
}
