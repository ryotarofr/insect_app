//! species + species_translations への永続化
//!
//! **責務**:
//!   - sqlx で species と species_translations を join し locale 別に解決した
//!     `Vec<SpeciesView>` を返す
//!   - DB 不在時 (= pool=None) は in-memory fallback で 0002_master_data.sql の
//!     seed と同値を返す
//!
//! **設計判断**:
//!   - **locale が無い行は除外しない**: `LEFT JOIN` で fallback して `name` を
//!     `sci_name` で埋める (= 未訳でも一覧は欠落させない)
//!   - **id は text PK**: `0002` の方針通りそのまま String で扱う
//!   - **cache はしない**: MVP は 5 行 / 1 クエリ / locale 別の cache 設計が複雑化
//!     するため、毎回 fetch する。将来必要なら prefectures と同じ warm pattern を導入

use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct SpeciesView {
    /// 短い slug。例: `dhh`
    pub id: String,
    /// 学名。例: `Dynastes hercules hercules`
    pub sci_name: String,
    /// 生息地。例: `中南米`
    pub region: String,
    /// `?locale=ja` で取得したローカル名。翻訳が無い locale では sci_name で fallback。
    pub name: String,
}

#[derive(Debug, thiserror::Error)]
pub enum SpeciesRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// 全 species を id 昇順で返す。`locale` は species_translations.locale (例: "ja")。
/// pool=None なら in-memory fallback (= 0002 seed と同値)。
pub async fn find_all(
    pool: Option<&PgPool>,
    locale: &str,
) -> Result<Vec<SpeciesView>, SpeciesRepoError> {
    match pool {
        Some(p) => find_all_db(p, locale).await,
        None => Ok(memory_species(locale)),
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn find_all_db(pool: &PgPool, locale: &str) -> Result<Vec<SpeciesView>, SpeciesRepoError> {
    // LEFT JOIN: locale が登録されていない行は name を sci_name で fallback
    let rows: Vec<SpeciesView> = sqlx::query_as::<_, SpeciesView>(
        r#"
        SELECT
            s.id,
            s.sci_name,
            s.region,
            COALESCE(t.name, s.sci_name) AS name
        FROM species s
        LEFT JOIN species_translations t
            ON t.species_id = s.id AND t.locale = $1
        ORDER BY s.id
        "#,
    )
    .bind(locale)
    .fetch_all(pool)
    .await
    .map_err(SpeciesRepoError::Db)?;
    Ok(rows)
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback (= 0002_master_data.sql の seed と完全一致)
// ──────────────────────────────────────────────────────────────────────

fn memory_species(locale: &str) -> Vec<SpeciesView> {
    // (id, sci_name, region, [(locale, name)...])
    const SEED: &[(&str, &str, &str, &[(&str, &str)])] = &[
        ("aki", "Megasoma actaeon", "南米", &[("ja", "アクタエオンゾウカブト")]),
        ("cat", "Chalcosoma chiron", "東南アジア", &[("ja", "コーカサスオオカブト")]),
        ("dhh", "Dynastes hercules hercules", "中南米", &[("ja", "ヘラクレスオオカブト")]),
        ("nat", "Trypoxylus dichotomus", "日本", &[("ja", "国産カブトムシ")]),
        ("neo", "Dynastes neptunus", "南米", &[("ja", "ネプチューンオオカブト")]),
    ];

    SEED.iter()
        .map(|(id, sci, region, translations)| {
            let name = translations
                .iter()
                .find(|(l, _)| *l == locale)
                .map(|(_, n)| (*n).to_string())
                .unwrap_or_else(|| (*sci).to_string());
            SpeciesView {
                id: (*id).to_string(),
                sci_name: (*sci).to_string(),
                region: (*region).to_string(),
                name,
            }
        })
        .collect()
}

// ──────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn in_memory_returns_5_in_id_order() {
        let species = find_all(None, "ja").await.unwrap();
        assert_eq!(species.len(), 5);
        // id 昇順: aki < cat < dhh < nat < neo
        assert_eq!(species[0].id, "aki");
        assert_eq!(species[4].id, "neo");
    }

    #[tokio::test]
    async fn ja_locale_returns_japanese_names() {
        let species = find_all(None, "ja").await.unwrap();
        let dhh = species.iter().find(|s| s.id == "dhh").unwrap();
        assert_eq!(dhh.name, "ヘラクレスオオカブト");
        assert_eq!(dhh.sci_name, "Dynastes hercules hercules");
        assert_eq!(dhh.region, "中南米");
    }

    #[tokio::test]
    async fn unknown_locale_falls_back_to_sci_name() {
        let species = find_all(None, "fr").await.unwrap();
        let dhh = species.iter().find(|s| s.id == "dhh").unwrap();
        // fr 翻訳が無いので sci_name にフォールバック
        assert_eq!(dhh.name, "Dynastes hercules hercules");
    }
}
