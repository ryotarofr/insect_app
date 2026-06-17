//! species_stats (種別の幼虫期 / 蛹期データ) への永続化 (Sprint 2 / N1 羽化予測)
//!
//! **責務**:
//!   - sqlx で `species_stats` テーブルから 1 種の `(larva_days, pupa_days)` を引く
//!   - DB 不在時 (= pool=None) は in-memory fallback で 0018 seed と同値を返す
//!   - 幼虫期 + 蛹期 の合計日数 (= birth_date 起点の eclosion 想定) を `total_days()` で提供
//!
//! **設計判断**:
//!   - **find_by_id のみ公開**: list_all は eclosion_daily worker が specimens を回す経路で
//!     1 件ずつ引けば十分。bulk fetch が必要になったら追加。
//!   - **cache はしない**: 5 行 / 1 query で十分速い (= prefectures と違って起動時 warm 不要)
//!   - **i64 ではなく i32**: PostgreSQL INTEGER と整合 (= 2^31 日 = 5800 万年で十分)

use chrono::NaiveDate;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow, PartialEq, Eq)]
pub struct SpeciesStats {
    pub species_id: String,
    pub larva_days: i32,
    pub pupa_days: i32,
}

impl SpeciesStats {
    /// 幼虫期 + 蛹期 の合計日数。birth_date 起点で eclosion_eta を算出する時に使う。
    pub fn total_days(&self) -> i32 {
        self.larva_days + self.pupa_days
    }
}

/// `birth_date + larva_days + pupa_days` で eclosion 予測日を算出する純関数。
/// (= PR N-4 / handler の create_specimen + worker の eclosion_daily で共用)
///
/// **計算式の前提**:
///   - birth_date 起点で「卵孵化〜羽化」全期間を加算する単純モデル
///   - 個体の現在 stage は考慮しない (= MVP 精度)。「蛹化日 + pupa_days」のような
///     stage 遷移日起点の精緻化は将来のタスク (= AI3 高精度予測)
///
/// **チェック**: 加算結果が NaiveDate の範囲外になることはない (= 数千年先まで安全)。
pub fn compute_eta(birth_date: NaiveDate, stats: &SpeciesStats) -> NaiveDate {
    birth_date + chrono::Duration::days(stats.total_days() as i64)
}

#[derive(Debug, thiserror::Error)]
pub enum SpeciesStatsRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// `species_id` で 1 件取得。pool=None なら in-memory fallback (= 0018 seed と同値)。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    species_id: &str,
) -> Result<Option<SpeciesStats>, SpeciesStatsRepoError> {
    match pool {
        Some(p) => {
            sqlx::query_as::<_, SpeciesStats>(
                r#"
                SELECT species_id, larva_days, pupa_days
                FROM species_stats
                WHERE species_id = $1
                "#,
            )
            .bind(species_id)
            .fetch_optional(p)
            .await
            .map_err(SpeciesStatsRepoError::Db)
        }
        None => Ok(memory_seed()
            .into_iter()
            .find(|s| s.species_id == species_id)),
    }
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback (= 0018_species_stats.sql の seed と完全一致)
// ──────────────────────────────────────────────────────────────────────

fn memory_seed() -> Vec<SpeciesStats> {
    const SEED: &[(&str, i32, i32)] = &[
        ("dhh", 540, 90),
        ("cat", 420, 60),
        ("aki", 720, 90),
        ("nat", 300, 30),
        ("neo", 540, 90),
    ];
    SEED.iter()
        .map(|(id, l, p)| SpeciesStats {
            species_id: (*id).to_string(),
            larva_days: *l,
            pupa_days: *p,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn find_dhh_returns_seed_values() {
        let s = find_by_id(None, "dhh").await.unwrap().unwrap();
        assert_eq!(s.larva_days, 540);
        assert_eq!(s.pupa_days, 90);
        assert_eq!(s.total_days(), 630);
    }

    #[tokio::test]
    async fn find_unknown_species_returns_none() {
        let s = find_by_id(None, "unknown_species").await.unwrap();
        assert!(s.is_none());
    }

    #[tokio::test]
    async fn all_5_seed_species_resolve() {
        for id in &["dhh", "cat", "aki", "nat", "neo"] {
            let s = find_by_id(None, id).await.unwrap();
            assert!(s.is_some(), "species_id={id} should be in seed");
            let s = s.unwrap();
            assert!(s.larva_days > 0);
            assert!(s.pupa_days > 0);
        }
    }

    #[test]
    fn total_days_sums_larva_and_pupa() {
        let s = SpeciesStats {
            species_id: "dhh".to_string(),
            larva_days: 540,
            pupa_days: 90,
        };
        assert_eq!(s.total_days(), 630);
    }

    #[test]
    fn compute_eta_adds_total_days_to_birth_date() {
        let stats = SpeciesStats {
            species_id: "dhh".to_string(),
            larva_days: 540,
            pupa_days: 90,
        };
        let birth = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let eta = compute_eta(birth, &stats);
        // 2024 は閏年 (366 日)。2024-01-01 + 630 days = 2025-09-22
        assert_eq!(eta, NaiveDate::from_ymd_opt(2025, 9, 22).unwrap());
    }

    #[tokio::test]
    async fn compute_eta_works_with_seed_lookup() {
        let stats = find_by_id(None, "nat").await.unwrap().unwrap();
        let birth = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let eta = compute_eta(birth, &stats);
        // nat: 300 + 30 = 330 days. 2026 は平年。2026-01-01 + 330 = 2026-11-27
        assert_eq!(eta, NaiveDate::from_ymd_opt(2026, 11, 27).unwrap());
    }
}
