//! `order_items.fulfilled_specimen_id` 周りの薄い repo (K1 / 注文確定 → 個体カルテ自動生成)。
//!
//! **方針**:
//!   - `repos::orders` を肥大化させないために、fulfillment 周辺のクエリだけをここに切り出す。
//!   - 1 ヶ月計画 Week 1 の責務 (= 注文 paid 遷移時の specimen 生成) のみを支える。
//!
//! **DB 専用**:
//!   in-memory fallback は持たない。理由:
//!   - 既存の `repos::orders` の in-memory items store は `item.id` を持たないため、
//!     fulfillment の冪等性ガード (= `fulfilled_specimen_id IS NULL` の WHERE 句) を
//!     in-memory で表現するには store 構造の改修が必要。
//!   - in-memory モードは MVP の dev 用 fallback でしかなく、production の購入フロー検証は
//!     必ず DB を立てて行う前提 (= README の docker compose / .env 起動手順)。
//!   - pool=None を受けた時は「fulfillment 不可能」として `Ok(空)` / `Ok(false)` を返し、
//!     呼び出し側 (= handlers::specimen_fulfillment) で warn ログを出す。

use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use super::orders::OrderRepoError;

/// fulfillment 専用 row。
///
/// C2C pivot: 旧 product_id / product_uuid (= B2C 商品参照) を listing_id に置換。
/// `listing_id` は ON DELETE SET NULL なので Option (= listing が消えた後でも item は残る)。
#[derive(Debug, Clone, FromRow)]
pub struct OrderItemFulfillmentRow {
    pub id: Uuid,
    pub listing_id: Option<Uuid>,
    pub title: String,
    pub unit_price_jpy: i64,
    pub qty: i32,
    pub fulfilled_specimen_id: Option<Uuid>,
}

/// fulfillment 待ち (= `fulfilled_specimen_id IS NULL`) の order_items を返す。
///
/// **pool=None**: in-memory mode は fulfillment 非対応 → 空配列を返す (上記モジュール
/// docstring 参照)。呼び出し側はこれを「fulfill 不要」とみなして 200 OK を返す。
pub async fn list_items_pending_fulfillment(
    pool: Option<&PgPool>,
    order_id: Uuid,
) -> Result<Vec<OrderItemFulfillmentRow>, OrderRepoError> {
    let Some(pool) = pool else {
        return Ok(Vec::new());
    };
    sqlx::query_as::<_, OrderItemFulfillmentRow>(
        r#"
        SELECT id, listing_id, title, unit_price_jpy, qty, fulfilled_specimen_id
        FROM order_items
        WHERE order_id = $1
          AND fulfilled_specimen_id IS NULL
        ORDER BY id
        "#,
    )
    .bind(order_id)
    .fetch_all(pool)
    .await
    .map_err(OrderRepoError::Db)
}

/// `order_items.fulfilled_specimen_id` を「まだ NULL なら」セットする (冪等性ガード)。
///
/// 戻り値:
///   - `Ok(true)`  … この呼び出しで紐付けが完了 (= 1 行 UPDATE された)
///   - `Ok(false)` … 既に他者が紐付け済 / item_id 不在 (= 何もしなかった)
///
/// 競合時 (= 同じ paid 遷移が並行して走る) は WHERE の `fulfilled_specimen_id IS NULL`
/// で **一方しか UPDATE されない** ため specimen の二重紐付けは起こらない。`Ok(false)` の
/// 場合は specimen が orphan で残り得るが、まれな race のため warn 止めとする (= ops で
/// archive 可能)。
///
/// **pool=None**: 何もせず `false` を返す (= in-memory mode で fulfillment は走らない)。
pub async fn mark_item_fulfilled(
    pool: Option<&PgPool>,
    item_id: Uuid,
    specimen_id: Uuid,
) -> Result<bool, OrderRepoError> {
    let Some(pool) = pool else {
        return Ok(false);
    };
    let res = sqlx::query(
        r#"
        UPDATE order_items
        SET fulfilled_specimen_id = $2
        WHERE id = $1
          AND fulfilled_specimen_id IS NULL
        "#,
    )
    .bind(item_id)
    .bind(specimen_id)
    .execute(pool)
    .await
    .map_err(OrderRepoError::Db)?;
    Ok(res.rows_affected() > 0)
}
