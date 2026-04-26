//! listings (C2C 出品) への永続化 (Phase 9.E / DB設計書 v2 §3.7)
//!
//! **責務 (本 PR / skeleton)**:
//!   - sqlx で listings テーブルへの基本 CRUD
//!   - DB 不在時 (= pool=None) は in-memory fallback
//!   - handler 統合は別 PR (= 既存 handler が listings を使っていない)
//!
//! **未実装 (= 後続)**:
//!   - bid_count / watcher_count は `v_listings_with_counts` VIEW 経由で取る別 query
//!   - status 遷移 (= sold / canceled / expired) と整合性 (= bids との関係)
//!   - listings.current_price_jpy を入札時に max(amount) で更新する trigger / handler 規律

use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct ListingRow {
    pub id: Uuid,
    pub public_id: String,                              // "L-0421"
    pub seller_user_id: Uuid,
    pub specimen_id: Option<Uuid>,
    pub title: String,
    pub description: Option<String>,
    pub is_auction: bool,
    pub starting_price_jpy: i64,
    pub current_price_jpy: Option<i64>,
    pub ends_at: Option<DateTime<Utc>>,
    pub status: String,                                 // "active" / "sold" / "canceled" / "expired"
    pub is_verified: bool,
}

#[derive(Debug, Clone)]
pub struct ListingInsert {
    pub public_id: String,
    pub seller_user_id: Uuid,
    pub specimen_id: Option<Uuid>,
    pub title: String,
    pub description: Option<String>,
    pub is_auction: bool,
    pub starting_price_jpy: i64,
    pub ends_at: Option<DateTime<Utc>>,
}

#[derive(Debug, thiserror::Error)]
pub enum ListingRepoError {
    #[error("invalid listing: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("listing not found: {0}")]
    NotFound(Uuid),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<ListingRow>, ListingRepoError> {
    match pool {
        Some(p) => find_by_id_db(p, id).await,
        None => Ok(memory_lock().iter().find(|r| r.id == id).cloned()),
    }
}

pub async fn find_by_public_id(
    pool: Option<&PgPool>,
    public_id: &str,
) -> Result<Option<ListingRow>, ListingRepoError> {
    match pool {
        Some(p) => find_by_public_id_db(p, public_id).await,
        None => Ok(memory_lock()
            .iter()
            .find(|r| r.public_id == public_id)
            .cloned()),
    }
}

/// status='active' な出品を created_at 降順で返す。
pub async fn find_active(
    pool: Option<&PgPool>,
) -> Result<Vec<ListingRow>, ListingRepoError> {
    match pool {
        Some(p) => find_active_db(p).await,
        None => Ok(memory_lock()
            .iter()
            .filter(|r| r.status == "active")
            .cloned()
            .collect()),
    }
}

pub async fn insert(
    pool: Option<&PgPool>,
    payload: ListingInsert,
) -> Result<Uuid, ListingRepoError> {
    validate(&payload)?;
    match pool {
        Some(p) => insert_db(p, payload).await,
        None => {
            let id = Uuid::new_v4();
            memory_lock_mut().push(ListingRow {
                id,
                public_id: payload.public_id,
                seller_user_id: payload.seller_user_id,
                specimen_id: payload.specimen_id,
                title: payload.title,
                description: payload.description,
                is_auction: payload.is_auction,
                starting_price_jpy: payload.starting_price_jpy,
                current_price_jpy: None,
                ends_at: payload.ends_at,
                status: "active".to_string(),
                is_verified: false,
            });
            Ok(id)
        }
    }
}

/// auction の current_price_jpy を更新 (= bid 受領後に呼ぶ)。
///
/// CHECK 制約 (`current_price_ge_starting`) は schema 側で握っているので、低い値で UPDATE
/// すると DB 側が拒否する。
pub async fn update_current_price(
    pool: Option<&PgPool>,
    id: Uuid,
    new_price: i64,
) -> Result<(), ListingRepoError> {
    if new_price < 0 {
        return Err(ListingRepoError::Invalid(
            "current_price must be >= 0".to_string(),
        ));
    }
    match pool {
        Some(p) => {
            let res = sqlx::query("UPDATE listings SET current_price_jpy = $2 WHERE id = $1")
                .bind(id)
                .bind(new_price)
                .execute(p)
                .await
                .map_err(ListingRepoError::Db)?;
            if res.rows_affected() == 0 {
                return Err(ListingRepoError::NotFound(id));
            }
            Ok(())
        }
        None => {
            let mut store = memory_lock_mut();
            let row = store
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(ListingRepoError::NotFound(id))?;
            row.current_price_jpy = Some(new_price);
            Ok(())
        }
    }
}

/// status を 'sold' / 'canceled' / 'expired' に書き換える。invalid な遷移チェックは
/// MVP では省略 (= 上位ロジックで握る前提)。
pub async fn update_status(
    pool: Option<&PgPool>,
    id: Uuid,
    new_status: &str,
) -> Result<(), ListingRepoError> {
    if !["active", "sold", "canceled", "expired"].contains(&new_status) {
        return Err(ListingRepoError::Invalid(format!(
            "invalid status: {new_status}"
        )));
    }
    match pool {
        Some(p) => update_status_db(p, id, new_status).await,
        None => {
            let mut store = memory_lock_mut();
            let row = store
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(ListingRepoError::NotFound(id))?;
            row.status = new_status.to_string();
            Ok(())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// validation
// ──────────────────────────────────────────────────────────────────────

fn validate(p: &ListingInsert) -> Result<(), ListingRepoError> {
    if p.public_id.trim().is_empty() {
        return Err(ListingRepoError::Invalid("public_id is empty".to_string()));
    }
    if p.title.trim().is_empty() {
        return Err(ListingRepoError::Invalid("title is empty".to_string()));
    }
    if p.starting_price_jpy < 0 {
        return Err(ListingRepoError::Invalid(
            "starting_price_jpy must be >= 0".to_string(),
        ));
    }
    // High #4: auction なら ends_at 必須
    if p.is_auction && p.ends_at.is_none() {
        return Err(ListingRepoError::Invalid(
            "auction listing requires ends_at".to_string(),
        ));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

const SELECT_FIELDS: &str = r#"
    id, public_id, seller_user_id, specimen_id, title, description,
    is_auction, starting_price_jpy, current_price_jpy, ends_at, status, is_verified
"#;

async fn find_by_id_db(pool: &PgPool, id: Uuid) -> Result<Option<ListingRow>, ListingRepoError> {
    let q = format!("SELECT {SELECT_FIELDS} FROM listings WHERE id = $1");
    sqlx::query_as::<_, ListingRow>(&q)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(ListingRepoError::Db)
}

async fn find_by_public_id_db(
    pool: &PgPool,
    public_id: &str,
) -> Result<Option<ListingRow>, ListingRepoError> {
    let q = format!("SELECT {SELECT_FIELDS} FROM listings WHERE public_id = $1");
    sqlx::query_as::<_, ListingRow>(&q)
        .bind(public_id)
        .fetch_optional(pool)
        .await
        .map_err(ListingRepoError::Db)
}

async fn find_active_db(pool: &PgPool) -> Result<Vec<ListingRow>, ListingRepoError> {
    let q = format!(
        r#"
        SELECT {SELECT_FIELDS}
        FROM listings
        WHERE status = 'active'
        ORDER BY created_at DESC, id
        "#
    );
    sqlx::query_as::<_, ListingRow>(&q)
        .fetch_all(pool)
        .await
        .map_err(ListingRepoError::Db)
}

async fn insert_db(pool: &PgPool, p: ListingInsert) -> Result<Uuid, ListingRepoError> {
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO listings (
            public_id, seller_user_id, specimen_id, title, description,
            is_auction, starting_price_jpy, ends_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        "#,
    )
    .bind(&p.public_id)
    .bind(p.seller_user_id)
    .bind(p.specimen_id)
    .bind(&p.title)
    .bind(p.description.as_deref())
    .bind(p.is_auction)
    .bind(p.starting_price_jpy)
    .bind(p.ends_at)
    .fetch_one(pool)
    .await
    .map_err(ListingRepoError::Db)?;
    Ok(row.0)
}

async fn update_status_db(
    pool: &PgPool,
    id: Uuid,
    new_status: &str,
) -> Result<(), ListingRepoError> {
    let res = sqlx::query("UPDATE listings SET status = $2 WHERE id = $1")
        .bind(id)
        .bind(new_status)
        .execute(pool)
        .await
        .map_err(ListingRepoError::Db)?;
    if res.rows_affected() == 0 {
        return Err(ListingRepoError::NotFound(id));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<ListingRow>> {
    static S: OnceLock<Mutex<Vec<ListingRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_lock() -> std::sync::MutexGuard<'static, Vec<ListingRow>> {
    memory_store().lock().expect("listings memory mutex poisoned")
}

fn memory_lock_mut() -> std::sync::MutexGuard<'static, Vec<ListingRow>> {
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

    fn seller() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }

    fn payload(public_id: &str, is_auction: bool) -> ListingInsert {
        ListingInsert {
            public_id: public_id.to_string(),
            seller_user_id: seller(),
            specimen_id: None,
            title: "ヘラクレス♂ 148mm 自家累代CBF3".to_string(),
            description: None,
            is_auction,
            starting_price_jpy: 50000,
            ends_at: if is_auction {
                Some(Utc::now() + chrono::Duration::days(7))
            } else {
                None
            },
        }
    }

    #[tokio::test]
    async fn validate_rejects_empty_title() {
        let _g = memory_guard();
        let mut p = payload("L-1", false);
        p.title = "".to_string();
        match insert(None, p).await {
            Err(ListingRepoError::Invalid(msg)) => assert!(msg.contains("title")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_auction_without_ends_at() {
        let _g = memory_guard();
        let mut p = payload("L-1", true);
        p.ends_at = None;
        match insert(None, p).await {
            Err(ListingRepoError::Invalid(msg)) => assert!(msg.contains("ends_at")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn in_memory_insert_find_active_and_update_status() {
        let _g = memory_guard();
        reset_memory_for_test();

        let id = insert(None, payload("L-1", false)).await.unwrap();
        let active = find_active(None).await.unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, id);

        update_status(None, id, "sold").await.unwrap();
        let active = find_active(None).await.unwrap();
        assert!(active.is_empty(), "sold は active リストから消える");

        let row = find_by_id(None, id).await.unwrap().unwrap();
        assert_eq!(row.status, "sold");
    }

    #[tokio::test]
    async fn update_status_rejects_unknown_value() {
        let _g = memory_guard();
        reset_memory_for_test();
        let id = insert(None, payload("L-2", false)).await.unwrap();
        match update_status(None, id, "weird").await {
            Err(ListingRepoError::Invalid(_)) => {}
            other => panic!("expected Invalid, got {other:?}"),
        }
    }
}
