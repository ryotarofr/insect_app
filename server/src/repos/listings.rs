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

/// `v_listings_with_counts` VIEW + `users` JOIN で seller name と bid_count /
/// watcher_count を埋めた active な出品を返す (= フロント Market.tsx 用)。
///
/// **PR-7 (フロント listings adapter DB 化)** で追加。in-memory モードでは
/// users / bids / listing_watches の cross-module 解決が複雑なので空配列を返す。
#[derive(Debug, Clone, FromRow)]
pub struct ListingWithCounts {
    pub id: Uuid,
    pub public_id: String,
    pub seller_user_id: Uuid,
    pub seller_name: String,
    pub specimen_id: Option<Uuid>,
    pub title: String,
    pub description: Option<String>,
    pub is_auction: bool,
    pub starting_price_jpy: i64,
    pub current_price_jpy: Option<i64>,
    pub ends_at: Option<DateTime<Utc>>,
    pub status: String,
    pub is_verified: bool,
    pub bid_count: i64,
    pub watcher_count: i64,
}

/// public_id で 1 件取得 + bid/watcher counts と seller name を埋めた拡張版。
///
/// **詳細ページ用** (= GET /api/v1/listings/{public_id})。
/// 一覧 (`find_active_with_counts`) と同じ shape で 1 件返すので FE は単一 type で扱える。
pub async fn find_by_public_id_with_counts(
    pool: Option<&PgPool>,
    public_id: &str,
) -> Result<Option<ListingWithCounts>, ListingRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, ListingWithCounts>(
            r#"
            SELECT
                v.id, v.public_id, v.seller_user_id,
                u.name AS seller_name,
                v.specimen_id, v.title, v.description,
                v.is_auction, v.starting_price_jpy, v.current_price_jpy,
                v.ends_at, v.status, v.is_verified,
                v.bid_count, v.watcher_count
            FROM v_listings_with_counts v
            JOIN users u ON u.id = v.seller_user_id
            WHERE v.public_id = $1
            LIMIT 1
            "#,
        )
        .bind(public_id)
        .fetch_optional(p)
        .await
        .map_err(ListingRepoError::Db),
        None => {
            // in-memory: status は問わず public_id で 1 件引く。counts / seller_name は
            // find_active_with_counts と同じ cross-module 解決を再利用。
            let row = memory_lock()
                .iter()
                .find(|r| r.public_id == public_id)
                .cloned();
            match row {
                Some(r) => {
                    let seller_name = crate::repos::users::find_by_id(None, r.seller_user_id)
                        .await
                        .ok()
                        .flatten()
                        .map(|u| u.name)
                        .unwrap_or_default();
                    let bid_count = crate::repos::bids::list_by_listing(None, r.id)
                        .await
                        .map(|v| v.len() as i64)
                        .unwrap_or(0);
                    let watcher_count =
                        crate::repos::listing_watches::count_by_listing(None, r.id)
                            .await
                            .unwrap_or(0);
                    Ok(Some(ListingWithCounts {
                        id: r.id,
                        public_id: r.public_id,
                        seller_user_id: r.seller_user_id,
                        seller_name,
                        specimen_id: r.specimen_id,
                        title: r.title,
                        description: r.description,
                        is_auction: r.is_auction,
                        starting_price_jpy: r.starting_price_jpy,
                        current_price_jpy: r.current_price_jpy,
                        ends_at: r.ends_at,
                        status: r.status,
                        is_verified: r.is_verified,
                        bid_count,
                        watcher_count,
                    }))
                }
                None => Ok(None),
            }
        }
    }
}

pub async fn find_active_with_counts(
    pool: Option<&PgPool>,
) -> Result<Vec<ListingWithCounts>, ListingRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, ListingWithCounts>(
            r#"
            SELECT
                v.id, v.public_id, v.seller_user_id,
                u.name AS seller_name,
                v.specimen_id, v.title, v.description,
                v.is_auction, v.starting_price_jpy, v.current_price_jpy,
                v.ends_at, v.status, v.is_verified,
                v.bid_count, v.watcher_count
            FROM v_listings_with_counts v
            JOIN users u ON u.id = v.seller_user_id
            WHERE v.status = 'active'
            ORDER BY v.id DESC
            "#,
        )
        .fetch_all(p)
        .await
        .map_err(ListingRepoError::Db),
        None => fallback_collect_with_counts(|r| r.status == "active").await,
    }
}

/// 自分の出品 (seller_user_id 指定) を返す。`status_filter=None` なら全 status、
/// `Some("active")` 等を渡すと CHECK 制約と同じ集合 (`active|sold|canceled|expired`) で絞る。
///
/// **Phase 1 / マイ出品**: GET /api/v1/listings/me が叩く。bid_count / watcher_count /
/// seller_name 込みの `ListingWithCounts` を返し、FE 側 (= `MyListings.tsx`) でタブ
/// (`入札中` = active && bid_count > 0 等) は派生計算する。
///
/// 並びは created_at の代理として `id DESC` (UUID v7 ではないが、insert 順とほぼ一致)。
pub async fn find_by_seller(
    pool: Option<&PgPool>,
    seller_user_id: Uuid,
    status_filter: Option<&str>,
) -> Result<Vec<ListingWithCounts>, ListingRepoError> {
    // 防御的 validation: CHECK 制約と同じ集合のみ許可。それ以外は invalid。
    if let Some(s) = status_filter {
        if !["active", "sold", "canceled", "expired"].contains(&s) {
            return Err(ListingRepoError::Invalid(format!("invalid status: {s}")));
        }
    }

    match pool {
        Some(p) => sqlx::query_as::<_, ListingWithCounts>(
            r#"
            SELECT
                v.id, v.public_id, v.seller_user_id,
                u.name AS seller_name,
                v.specimen_id, v.title, v.description,
                v.is_auction, v.starting_price_jpy, v.current_price_jpy,
                v.ends_at, v.status, v.is_verified,
                v.bid_count, v.watcher_count
            FROM v_listings_with_counts v
            JOIN users u ON u.id = v.seller_user_id
            WHERE v.seller_user_id = $1
              AND ($2::TEXT IS NULL OR v.status = $2)
            ORDER BY v.id DESC
            "#,
        )
        .bind(seller_user_id)
        .bind(status_filter)
        .fetch_all(p)
        .await
        .map_err(ListingRepoError::Db),
        None => {
            fallback_collect_with_counts(|r| {
                r.seller_user_id == seller_user_id
                    && status_filter.map(|s| r.status == s).unwrap_or(true)
            })
            .await
        }
    }
}

/// in-memory store からフィルタ → counts / seller_name を解決する共通ヘルパ。
/// `find_active_with_counts` / `find_by_seller` の None 分岐から再利用する。
async fn fallback_collect_with_counts(
    pred: impl Fn(&ListingRow) -> bool,
) -> Result<Vec<ListingWithCounts>, ListingRepoError> {
    let rows: Vec<ListingRow> = memory_lock()
        .iter()
        .filter(|r| pred(r))
        .cloned()
        .collect();

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let seller_name = crate::repos::users::find_by_id(None, r.seller_user_id)
            .await
            .ok()
            .flatten()
            .map(|u| u.name)
            .unwrap_or_default();
        let bid_count = crate::repos::bids::list_by_listing(None, r.id)
            .await
            .map(|v| v.len() as i64)
            .unwrap_or(0);
        let watcher_count = crate::repos::listing_watches::count_by_listing(None, r.id)
            .await
            .unwrap_or(0);
        out.push(ListingWithCounts {
            id: r.id,
            public_id: r.public_id,
            seller_user_id: r.seller_user_id,
            seller_name,
            specimen_id: r.specimen_id,
            title: r.title,
            description: r.description,
            is_auction: r.is_auction,
            starting_price_jpy: r.starting_price_jpy,
            current_price_jpy: r.current_price_jpy,
            ends_at: r.ends_at,
            status: r.status,
            is_verified: r.is_verified,
            bid_count,
            watcher_count,
        });
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
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
