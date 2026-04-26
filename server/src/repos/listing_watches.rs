//! listing_watches (出品ウォッチ) への永続化 (Phase 9.E / DB設計書 v2 §3.7)
//!
//! `repos::product_watches` の listing 版。設計書 High #1 案 C に従い、
//! product_watches / listing_watches を 2 テーブルに分割している。
//!
//! **責務 (本 PR / skeleton)**:
//!   - sqlx で listing_watches テーブルへの toggle / list / count
//!   - DB 不在時は in-memory fallback
//!   - handler 統合は別 PR

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct ListingWatchRow {
    pub user_id: Uuid,
    pub listing_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum ListingWatchRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToggleOutcome {
    Added,
    Removed,
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

pub async fn toggle(
    pool: Option<&PgPool>,
    user_id: Uuid,
    listing_id: Uuid,
) -> Result<ToggleOutcome, ListingWatchRepoError> {
    match pool {
        Some(p) => toggle_db(p, user_id, listing_id).await,
        None => Ok(toggle_memory(user_id, listing_id)),
    }
}

pub async fn is_watched(
    pool: Option<&PgPool>,
    user_id: Uuid,
    listing_id: Uuid,
) -> Result<bool, ListingWatchRepoError> {
    match pool {
        Some(p) => {
            let row: Option<(Uuid,)> = sqlx::query_as(
                r#"
                SELECT user_id FROM listing_watches
                WHERE user_id = $1 AND listing_id = $2
                "#,
            )
            .bind(user_id)
            .bind(listing_id)
            .fetch_optional(p)
            .await
            .map_err(ListingWatchRepoError::Db)?;
            Ok(row.is_some())
        }
        None => Ok(memory_lock().contains(&(user_id, listing_id))),
    }
}

pub async fn find_listing_ids_by_user(
    pool: Option<&PgPool>,
    user_id: Uuid,
) -> Result<Vec<Uuid>, ListingWatchRepoError> {
    match pool {
        Some(p) => {
            let rows: Vec<(Uuid,)> = sqlx::query_as(
                r#"
                SELECT listing_id FROM listing_watches
                WHERE user_id = $1
                ORDER BY created_at DESC
                "#,
            )
            .bind(user_id)
            .fetch_all(p)
            .await
            .map_err(ListingWatchRepoError::Db)?;
            Ok(rows.into_iter().map(|(l,)| l).collect())
        }
        None => Ok(memory_lock()
            .iter()
            .filter(|(u, _)| *u == user_id)
            .map(|(_, l)| *l)
            .collect()),
    }
}

pub async fn count_by_listing(
    pool: Option<&PgPool>,
    listing_id: Uuid,
) -> Result<i64, ListingWatchRepoError> {
    match pool {
        Some(p) => {
            let row: (i64,) = sqlx::query_as(
                r#"
                SELECT COUNT(*) FROM listing_watches
                WHERE listing_id = $1
                "#,
            )
            .bind(listing_id)
            .fetch_one(p)
            .await
            .map_err(ListingWatchRepoError::Db)?;
            Ok(row.0)
        }
        None => Ok(memory_lock()
            .iter()
            .filter(|(_, l)| *l == listing_id)
            .count() as i64),
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn toggle_db(
    pool: &PgPool,
    user_id: Uuid,
    listing_id: Uuid,
) -> Result<ToggleOutcome, ListingWatchRepoError> {
    let inserted: Option<(Uuid,)> = sqlx::query_as(
        r#"
        INSERT INTO listing_watches (user_id, listing_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, listing_id) DO NOTHING
        RETURNING user_id
        "#,
    )
    .bind(user_id)
    .bind(listing_id)
    .fetch_optional(pool)
    .await
    .map_err(ListingWatchRepoError::Db)?;

    if inserted.is_some() {
        return Ok(ToggleOutcome::Added);
    }

    sqlx::query(
        r#"
        DELETE FROM listing_watches
        WHERE user_id = $1 AND listing_id = $2
        "#,
    )
    .bind(user_id)
    .bind(listing_id)
    .execute(pool)
    .await
    .map_err(ListingWatchRepoError::Db)?;

    Ok(ToggleOutcome::Removed)
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_set() -> &'static Mutex<HashSet<(Uuid, Uuid)>> {
    static S: OnceLock<Mutex<HashSet<(Uuid, Uuid)>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashSet::new()))
}

fn memory_lock() -> std::sync::MutexGuard<'static, HashSet<(Uuid, Uuid)>> {
    memory_set().lock().expect("listing_watches memory mutex poisoned")
}

fn toggle_memory(user_id: Uuid, listing_id: Uuid) -> ToggleOutcome {
    let mut set = memory_lock();
    let key = (user_id, listing_id);
    if set.contains(&key) {
        set.remove(&key);
        ToggleOutcome::Removed
    } else {
        set.insert(key);
        ToggleOutcome::Added
    }
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_set().lock() {
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

    fn u() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }
    fn l() -> Uuid {
        Uuid::parse_str("c0c0c0c0-0000-4000-8000-00000000c0c0").unwrap()
    }

    #[tokio::test]
    async fn in_memory_toggle_alternates() {
        let _g = memory_guard();
        reset_memory_for_test();
        assert_eq!(toggle(None, u(), l()).await.unwrap(), ToggleOutcome::Added);
        assert!(is_watched(None, u(), l()).await.unwrap());
        assert_eq!(
            toggle(None, u(), l()).await.unwrap(),
            ToggleOutcome::Removed
        );
        assert!(!is_watched(None, u(), l()).await.unwrap());
    }

    #[tokio::test]
    async fn in_memory_count_by_listing_counts_only_target() {
        let _g = memory_guard();
        reset_memory_for_test();
        let other_u = Uuid::new_v4();
        toggle(None, u(), l()).await.unwrap();
        toggle(None, other_u, l()).await.unwrap();
        toggle(None, u(), Uuid::new_v4()).await.unwrap();

        let n = count_by_listing(None, l()).await.unwrap();
        assert_eq!(n, 2);
    }

    #[tokio::test]
    async fn in_memory_find_listing_ids_by_user() {
        let _g = memory_guard();
        reset_memory_for_test();
        let l1 = Uuid::new_v4();
        let l2 = Uuid::new_v4();
        toggle(None, u(), l1).await.unwrap();
        toggle(None, u(), l2).await.unwrap();
        let ids = find_listing_ids_by_user(None, u()).await.unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&l1));
        assert!(ids.contains(&l2));
    }
}
