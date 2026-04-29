//! 商品血統情報 (= product_bloodlines + product_bloodline_ancestors) の永続化。
//!
//! **責務**:
//!   - sqlx で 2 テーブルを 1 商品ぶん JOIN し、`BloodlineView` で返す
//!   - DB 不在時 (= pool=None) は in-memory fallback で 0019 seed と同値を返す
//!
//! **設計判断**:
//!   - 商品単位 1:1 (= product_id PK) なので key は public_id で受ける handler 側に
//!     合わせ、内部では products テーブル経由で UUID に解決する
//!   - ancestors はロール ('father' / 'mother' / paternal_* / maternal_*) を別行として
//!     fetch し、Vec で返す。サマリ用途では `find` で取り出すので Map に詰め直さなくて良い
//!   - F値バンドの閾値はフロント側 (`bloodline-fixture.ts::fBand`) に残す。本 repo は
//!     生値を返すだけ (= 表示ロジックは UI 層に閉じ込める)
//!
//! **既存パターンに合わせている点**:
//!   - `repos::products` と同じく runtime sqlx (= compile-time DATABASE_URL 不要)
//!   - `find_all` は in-memory / DB の両方で同じ shape を返す
//!   - エラー型は thiserror で `Db(sqlx::Error)` を一本化

use std::collections::HashMap;

use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
struct BloodlineRow {
    /// products.id への FK。fallback の場合は `repos::products::memory_product_uuid` 値。
    product_id: Uuid,
    /// products.public_id (= "p-hh-m-142")。レスポンス key に使う。
    product_public_id: String,
    generation: String,
    /// NUMERIC(5,4) → f64 に明示 cast (= 表示用、計算には使わない)。
    inbreeding_coef: f64,
    breeder_certified: bool,
    third_party_verified: bool,
    pedigree_notes: String,
}

#[derive(Debug, Clone, FromRow)]
struct AncestorRow {
    product_id: Uuid,
    role: String,
    ancestor_public_id: String,
    name: String,
    sex: String,
    generation_label: String,
    size_mm: Option<f64>,
    is_wild: bool,
    deceased_note: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AncestorView {
    pub role: String,
    pub ancestor_public_id: String,
    pub name: String,
    pub sex: String,
    pub generation_label: String,
    pub size_mm: Option<f64>,
    pub is_wild: bool,
    pub deceased_note: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BloodlineView {
    pub product_public_id: String,
    pub generation: String,
    pub inbreeding_coef: f64,
    pub breeder_certified: bool,
    pub third_party_verified: bool,
    pub pedigree_notes: String,
    pub ancestors: Vec<AncestorView>,
}

#[derive(Debug, thiserror::Error)]
pub enum BloodlineRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// 全商品の血統データを product_public_id 昇順で返す。
/// pool=None なら in-memory fallback (= 0019 seed と同値)。
pub async fn find_all(pool: Option<&PgPool>) -> Result<Vec<BloodlineView>, BloodlineRepoError> {
    match pool {
        Some(p) => find_all_db(p).await,
        None => Ok(memory_bloodlines()),
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn find_all_db(pool: &PgPool) -> Result<Vec<BloodlineView>, BloodlineRepoError> {
    // 1) bloodline 本体 + products.public_id を JOIN で 1 query
    let rows: Vec<BloodlineRow> = sqlx::query_as::<_, BloodlineRow>(
        r#"
        SELECT
            pb.product_id,
            p.public_id AS product_public_id,
            pb.generation,
            pb.inbreeding_coef::DOUBLE PRECISION AS inbreeding_coef,
            pb.breeder_certified,
            pb.third_party_verified,
            pb.pedigree_notes
        FROM product_bloodlines pb
        JOIN products p ON p.id = pb.product_id
        ORDER BY p.public_id
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(BloodlineRepoError::Db)?;

    // 2) ancestors を bulk 取得 (= N+1 回避)
    let product_ids: Vec<Uuid> = rows.iter().map(|r| r.product_id).collect();
    let ancestors: Vec<AncestorRow> = sqlx::query_as::<_, AncestorRow>(
        r#"
        SELECT product_id, role, ancestor_public_id, name, sex,
               generation_label,
               size_mm::DOUBLE PRECISION AS size_mm,
               is_wild, deceased_note
        FROM product_bloodline_ancestors
        WHERE product_id = ANY($1)
        "#,
    )
    .bind(&product_ids)
    .fetch_all(pool)
    .await
    .map_err(BloodlineRepoError::Db)?;

    // 3) in-memory join
    let mut grouped: HashMap<Uuid, Vec<AncestorView>> = HashMap::new();
    for a in ancestors {
        grouped.entry(a.product_id).or_default().push(AncestorView {
            role: a.role,
            ancestor_public_id: a.ancestor_public_id,
            name: a.name,
            sex: a.sex,
            generation_label: a.generation_label,
            size_mm: a.size_mm,
            is_wild: a.is_wild,
            deceased_note: a.deceased_note,
        });
    }

    Ok(rows
        .into_iter()
        .map(|r| BloodlineView {
            product_public_id: r.product_public_id,
            generation: r.generation,
            inbreeding_coef: r.inbreeding_coef,
            breeder_certified: r.breeder_certified,
            third_party_verified: r.third_party_verified,
            pedigree_notes: r.pedigree_notes,
            ancestors: grouped.remove(&r.product_id).unwrap_or_default(),
        })
        .collect())
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback (= 0019_product_bloodlines.sql の seed と完全一致)
// ──────────────────────────────────────────────────────────────────────

fn memory_bloodlines() -> Vec<BloodlineView> {
    fn anc(
        role: &str,
        ancestor_public_id: &str,
        name: &str,
        sex: &str,
        generation_label: &str,
        size_mm: Option<f64>,
        is_wild: bool,
        deceased_note: Option<&str>,
    ) -> AncestorView {
        AncestorView {
            role: role.to_string(),
            ancestor_public_id: ancestor_public_id.to_string(),
            name: name.to_string(),
            sex: sex.to_string(),
            generation_label: generation_label.to_string(),
            size_mm,
            is_wild,
            deceased_note: deceased_note.map(String::from),
        }
    }

    let mut out = vec![
        BloodlineView {
            product_public_id: "p-aki".to_string(),
            generation: "WF1".to_string(),
            inbreeding_coef: 0.0,
            breeder_certified: true,
            third_party_verified: true,
            pedigree_notes:
                "MIYAMA FARM が 2024 年に直輸入した WILD ペアから採れた WF1。両親ともペルー産野生個体で完全血統不明 + F値 0.00。第三者認証済。"
                    .to_string(),
            ancestors: vec![
                anc("father", "#WILD-AKI-A", "野生 ♂ ペルー", "m", "WILD", None, true, None),
                anc("mother", "#WILD-AKI-B", "野生 ♀ ペルー", "f", "WILD", None, true, None),
            ],
        },
        BloodlineView {
            product_public_id: "p-cat-l".to_string(),
            generation: "CBF3".to_string(),
            inbreeding_coef: 0.08,
            breeder_certified: true,
            third_party_verified: false,
            pedigree_notes:
                "ANCHOR BEETLE CO. 自家累代 CBF3。父系・母系ともに KUWAGATA.jp 由来 F0 ペアから。F値 0.08 で「注意」域。次サイクルは別系統との交配を推奨。"
                    .to_string(),
            ancestors: vec![
                anc("father", "#CAT-0118", "雷", "m", "CBF1", Some(95.0), false, None),
                anc("mother", "#CAT-0089", "雪", "f", "CBF1", Some(50.0), false, None),
                anc("paternal_father", "#CAT-0091", "嵐", "m", "F0", Some(110.0), false, None),
                anc("paternal_mother", "#CAT-0097", "蘭", "f", "F0", Some(60.0), false, None),
                anc("maternal_father", "#CAT-0091", "嵐", "m", "F0", Some(110.0), false, None),
                anc("maternal_mother", "#CAT-0097", "蘭", "f", "F0", Some(60.0), false, None),
            ],
        },
        BloodlineView {
            product_public_id: "p-hh-m-142".to_string(),
            generation: "CBF2".to_string(),
            inbreeding_coef: 0.05,
            breeder_certified: true,
            third_party_verified: false,
            pedigree_notes:
                "ANCHOR BEETLE CO. 自家累代。父系は 2019 グアドループ産 WILD から 3 代目。母系は ANCHOR BEETLE CO. 自家累代 F0。F値 0.05 で安全圏内。"
                    .to_string(),
            ancestors: vec![
                anc("father", "#DHH-0213", "漆黒", "m", "CBF1", Some(152.0), false, None),
                anc("mother", "#DHH-0244", "マリア", "f", "F0", Some(66.0), false, None),
                anc("paternal_father", "#DHH-0150", "月影", "m", "F0", Some(148.0), false, Some("故 (2025-10-02)")),
                anc("paternal_mother", "#DHH-0204", "花音", "f", "F0", Some(68.0), false, None),
                anc("maternal_father", "#WILD-DHH-A", "野生 ♂", "m", "WILD", None, true, None),
                anc("maternal_mother", "#WILD-DHH-B", "野生 ♀", "f", "WILD", None, true, None),
            ],
        },
        BloodlineView {
            product_public_id: "p-neo-m".to_string(),
            generation: "CBF2".to_string(),
            inbreeding_coef: 0.0,
            breeder_certified: true,
            third_party_verified: true,
            pedigree_notes:
                "MIYAMA FARM 自家累代 CBF2。父系・母系ともに別系統の MIYAMA FARM F0 ペア。F値 0.00 で完全に安全圏。第三者血統認証済。"
                    .to_string(),
            ancestors: vec![
                anc("father", "#NEO-0058", "青嵐", "m", "CBF1", Some(102.0), false, None),
                anc("mother", "#NEO-0024", "凜", "f", "F0", Some(68.0), false, None),
                anc("paternal_father", "#NEO-0011", "蒼", "m", "F0", Some(125.0), false, None),
                anc("paternal_mother", "#NEO-0007", "翠", "f", "F0", Some(65.0), false, None),
                anc("maternal_father", "#WILD-NEO-A", "野生 ♂", "m", "WILD", None, true, None),
                anc("maternal_mother", "#WILD-NEO-B", "野生 ♀", "f", "WILD", None, true, None),
            ],
        },
    ];
    // DB 経路 (= ORDER BY p.public_id) と並びを揃える
    out.sort_by(|a, b| a.product_public_id.cmp(&b.product_public_id));
    out
}

// ──────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn in_memory_returns_four_in_id_order() {
        let rows = find_all(None).await.unwrap();
        assert_eq!(rows.len(), 4);
        let ids: Vec<&str> = rows.iter().map(|r| r.product_public_id.as_str()).collect();
        assert_eq!(ids, vec!["p-aki", "p-cat-l", "p-hh-m-142", "p-neo-m"]);
    }

    #[tokio::test]
    async fn in_memory_p_hh_has_six_ancestors_and_correct_coef() {
        let rows = find_all(None).await.unwrap();
        let dhh = rows
            .iter()
            .find(|r| r.product_public_id == "p-hh-m-142")
            .expect("p-hh-m-142 present");
        assert_eq!(dhh.generation, "CBF2");
        assert!((dhh.inbreeding_coef - 0.05).abs() < 1e-9);
        assert!(dhh.breeder_certified);
        assert!(!dhh.third_party_verified);
        assert_eq!(dhh.ancestors.len(), 6);

        let father = dhh.ancestors.iter().find(|a| a.role == "father").unwrap();
        assert_eq!(father.name, "漆黒");
        assert_eq!(father.sex, "m");
        assert_eq!(father.generation_label, "CBF1");
        assert_eq!(father.size_mm, Some(152.0));
        assert!(!father.is_wild);

        let pat_father = dhh
            .ancestors
            .iter()
            .find(|a| a.role == "paternal_father")
            .unwrap();
        assert_eq!(pat_father.deceased_note.as_deref(), Some("故 (2025-10-02)"));

        let mat_father = dhh
            .ancestors
            .iter()
            .find(|a| a.role == "maternal_father")
            .unwrap();
        assert!(mat_father.is_wild);
        assert_eq!(mat_father.size_mm, None);
    }

    #[tokio::test]
    async fn in_memory_wf1_has_only_two_ancestors() {
        let rows = find_all(None).await.unwrap();
        let aki = rows
            .iter()
            .find(|r| r.product_public_id == "p-aki")
            .expect("p-aki present");
        // WF1 は祖父母不明 → 父母 2 役割のみ
        assert_eq!(aki.ancestors.len(), 2);
        assert!(aki.ancestors.iter().all(|a| a.is_wild));
    }
}
