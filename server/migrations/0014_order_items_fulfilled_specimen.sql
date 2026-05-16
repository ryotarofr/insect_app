-- 0014_order_items_fulfilled_specimen.sql — K1 / 注文確定 → 個体カルテ自動生成 (1 ヶ月計画 Week 1)
--
-- **目的**:
--   `orders.status = 'paid'` 遷移時に、live (= 生体) `order_items` ごとに `specimens` を
--   1 件 INSERT し、`order_items.fulfilled_specimen_id` で紐付けて完了マークする。
--   この列を 「FK + NULL ガード」として使うことで、同じ event を複数回受信しても
--   specimen が二重生成されないことを **行レベル** で保証する (= 冪等性)。
--
-- **設計判断**:
--   - NULL 許容: 全 order_item が live とは限らない (= supply は NULL のまま)。
--   - ON DELETE SET NULL: 個体マスタを物理削除しても order_items は残し、列だけ NULL に倒す。
--     注文履歴の不変性は他列 (product_id / title / unit_price_jpy) で確保済み (= 0001_initial.sql)。
--   - 部分 index (= WHERE fulfilled_specimen_id IS NOT NULL): NULL が大半 (supply + 未確定 live)
--     になることを見越し、index 容量を最小化。reverse lookup (specimen → 注文経由元) に効く。
--   - 既存行 backfill は **不要**: 0014 適用前の order_items は全て NULL で開始する。
--     production で paid 済の order があれば、別 migration / 手動オペで埋めるが、
--     dev での seed 運用では問題にならない。
--
-- **依存**:
--   - 0007_specimens.sql (specimens テーブル)
--   - 0001_initial.sql (order_items テーブル / id PK)

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS fulfilled_specimen_id UUID;

ALTER TABLE order_items
    ADD CONSTRAINT fk_order_items_fulfilled_specimen
        FOREIGN KEY (fulfilled_specimen_id) REFERENCES specimens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_fulfilled_specimen
    ON order_items (fulfilled_specimen_id)
    WHERE fulfilled_specimen_id IS NOT NULL;
