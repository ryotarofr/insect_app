//! shipping_methods + shipping_method_translations への永続化
//!
//! **責務**:
//!   - sqlx で shipping_methods + 翻訳を JOIN して 1 配送方法ビューを返す
//!   - DB 不在時 (= pool=None) は in-memory fallback で 0002 seed と同値の 2 件を返す
//!   - 既存 `checkout.rs::SHIPPING_METHODS` の signature 互換 helper を提供
//!
//! **設計判断**:
//!   - text PK ("cold" / "normal") をそのまま String で持つ (= UUID 化しない)
//!   - i18n は ja のみ MVP で持ち、将来 en を足す時は `cached_methods_for_locale("en")` を別途
//!   - amount_jpy は BIGINT (i64)、既存 `amount_yen` フィールドと同一意味
//!   - cards.rs::build_shipping_method_picker / checkout.rs::shipping_amount_for から
//!     使うため、`cached_methods()` は warm 後の HashMap<String, ShippingMethodView> を返す
//!
//! **TODO: handler 切替**:
//!   - `checkout.rs::SHIPPING_METHODS` const を関数化 → 本 cache から組む
//!   - `cards.rs::method_name_ja` / `method_desc_ja` 関数を削除し view から直接取得

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct ShippingMethodRow {
    pub id: String,
    pub sort_order: i32,
    pub amount_jpy: i64,
    pub is_active: bool,
}

/// 翻訳 (ja) 込みの配送方法ビュー。
#[derive(Debug, Clone)]
pub struct ShippingMethodView {
    pub id: String,
    pub sort_order: i32,
    pub amount_jpy: i64,
    pub is_active: bool,
    /// 翻訳された表示名 (= "温度制御便（推奨）")。fallback は id 文字列。
    pub name: String,
    /// 翻訳された説明 (= "生体含むため必須設定 · 15〜25℃")。fallback は空文字。
    pub description: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ShippingMethodRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// active な配送方法を sort_order 昇順で返す。pool=None なら in-memory fallback。
pub async fn find_all_active(
    pool: Option<&PgPool>,
) -> Result<Vec<ShippingMethodView>, ShippingMethodRepoError> {
    match pool {
        Some(p) => find_all_active_db(p).await,
        None => Ok(memory_methods()),
    }
}

/// 起動時に DB から全 active 配送方法を読み込み、id → view の HashMap で持つ。
pub async fn warm_methods_cache(
    pool: Option<&PgPool>,
) -> Result<(), ShippingMethodRepoError> {
    let views = find_all_active(pool).await?;
    let map: HashMap<String, ShippingMethodView> = views
        .into_iter()
        .map(|v| (v.id.clone(), v))
        .collect();
    if let Ok(mut w) = methods_cache().write() {
        *w = Some(map);
    }
    Ok(())
}

/// warm 後の HashMap を返す。warm 前は in-memory fallback。
pub fn cached_methods() -> HashMap<String, ShippingMethodView> {
    if let Ok(r) = methods_cache().read()
        && let Some(map) = r.as_ref()
    {
        return map.clone();
    }
    memory_methods_map()
}

/// id 順 (= sort_order 昇順) の Vec を返す。UI で表示順を確定させたい時に使う。
pub fn cached_methods_sorted() -> Vec<ShippingMethodView> {
    let mut v: Vec<ShippingMethodView> = cached_methods().into_values().collect();
    v.sort_by_key(|m| (m.sort_order, m.id.clone()));
    v
}

/// 配送料を返す。未知 id ならデフォルト (= sort_order 0 の amount) にフォールバック。
/// `checkout.rs::shipping_amount_for` の DB 版。
pub fn amount_for(id: &str) -> i64 {
    let cache = cached_methods();
    if let Some(m) = cache.get(id) {
        return m.amount_jpy;
    }
    // フォールバック: sort_order が一番小さい active 行を採用 (= "cold" 想定)
    cache
        .values()
        .min_by_key(|m| (m.sort_order, m.id.clone()))
        .map(|m| m.amount_jpy)
        .unwrap_or(0)
}

/// id が cache に存在するか (= patch validation 用)。
pub fn has_method(id: &str) -> bool {
    cached_methods().contains_key(id)
}

fn methods_cache() -> &'static RwLock<Option<HashMap<String, ShippingMethodView>>> {
    static C: OnceLock<RwLock<Option<HashMap<String, ShippingMethodView>>>> = OnceLock::new();
    C.get_or_init(|| RwLock::new(None))
}

#[cfg(test)]
pub fn reset_methods_cache_for_test() {
    if let Ok(mut w) = methods_cache().write() {
        *w = None;
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn find_all_active_db(
    pool: &PgPool,
) -> Result<Vec<ShippingMethodView>, ShippingMethodRepoError> {
    let rows: Vec<ShippingMethodRow> = sqlx::query_as::<_, ShippingMethodRow>(
        r#"
        SELECT id, sort_order, amount_jpy, is_active
        FROM shipping_methods
        WHERE is_active = true
        ORDER BY sort_order, id
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(ShippingMethodRepoError::Db)?;

    // 翻訳 (ja) を bulk fetch (= N+1 回避)
    let translations: Vec<(String, String, Option<String>)> =
        sqlx::query_as::<_, (String, String, Option<String>)>(
            r#"
            SELECT method_id, name, description
            FROM shipping_method_translations
            WHERE locale = 'ja'
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ShippingMethodRepoError::Db)?;

    let trans_map: HashMap<String, (String, Option<String>)> = translations
        .into_iter()
        .map(|(id, name, desc)| (id, (name, desc)))
        .collect();

    Ok(rows
        .into_iter()
        .map(|r| {
            let (name, desc) = trans_map
                .get(&r.id)
                .cloned()
                .unwrap_or_else(|| (r.id.clone(), None));
            ShippingMethodView {
                id: r.id,
                sort_order: r.sort_order,
                amount_jpy: r.amount_jpy,
                is_active: r.is_active,
                name,
                description: desc.unwrap_or_default(),
            }
        })
        .collect())
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback (= 0002_master_data.sql の seed と同値)
// ──────────────────────────────────────────────────────────────────────

fn memory_methods() -> Vec<ShippingMethodView> {
    vec![
        ShippingMethodView {
            id: "cold".to_string(),
            sort_order: 0,
            amount_jpy: 1800,
            is_active: true,
            name: "温度制御便（推奨）".to_string(),
            description: "生体含むため必須設定 · 15〜25℃".to_string(),
        },
        ShippingMethodView {
            id: "normal".to_string(),
            sort_order: 1,
            amount_jpy: 800,
            is_active: true,
            name: "通常便".to_string(),
            description: "用品のみ・常温配送".to_string(),
        },
    ]
}

fn memory_methods_map() -> HashMap<String, ShippingMethodView> {
    memory_methods().into_iter().map(|m| (m.id.clone(), m)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn in_memory_returns_two_methods_in_sort_order() {
        let methods = find_all_active(None).await.unwrap();
        assert_eq!(methods.len(), 2);
        assert_eq!(methods[0].id, "cold");
        assert_eq!(methods[0].amount_jpy, 1800);
        assert_eq!(methods[1].id, "normal");
        assert_eq!(methods[1].amount_jpy, 800);
    }

    #[tokio::test]
    async fn warm_methods_cache_in_memory_populates_two() {
        reset_methods_cache_for_test();
        warm_methods_cache(None).await.unwrap();
        let map = cached_methods();
        assert_eq!(map.len(), 2);
        assert!(map.contains_key("cold"));
        assert!(map.contains_key("normal"));
    }

    #[tokio::test]
    async fn cached_methods_sorted_returns_cold_first() {
        reset_methods_cache_for_test();
        warm_methods_cache(None).await.unwrap();
        let v = cached_methods_sorted();
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].id, "cold");
        assert_eq!(v[1].id, "normal");
    }

    #[tokio::test]
    async fn amount_for_known_and_unknown_id() {
        reset_methods_cache_for_test();
        warm_methods_cache(None).await.unwrap();
        assert_eq!(amount_for("cold"), 1800);
        assert_eq!(amount_for("normal"), 800);
        // 未知 → デフォルト (sort_order 最小 = cold) にフォールバック
        assert_eq!(amount_for("rocket"), 1800);
    }

    #[tokio::test]
    async fn has_method_works() {
        reset_methods_cache_for_test();
        warm_methods_cache(None).await.unwrap();
        assert!(has_method("cold"));
        assert!(has_method("normal"));
        assert!(!has_method("rocket"));
    }

    #[test]
    fn memory_methods_have_translations() {
        let methods = memory_methods();
        let cold = methods.iter().find(|m| m.id == "cold").unwrap();
        assert_eq!(cold.name, "温度制御便（推奨）");
        assert_eq!(cold.description, "生体含むため必須設定 · 15〜25℃");
        let normal = methods.iter().find(|m| m.id == "normal").unwrap();
        assert_eq!(normal.name, "通常便");
        assert_eq!(normal.description, "用品のみ・常温配送");
    }
}
