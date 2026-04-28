//! product_watches への永続化 (Phase 9.E / DB設計書 v2 §3.7 + 0012 で session_id 許容)
//!
//! **責務**:
//!   - sqlx で product_watches テーブルへの toggle / list / count を提供
//!   - DB 不在時 (= pool=None) は in-memory fallback で動く
//!   - owner は `WatchOwner::User(uuid)` か `WatchOwner::Session(uuid)` のいずれかで指定し、
//!     0012 で追加された CHECK 制約 (= user_id IS NOT NULL OR session_id IS NOT NULL) と
//!     UNIQUE 部分 index (= COALESCE(user_id, session_id), product_id) に整合する。
//!
//! **設計判断**:
//!   - login user → User(user_id)、anonymous → Session(session_id) で handler が分岐
//!   - 取消は physical DELETE (= ON / OFF を toggle で表現する素朴な設計)
//!   - in-memory fallback は本 repo 内で完結 (= 旧 handlers/watch.rs 側 in-memory state は撤去済)

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct ProductWatchRow {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub session_id: Option<Uuid>,
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

/// watch の所有者識別子。login user か anonymous session かのどちらかを表す。
///
/// **DB schema との対応**: 0012_product_watches_session_owner.sql 通り、内部的には
/// `user_id` か `session_id` のいずれかを 1 つ非 NULL にして INSERT する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WatchOwner {
    User(Uuid),
    Session(Uuid),
}

impl WatchOwner {
    /// owner を `(user_id, session_id)` のタプルに分解 (= bind 用)。
    fn split(self) -> (Option<Uuid>, Option<Uuid>) {
        match self {
            WatchOwner::User(u) => (Some(u), None),
            WatchOwner::Session(s) => (None, Some(s)),
        }
    }

    /// in-memory set 用の key (= owner kind + uuid を 1 値に潰す)。
    fn memory_key(self) -> (u8, Uuid) {
        match self {
            WatchOwner::User(u) => (0, u),
            WatchOwner::Session(s) => (1, s),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// (owner, product) 組の watch state を toggle する。
/// 既存行があれば DELETE → Removed、無ければ INSERT → Added。
/// pool=None なら in-memory fallback。
pub async fn toggle(
    pool: Option<&PgPool>,
    owner: WatchOwner,
    product_id: Uuid,
) -> Result<ToggleOutcome, ProductWatchRepoError> {
    match pool {
        Some(p) => toggle_db(p, owner, product_id).await,
        None => Ok(toggle_memory(owner, product_id)),
    }
}

/// (owner, product) 組が watch 中かを判定。
pub async fn is_watched(
    pool: Option<&PgPool>,
    owner: WatchOwner,
    product_id: Uuid,
) -> Result<bool, ProductWatchRepoError> {
    match pool {
        Some(p) => is_watched_db(p, owner, product_id).await,
        None => Ok(memory_set_lock().contains(&(owner.memory_key(), product_id))),
    }
}

/// owner が watch している商品 UUID 一覧 (= マイページ用)。
pub async fn find_product_ids_by_owner(
    pool: Option<&PgPool>,
    owner: WatchOwner,
) -> Result<Vec<Uuid>, ProductWatchRepoError> {
    match pool {
        Some(p) => find_product_ids_by_owner_db(p, owner).await,
        None => {
            let key = owner.memory_key();
            Ok(memory_set_lock()
                .iter()
                .filter(|(o, _)| *o == key)
                .map(|(_, pid)| *pid)
                .collect())
        }
    }
}

/// 1 商品をウォッチしている owner 数 (= 商品ページ "N 人がウォッチ中")。user / session 区別なし。
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

/// session → user 紐付け (= login 時に anonymous の watch を user に承継)。
/// 戻り値は更新行数。
pub async fn promote_session_to_user(
    pool: Option<&PgPool>,
    session_id: Uuid,
    user_id: Uuid,
) -> Result<u64, ProductWatchRepoError> {
    match pool {
        Some(p) => promote_session_to_user_db(p, session_id, user_id).await,
        None => {
            let mut set = memory_set_lock_mut();
            let session_key = WatchOwner::Session(session_id).memory_key();
            let user_key = WatchOwner::User(user_id).memory_key();
            // session 経由の rows を一旦集めて user 経由に書き換え
            let to_promote: Vec<Uuid> = set
                .iter()
                .filter(|(o, _)| *o == session_key)
                .map(|(_, pid)| *pid)
                .collect();
            for pid in &to_promote {
                set.remove(&(session_key, *pid));
                set.insert((user_key, *pid));
            }
            Ok(to_promote.len() as u64)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn toggle_db(
    pool: &PgPool,
    owner: WatchOwner,
    product_id: Uuid,
) -> Result<ToggleOutcome, ProductWatchRepoError> {
    let (user_id, session_id) = owner.split();

    // INSERT ... ON CONFLICT (= UNIQUE 部分 index `(COALESCE(user_id, session_id), product_id)`)
    // で「INSERT できたか?」を判定する。COALESCE がキーなので user / session 別々に conflict 句を
    // 書くのではなく、COALESCE-based unique index に依存する形 (= ON CONFLICT (col) は使えないが
    // ON CONFLICT DO NOTHING で同値違反を吸収できる)。
    let inserted: Option<(Uuid,)> = sqlx::query_as(
        r#"
        INSERT INTO product_watches (user_id, session_id, product_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(product_id)
    .fetch_optional(pool)
    .await
    .map_err(ProductWatchRepoError::Db)?;

    if inserted.is_some() {
        return Ok(ToggleOutcome::Added);
    }

    // 既に存在した → DELETE で OFF に倒す。owner は user_id / session_id どちらか一方のみ。
    sqlx::query(
        r#"
        DELETE FROM product_watches
        WHERE COALESCE(user_id, session_id) = COALESCE($1, $2)
          AND product_id = $3
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(product_id)
    .execute(pool)
    .await
    .map_err(ProductWatchRepoError::Db)?;

    Ok(ToggleOutcome::Removed)
}

async fn is_watched_db(
    pool: &PgPool,
    owner: WatchOwner,
    product_id: Uuid,
) -> Result<bool, ProductWatchRepoError> {
    let (user_id, session_id) = owner.split();
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT id FROM product_watches
        WHERE COALESCE(user_id, session_id) = COALESCE($1, $2)
          AND product_id = $3
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(product_id)
    .fetch_optional(pool)
    .await
    .map_err(ProductWatchRepoError::Db)?;
    Ok(row.is_some())
}

async fn find_product_ids_by_owner_db(
    pool: &PgPool,
    owner: WatchOwner,
) -> Result<Vec<Uuid>, ProductWatchRepoError> {
    let (user_id, session_id) = owner.split();
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT product_id FROM product_watches
        WHERE COALESCE(user_id, session_id) = COALESCE($1, $2)
        ORDER BY created_at DESC
        "#,
    )
    .bind(user_id)
    .bind(session_id)
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

async fn promote_session_to_user_db(
    pool: &PgPool,
    session_id: Uuid,
    user_id: Uuid,
) -> Result<u64, ProductWatchRepoError> {
    let res = sqlx::query(
        r#"
        UPDATE product_watches
        SET user_id = $2, session_id = NULL
        WHERE session_id = $1
        "#,
    )
    .bind(session_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(ProductWatchRepoError::Db)?;
    Ok(res.rows_affected())
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────
//
// HashSet<(owner_key, product_id)> で「watch 中か」だけを保持。
// owner_key は (kind, uuid) で User(0) / Session(1) を区別する。
// created_at は持たない (= MVP fallback / 順序が必要なら DB 経路を使う)。

#[allow(clippy::type_complexity)]
fn memory_set() -> &'static Mutex<HashSet<((u8, Uuid), Uuid)>> {
    static S: OnceLock<Mutex<HashSet<((u8, Uuid), Uuid)>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashSet::new()))
}

fn memory_set_lock() -> std::sync::MutexGuard<'static, HashSet<((u8, Uuid), Uuid)>> {
    memory_set()
        .lock()
        .expect("product_watches memory mutex poisoned")
}

fn memory_set_lock_mut() -> std::sync::MutexGuard<'static, HashSet<((u8, Uuid), Uuid)>> {
    memory_set_lock()
}

fn toggle_memory(owner: WatchOwner, product_id: Uuid) -> ToggleOutcome {
    let mut set = memory_set_lock();
    let key = (owner.memory_key(), product_id);
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
    fn s() -> Uuid {
        Uuid::parse_str("c0c0c0c0-0000-4000-8000-00000000c0c0").unwrap()
    }
    fn p() -> Uuid {
        Uuid::parse_str("b0b0b0b0-0000-4000-8000-00000000b0b0").unwrap()
    }

    #[tokio::test]
    async fn in_memory_toggle_adds_then_removes_for_user_owner() {
        let _g = memory_guard();
        reset_memory_for_test();
        let owner = WatchOwner::User(u());
        let r = toggle(None, owner, p()).await.unwrap();
        assert_eq!(r, ToggleOutcome::Added);
        assert!(is_watched(None, owner, p()).await.unwrap());

        let r = toggle(None, owner, p()).await.unwrap();
        assert_eq!(r, ToggleOutcome::Removed);
        assert!(!is_watched(None, owner, p()).await.unwrap());
    }

    #[tokio::test]
    async fn in_memory_toggle_works_for_session_owner() {
        let _g = memory_guard();
        reset_memory_for_test();
        let owner = WatchOwner::Session(s());
        let r = toggle(None, owner, p()).await.unwrap();
        assert_eq!(r, ToggleOutcome::Added);
        assert!(is_watched(None, owner, p()).await.unwrap());
    }

    #[tokio::test]
    async fn in_memory_user_and_session_owners_are_independent() {
        let _g = memory_guard();
        reset_memory_for_test();
        // 同じ UUID 値を user / session に渡しても別物として扱う
        toggle(None, WatchOwner::User(u()), p()).await.unwrap();
        // session として同じ uuid 値を投げる → 別 owner なので新規 Added
        let r = toggle(None, WatchOwner::Session(u()), p()).await.unwrap();
        assert_eq!(r, ToggleOutcome::Added);

        // user 経由は依然 watch 中
        assert!(is_watched(None, WatchOwner::User(u()), p()).await.unwrap());
        // session 経由も watch 中
        assert!(is_watched(None, WatchOwner::Session(u()), p()).await.unwrap());
    }

    #[tokio::test]
    async fn in_memory_find_product_ids_by_owner_filters() {
        let _g = memory_guard();
        reset_memory_for_test();
        let p1 = Uuid::new_v4();
        let p2 = Uuid::new_v4();
        toggle(None, WatchOwner::User(u()), p1).await.unwrap();
        toggle(None, WatchOwner::User(u()), p2).await.unwrap();
        toggle(None, WatchOwner::Session(s()), Uuid::new_v4()).await.unwrap();
        let ids = find_product_ids_by_owner(None, WatchOwner::User(u())).await.unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&p1));
        assert!(ids.contains(&p2));
    }

    #[tokio::test]
    async fn in_memory_count_by_product_includes_user_and_session_owners() {
        let _g = memory_guard();
        reset_memory_for_test();
        toggle(None, WatchOwner::User(u()), p()).await.unwrap();
        toggle(None, WatchOwner::Session(s()), p()).await.unwrap();
        toggle(None, WatchOwner::User(Uuid::new_v4()), p()).await.unwrap();

        let n = count_by_product(None, p()).await.unwrap();
        assert_eq!(n, 3, "user 2 + session 1 = 3 owner が watch 中");
    }

    #[tokio::test]
    async fn in_memory_promote_session_to_user_moves_rows() {
        let _g = memory_guard();
        reset_memory_for_test();
        let session = Uuid::new_v4();
        toggle(None, WatchOwner::Session(session), p()).await.unwrap();
        toggle(None, WatchOwner::Session(session), Uuid::new_v4()).await.unwrap();

        let moved = promote_session_to_user(None, session, u()).await.unwrap();
        assert_eq!(moved, 2);

        // session 経由では消えている
        assert!(!is_watched(None, WatchOwner::Session(session), p()).await.unwrap());
        // user 経由で見えるようになる
        assert!(is_watched(None, WatchOwner::User(u()), p()).await.unwrap());
    }
}
