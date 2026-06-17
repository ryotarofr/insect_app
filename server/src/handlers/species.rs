//! `/api/v1/species` (種マスタ取得 / フロント data.ts 移行)
//!
//! **責務**:
//!   - `GET /api/v1/species?locale=ja` で全 species を locale 別に解決して返す
//!
//! **設計判断**:
//!   - locale は **クエリパラメータ任意** (= 省略時 `ja` がデフォルト)
//!   - レスポンスは camelCase で `{ id, name, sciName, region }`。`name` は locale 翻訳
//!   - `name` が無い locale は repo 側で sci_name に fallback (= 一覧は欠落させない)
//!   - **認証不要** (= 種マスタは public 情報、anonymous でも引ける)

use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::repos::species;
use crate::state::AppState;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct SpeciesQuery {
    /// 取得する翻訳の locale。未指定なら `ja`。
    #[serde(default = "default_locale")]
    pub locale: String,
}

fn default_locale() -> String {
    "ja".to_string()
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesResponse {
    /// 短い slug。例: `dhh`
    pub id: String,
    /// locale 別の名前。例: `ヘラクレスオオカブト`
    pub name: String,
    /// 学名。例: `Dynastes hercules hercules`
    pub sci_name: String,
    /// 生息地。例: `中南米`
    pub region: String,
}

/// `GET /api/v1/species?locale=ja` — 全 species を id 昇順で返す。
#[utoipa::path(
    get,
    path = "/species",
    tag = "species",
    params(SpeciesQuery),
    responses(
        (status = 200, description = "全 species を id 昇順で返す", body = Vec<SpeciesResponse>),
    ),
)]
pub async fn list_species(
    State(state): State<AppState>,
    Query(q): Query<SpeciesQuery>,
) -> Result<Json<Vec<SpeciesResponse>>, AppError> {
    let rows = species::find_all(state.db(), &q.locale)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("species lookup: {e}")))?;

    let res: Vec<SpeciesResponse> = rows
        .into_iter()
        .map(|s| SpeciesResponse {
            id: s.id,
            name: s.name,
            sci_name: s.sci_name,
            region: s.region,
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

    fn q(locale: &str) -> Query<SpeciesQuery> {
        Query(SpeciesQuery {
            locale: locale.to_string(),
        })
    }

    #[tokio::test]
    async fn list_returns_5_species_in_id_order() {
        let res = list_species(st(), q("ja")).await.expect("ok");
        let body = res.0;
        assert_eq!(body.len(), 5);
        assert_eq!(body[0].id, "aki");
        assert_eq!(body[4].id, "neo");
    }

    #[tokio::test]
    async fn ja_locale_resolves_japanese_names() {
        let res = list_species(st(), q("ja")).await.expect("ok");
        let dhh = res.0.iter().find(|s| s.id == "dhh").unwrap();
        assert_eq!(dhh.name, "ヘラクレスオオカブト");
        assert_eq!(dhh.sci_name, "Dynastes hercules hercules");
        assert_eq!(dhh.region, "中南米");
    }

    #[tokio::test]
    async fn unknown_locale_falls_back_to_sci_name() {
        let res = list_species(st(), q("fr")).await.expect("ok");
        let dhh = res.0.iter().find(|s| s.id == "dhh").unwrap();
        assert_eq!(dhh.name, "Dynastes hercules hercules");
    }

    #[test]
    fn default_locale_is_ja() {
        assert_eq!(default_locale(), "ja");
    }
}
