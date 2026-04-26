-- 0005_order_items_product_fk.sql — order_items.product_id を products(id) FK に拡張
--                                   (Phase 9.F / DB設計書 v2 §3.6 / 元 plan の 0009)
--
-- **背景**:
--   - 0001_initial.sql の order_items.product_id は TEXT で "p-hh-m-142" のような
--     public_id スナップショットを保存する仕様だった (= MVP の妥協)。
--   - Phase 9.B で products テーブル + UUID 内部 PK を導入したことで、
--     ようやく order_items から products(id) への参照整合性を取れる。
--
-- **設計判断**:
--   - product_id (TEXT) は **残す** (= 注文時点での public_id スナップショット)。
--     商品が public_id を変更したり削除されても履歴 (= 「何を買ったか」) は壊れない。
--   - product_uuid (UUID) を **追加** して FK で参照整合性を確保。
--     ON DELETE SET NULL: 商品行が消えても order_items は残し product_uuid のみ NULL に倒す。
--     (= 監査・税務的に注文履歴は不変であるべき / 商品マスタの整理で履歴は壊れない)
--   - 既存行は public_id → uuid の lookup で backfill する。
--     0003 の seed と一致しない public_id があれば NULL のまま (= 警告ログでは追えるが必須でない)。
--   - product_uuid は **NULL 許容のまま** とする。理由は (a) 旧データ互換 (b) 商品削除後の null
--     遷移を許容するため。Phase 10+ で商品削除を許容しない設計に倒すなら NOT NULL 化を別 migration で。

-- ──────────────────────────────────────────────────────────────────────
-- 1. column 追加 (NULL 許容で)
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS product_uuid UUID;

-- ──────────────────────────────────────────────────────────────────────
-- 2. backfill: 既存 product_id (TEXT public_id) を products.id (UUID) で解決
-- ──────────────────────────────────────────────────────────────────────
-- products.public_id = order_items.product_id の組み合わせがあれば UUID で埋める。
-- 該当しない (= 既に消された商品 / 不正データ) 行は NULL のまま残る。
UPDATE order_items oi
   SET product_uuid = p.id
  FROM products p
 WHERE oi.product_uuid IS NULL
   AND p.public_id = oi.product_id;

-- ──────────────────────────────────────────────────────────────────────
-- 3. FK 制約 + index を追加
-- ──────────────────────────────────────────────────────────────────────
-- ON DELETE SET NULL: 商品マスタからの削除で order_items は残し product_uuid のみ NULL に。
-- 注文履歴の不変性を担保しつつ、商品マスタの整理を許す。
ALTER TABLE order_items
    ADD CONSTRAINT fk_order_items_product
        FOREIGN KEY (product_uuid) REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_product_uuid
    ON order_items (product_uuid);

-- ──────────────────────────────────────────────────────────────────────
-- 4. note for ops
-- ──────────────────────────────────────────────────────────────────────
-- product_uuid IS NULL の行を定期的に監査することを推奨:
--   SELECT id, product_id FROM order_items WHERE product_uuid IS NULL;
-- 0003 seed 投入直後の dev では該当行が出ないはず (= seed の 6 件と一致するため)。
-- production で出てきたら「商品マスタ未登録 or 削除済」のサイン。
