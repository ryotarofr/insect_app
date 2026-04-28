//! orders / order_items / shipping_addresses への永続化 (Phase 9.1 / Stripe2)
//!
//! **責務**:
//!   - cart snapshot + checkout state + Stripe session id を 1 transaction で
//!     orders / order_items / shipping_addresses に書き込む
//!   - 失敗時はロールバック (sqlx の transaction で自動)
//!   - pool 不在時は in-memory fallback (= MVP の dev workflow を維持)
//!
//! **設計上の注意**:
//!   - migration の CHECK 制約 (status / amount_jpy>=0 / qty 1..=99) を server 側で
//!     再度 validate しておく (= DB エラーをユーザに直接見せない)。
//!   - line item の subtotal は server で計算して書く (= client 改ざん経路を遮断)。
//!   - **runtime queries (`sqlx::query` / `sqlx::query_as`) を使う**。
//!     `query!` macro は DATABASE_URL を compile 時に要求するため、`.sqlx/` cache の
//!     セットアップ前提を避けて runtime 側に倒す (MVP)。本番化で compile-time check に
//!     切り替えたい時は `cargo sqlx prepare` で `.sqlx/` を生成する。

use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct OrderInsertRequest {
    pub session_id: String,
    /// **Phase 9.G / 0011_orders_user_fk.sql**: 注文時に login していたら user_id を埋める。
    /// 匿名注文 (= 未ログインの guest checkout) は None で許容され、後で UPDATE で紐付け
    /// 直す経路 (= 設計書 §8.2 と同じ pattern) も将来追加可能。
    pub user_id: Option<Uuid>,
    pub stripe_session_id: Option<String>,
    pub amount_jpy: i64,
    pub shipping_jpy: Option<i64>,
    pub line_items: Vec<OrderLineInsert>,
    pub shipping_address: ShippingAddressInsert,
}

#[derive(Debug, Clone)]
pub struct OrderLineInsert {
    /// public_id スナップショット (= "p-hh-m-142")。historical reference 用に保持。
    pub product_id: String,
    /// products(id) への UUID 参照 (Phase 9.F / 0005_order_items_product_fk.sql)。
    /// `None` の場合 (= public_id 解決失敗 / DB 不在時) は order_items.product_uuid に
    /// NULL が入る。注文履歴の不変性は product_id (TEXT) で確保されているため許容。
    pub product_uuid: Option<Uuid>,
    pub title: String,
    pub unit_price_jpy: i64,
    pub qty: u32,
    pub subtotal_jpy: i64,
}

#[derive(Debug, Clone)]
pub struct ShippingAddressInsert {
    pub address_name: String,
    pub address_tel: String,
    pub address_zip: String,
    pub address_pref: String,
    pub address_addr: String,
    pub shipping_method_id: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct OrderRecord {
    pub id: Uuid,
    pub session_id: String,
    pub user_id: Option<Uuid>,
    pub stripe_session_id: Option<String>,
    pub stripe_payment_intent_id: Option<String>,
    pub status: String,
    pub amount_jpy: i64,
    pub shipping_jpy: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// `order_items` テーブルから SELECT して返す行 (= 注文詳細 endpoint 用)。
/// `OrderLineInsert` は INSERT 用で qty が u32 なのに対し、本 row は DB 列定義通り i32 で
/// 受け取る (= sqlx::FromRow が i32 の derive を持つため)。
#[derive(Debug, Clone, FromRow)]
pub struct OrderLineRow {
    pub product_id: String,
    pub product_uuid: Option<Uuid>,
    pub title: String,
    pub unit_price_jpy: i64,
    pub qty: i32,
    pub subtotal_jpy: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum OrderRepoError {
    #[error("invalid order request: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// 注文を永続化する。pool が `Some` なら DB へ、`None` なら in-memory store へ。
pub async fn insert_order(
    pool: Option<&PgPool>,
    req: OrderInsertRequest,
) -> Result<OrderRecord, OrderRepoError> {
    validate(&req)?;
    match pool {
        Some(p) => insert_order_db(p, req).await,
        None => insert_order_memory(req),
    }
}

/// stripe_session_id で注文を取得 (= webhook handler から使う想定)。
pub async fn find_by_stripe_session_id(
    pool: Option<&PgPool>,
    stripe_session_id: &str,
) -> Result<Option<OrderRecord>, OrderRepoError> {
    match pool {
        Some(p) => find_by_stripe_session_id_db(p, stripe_session_id).await,
        None => Ok(memory_store()
            .lock()
            .ok()
            .and_then(|s| {
                s.iter()
                    .rev()
                    .find(|o| o.stripe_session_id.as_deref() == Some(stripe_session_id))
                    .cloned()
            })),
    }
}

/// 注文 status を更新 (= webhook で paid / failed / canceled に遷移)。
pub async fn update_status(
    pool: Option<&PgPool>,
    order_id: Uuid,
    new_status: &str,
    stripe_payment_intent_id: Option<&str>,
) -> Result<(), OrderRepoError> {
    if !is_valid_status(new_status) {
        return Err(OrderRepoError::Invalid(format!(
            "invalid status: {new_status}"
        )));
    }
    match pool {
        Some(p) => update_status_db(p, order_id, new_status, stripe_payment_intent_id).await,
        None => {
            let mut store = memory_store()
                .lock()
                .map_err(|_| OrderRepoError::Invalid("in-memory mutex poisoned".to_string()))?;
            if let Some(o) = store.iter_mut().find(|o| o.id == order_id) {
                o.status = new_status.to_string();
                if let Some(pi) = stripe_payment_intent_id {
                    o.stripe_payment_intent_id = Some(pi.to_string());
                }
                o.updated_at = Utc::now();
                Ok(())
            } else {
                Err(OrderRepoError::Invalid(format!(
                    "order not found: {order_id}"
                )))
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// validation
// ──────────────────────────────────────────────────────────────────────

fn validate(req: &OrderInsertRequest) -> Result<(), OrderRepoError> {
    if req.line_items.is_empty() {
        return Err(OrderRepoError::Invalid("line_items is empty".to_string()));
    }
    if req.amount_jpy < 0 {
        return Err(OrderRepoError::Invalid(
            "amount_jpy must be >= 0".to_string(),
        ));
    }
    if let Some(s) = req.shipping_jpy
        && s < 0
    {
        return Err(OrderRepoError::Invalid(
            "shipping_jpy must be >= 0".to_string(),
        ));
    }
    for li in &req.line_items {
        if li.qty == 0 || li.qty > 99 {
            return Err(OrderRepoError::Invalid(format!(
                "qty out of range (1..=99) for {}",
                li.product_id
            )));
        }
        if li.unit_price_jpy < 0 || li.subtotal_jpy < 0 {
            return Err(OrderRepoError::Invalid(format!(
                "negative price for {}",
                li.product_id
            )));
        }
    }
    Ok(())
}

fn is_valid_status(s: &str) -> bool {
    matches!(s, "pending" | "paid" | "failed" | "canceled")
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装 (runtime queries)
// ──────────────────────────────────────────────────────────────────────

async fn insert_order_db(
    pool: &PgPool,
    req: OrderInsertRequest,
) -> Result<OrderRecord, OrderRepoError> {
    let mut tx: Transaction<'_, Postgres> = pool.begin().await.map_err(OrderRepoError::Db)?;

    // ── orders INSERT ──
    let row = sqlx::query(
        r#"
        INSERT INTO orders (session_id, user_id, stripe_session_id, status, amount_jpy, shipping_jpy)
        VALUES ($1, $2, $3, 'pending', $4, $5)
        RETURNING id, session_id, user_id, stripe_session_id, stripe_payment_intent_id,
                  status, amount_jpy, shipping_jpy, created_at, updated_at
        "#,
    )
    .bind(&req.session_id)
    .bind(req.user_id)
    .bind(&req.stripe_session_id)
    .bind(req.amount_jpy)
    .bind(req.shipping_jpy)
    .fetch_one(&mut *tx)
    .await
    .map_err(OrderRepoError::Db)?;

    let record = OrderRecord {
        id: row.try_get("id").map_err(OrderRepoError::Db)?,
        session_id: row.try_get("session_id").map_err(OrderRepoError::Db)?,
        user_id: row.try_get("user_id").map_err(OrderRepoError::Db)?,
        stripe_session_id: row.try_get("stripe_session_id").map_err(OrderRepoError::Db)?,
        stripe_payment_intent_id: row
            .try_get("stripe_payment_intent_id")
            .map_err(OrderRepoError::Db)?,
        status: row.try_get("status").map_err(OrderRepoError::Db)?,
        amount_jpy: row.try_get("amount_jpy").map_err(OrderRepoError::Db)?,
        shipping_jpy: row.try_get("shipping_jpy").map_err(OrderRepoError::Db)?,
        created_at: row.try_get("created_at").map_err(OrderRepoError::Db)?,
        updated_at: row.try_get("updated_at").map_err(OrderRepoError::Db)?,
    };
    let order_id = record.id;

    // ── order_items INSERT (loop) ──
    // Phase 9.F: product_uuid を追加 (= products(id) への FK)。
    // public_id (= product_id text) 解決失敗時は NULL を入れる (= 監査ログで追跡可能)。
    for li in &req.line_items {
        sqlx::query(
            r#"
            INSERT INTO order_items
                (order_id, product_id, product_uuid, title,
                 unit_price_jpy, qty, subtotal_jpy)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(order_id)
        .bind(&li.product_id)
        .bind(li.product_uuid)
        .bind(&li.title)
        .bind(li.unit_price_jpy)
        .bind(li.qty as i32)
        .bind(li.subtotal_jpy)
        .execute(&mut *tx)
        .await
        .map_err(OrderRepoError::Db)?;
    }

    // ── shipping_addresses INSERT ──
    sqlx::query(
        r#"
        INSERT INTO shipping_addresses
            (order_id, address_name, address_tel, address_zip,
             address_pref, address_addr, shipping_method_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(order_id)
    .bind(&req.shipping_address.address_name)
    .bind(&req.shipping_address.address_tel)
    .bind(&req.shipping_address.address_zip)
    .bind(&req.shipping_address.address_pref)
    .bind(&req.shipping_address.address_addr)
    .bind(&req.shipping_address.shipping_method_id)
    .execute(&mut *tx)
    .await
    .map_err(OrderRepoError::Db)?;

    tx.commit().await.map_err(OrderRepoError::Db)?;
    Ok(record)
}

async fn find_by_stripe_session_id_db(
    pool: &PgPool,
    sid: &str,
) -> Result<Option<OrderRecord>, OrderRepoError> {
    let row: Option<OrderRecord> = sqlx::query_as::<_, OrderRecord>(
        r#"
        SELECT id, session_id, user_id, stripe_session_id, stripe_payment_intent_id,
               status, amount_jpy, shipping_jpy, created_at, updated_at
        FROM orders
        WHERE stripe_session_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(sid)
    .fetch_optional(pool)
    .await
    .map_err(OrderRepoError::Db)?;
    Ok(row)
}

/// 1 注文を internal UUID で取得 (= /orders/{id} 詳細用)。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<OrderRecord>, OrderRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, OrderRecord>(
            r#"
            SELECT id, session_id, user_id, stripe_session_id, stripe_payment_intent_id,
                   status, amount_jpy, shipping_jpy, created_at, updated_at
            FROM orders
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(p)
        .await
        .map_err(OrderRepoError::Db),
        None => {
            let store = memory_store()
                .lock()
                .map_err(|_| OrderRepoError::Invalid("in-memory mutex poisoned".to_string()))?;
            Ok(store.iter().find(|r| r.id == id).cloned())
        }
    }
}

/// 1 注文の line_items を product_id 順で返す。
pub async fn list_items_by_order_id(
    pool: Option<&PgPool>,
    order_id: Uuid,
) -> Result<Vec<OrderLineRow>, OrderRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, OrderLineRow>(
            r#"
            SELECT product_id, product_uuid, title, unit_price_jpy, qty, subtotal_jpy
            FROM order_items
            WHERE order_id = $1
            ORDER BY product_id
            "#,
        )
        .bind(order_id)
        .fetch_all(p)
        .await
        .map_err(OrderRepoError::Db),
        None => {
            let store = memory_items_store()
                .lock()
                .map_err(|_| OrderRepoError::Invalid("items mutex poisoned".to_string()))?;
            let mut rows: Vec<OrderLineRow> = store
                .iter()
                .filter(|(oid, _)| *oid == order_id)
                .map(|(_, r)| r.clone())
                .collect();
            rows.sort_by(|a, b| a.product_id.cmp(&b.product_id));
            Ok(rows)
        }
    }
}

/// 1 user の注文履歴を created_at 降順で返す (= GET /api/v1/orders/me 用)。
pub async fn list_by_user_id(
    pool: Option<&PgPool>,
    user_id: Uuid,
) -> Result<Vec<OrderRecord>, OrderRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, OrderRecord>(
            r#"
            SELECT id, session_id, user_id, stripe_session_id, stripe_payment_intent_id,
                   status, amount_jpy, shipping_jpy, created_at, updated_at
            FROM orders
            WHERE user_id = $1
            ORDER BY created_at DESC, id
            "#,
        )
        .bind(user_id)
        .fetch_all(p)
        .await
        .map_err(OrderRepoError::Db),
        None => {
            let store = memory_store()
                .lock()
                .map_err(|_| OrderRepoError::Invalid("in-memory mutex poisoned".to_string()))?;
            let mut rows: Vec<OrderRecord> = store
                .iter()
                .filter(|r| r.user_id == Some(user_id))
                .cloned()
                .collect();
            rows.sort_by(|a, b| {
                b.created_at
                    .cmp(&a.created_at)
                    .then_with(|| a.id.cmp(&b.id))
            });
            Ok(rows)
        }
    }
}

async fn update_status_db(
    pool: &PgPool,
    order_id: Uuid,
    new_status: &str,
    stripe_payment_intent_id: Option<&str>,
) -> Result<(), OrderRepoError> {
    let result = sqlx::query(
        r#"
        UPDATE orders
        SET status = $2,
            stripe_payment_intent_id = COALESCE($3, stripe_payment_intent_id)
        WHERE id = $1
        "#,
    )
    .bind(order_id)
    .bind(new_status)
    .bind(stripe_payment_intent_id)
    .execute(pool)
    .await
    .map_err(OrderRepoError::Db)?;

    if result.rows_affected() == 0 {
        return Err(OrderRepoError::Invalid(format!(
            "order not found: {order_id}"
        )));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback (= MVP / DB 不在時)
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<OrderRecord>> {
    static S: OnceLock<Mutex<Vec<OrderRecord>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

/// in-memory モードの order_items 用 store。`(order_id, OrderLineRow)` で保存し、
/// `list_items_by_order_id` で order_id でフィルタする。
fn memory_items_store() -> &'static Mutex<Vec<(Uuid, OrderLineRow)>> {
    static S: OnceLock<Mutex<Vec<(Uuid, OrderLineRow)>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn insert_order_memory(req: OrderInsertRequest) -> Result<OrderRecord, OrderRepoError> {
    let now = Utc::now();
    let rec = OrderRecord {
        id: Uuid::new_v4(),
        session_id: req.session_id,
        user_id: req.user_id,
        stripe_session_id: req.stripe_session_id,
        stripe_payment_intent_id: None,
        status: "pending".to_string(),
        amount_jpy: req.amount_jpy,
        shipping_jpy: req.shipping_jpy,
        created_at: now,
        updated_at: now,
    };
    {
        let mut store = memory_store()
            .lock()
            .map_err(|_| OrderRepoError::Invalid("in-memory mutex poisoned".to_string()))?;
        store.push(rec.clone());
    }
    // line_items も in-memory items store に積む (= /orders/{id} 詳細での list_items 用)。
    {
        let mut items_store = memory_items_store()
            .lock()
            .map_err(|_| OrderRepoError::Invalid("items mutex poisoned".to_string()))?;
        for li in req.line_items.into_iter() {
            items_store.push((
                rec.id,
                OrderLineRow {
                    product_id: li.product_id,
                    product_uuid: li.product_uuid,
                    title: li.title,
                    unit_price_jpy: li.unit_price_jpy,
                    qty: li.qty as i32,
                    subtotal_jpy: li.subtotal_jpy,
                },
            ));
        }
    }
    Ok(rec)
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_store().lock() {
        s.clear();
    }
    if let Ok(mut s) = memory_items_store().lock() {
        s.clear();
    }
}

/// テスト並列実行下で `orders` の in-memory store と "cs_mock_test" 等の固定 stripe_session_id を
/// 触る複数モジュール (= `repos::orders` / `handlers::stripe_webhook`) が
/// **同じ** GUARD を取って逐次化するために共有する mutex。
///
/// 各テスト冒頭で `let _g = memory_guard();` を呼ぶ。
#[cfg(test)]
pub fn memory_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    // PoisonError は他テストの panic 時に起こるが、本 GUARD の中身は () なので
    // 取得側は中身を気にせず先に進めて良い。inner を取り直して握り直す。
    GUARD.lock().unwrap_or_else(|p| p.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> OrderInsertRequest {
        OrderInsertRequest {
            session_id: "anonymous".to_string(),
            user_id: None,
            stripe_session_id: Some("cs_mock_test".to_string()),
            amount_jpy: 96000,
            shipping_jpy: Some(1800),
            line_items: vec![OrderLineInsert {
                product_id: "p-x".to_string(),
                product_uuid: None,                 // test fixture では UUID 解決スキップ
                title: "Test".to_string(),
                unit_price_jpy: 48000,
                qty: 2,
                subtotal_jpy: 96000,
            }],
            shipping_address: ShippingAddressInsert {
                address_name: "山田".to_string(),
                address_tel: "090-0000".to_string(),
                address_zip: "150-0001".to_string(),
                address_pref: "13".to_string(),
                address_addr: "渋谷".to_string(),
                shipping_method_id: "cold".to_string(),
            },
        }
    }

    #[tokio::test]
    async fn validate_rejects_empty_line_items() {
        let _g = memory_guard();
        let mut r = req();
        r.line_items.clear();
        match insert_order(None, r).await {
            Err(OrderRepoError::Invalid(msg)) => assert!(msg.contains("line_items")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_qty_zero() {
        let _g = memory_guard();
        let mut r = req();
        r.line_items[0].qty = 0;
        match insert_order(None, r).await {
            Err(OrderRepoError::Invalid(msg)) => assert!(msg.contains("qty")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn in_memory_insert_and_find() {
        let _g = memory_guard();
        reset_memory_for_test();
        let r = req();
        let rec = insert_order(None, r).await.unwrap();
        assert_eq!(rec.status, "pending");

        let found = find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, rec.id);

        update_status(None, rec.id, "paid", Some("pi_test"))
            .await
            .unwrap();
        let updated = find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.status, "paid");
        assert_eq!(updated.stripe_payment_intent_id, Some("pi_test".to_string()));
    }

    #[test]
    fn is_valid_status_works() {
        assert!(is_valid_status("pending"));
        assert!(is_valid_status("paid"));
        assert!(is_valid_status("failed"));
        assert!(is_valid_status("canceled"));
        assert!(!is_valid_status("unknown"));
        assert!(!is_valid_status(""));
    }

    /// Phase 9.F: OrderLineInsert に product_uuid: Option<Uuid> が乗っており、
    /// None / Some の両方を構築できる (= API 契約の確認)。
    /// in-memory 経路は line_items を保存しないので、本テストは型検証が主目的。
    #[test]
    fn order_line_insert_accepts_product_uuid() {
        let with_none = OrderLineInsert {
            product_id: "p-x".to_string(),
            product_uuid: None,
            title: "T".to_string(),
            unit_price_jpy: 100,
            qty: 1,
            subtotal_jpy: 100,
        };
        assert!(with_none.product_uuid.is_none());

        let some_uuid = Uuid::new_v4();
        let with_some = OrderLineInsert {
            product_id: "p-x".to_string(),
            product_uuid: Some(some_uuid),
            title: "T".to_string(),
            unit_price_jpy: 100,
            qty: 1,
            subtotal_jpy: 100,
        };
        assert_eq!(with_some.product_uuid, Some(some_uuid));
    }
}
