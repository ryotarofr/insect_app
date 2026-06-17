-- 0021_c2c_pivot_drop_b2c_tables.sql — C2C pivot: B2C 商品系テーブル全廃 + cart/orders を listing 化
--
-- **背景**:
--   FE 側で C2C 専業化 (= /products は listings 一覧、/market /shop 廃止) を実施したのに伴い、
--   server 側の products / product_translations / product_bloodlines / product_watches を
--   全て破棄する。cart_items / order_items の product 参照は listings 参照に置換する。
--
-- **方針** (= dev / test 環境前提):
--   - 既存データは破棄して良い (= MVP 段階で本番運用無し)
--   - cart_items / order_items の B2C product 参照行は DELETE してから column を入れ替える
--   - listing_id (UUID) を新設、FK to listings(id)
--   - 旧 product_id (TEXT) / product_uuid (UUID) / 関連 index は DROP
--
-- **残すテーブル** (= C2C でも必要):
--   - shipping_methods / shipping_method_translations (= 配送方法マスタ)
--   - prefectures (= 配送先 47 都道府県マスタ)
--   - stripe_webhook_events (= C2C 取引でも冪等性確保に必要)
--   - orders / order_items / shipping_addresses (= C2C 取引履歴として再利用)

-- ──────────────────────────────────────────────────────────────────────
-- 1. cart_items: product_id (UUID) → listing_id (UUID FK to listings)
-- ──────────────────────────────────────────────────────────────────────
-- 既存 cart 行は破棄 (= dev 環境では空 or seed のみのはず)。
DELETE FROM cart_items;

-- 旧 index と FK を drop
DROP INDEX IF EXISTS idx_cart_items_product;
ALTER TABLE cart_items DROP COLUMN IF EXISTS product_id;

-- listing_id を追加。FK は listings(id) ON DELETE CASCADE
-- (= listing が消えた時点で cart 行も消す = 整合性優先)。
ALTER TABLE cart_items
    ADD COLUMN listing_id UUID NOT NULL
        REFERENCES listings(id) ON DELETE CASCADE;

CREATE INDEX idx_cart_items_listing
    ON cart_items (listing_id);

-- C2C は 1 listing = 1 unique specimen のため qty は常に 1。
-- 既存 CHECK (qty BETWEEN 1 AND 99) は残し、新規挿入は 1 のみを期待する形で運用。
-- (qty=1 強制の制約追加は後続 PR で判断)

-- ──────────────────────────────────────────────────────────────────────
-- 2. order_items: product_id (TEXT) / product_uuid (UUID FK to products) → listing_id
-- ──────────────────────────────────────────────────────────────────────
-- 既存 order 行は dev 環境では破棄して OK。
DELETE FROM order_items;
DELETE FROM orders;

-- 旧 FK / index / 列を drop
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS fk_order_items_product;
DROP INDEX IF EXISTS idx_order_items_product_uuid;
ALTER TABLE order_items DROP COLUMN IF EXISTS product_uuid;
ALTER TABLE order_items DROP COLUMN IF EXISTS product_id;

-- listing_id を追加。FK は listings(id) ON DELETE SET NULL (= 注文履歴の不変性を担保)。
ALTER TABLE order_items
    ADD COLUMN listing_id UUID
        REFERENCES listings(id) ON DELETE SET NULL;

CREATE INDEX idx_order_items_listing
    ON order_items (listing_id) WHERE listing_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- 3. B2C 専用テーブルを drop
-- ──────────────────────────────────────────────────────────────────────
-- product_watches は product_id が products(id) を FK 参照しているので CASCADE で連鎖 drop。
DROP TABLE IF EXISTS product_watches CASCADE;

-- 商品血統 (= 商品の親個体情報) は B2C 専用なので削除。
-- 同じ概念は listings 経由で specimen.father_id / mother_id を引けば良い。
DROP TABLE IF EXISTS product_bloodlines CASCADE;

-- 商品翻訳 (= product_id × locale → name/description) も B2C 専用。
DROP TABLE IF EXISTS product_translations CASCADE;

-- 商品マスタ本体を drop。listings が販売対象の唯一のエンティティに。
DROP TABLE IF EXISTS products CASCADE;
