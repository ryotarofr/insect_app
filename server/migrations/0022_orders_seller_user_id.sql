-- 0022_orders_seller_user_id.sql — orders に seller_user_id を追加 (Phase 4 / C2C 取引履歴の販売側統合)
--
-- **背景** (= docs/implementation-plan-shop-management.md Phase 4):
--   既存 `orders` は買い手 (= `user_id`) しか持っておらず、販売側の取引履歴を引けない。
--   C2C モデルでは 1 注文 = 1 listing が基本のため、`orders.seller_user_id` を 1 列追加し、
--   listings.seller_user_id を fulfill_paid_order 時に COALESCE で書き込む方式を取る。
--
-- **設計判断**:
--   - **NULL 許容** で導入: 既存 (= 過去の anonymous purchase / pre-Phase4 注文) を NOT NULL に倒すと
--     migration 適用が壊れる。MVP では NULL 許容 + handler 側で「複数 seller を含む注文は NULL」
--     とする運用。Phase 7 (Stripe Connect) 完了後に NOT NULL 化する別 migration を検討。
--   - **FK は `ON DELETE SET NULL`**: 出品者が account 削除しても注文履歴は残す (= 不変性)。
--   - **index は単独**: GET /orders/me?role=seller 用に `(seller_user_id, created_at DESC)` で部分 index。
--     `WHERE seller_user_id IS NOT NULL` の partial index にして hot path のみ高速化する。
--
-- **backfill**:
--   既存の C2C pivot 後 orders は **無い前提** (= migration 0021 で全削除)。
--   万一残っていても order_items.listing_id → listings.seller_user_id で UPDATE 可能だが、
--   本 migration では実施せず application 側 (= fulfill_paid_order) に任せる方針。

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS seller_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL;

-- 販売側履歴の hot path: GET /orders/me?role=seller (= seller_user_id = me で created_at 降順)
CREATE INDEX IF NOT EXISTS idx_orders_seller_created_at
    ON orders (seller_user_id, created_at DESC)
    WHERE seller_user_id IS NOT NULL;
