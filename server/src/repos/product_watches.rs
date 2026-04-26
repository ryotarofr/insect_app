//! product_watches への永続化 (Phase 9.E / DB設計書 v2 §3.7)
//!
//! **責務 (本 PR / skeleton)**:
//!   - sqlx で product_watches テーブルへの toggle / list / count を提供
//!   - DB 不在時 (= pool=None) は in-memory fallback で動く
//!   - handler 切替は Cookie middleware 導入 + login user 確保が前提
//!
//! **設計判断**:
//!   - PRIMARY KEY (user_id, product_id) 複合 (= 1 ユーザが同じ商品を 2 度登録できない)
//!   - 取消は physical DELETE (= ON / OFF を toggle で表現する素朴な設計)
//!   - listing_watches は別 module (= Phase 9.E の listings 投入後に追加)
//!   - in-memory fallback は本 repo 内で完結 (= handlers/watch.rs 側 in-memory state とは別物)
//!
//! **未実装 (= 後続タスク)**:
//!   - handler 切替 (= watch.rs を repo 経由に書き換え)。1 ユーザ確保 = Cookie session 必要

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct ProductWatchRow {
    pub user_id: Uuid,
    pub product_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum ProductWatchRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

/// toggle 結果 (= UI に渡す現在状態)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToggleOutcome {
    /// 新規登録 (= ハート ON にした)
    Added,
    /// 解除 (= ハート OFF にした)
    Removed,
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// (user, product) 組の watch state を toggle する。
/// 既存行があれば DELETE → Removed、無ければ INSERT → Added。
/// pool=None なら in-memory fallback。
pub async fn toggle(
    pool: Option<&PgPool>,
    user_id: Uuid,
    product_id: Uuid,
) -> Result<ToggleOutcome, ProductWatchRepoError> {
    match pool {
        Some(p) => toggle_db(p, user_id, product_id).await,
        None => Ok(toggle_memory(user_id, product_id)),
    }
}

/// (user, product) 組が watch 中かを判定。
pub async fn is_watched(
    pool: Option<&PgPool>,
    user_id: Uuid,
    product_id: Uuid,
) -> Result<bool, ProductWatchRepoError> {
    match pool {
        Some(p) => is_watched_db(p, user_id, product_id).await,
        None => Ok(memory_set_lock().contains(&(user_id, product_id))),
    }
}

/// 1 ユーザが watch している商品 UUID 一覧 (= マイページ用)。
pub async fn find_product_ids_by_user(
    pool: Option<&PgPool>,
    user_id: Uuid,
) -> Result<Vec<Uuid>, ProductWatchRepoError> {
    match pool {
        Some(p) => find_product_ids_by_user_db(p, user_id).await,
        None => Ok(memory_set_lock()
            .iter()
            .filter(|(uid, _)| *uid == user_id)
            .map(|(_, pid)| *pid)
            .collect()),
    }
}

/// 1 商品をウォッチしているユーザ数 (= 商品ページ "N 人がウォッチ中")。
pub async fn count_by_product(
    pool: Option<&PgPool>,
    product_id: Uuid,
) -> Result<i64, ProductWatchRepoError> {
    match pool {
        Some(p) => count_by_product_db(p, product_id).await,
        None => Ok(memory_set_lock()
            .iter()
            .filter(|(_, pid)| *pid == product_id)
            .count() as i64),
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn toggle_db(
    pool: &PgPool,
    user_id: Uuid,
    product_id: Uuid,
) -> Result<ToggleOutcome, ProductWatchRepoError> {
    // トランザクション + UPSERT/DELETE で race を避ける。
    // PG では `INSERT ... ON CONFLICT DO NOTHING RETURNING` で「INSERT できたか?」が分かる。
    let inserted: Option<(Uuid,)> = sqlx::query_as(
        r#"
        INSERT INTO product_watches (user_id, product_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, product_id) DO NOTHING
        RETURNING user_id
        "#,
    )
    .bind(user_id)
    .bind(product_id)
    .fetch_optional(pool)
    .await
    .map_err(ProductWatchRepoError::Db)?;

    if inserted.is_some() {
        return Ok(ToggleOutcome::Added);
    }

    // 既に存在した → DELETE で OFF に倒す
    sqlx::query(
        r#"
        DELETE FROM product_watches
        WHERE user_id = $1 AND product_id = $2
        "#,
    )
    .bind(user_id)
    .bind(product_id)
    .execute(pool)
    .await
    .map_err(ProductWatchRepoError::Db)?;

    Ok(ToggleOutcome::Removed)
}

async fn is_watched_db(
    pool: &PgPool,
    user_id: Uuid,
    product_id: Uuid,
) -> Result<bool, ProductWatchRepoError> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT user_id FROM product_watches
        WHERE user_id = $1 AND product_id = $2
        "#,
    )
    .bind(user_id)
    .bind(product_id)
    .fetch_optional(pool)
    .await
    .map_err(ProductWatchRepoError::Db)?;
    Ok(row.is_some())
}

async fn find_product_ids_by_user_db(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Uuid>, ProductWatchRepoError> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT product_id FROM product_watches
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(ProductWatchRepoError::Db)?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

async fn count_by_product_db(
    pool: &PgPool,
    product_id: Uuid,
) -> Result<i64, ProductWatchRepoError> {
    let row: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM product_watches
        WHERE product_id = $1
        "#,
    )
    .bind(product_id)
    .fetch_one(pool)
    .await
    .map_err(ProductWatchRepoError::Db)?;
    Ok(row.0)
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────
//
// HashSet<(user_id, product_id)> で「watch 中か」だけを保持。
// created_at は持たない (= MVP fallback / 順序が必要なら DB 経路を使う)。

fn memory_set() -> &'static Mutex<HashSet<(Uuid, Uuid)>> {
    static S: OnceLock<Mutex<HashSet<(Uuid, Uuid)>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashSet::new()))
}

fn memory_set_lock() -> std::sync::MutexGuard<'static, HashSet<(Uuid, Uuid)>> {
    memory_set().lock().expect("product_watches memory mutex poisoned")
}

fn toggle_memory(user_id: Uuid, product_id: Uuid) -> ToggleOutcome {
    let mut set = memory_set_lock();
    let key = (user_id, product_id);
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
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// グローバル in-memory set はプロセス全体で共有のため、reset を絡めるテストは
    /// 並列実行で他テストの書き込みと混ざる。1 個ずつ走るよう GUARD で逐次化する。
    static GUARD: StdMutex<()> = StdMutex::new(());

    fn u() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }
    fn p() -> Uuid {
        Uuid::parse_str("b0b0b0b0-0000-4000-8000-00000000b0b0").unwrap()
    }

    #[tokio::test]
    async fn in_memory_toggle_adds_then_removes() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let r = toggle(None, u(), p()).await.unwrap();
        assert_eq!(r, ToggleOutcome::Added);
        assert!(is_watched(None, u(), p()).await.unwrap());

        let r = toggle(None, u(), p()).await.unwrap();
        assert_eq!(r, ToggleOutcome::Removed);
        assert!(!is_watched(None, u(), p()).await.unwrap());
    }

    #[tokio::test]
    async fn in_memory_find_product_ids_by_user_orders_unspecified_but_complete() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let p1 = Uuid::new_v4();
        let p2 = Uuid::new_v4();
        toggle(None, u(), p1).await.unwrap();
        toggle(None, u(), p2).await.unwrap();
        let ids = find_product_ids_by_user(None, u()).await.unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&p1));
        assert!(ids.contains(&p2));
    }

    #[tokio::test]
    async fn in_memory_count_by_product_counts_only_target() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let other_u = Uuid::new_v4();
        toggle(None, u(), p()).await.unwrap();
        toggle(None, other_u, p()).await.unwrap();
        toggle(None, u(), Uuid::new_v4()).await.unwrap(); // 別 product

        let n = count_by_product(None, p()).await.unwrap();
        assert_eq!(n, 2, "p() を watch しているのは 2 ユーザ");
    }

    #[tokio::test]
    async fn in_memory_is_watched_separates_users() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        toggle(None, u(), p()).await.unwrap();
        let other = Uuid::new_v4();
        // 別ユーザの視点では watch 中ではない
        assert!(!is_watched(None, other, p()).await.unwrap());
        assert!(is_watched(None, u(), p()).await.unwrap());
    }
}
