//! listing_shipping_methods (出品ごとの対応可能配送方法) への永続化
//!
//! **背景**:
//!   C2C で出品者が「自分が対応可能な配送方法」を絞り込めるようにする。
//!   検索 / checkout は repo の `find_by_listing` を使い、wizard は `set_for_listing`
//!   で書き込む。
//!
//! **「未対応 = 全方法 OK」の規律**:
//!   - 行が 1 件も無い場合、「全方法に対応」と解釈する (= 出品者が絞り込みを設定していない状態)。
//!   - 行があれば、その集合のみ対応とみなす (= 絞り込み意思を尊重)。
//!   - この解釈は handler / フロント側で行う (= 本 repo は集合だけ管理)。
//!
//! **設計上の注意**:
//!   - shipping_method_id の値域チェックは migration の FK ではなく application 側 (= 本 repo の
//!     validate)。`shipping_methods.id` の seed 集合に含まれることを `is_known_shipping_method_id`
//!     で握る。
//!   - `set_for_listing` は冪等 (= DELETE → INSERT の transaction で旧集合を捨てる)。
//!     部分更新 (差分 add/remove) は MVP では不要。

use std::sync::{Mutex, OnceLock};

use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct ListingShippingMethodRow {
    pub listing_id: Uuid,
    pub shipping_method_id: String,
    pub extra_fee_jpy: Option<i64>,
}

#[derive(Debug, thiserror::Error)]
pub enum ListingShippingMethodRepoError {
    #[error("invalid shipping method: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// 1 listing の対応配送方法 ID リストを返す (= sort_order 昇順は呼び出し側で再現する)。
/// 行が無ければ空 Vec を返す (= 「全方法 OK」の解釈は呼び出し側)。
pub async fn find_by_listing(
    pool: Option<&PgPool>,
    listing_id: Uuid,
) -> Result<Vec<String>, ListingShippingMethodRepoError> {
    match pool {
        Some(p) => {
            let rows: Vec<(String,)> = sqlx::query_as(
                r#"
                SELECT shipping_method_id
                FROM listing_shipping_methods
                WHERE listing_id = $1
                ORDER BY shipping_method_id
                "#,
            )
            .bind(listing_id)
            .fetch_all(p)
            .await
            .map_err(ListingShippingMethodRepoError::Db)?;
            Ok(rows.into_iter().map(|r| r.0).collect())
        }
        None => {
            let store = memory_store()
                .lock()
                .expect("listing_shipping_methods memory mutex poisoned");
            let mut out: Vec<String> = store
                .iter()
                .filter(|r| r.listing_id == listing_id)
                .map(|r| r.shipping_method_id.clone())
                .collect();
            out.sort();
            Ok(out)
        }
    }
}

/// 1 listing の対応配送方法集合を上書きする (= 旧集合を全削除して新集合を INSERT)。
/// `method_ids` が空の場合は全削除のみ (= 「全方法 OK」状態に戻す)。
///
/// **冪等性**: 同じ listing_id で何度呼んでも結果が同じになる (= transaction で DELETE → INSERT)。
///
/// **shipping_method_id 検証**:
///   shipping_methods.id の seed 集合に含まれるかを呼び出し側 (= handler) で事前検証する想定。
///   本 repo では空文字列のみ拒否する。
pub async fn set_for_listing(
    pool: Option<&PgPool>,
    listing_id: Uuid,
    method_ids: &[&str],
) -> Result<(), ListingShippingMethodRepoError> {
    for m in method_ids {
        if m.trim().is_empty() {
            return Err(ListingShippingMethodRepoError::Invalid(
                "empty shipping_method_id".to_string(),
            ));
        }
    }

    match pool {
        Some(p) => {
            let mut tx: Transaction<'_, Postgres> = p
                .begin()
                .await
                .map_err(ListingShippingMethodRepoError::Db)?;
            // 旧集合を全削除
            sqlx::query("DELETE FROM listing_shipping_methods WHERE listing_id = $1")
                .bind(listing_id)
                .execute(&mut *tx)
                .await
                .map_err(ListingShippingMethodRepoError::Db)?;
            // 新集合を INSERT (= MVP では extra_fee_jpy=NULL 固定)
            for m in method_ids {
                sqlx::query(
                    r#"
                    INSERT INTO listing_shipping_methods
                        (listing_id, shipping_method_id, extra_fee_jpy)
                    VALUES ($1, $2, NULL)
                    ON CONFLICT (listing_id, shipping_method_id) DO NOTHING
                    "#,
                )
                .bind(listing_id)
                .bind(*m)
                .execute(&mut *tx)
                .await
                .map_err(ListingShippingMethodRepoError::Db)?;
            }
            tx.commit().await.map_err(ListingShippingMethodRepoError::Db)?;
            Ok(())
        }
        None => {
            let mut store = memory_store()
                .lock()
                .expect("listing_shipping_methods memory mutex poisoned");
            store.retain(|r| r.listing_id != listing_id);
            for m in method_ids {
                store.push(ListingShippingMethodRow {
                    listing_id,
                    shipping_method_id: m.to_string(),
                    extra_fee_jpy: None,
                });
            }
            Ok(())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback (= MVP / DB 不在時)
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<ListingShippingMethodRow>> {
    static S: OnceLock<Mutex<Vec<ListingShippingMethodRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_store().lock() {
        s.clear();
    }
}

#[cfg(test)]
pub fn memory_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    GUARD.lock().unwrap_or_else(|p| p.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lid() -> Uuid {
        Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap()
    }

    #[tokio::test]
    async fn rejects_empty_method_id() {
        let _g = memory_guard();
        match set_for_listing(None, lid(), &["", "cold"]).await {
            Err(ListingShippingMethodRepoError::Invalid(_)) => {}
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn set_and_find_roundtrip() {
        let _g = memory_guard();
        reset_memory_for_test();
        set_for_listing(None, lid(), &["cold", "normal"]).await.unwrap();
        let methods = find_by_listing(None, lid()).await.unwrap();
        assert_eq!(methods, vec!["cold".to_string(), "normal".to_string()]);
    }

    #[tokio::test]
    async fn set_overwrites_previous_set() {
        let _g = memory_guard();
        reset_memory_for_test();
        set_for_listing(None, lid(), &["cold", "normal"]).await.unwrap();
        set_for_listing(None, lid(), &["normal"]).await.unwrap();
        let methods = find_by_listing(None, lid()).await.unwrap();
        assert_eq!(methods, vec!["normal".to_string()]);
    }

    #[tokio::test]
    async fn set_empty_clears_to_all_ok_state() {
        let _g = memory_guard();
        reset_memory_for_test();
        set_for_listing(None, lid(), &["cold"]).await.unwrap();
        set_for_listing(None, lid(), &[]).await.unwrap();
        let methods = find_by_listing(None, lid()).await.unwrap();
        assert!(methods.is_empty(), "空集合 = 全方法 OK の暗黙状態");
    }

    #[tokio::test]
    async fn find_by_listing_returns_empty_for_unknown() {
        let _g = memory_guard();
        reset_memory_for_test();
        let other = Uuid::parse_str("22222222-2222-4222-8222-222222222222").unwrap();
        let methods = find_by_listing(None, other).await.unwrap();
        assert!(methods.is_empty());
    }
}
