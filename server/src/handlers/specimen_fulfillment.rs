//! 注文確定 → 個体カルテ譲渡 (C2C pivot 後の K1 相当)。
//!
//! **C2C pivot 後の責務**:
//!   `orders.status = 'paid'` 遷移後に呼ばれ、`order_items.listing_id` から
//!   listings.specimen_id を引き、その specimen の owner を seller → buyer に書き換える。
//!   B2C 時代のように specimen を **新規生成** するのではなく、**既存個体を譲渡** する。
//!
//! **冪等性 (二段構え)**:
//!   1. webhook 層: `stripe_webhook_events.event_id` の UNIQUE で同じ Stripe event の二重
//!      受信を弾く。
//!   2. 行レベル: `mark_item_fulfilled` の WHERE に `fulfilled_specimen_id IS NULL` を
//!      含めることで、たとえ重複呼び出しが通っても二重譲渡は起こらない。
//!
//! **失敗時の挙動**:
//!   この関数が `Err` を返すと、呼び出し側 (= `stripe_webhook::post_stripe_webhook`) は
//!   webhook を 5xx で返し、idempotency キャッシュを rollback する。Stripe の retry が
//!   走り、再実行時は行レベルガードで idempotent。

use uuid::Uuid;

use crate::repos::{email_outbox, listings, order_fulfillment, orders, specimens, users};
use crate::state::AppState;

/// `paid` 遷移した注文に対して、`order_items.listing_id` から specimen を引いて
/// owner を譲渡する。
///
/// **挙動**:
///   1. 注文を取得 → `user_id` (= buyer) が None なら譲渡スキップ
///   2. 未 fulfill な order_items を列挙
///   3. 各 item について:
///      - `listing_id` が None (= listing 削除済) なら skip
///      - listings を引き、`specimen_id` が None (= specimen 紐付け無し出品) なら skip
///      - `mark_item_fulfilled` で order_items に specimen_id を書き戻す (= 行レベル冪等)
///      - `specimens.owner_user_id` を seller → buyer に UPDATE (= transfer_owner)
///      - seller に「出品が売れました」メールを email_outbox に enqueue
///   4. ループ終了後、buyer に「注文確認」メールを email_outbox に enqueue
pub async fn fulfill_paid_order(state: &AppState, order_id: Uuid) -> anyhow::Result<()> {
    let order = orders::find_by_id(state.db(), order_id)
        .await
        .map_err(|e| anyhow::anyhow!("order lookup: {e}"))?
        .ok_or_else(|| anyhow::anyhow!("order not found: {order_id}"))?;

    let Some(buyer_user_id) = order.user_id else {
        tracing::warn!(
            "fulfill_paid_order: order {} has no user_id (anonymous purchase); skipping transfer",
            order_id
        );
        return Ok(());
    };

    let pending = order_fulfillment::list_items_pending_fulfillment(state.db(), order_id)
        .await
        .map_err(|e| anyhow::anyhow!("list_items_pending_fulfillment: {e}"))?;

    if pending.is_empty() {
        tracing::debug!("fulfill_paid_order: order {} has no pending items", order_id);
        return Ok(());
    }

    for item in pending {
        let Some(listing_id) = item.listing_id else {
            tracing::warn!(
                "fulfill_paid_order: item {} has NULL listing_id; skipping",
                item.id
            );
            continue;
        };

        let listing = match listings::find_by_id(state.db(), listing_id).await {
            Ok(Some(l)) => l,
            Ok(None) => {
                tracing::warn!(
                    "fulfill_paid_order: listing {} not found (item={}); skipping",
                    listing_id,
                    item.id
                );
                continue;
            }
            Err(e) => return Err(anyhow::anyhow!("listing lookup: {e}")),
        };

        let Some(specimen_id) = listing.specimen_id else {
            // 自由 title 出品 (= specimen 紐付け無し) は譲渡対象 specimen が存在しない。
            // C2C pivot の MVP 範囲では specimen 紐付け listing のみが正規フロー。
            tracing::warn!(
                "fulfill_paid_order: listing {} has NULL specimen_id (item={}); skipping",
                listing_id,
                item.id
            );
            continue;
        };

        // C2C pivot Step B: 譲渡を本実装。
        //   1. mark_item_fulfilled で fulfilled_specimen_id を埋め (= 行レベル冪等性ガード)
        //   2. 成功した場合のみ specimens.owner_user_id を seller → buyer に書き換える
        // 順序:
        //   競合 (= 並行する webhook) で fulfilled_specimen_id が既に埋まっている場合は
        //   bound=false で返るので、その時は owner 書き換えも skip する。これにより
        //   「2 度 owner 書き換える」事故を防ぐ。
        let bound = order_fulfillment::mark_item_fulfilled(state.db(), item.id, specimen_id)
            .await
            .map_err(|e| anyhow::anyhow!("mark_item_fulfilled: {e}"))?;

        if !bound {
            tracing::warn!(
                "fulfill_paid_order: item {} was fulfilled by a concurrent run; skipping owner transfer",
                item.id,
            );
            continue;
        }

        // owner 書き換え (= seller → buyer)。NotFound は warn 止め (= specimen 削除済の race)。
        match specimens::transfer_owner(state.db(), specimen_id, buyer_user_id).await {
            Ok(()) => {
                tracing::info!(
                    "fulfill_paid_order: order {} item {} → specimen {} transferred (seller={} → buyer={})",
                    order_id,
                    item.id,
                    specimen_id,
                    listing.seller_user_id,
                    buyer_user_id
                );
            }
            Err(e) => {
                // owner 書き換え失敗は致命 (= buyer の所有が反映されない)。
                // anyhow で包んで上位 (stripe_webhook) に伝播し、5xx + Stripe retry を促す。
                return Err(anyhow::anyhow!(
                    "transfer_owner failed for specimen {}: {e}",
                    specimen_id
                ));
            }
        }

        // seller 通知メール (= 「出品が売れました」) を enqueue。
        // idempotency_key="seller_sale:{order_item_id}" で同 item の 2 重 enqueue を排除。
        // 失敗は warn 止め (= 譲渡 / 注文整合性は既に成立、メールは best-effort)。
        enqueue_listing_sold_to_seller(
            state,
            order_id,
            item.id,
            listing.seller_user_id,
            listing.public_id.clone(),
            listing.title.clone(),
            item.unit_price_jpy,
        )
        .await;
    }

    // 注文確認メールを email_outbox に enqueue (= 既存 B2C ロジックと同じ)。
    enqueue_order_confirmation(state, order_id, buyer_user_id, order.amount_jpy).await;

    Ok(())
}

/// `order_confirmation` 種別の email を outbox に enqueue。失敗は warn ログのみで握り潰す。
async fn enqueue_order_confirmation(
    state: &AppState,
    order_id: Uuid,
    user_id: Uuid,
    amount_jpy: i64,
) {
    let user = match users::find_by_id(state.db(), user_id).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            tracing::warn!(
                "enqueue_order_confirmation: user {} not found (order={})",
                user_id,
                order_id
            );
            return;
        }
        Err(e) => {
            tracing::warn!(
                "enqueue_order_confirmation: user lookup failed: {e} (order={order_id})"
            );
            return;
        }
    };
    let Some(to_email) = user.email else {
        tracing::warn!(
            "enqueue_order_confirmation: user {} has NULL email; cannot send confirmation (order={})",
            user_id,
            order_id
        );
        return;
    };

    let payload = email_outbox::OutboxEnqueue {
        kind: "order_confirmation".to_string(),
        to_email,
        template_args: serde_json::json!({
            "order_id": order_id.to_string(),
            "amount_jpy": amount_jpy,
        }),
        idempotency_key: Some(format!("order:{order_id}")),
        owner_user_id: Some(user_id),
    };

    match email_outbox::enqueue(state.db(), payload).await {
        Ok(outbox_id) => {
            tracing::info!(
                outbox_id = %outbox_id,
                order_id = %order_id,
                "order_confirmation enqueued"
            );
        }
        Err(e) => {
            tracing::warn!("enqueue_order_confirmation failed: {e} (order={order_id})");
        }
    }
}

/// `listing_sold` 種別の email を seller に enqueue する。
///
/// **C2C pivot**: 注文確定 → 譲渡完了直後に呼ぶ。order_items 単位 (= 1 listing 単位) で
/// 1 通ずつ enqueue し、idempotency_key で 2 重 enqueue を排除する。
///
/// **失敗ハンドリング**:
///   譲渡 / 注文整合性は既に成立しているので、メール enqueue 失敗は warn 止め
///   (= best-effort、Stripe retry を発火させない)。enqueue 後の実送信失敗は
///   email_outbox の retry / dead-letter で処理される。
async fn enqueue_listing_sold_to_seller(
    state: &AppState,
    order_id: Uuid,
    item_id: Uuid,
    seller_user_id: Uuid,
    listing_public_id: String,
    listing_title: String,
    sale_price_jpy: i64,
) {
    let user = match users::find_by_id(state.db(), seller_user_id).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            tracing::warn!(
                "enqueue_listing_sold_to_seller: seller {} not found (order={}, item={})",
                seller_user_id,
                order_id,
                item_id
            );
            return;
        }
        Err(e) => {
            tracing::warn!(
                "enqueue_listing_sold_to_seller: seller lookup failed: {e} (order={order_id}, item={item_id})"
            );
            return;
        }
    };
    let Some(to_email) = user.email else {
        tracing::warn!(
            "enqueue_listing_sold_to_seller: seller {} has NULL email; cannot send notification (order={}, item={})",
            seller_user_id,
            order_id,
            item_id
        );
        return;
    };

    let payload = email_outbox::OutboxEnqueue {
        kind: "listing_sold".to_string(),
        to_email,
        template_args: serde_json::json!({
            "order_id": order_id.to_string(),
            "item_id": item_id.to_string(),
            "listing_public_id": listing_public_id,
            "listing_title": listing_title,
            "sale_price_jpy": sale_price_jpy,
        }),
        // idempotency: order_item 単位で 1 通だけ送る (= 同 webhook の 2 重実行に強い)。
        idempotency_key: Some(format!("seller_sale:{item_id}")),
        owner_user_id: Some(seller_user_id),
    };

    match email_outbox::enqueue(state.db(), payload).await {
        Ok(outbox_id) => {
            tracing::info!(
                outbox_id = %outbox_id,
                order_id = %order_id,
                item_id = %item_id,
                seller_user_id = %seller_user_id,
                "listing_sold enqueued"
            );
        }
        Err(e) => {
            tracing::warn!(
                "enqueue_listing_sold_to_seller failed: {e} (order={order_id}, item={item_id})"
            );
        }
    }
}
