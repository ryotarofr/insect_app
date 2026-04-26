//! bids (入札履歴) への永続化 (Phase 9.E / DB設計書 v2 §3.7)
//!
//! **責務 (本 PR / skeleton)**:
//!   - sqlx で bids テーブルへの INSERT / SELECT
//!   - DB 不在時は in-memory fallback
//!   - listings.current_price_jpy の更新は本 repo では扱わず handler 側で握る規律
//!
//! **未実装 (= 後続)**:
//!   - 自動 trigger で listings.current_price_jpy = MAX(bids.amount_jpy)
//!   - bid 承認 / cancel ワークフロー (= MVP では INSERT 一方通行)

use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct BidRow {
    pub id: Uuid,
    pub listing_id: Uuid,
    pub bidder_user_id: Uuid,
    pub amount_jpy: i64,
    pub bid_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct BidInsert {
    pub listing_id: Uuid,
    pub bidder_user_id: Uuid,
    pub amount_jpy: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum BidRepoError {
    #[error("invalid bid: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

pub async fn insert(
    pool: Option<&PgPool>,
    p: BidInsert,
) -> Result<Uuid, BidRepoError> {
    if p.amount_jpy <= 0 {
        return Err(BidRepoError::Invalid(format!(
            "amount_jpy must be > 0, got {}",
            p.amount_jpy
        )));
    }
    match pool {
        Some(pool) => {
            let row: (Uuid,) = sqlx::query_as(
                r#"
                INSERT INTO bids (listing_id, bidder_user_id, amount_jpy)
                VALUES ($1, $2, $3)
                RETURNING id
                "#,
            )
            .bind(p.listing_id)
            .bind(p.bidder_user_id)
            .bind(p.amount_jpy)
            .fetch_one(pool)
            .await
            .map_err(BidRepoError::Db)?;
            Ok(row.0)
        }
        None => {
            let id = Uuid::new_v4();
            memory_lock_mut().push(BidRow {
                id,
                listing_id: p.listing_id,
                bidder_user_id: p.bidder_user_id,
                amount_jpy: p.amount_jpy,
                bid_at: Utc::now(),
            });
            Ok(id)
        }
    }
}

/// 1 listing の入札を bid_at 降順 (= 新しい順) で返す。
pub async fn list_by_listing(
    pool: Option<&PgPool>,
    listing_id: Uuid,
) -> Result<Vec<BidRow>, BidRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, BidRow>(
            r#"
            SELECT id, listing_id, bidder_user_id, amount_jpy, bid_at
            FROM bids
            WHERE listing_id = $1
            ORDER BY bid_at DESC
            "#,
        )
        .bind(listing_id)
        .fetch_all(p)
        .await
        .map_err(BidRepoError::Db),
        None => {
            let mut rows: Vec<BidRow> = memory_lock()
                .iter()
                .filter(|r| r.listing_id == listing_id)
                .cloned()
                .collect();
            rows.sort_by(|a, b| b.bid_at.cmp(&a.bid_at));
            Ok(rows)
        }
    }
}

/// 1 listing の最高入札 (= MAX(amount_jpy))。
pub async fn find_top_bid(
    pool: Option<&PgPool>,
    listing_id: Uuid,
) -> Result<Option<BidRow>, BidRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, BidRow>(
            r#"
            SELECT id, listing_id, bidder_user_id, amount_jpy, bid_at
            FROM bids
            WHERE listing_id = $1
            ORDER BY amount_jpy DESC, bid_at ASC
            LIMIT 1
            "#,
        )
        .bind(listing_id)
        .fetch_optional(p)
        .await
        .map_err(BidRepoError::Db),
        None => {
            let mut rows: Vec<BidRow> = memory_lock()
                .iter()
                .filter(|r| r.listing_id == listing_id)
                .cloned()
                .collect();
            // 同額なら早い順 (= bid_at 昇順)
            rows.sort_by(|a, b| {
                b.amount_jpy
                    .cmp(&a.amount_jpy)
                    .then_with(|| a.bid_at.cmp(&b.bid_at))
            });
            Ok(rows.into_iter().next())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<BidRow>> {
    static S: OnceLock<Mutex<Vec<BidRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_lock() -> std::sync::MutexGuard<'static, Vec<BidRow>> {
    memory_store().lock().expect("bids memory mutex poisoned")
}

fn memory_lock_mut() -> std::sync::MutexGuard<'static, Vec<BidRow>> {
    memory_lock()
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

    fn listing() -> Uuid {
        Uuid::parse_str("c0c0c0c0-0000-4000-8000-00000000c0c0").unwrap()
    }
    fn bidder() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }

    #[tokio::test]
    async fn validate_rejects_zero_amount() {
        let _g = memory_guard();
        match insert(
            None,
            BidInsert {
                listing_id: listing(),
                bidder_user_id: bidder(),
                amount_jpy: 0,
            },
        )
        .await
        {
            Err(BidRepoError::Invalid(msg)) => assert!(msg.contains("amount_jpy")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn in_memory_insert_and_list_orders_by_bid_at_desc() {
        let _g = memory_guard();
        reset_memory_for_test();
        let _ = insert(
            None,
            BidInsert {
                listing_id: listing(),
                bidder_user_id: bidder(),
                amount_jpy: 50000,
            },
        )
        .await
        .unwrap();
        // 微小差で順序を作る
        std::thread::sleep(std::time::Duration::from_millis(2));
        let _ = insert(
            None,
            BidInsert {
                listing_id: listing(),
                bidder_user_id: bidder(),
                amount_jpy: 60000,
            },
        )
        .await
        .unwrap();

        let bids = list_by_listing(None, listing()).await.unwrap();
        assert_eq!(bids.len(), 2);
        assert_eq!(bids[0].amount_jpy, 60000, "新しい順 = bid_at desc");
    }

    #[tokio::test]
    async fn in_memory_find_top_bid_returns_max_amount() {
        let _g = memory_guard();
        reset_memory_for_test();
        for amt in [50000i64, 70000, 60000] {
            let _ = insert(
                None,
                BidInsert {
                    listing_id: listing(),
                    bidder_user_id: bidder(),
                    amount_jpy: amt,
                },
            )
            .await
            .unwrap();
        }
        let top = find_top_bid(None, listing()).await.unwrap().unwrap();
        assert_eq!(top.amount_jpy, 70000);
    }

    #[tokio::test]
    async fn in_memory_find_top_bid_filters_other_listings() {
        let _g = memory_guard();
        reset_memory_for_test();
        let other_listing = Uuid::new_v4();
        let _ = insert(
            None,
            BidInsert {
                listing_id: other_listing,
                bidder_user_id: bidder(),
                amount_jpy: 999_999,
            },
        )
        .await
        .unwrap();
        let _ = insert(
            None,
            BidInsert {
                listing_id: listing(),
                bidder_user_id: bidder(),
                amount_jpy: 50000,
            },
        )
        .await
        .unwrap();
        let top = find_top_bid(None, listing()).await.unwrap().unwrap();
        assert_eq!(top.amount_jpy, 50000, "他 listing の高額は混ざらない");
    }
}
