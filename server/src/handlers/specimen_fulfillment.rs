//! 注文確定 → 個体カルテ自動生成 (K1 / 1 ヶ月計画 Week 1)。
//!
//! **責務**:
//!   - `orders.status = 'paid'` 遷移後に呼ばれ、`order_items` の live (= 生体) 商品 1 行
//!     につき `specimens` を 1 件 INSERT し、`order_items.fulfilled_specimen_id` で紐付ける。
//!
//! **冪等性 (二段構え)**:
//!   1. webhook 層: `stripe_webhook_events.event_id` の UNIQUE で同じ Stripe event の二重
//!      受信を弾く (= `repos::stripe_webhook_events::record_if_new`)。
//!   2. 行レベル: `mark_item_fulfilled` の WHERE に `fulfilled_specimen_id IS NULL` を
//!      含めることで、たとえ重複呼び出しが通っても specimen の二重紐付けは起こらない。
//!
//! **失敗時の挙動**:
//!   この関数が `Err` を返すと、呼び出し側 (= `stripe_webhook::post_stripe_webhook`) は
//!   webhook を 5xx で返し、idempotency キャッシュを rollback する。Stripe の retry が
//!   走り、再実行時は行レベルガードで idempotent。
//!
//! **将来の移管 (Week 2 / apalis)**:
//!   1 ヶ月計画 Week 2 で apalis ジョブに分離し、webhook ホットパスから外す予定。
//!   現状は同期処理で paid 遷移と一連で動かす最小実装。

use uuid::Uuid;

use crate::repos::{order_fulfillment, orders, products, specimens};
use crate::state::AppState;

/// `paid` 遷移した注文に対して、live `order_items` 1 行 = 1 specimen を生成する。
///
/// **前提**: 呼び出し前に `orders.status = 'paid'` への更新が成功している。
///
/// **挙動**:
///   1. 注文を取得 → `user_id` が None なら specimen を作らない (= 匿名注文 / 後追い紐付けは別タスク)
///   2. 未 fulfill な order_items を列挙
///   3. 各 item について:
///      - `product_uuid` が None なら skip (= public_id → uuid 解決失敗の旧行)
///      - products を引き、`kind != 'live'` なら skip (= supply / mat / jelly 等)
///      - `species_id` が None なら skip + warn (= 0003 の CHECK で起こらない defensive)
///      - SpecimenInsert を組み立てて specimens::insert
///      - `mark_item_fulfilled` で order_items に specimen_id を書き戻す
///        - `Ok(false)` (= 競合) なら orphan specimen が残るが warn 止め (= ops で archive)
///
/// **qty > 1 の扱い**:
///   live 1 行 = 1 specimen のみ生成する (qty > 1 は warn のみ / 1 specimen で完了)。
///   live 商品の domain 上 qty=1 が原則であり、複数個体を 1 注文行にまとめるのは MVP 範囲外。
pub async fn fulfill_paid_order(state: &AppState, order_id: Uuid) -> anyhow::Result<()> {
    let order = orders::find_by_id(state.db(), order_id)
        .await
        .map_err(|e| anyhow::anyhow!("order lookup: {e}"))?
        .ok_or_else(|| anyhow::anyhow!("order not found: {order_id}"))?;

    let Some(owner_user_id) = order.user_id else {
        tracing::warn!(
            "fulfill_paid_order: order {} has no user_id (anonymous purchase); skipping specimen generation",
            order_id
        );
        return Ok(());
    };

    let purchased_at = order.created_at.date_naive();

    let pending = order_fulfillment::list_items_pending_fulfillment(state.db(), order_id)
        .await
        .map_err(|e| anyhow::anyhow!("list_items_pending_fulfillment: {e}"))?;

    if pending.is_empty() {
        tracing::debug!("fulfill_paid_order: order {} has no pending items", order_id);
        return Ok(());
    }

    for item in pending {
        let Some(product_uuid) = item.product_uuid else {
            tracing::warn!(
                "fulfill_paid_order: item {} has NULL product_uuid (product_id={}); skipping",
                item.id,
                item.product_id
            );
            continue;
        };

        let product = match products::find_by_id(state.db(), product_uuid).await {
            Ok(Some(p)) => p,
            Ok(None) => {
                tracing::warn!(
                    "fulfill_paid_order: product {} not found (item={}); skipping",
                    product_uuid,
                    item.id
                );
                continue;
            }
            Err(e) => return Err(anyhow::anyhow!("product lookup: {e}")),
        };

        if product.row.kind != "live" {
            // supply (用品) は specimen 不要 → fulfilled_specimen_id は NULL のまま残す。
            continue;
        }
        let Some(species_id) = product.row.species_id.clone() else {
            tracing::warn!(
                "fulfill_paid_order: live product {} has NULL species_id (item={}); skipping",
                product_uuid,
                item.id
            );
            continue;
        };

        if item.qty > 1 {
            tracing::warn!(
                "fulfill_paid_order: live item {} has qty={} > 1; generating only 1 specimen (qty>1 unsupported for live in MVP)",
                item.id,
                item.qty
            );
        }

        // stage / stage_progress: badge_kind から最低限の推論。
        //   "larva" → 幼虫 (stage_progress 0.5) / それ以外 → 成虫 (1.0)。
        //   products に stage 列が無いため、これ以上の精度は K2 (= カルテ詳細編集) で
        //   ユーザに上書きしてもらう前提。
        let (stage, stage_progress) = match product.row.badge_kind.as_deref() {
            Some("larva") => ("幼虫".to_string(), 0.5_f64),
            _ => ("成虫".to_string(), 1.0_f64),
        };

        let public_id = build_specimen_public_id(&species_id, item.id);
        let name = product.title("ja"); // ja を主、無ければ public_id fallback

        let payload = specimens::SpecimenInsert {
            public_id,
            owner_user_id,
            species_id,
            name,
            sex: product.row.sex.clone().unwrap_or_else(|| "unknown".to_string()),
            stage,
            stage_progress,
            size_mm: product.row.size_mm,
            weight_g: None,
            birth_date: None,
            purchased_at: Some(purchased_at),
            purchased_from_shop_id: Some(product.row.shop_id),
            generation: product.row.generation.clone(),
            purchase_price_jpy: Some(item.unit_price_jpy),
            eclosion_eta: None,
            father_id: None,
            mother_id: None,
            father_label: None,
            mother_label: None,
            notes: None,
        };

        let specimen_id = specimens::insert(state.db(), payload)
            .await
            .map_err(|e| anyhow::anyhow!("specimens::insert (item={}): {e}", item.id))?;

        let bound = order_fulfillment::mark_item_fulfilled(state.db(), item.id, specimen_id)
            .await
            .map_err(|e| anyhow::anyhow!("mark_item_fulfilled: {e}"))?;

        if !bound {
            // 競合 = 別経路で既に紐付けられた。今作った specimen は orphan になるが、
            // 安全側に倒して warn だけにする (= 後続で manual archive 可能)。
            tracing::warn!(
                "fulfill_paid_order: item {} was fulfilled by a concurrent run; orphan specimen={}",
                item.id,
                specimen_id
            );
        } else {
            tracing::info!(
                "fulfill_paid_order: order {} item {} → specimen {} (owner={})",
                order_id,
                item.id,
                specimen_id,
                owner_user_id
            );
        }
    }

    Ok(())
}

/// specimen の `public_id` を `#{SPECIES_UPPER}-{first 6 hex of item_id}` 形式で生成。
///
/// 例: species_id="dhh", item_id=00112233-... → "#DHH-001122"
///
/// **衝突可能性**: item_id は UUID v4 で 122 bit エントロピ。先頭 6 hex (= 24 bit) の
/// 部分衝突は同一 species_id 内で 16M に 1 回程度。万一 specimens.public_id の UNIQUE
/// 制約に引っかかれば呼び出し側が DB エラーで 5xx を返し、Stripe retry → mark_item_fulfilled
/// が効いて再生成は走らない (= 旧 specimen は orphan のまま archive 待ち)。十分許容範囲。
fn build_specimen_public_id(species_id: &str, item_id: Uuid) -> String {
    let species_upper = species_id.to_uppercase();
    let item_hex = item_id.simple().to_string();
    let prefix = item_hex.get(..6).unwrap_or(&item_hex);
    format!("#{species_upper}-{prefix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_specimen_public_id_uses_species_upper_and_6_hex() {
        let id = Uuid::parse_str("00112233-4455-6677-8899-aabbccddeeff").unwrap();
        assert_eq!(build_specimen_public_id("dhh", id), "#DHH-001122");
        assert_eq!(build_specimen_public_id("cat", id), "#CAT-001122");
    }

    #[test]
    fn build_specimen_public_id_handles_empty_species() {
        let id = Uuid::nil();
        // species_id が空でも panic しない (= public_id の prefix 部だけ "" になる)
        assert_eq!(build_specimen_public_id("", id), "#-000000");
    }
}
