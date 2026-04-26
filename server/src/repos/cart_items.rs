//! cart_items への永続化 (Phase 9.E / DB設計書 v2 §3.7)
//!
//! **責務 (本 PR / skeleton)**:
//!   - sqlx で cart_items テーブルから 1 ユーザの cart 行を取得・追加・更新・削除
//!   - DB 不在時 (= pool=None) は in-memory fallback (= repos 内で完結する別ストア) で動く
//!   - handler 切替は Cookie middleware 導入 + 1 ユーザ 1 session 確保が前提
//!     (= 本 PR では handlers/cart.rs はまだ既存の cart_store を使い続ける)
//!
//! **設計判断**:
//!   - cart_items.session_id は user_sessions(id) FK (= 0006_cart_and_watches.sql)
//!   - guest cart は session_id 経由、ログイン後は user_id 経由
//!   - id (UUID) を Undo token として hex で client に返す想定
//!   - in-memory fallback は本 repo 内の `Mutex<Vec<CartItemRow>>` で隔離 (= handlers 側
//!     `cart_store` とは別物)。handler を repo に切り替えるタイミングで `cart_store` を
//!     deprecated にする (= dual-state を回避)
//!
//! **未実装 (= 後続タスク)**:
//!   - DB 経路の SELECT/INSERT/UPDATE/DELETE 実装
//!   - handler 接続 (= cart.rs を repo 経由に書き換え)
//!   - login 時の session → user 紐付け (= UPDATE cart_items SET user_id = ?, session_id = NULL)

use std::sync::{Mutex, OnceLock};

use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct CartItemRow {
    pub id: Uuid,
    pub session_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub product_id: Uuid,
    pub qty: i32,
}

/// cart_items への INSERT 用 payload。
/// session_id か user_id のどちらかは Some にする (= DB CHECK で弾かれる)。
#[derive(Debug, Clone)]
pub struct CartItemInsert {
    pub session_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub product_id: Uuid,
    pub qty: i32,
}

#[derive(Debug, thiserror::Error)]
pub enum CartItemRepoError {
    #[error("invalid cart item: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("cart item not found: {0}")]
    NotFound(Uuid),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API (skeleton)
// ──────────────────────────────────────────────────────────────────────

/// session_id (= guest) で cart 全行を返す。pool=None なら in-memory fallback。
pub async fn find_by_session_id(
    pool: Option<&PgPool>,
    session_id: Uuid,
) -> Result<Vec<CartItemRow>, CartItemRepoError> {
    match pool {
        Some(p) => find_by_session_id_db(p, session_id).await,
        None => Ok(memory_store_lock()
            .iter()
            .filter(|r| r.session_id == Some(session_id))
            .cloned()
            .collect()),
    }
}

/// user_id (= ログイン後) で cart 全行を返す。pool=None なら in-memory fallback。
pub async fn find_by_user_id(
    pool: Option<&PgPool>,
    user_id: Uuid,
) -> Result<Vec<CartItemRow>, CartItemRepoError> {
    match pool {
        Some(p) => find_by_user_id_db(p, user_id).await,
        None => Ok(memory_store_lock()
            .iter()
            .filter(|r| r.user_id == Some(user_id))
            .cloned()
            .collect()),
    }
}

/// 新規 cart_item を追加。Validation 後 DB / in-memory に書き込み、生成された UUID を返す。
pub async fn insert(
    pool: Option<&PgPool>,
    payload: CartItemInsert,
) -> Result<Uuid, CartItemRepoError> {
    validate(&payload)?;
    match pool {
        Some(p) => insert_db(p, payload).await,
        None => {
            let id = Uuid::new_v4();
            memory_store_lock_mut().push(CartItemRow {
                id,
                session_id: payload.session_id,
                user_id: payload.user_id,
                product_id: payload.product_id,
                qty: payload.qty,
            });
            Ok(id)
        }
    }
}

/// 既存 cart_item の qty を上書き。0/負数 は 400 相当 (Invalid)。
pub async fn set_qty(
    pool: Option<&PgPool>,
    id: Uuid,
    new_qty: i32,
) -> Result<(), CartItemRepoError> {
    if !(1..=99).contains(&new_qty) {
        return Err(CartItemRepoError::Invalid(format!(
            "qty must be 1..=99, got {new_qty}"
        )));
    }
    match pool {
        Some(p) => set_qty_db(p, id, new_qty).await,
        None => {
            let mut store = memory_store_lock_mut();
            let row = store
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(CartItemRepoError::NotFound(id))?;
            row.qty = new_qty;
            Ok(())
        }
    }
}

/// cart_item を physical DELETE。Undo 不可な final 削除 (§8.1 採用方針)。
pub async fn delete(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<(), CartItemRepoError> {
    match pool {
        Some(p) => delete_db(p, id).await,
        None => {
            let mut store = memory_store_lock_mut();
            let len_before = store.len();
            store.retain(|r| r.id != id);
            if store.len() == len_before {
                return Err(CartItemRepoError::NotFound(id));
            }
            Ok(())
        }
    }
}

/// session → user 紐付け (= ログイン時のカート引き継ぎ)。設計書 §8.2 採用案。
/// 戻り値は更新行数。
pub async fn promote_session_to_user(
    pool: Option<&PgPool>,
    session_id: Uuid,
    user_id: Uuid,
) -> Result<u64, CartItemRepoError> {
    match pool {
        Some(p) => promote_session_to_user_db(p, session_id, user_id).await,
        None => {
            let mut store = memory_store_lock_mut();
            let mut count: u64 = 0;
            for r in store.iter_mut() {
                if r.session_id == Some(session_id) {
                    r.session_id = None;
                    r.user_id = Some(user_id);
                    count += 1;
                }
            }
            Ok(count)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// validation
// ──────────────────────────────────────────────────────────────────────

fn validate(payload: &CartItemInsert) -> Result<(), CartItemRepoError> {
    if payload.session_id.is_none() && payload.user_id.is_none() {
        return Err(CartItemRepoError::Invalid(
            "session_id か user_id のいずれかが必須".to_string(),
        ));
    }
    if !(1..=99).contains(&payload.qty) {
        return Err(CartItemRepoError::Invalid(format!(
            "qty must be 1..=99, got {}",
            payload.qty
        )));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装 (sqlx runtime queries)
// ──────────────────────────────────────────────────────────────────────

async fn find_by_session_id_db(
    pool: &PgPool,
    session_id: Uuid,
) -> Result<Vec<CartItemRow>, CartItemRepoError> {
    sqlx::query_as::<_, CartItemRow>(
        r#"
        SELECT id, session_id, user_id, product_id, qty
        FROM cart_items
        WHERE session_id = $1
        ORDER BY created_at, id
        "#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .map_err(CartItemRepoError::Db)
}

async fn find_by_user_id_db(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<CartItemRow>, CartItemRepoError> {
    sqlx::query_as::<_, CartItemRow>(
        r#"
        SELECT id, session_id, user_id, product_id, qty
        FROM cart_items
        WHERE user_id = $1
        ORDER BY created_at, id
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(CartItemRepoError::Db)
}

async fn insert_db(
    pool: &PgPool,
    p: CartItemInsert,
) -> Result<Uuid, CartItemRepoError> {
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO cart_items (session_id, user_id, product_id, qty)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
    )
    .bind(p.session_id)
    .bind(p.user_id)
    .bind(p.product_id)
    .bind(p.qty)
    .fetch_one(pool)
    .await
    .map_err(CartItemRepoError::Db)?;
    Ok(row.0)
}

async fn set_qty_db(
    pool: &PgPool,
    id: Uuid,
    new_qty: i32,
) -> Result<(), CartItemRepoError> {
    let res = sqlx::query(
        r#"
        UPDATE cart_items
        SET qty = $2
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(new_qty)
    .execute(pool)
    .await
    .map_err(CartItemRepoError::Db)?;
    if res.rows_affected() == 0 {
        return Err(CartItemRepoError::NotFound(id));
    }
    Ok(())
}

async fn delete_db(pool: &PgPool, id: Uuid) -> Result<(), CartItemRepoError> {
    let res = sqlx::query("DELETE FROM cart_items WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(CartItemRepoError::Db)?;
    if res.rows_affected() == 0 {
        return Err(CartItemRepoError::NotFound(id));
    }
    Ok(())
}

async fn promote_session_to_user_db(
    pool: &PgPool,
    session_id: Uuid,
    user_id: Uuid,
) -> Result<u64, CartItemRepoError> {
    let res = sqlx::query(
        r#"
        UPDATE cart_items
        SET user_id = $2, session_id = NULL
        WHERE session_id = $1
        "#,
    )
    .bind(session_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(CartItemRepoError::Db)?;
    Ok(res.rows_affected())
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────
//
// **注意**: ここの fallback は handlers/cart.rs::cart_store とは独立した別ストア。
// 現状 handler は repo を使わず cart_store を直接見るので、本 fallback は repo を
// 直接呼んだテスト / 将来の handler 切替後にしか使われない。
//
// dual-state を避けるため、handler を repo 経由に切り替える PR で cart_store を
// deprecated にする予定。

fn memory_store() -> &'static Mutex<Vec<CartItemRow>> {
    static S: OnceLock<Mutex<Vec<CartItemRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_store_lock() -> std::sync::MutexGuard<'static, Vec<CartItemRow>> {
    memory_store().lock().expect("cart_items memory mutex poisoned")
}

fn memory_store_lock_mut() -> std::sync::MutexGuard<'static, Vec<CartItemRow>> {
    memory_store_lock()
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_store().lock() {
        s.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }

    fn product() -> Uuid {
        Uuid::parse_str("b0b0b0b0-0000-4000-8000-00000000b0b0").unwrap()
    }

    #[tokio::test]
    async fn validate_rejects_owner_missing() {
        let res = insert(
            None,
            CartItemInsert {
                session_id: None,
                user_id: None,
                product_id: product(),
                qty: 1,
            },
        )
        .await;
        match res {
            Err(CartItemRepoError::Invalid(msg)) => assert!(msg.contains("session_id か user_id")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_qty_out_of_range() {
        for bad in [0, 100, -3] {
            let res = insert(
                None,
                CartItemInsert {
                    session_id: None,
                    user_id: Some(user()),
                    product_id: product(),
                    qty: bad,
                },
            )
            .await;
            match res {
                Err(CartItemRepoError::Invalid(msg)) => assert!(msg.contains("qty")),
                other => panic!("expected Invalid for qty={bad}, got {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn in_memory_insert_find_by_user_and_set_qty_and_delete() {
        reset_memory_for_test();
        let id = insert(
            None,
            CartItemInsert {
                session_id: None,
                user_id: Some(user()),
                product_id: product(),
                qty: 2,
            },
        )
        .await
        .unwrap();

        let rows = find_by_user_id(None, user()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].qty, 2);

        set_qty(None, id, 5).await.unwrap();
        let rows = find_by_user_id(None, user()).await.unwrap();
        assert_eq!(rows[0].qty, 5);

        delete(None, id).await.unwrap();
        let rows = find_by_user_id(None, user()).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn in_memory_set_qty_rejects_out_of_range_after_insert() {
        reset_memory_for_test();
        let id = insert(
            None,
            CartItemInsert {
                session_id: None,
                user_id: Some(user()),
                product_id: product(),
                qty: 1,
            },
        )
        .await
        .unwrap();

        match set_qty(None, id, 0).await {
            Err(CartItemRepoError::Invalid(_)) => {}
            other => panic!("expected Invalid, got {other:?}"),
        }
        match set_qty(None, id, 100).await {
            Err(CartItemRepoError::Invalid(_)) => {}
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn in_memory_promote_session_to_user_moves_rows() {
        reset_memory_for_test();
        let session = Uuid::new_v4();
        let _ = insert(
            None,
            CartItemInsert {
                session_id: Some(session),
                user_id: None,
                product_id: product(),
                qty: 1,
            },
        )
        .await
        .unwrap();
        let _ = insert(
            None,
            CartItemInsert {
                session_id: Some(session),
                user_id: None,
                product_id: product(),
                qty: 3,
            },
        )
        .await
        .unwrap();

        let moved = promote_session_to_user(None, session, user()).await.unwrap();
        assert_eq!(moved, 2);

        let by_user = find_by_user_id(None, user()).await.unwrap();
        assert_eq!(by_user.len(), 2);
        let by_session = find_by_session_id(None, session).await.unwrap();
        assert!(by_session.is_empty(), "session 行は移った後 0 件");
    }

    #[tokio::test]
    async fn in_memory_delete_unknown_id_returns_not_found() {
        reset_memory_for_test();
        let unknown = Uuid::new_v4();
        match delete(None, unknown).await {
            Err(CartItemRepoError::NotFound(id)) => assert_eq!(id, unknown),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}
