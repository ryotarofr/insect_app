//! products / product_translations への永続化 (Phase 9.B / DB設計書 v2 §3.2)
//!
//! **責務**:
//!   - sqlx で products + product_translations を JOIN して 1 商品を返す
//!   - locale fallback: 第 1 引数 locale → "ja" → public_id (= 翻訳行が無い場合)
//!   - DB 不在時 (= pool=None) は orders_repo と同じく in-memory fallback で固定 6 件を返す
//!   - 既存 `cards.rs::product_filter_meta()` の signature 互換 helper
//!     `to_meta_map()` を提供 (= 段階 3 の handler 切替で使う)
//!
//! **設計判断**:
//!   - sqlx::query / query_as の **runtime API** を採用 (= compile-time DATABASE_URL 不要)。
//!     orders_repo と同じパターン。
//!   - badge_kind は server 側で raw 文字列のまま保持し、SDUI 出力時に i18n 解決する想定。
//!     cards.rs の既存 helper では「おすすめ」「幼虫」等の表示 raw text を直接生成して
//!     いたため、互換 helper では badge_kind → ja 表示文字列の **変換マップ** を持つ。
//!     将来 SDUI 化が進んだら `Localizable::I18n { key: "badge.recommended" }` で返す。
//!
//! **段階 3 で予定する handler 切替**:
//!   - `cards.rs::product_filter_meta()` の中身を `to_meta_map()` を返すように変更
//!   - `mock_store()` / `detail_mock_store()` も `Product` の Vec から CardBlock を構築

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct ProductRow {
    pub id: Uuid,
    pub public_id: String,
    pub shop_id: Uuid,
    pub kind: String,                                   // "live" / "supply"
    pub difficulty: Option<String>,                     // "easy" / "medium" / "hard"
    pub species_id: Option<String>,
    pub sex: Option<String>,                            // "male" / "female" / "unknown"
    pub is_pair: bool,
    pub generation: Option<String>,
    /// NUMERIC(5,1) は sqlx::types::BigDecimal にマップされるが、本プロジェクトは
    /// MVP では浮動小数で扱って問題ない (= 表示精度のみ重視 / 計算には使わない) ため
    /// SELECT 側で `size_mm::DOUBLE PRECISION` にキャストして `Option<f64>` で受け取る。
    /// BigDecimal 採用は Phase 9.x で再評価。
    pub size_mm: Option<f64>,
    pub price_jpy: i64,
    pub badge_kind: Option<String>,
    pub tone: String,                                   // "forest" / "amber"
    pub ph_label: String,
    pub is_active: bool,
}

#[derive(Debug, Clone)]
pub struct Product {
    pub row: ProductRow,
    /// (locale, title) のペア。translation テーブルから JOIN で取得した結果。
    /// 第 1 引数 locale → "ja" の順で fallback して title を返すヘルパは [`Product::title`] 参照。
    pub translations: Vec<(String, String)>,
}

impl Product {
    /// 第 1 引数 locale で title を返す。無ければ ja → public_id にフォールバック。
    pub fn title(&self, locale: &str) -> String {
        if let Some((_, t)) = self.translations.iter().find(|(l, _)| l == locale) {
            return t.clone();
        }
        if let Some((_, t)) = self.translations.iter().find(|(l, _)| l == "ja") {
            return t.clone();
        }
        self.row.public_id.clone()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProductRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("product not found: {0}")]
    NotFound(String),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// 全 active 商品を public_id 順で返す。pool が None なら in-memory fallback。
pub async fn find_all(
    pool: Option<&PgPool>,
    only_active: bool,
) -> Result<Vec<Product>, ProductRepoError> {
    match pool {
        Some(p) => find_all_db(p, only_active).await,
        None => Ok(memory_products()
            .into_iter()
            .filter(|p| !only_active || p.row.is_active)
            .collect()),
    }
}

/// public_id (= "p-hh-m-142" 等) で 1 件取得。
pub async fn find_by_public_id(
    pool: Option<&PgPool>,
    public_id: &str,
) -> Result<Option<Product>, ProductRepoError> {
    match pool {
        Some(p) => find_by_public_id_db(p, public_id).await,
        None => Ok(memory_products()
            .into_iter()
            .find(|p| p.row.public_id == public_id)),
    }
}

/// 内部 UUID で 1 件取得 (= order_items.product_id 等の FK lookup 用)。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<Product>, ProductRepoError> {
    match pool {
        Some(p) => find_by_id_db(p, id).await,
        None => Ok(memory_products().into_iter().find(|p| p.row.id == id)),
    }
}

// ──────────────────────────────────────────────────────────────────────
// 互換 helper: cards.rs::ProductMeta との橋渡し
// ──────────────────────────────────────────────────────────────────────

/// cards.rs の `pub(crate) struct ProductMeta` 互換のフィールドだけ抜き出した cache 用 view。
///
/// 段階 3 で `cards.rs::product_filter_meta()` の中身を本 helper の結果に置換する。
///
/// **`created_days_ago` の扱い**:
///   現状 DB スキーマには「sort 用の固定経過日数」カラムが無い (`created_at` はあるが
///   テスト時刻に依存させると flakey になる)。Phase 9.B の段階 3 では cards.rs 側の
///   既存値をそのまま `seeded_created_days_ago` 関数に閉じ込めて流用する。
///   "new" sort の表現を変えたくなったら `created_at` ベースの計算に切り替えるか、
///   products テーブルに `seeded_days_ago` カラムを足す。
#[derive(Debug, Clone)]
pub struct ProductMetaView {
    pub public_id: String,
    pub category: &'static str,                         // "live" / "supply"
    pub difficulty: &'static str,                       // "easy" / "medium" / "hard" / "" (= supply 時)
    pub price_yen: u32,
    pub created_days_ago: u32,                          // = `seeded_created_days_ago(public_id)` の値
    pub title: String,                                  // ja
}

/// `created_days_ago` の seed 値テーブル (cards.rs の既存 ProductMeta と同値)。
///
/// 未登録 public_id は 0 を返す (= "今日登録された" 扱い)。
fn seeded_created_days_ago(public_id: &str) -> u32 {
    match public_id {
        "p-hh-m-142" => 7,
        "p-cat-l"    => 30,
        "p-neo-m"    => 14,
        "p-aki"      => 2,
        "p-jelly"    => 60,
        "p-mat"      => 45,
        _            => 0,
    }
}

impl ProductMetaView {
    fn from_product(p: &Product) -> Self {
        // kind / difficulty を 'static slice に正規化 (= cards.rs 側の API と互換)
        let category: &'static str = match p.row.kind.as_str() {
            "live" => "live",
            "supply" => "supply",
            other => panic_unknown_kind(other),
        };
        let difficulty: &'static str = match p.row.difficulty.as_deref() {
            Some("easy") => "easy",
            Some("medium") => "medium",
            Some("hard") => "hard",
            None => "",
            Some(other) => panic_unknown_difficulty(other),
        };
        Self {
            public_id: p.row.public_id.clone(),
            category,
            difficulty,
            price_yen: u32::try_from(p.row.price_jpy).unwrap_or(0),
            created_days_ago: seeded_created_days_ago(&p.row.public_id),
            title: p.title("ja"),
        }
    }
}

#[cold]
fn panic_unknown_kind(k: &str) -> ! {
    panic!("unknown product kind: {k} (DB CHECK constraint should prevent this)")
}

#[cold]
fn panic_unknown_difficulty(d: &str) -> ! {
    panic!("unknown product difficulty: {d}")
}

/// **互換 cache**: 起動時に DB から全商品を読み込み、`HashMap<public_id, ProductMetaView>`
/// で持っておく。`cards.rs::product_filter_meta()` の置き換え先として使う。
///
/// pool=None の時は in-memory fallback (= 0003 seed と同じ 6 件) を返す。
pub async fn warm_meta_cache(pool: Option<&PgPool>) -> Result<(), ProductRepoError> {
    let products = find_all(pool, true).await?;
    let map: HashMap<String, ProductMetaView> = products
        .iter()
        .map(|p| (p.row.public_id.clone(), ProductMetaView::from_product(p)))
        .collect();
    if let Ok(mut w) = meta_cache().write() {
        *w = Some(map);
    }
    Ok(())
}

/// **互換 cache 取得**: warm_meta_cache 後の HashMap を返す。warm 前は in-memory fallback。
pub fn cached_meta() -> HashMap<String, ProductMetaView> {
    if let Ok(r) = meta_cache().read() {
        if let Some(map) = r.as_ref() {
            return map.clone();
        }
    }
    memory_meta_view_map()
}

fn meta_cache() -> &'static RwLock<Option<HashMap<String, ProductMetaView>>> {
    static C: OnceLock<RwLock<Option<HashMap<String, ProductMetaView>>>> = OnceLock::new();
    C.get_or_init(|| RwLock::new(None))
}

#[cfg(test)]
pub fn reset_meta_cache_for_test() {
    if let Ok(mut w) = meta_cache().write() {
        *w = None;
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装 (runtime queries)
// ──────────────────────────────────────────────────────────────────────

async fn find_all_db(
    pool: &PgPool,
    only_active: bool,
) -> Result<Vec<Product>, ProductRepoError> {
    let rows: Vec<ProductRow> = sqlx::query_as::<_, ProductRow>(
        r#"
        SELECT id, public_id, shop_id, kind, difficulty, species_id, sex, is_pair,
               generation,
               -- NUMERIC(5,1) は f64 に cast (= sqlx の型推論を曖昧にしないため明示)
               size_mm::DOUBLE PRECISION AS size_mm,
               price_jpy, badge_kind, tone, ph_label, is_active
        FROM products
        WHERE ($1 = false) OR (is_active = true)
        ORDER BY public_id
        "#,
    )
    .bind(only_active)
    .fetch_all(pool)
    .await
    .map_err(ProductRepoError::Db)?;

    // translations を 1 クエリで bulk 取得して in-memory join (= N+1 回避)
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let translations: Vec<(Uuid, String, String)> = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"
        SELECT product_id, locale, title
        FROM product_translations
        WHERE product_id = ANY($1)
        "#,
    )
    .bind(&ids)
    .fetch_all(pool)
    .await
    .map_err(ProductRepoError::Db)?;

    let mut group: HashMap<Uuid, Vec<(String, String)>> = HashMap::new();
    for (pid, locale, title) in translations {
        group.entry(pid).or_default().push((locale, title));
    }

    Ok(rows
        .into_iter()
        .map(|r| {
            let translations = group.remove(&r.id).unwrap_or_default();
            Product { row: r, translations }
        })
        .collect())
}

async fn find_by_public_id_db(
    pool: &PgPool,
    public_id: &str,
) -> Result<Option<Product>, ProductRepoError> {
    let row: Option<ProductRow> = sqlx::query_as::<_, ProductRow>(
        r#"
        SELECT id, public_id, shop_id, kind, difficulty, species_id, sex, is_pair,
               generation, size_mm::DOUBLE PRECISION AS size_mm,
               price_jpy, badge_kind, tone, ph_label, is_active
        FROM products
        WHERE public_id = $1
        "#,
    )
    .bind(public_id)
    .fetch_optional(pool)
    .await
    .map_err(ProductRepoError::Db)?;

    let Some(row) = row else {
        return Ok(None);
    };

    let translations: Vec<(String, String)> = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT locale, title
        FROM product_translations
        WHERE product_id = $1
        "#,
    )
    .bind(row.id)
    .fetch_all(pool)
    .await
    .map_err(ProductRepoError::Db)?;

    Ok(Some(Product { row, translations }))
}

async fn find_by_id_db(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<Product>, ProductRepoError> {
    let row: Option<ProductRow> = sqlx::query_as::<_, ProductRow>(
        r#"
        SELECT id, public_id, shop_id, kind, difficulty, species_id, sex, is_pair,
               generation, size_mm::DOUBLE PRECISION AS size_mm,
               price_jpy, badge_kind, tone, ph_label, is_active
        FROM products
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(ProductRepoError::Db)?;

    let Some(row) = row else {
        return Ok(None);
    };

    let translations: Vec<(String, String)> = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT locale, title
        FROM product_translations
        WHERE product_id = $1
        "#,
    )
    .bind(row.id)
    .fetch_all(pool)
    .await
    .map_err(ProductRepoError::Db)?;

    Ok(Some(Product { row, translations }))
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback (= MVP / DB 不在時)
// ──────────────────────────────────────────────────────────────────────
//
// 0003_products.sql の seed と完全に一致する 6 件を返す。
// pool=None の時は test 環境 / DB 切れ時 / migration 前の dev で動く。

fn memory_products() -> Vec<Product> {
    fn p(
        public_id: &str,
        kind: &str,
        difficulty: Option<&str>,
        species_id: Option<&str>,
        sex: Option<&str>,
        generation: Option<&str>,
        size_mm: Option<f64>,
        price_jpy: i64,
        badge_kind: Option<&str>,
        tone: &str,
        ph_label: &str,
        title_ja: &str,
    ) -> Product {
        Product {
            row: ProductRow {
                id: Uuid::new_v4(),                     // in-memory なので毎回新規 (= test で id 安定が要なら別 helper)
                public_id: public_id.to_string(),
                shop_id: Uuid::nil(),                   // in-memory ではダミー
                kind: kind.to_string(),
                difficulty: difficulty.map(String::from),
                species_id: species_id.map(String::from),
                sex: sex.map(String::from),
                is_pair: false,
                generation: generation.map(String::from),
                size_mm,
                price_jpy,
                badge_kind: badge_kind.map(String::from),
                tone: tone.to_string(),
                ph_label: ph_label.to_string(),
                is_active: true,
            },
            translations: vec![("ja".to_string(), title_ja.to_string())],
        }
    }

    // title / price は cards.rs::product_filter_meta() (= 段階 3 で本 fallback に置換) と
    // 完全に一致させる。0003_products.sql の seed もこれと同値で揃える。
    vec![
        p("p-hh-m-142", "live", Some("hard"),   Some("dhh"), Some("male"),    Some("CBF2"), Some(142.0), 48000, Some("recommended"), "forest", "D", "ヘラクレスオオカブト ♂ 142mm"),
        p("p-cat-l",    "live", Some("medium"), Some("cat"), Some("unknown"), Some("CBF3"), None,        12000, Some("larva"),       "forest", "C", "コーカサス幼虫 3齢 ♂ 52g"),
        p("p-neo-m",    "live", Some("hard"),   Some("neo"), Some("male"),    Some("CBF2"), None,        28000, Some("warning"),     "forest", "N", "ネプチューン ♂ 初令ペア"),
        p("p-aki",      "live", Some("hard"),   Some("aki"), Some("male"),    Some("WF1"),  None,        62000, Some("rare"),        "forest", "A", "アクタエオン WILD F1 ♂"),
        // supply は本来 difficulty 概念を持たないが、cards.rs 旧 hardcoded ProductMeta が
        // "easy" を入れて UI の難易度フィルタに乗せていたため、互換のため "easy" を維持。
        p("p-jelly",    "supply", Some("easy"), None,        None,            None,         None,         1480, Some("consumable"),  "amber",  "J", "高栄養ゼリー 17g × 50個"),
        p("p-mat",      "supply", Some("easy"), None,        None,            None,         None,         1280, Some("popular"),     "amber",  "M", "完熟発酵マット 10L"),
    ]
}

fn memory_meta_view_map() -> HashMap<String, ProductMetaView> {
    memory_products()
        .iter()
        .map(|p| (p.row.public_id.clone(), ProductMetaView::from_product(p)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn in_memory_find_all_returns_six() {
        let products = find_all(None, true).await.unwrap();
        assert_eq!(products.len(), 6);
    }

    #[tokio::test]
    async fn in_memory_find_by_public_id_hits() {
        let p = find_by_public_id(None, "p-hh-m-142").await.unwrap();
        assert!(p.is_some());
        let p = p.unwrap();
        assert_eq!(p.row.kind, "live");
        assert_eq!(p.row.price_jpy, 48000);
        assert_eq!(p.title("ja"), "ヘラクレスオオカブト ♂ 142mm");
    }

    #[tokio::test]
    async fn in_memory_find_by_public_id_misses() {
        let p = find_by_public_id(None, "p-not-exist").await.unwrap();
        assert!(p.is_none());
    }

    #[test]
    fn product_meta_view_maps_kind_and_difficulty() {
        let products = memory_products();
        let live = products.iter().find(|p| p.row.public_id == "p-hh-m-142").unwrap();
        let v = ProductMetaView::from_product(live);
        assert_eq!(v.category, "live");
        assert_eq!(v.difficulty, "hard");
        assert_eq!(v.price_yen, 48000);

        // supply は seed で 'easy' を入れている (= cards.rs 旧挙動互換 / 用品が
        // 「初心者向け」chip に乗る)。将来 supply に専用 chip を出す時は NULL に戻す。
        let supply = products.iter().find(|p| p.row.public_id == "p-jelly").unwrap();
        let v = ProductMetaView::from_product(supply);
        assert_eq!(v.category, "supply");
        assert_eq!(v.difficulty, "easy");

        // difficulty NULL の経路 (= 直書き Product) でも空文字に倒れること
        let null_p = Product {
            row: ProductRow {
                id: Uuid::nil(),
                public_id: "p-null-diff".to_string(),
                shop_id: Uuid::nil(),
                kind: "supply".to_string(),
                difficulty: None,
                species_id: None,
                sex: None,
                is_pair: false,
                generation: None,
                size_mm: None,
                price_jpy: 100,
                badge_kind: None,
                tone: "amber".to_string(),
                ph_label: "X".to_string(),
                is_active: true,
            },
            translations: vec![],
        };
        let v = ProductMetaView::from_product(&null_p);
        assert_eq!(v.difficulty, "");
    }

    #[tokio::test]
    async fn warm_meta_cache_in_memory_populates_six() {
        reset_meta_cache_for_test();
        warm_meta_cache(None).await.unwrap();
        let map = cached_meta();
        assert_eq!(map.len(), 6);
        assert!(map.contains_key("p-hh-m-142"));
        assert_eq!(map.get("p-jelly").unwrap().price_yen, 1480);
    }

    /// 段階 3: cards.rs::ProductMeta.created_days_ago と同値を返すこと。
    /// cards.rs 側の sort "new" が DB 移行後も既存挙動を保つ保証。
    #[test]
    fn seeded_created_days_ago_matches_legacy_values() {
        assert_eq!(seeded_created_days_ago("p-hh-m-142"), 7);
        assert_eq!(seeded_created_days_ago("p-cat-l"), 30);
        assert_eq!(seeded_created_days_ago("p-neo-m"), 14);
        assert_eq!(seeded_created_days_ago("p-aki"), 2);
        assert_eq!(seeded_created_days_ago("p-jelly"), 60);
        assert_eq!(seeded_created_days_ago("p-mat"), 45);
        // 未知 id は 0 (= "今日" 扱い)
        assert_eq!(seeded_created_days_ago("p-unknown"), 0);
    }

    /// 段階 3: ProductMetaView 経由でも created_days_ago / title が伝搬すること。
    #[test]
    fn product_meta_view_carries_created_days_ago_and_title() {
        let products = memory_products();
        let aki = products.iter().find(|p| p.row.public_id == "p-aki").unwrap();
        let v = ProductMetaView::from_product(aki);
        assert_eq!(v.created_days_ago, 2);
        assert_eq!(v.title, "アクタエオン WILD F1 ♂");
        let mat = products.iter().find(|p| p.row.public_id == "p-mat").unwrap();
        let v = ProductMetaView::from_product(mat);
        assert_eq!(v.created_days_ago, 45);
        assert_eq!(v.title, "完熟発酵マット 10L");
        assert_eq!(v.price_yen, 1280);
    }

    #[test]
    fn product_title_falls_back_from_locale_to_ja_to_public_id() {
        let p = Product {
            row: ProductRow {
                id: Uuid::nil(),
                public_id: "p-test".to_string(),
                shop_id: Uuid::nil(),
                kind: "live".to_string(),
                difficulty: None,
                species_id: None,
                sex: None,
                is_pair: false,
                generation: None,
                size_mm: None,
                price_jpy: 0,
                badge_kind: None,
                tone: "forest".to_string(),
                ph_label: "T".to_string(),
                is_active: true,
            },
            translations: vec![("ja".to_string(), "テスト".to_string())],
        };
        assert_eq!(p.title("ja"), "テスト");        // hit
        assert_eq!(p.title("en"), "テスト");        // ja fallback
        assert_eq!(
            Product { row: p.row.clone(), translations: vec![] }.title("en"),
            "p-test"                                   // public_id fallback
        );
    }
}
