-- 0001_initial.sql — KOCHU 初期 PostgreSQL スキーマ
--
-- **設計方針**:
--   - migration は sqlx::migrate! (= sqlx-cli) で管理。
--   - 1 migration = 1 ファイル / unidirectional (= rollback は別 migration を切る)。
--   - 番号は 4 桁 zero-pad。`0001_<name>.sql` 形式で並び順を確定。
--
-- **Phase 9 で扱うテーブル**:
--   - `orders`        — Stripe Checkout で作る注文ヘッダ
--   - `order_items`   — 注文 1 行 (= LineItem 相当の永続化)
--   - `shipping_addresses` — 配送先 (将来 user 別保存に拡張)
--
-- 現状はスキーマの**雛形**を置いて Rust 側 sqlx の compile-time check を可能にする
-- ところまでが目的。具体ロジック (Stripe webhook → status 更新 等) は別 migration / handler で。

-- ──────────────────────────────────────────────────────────────────────
-- extensions
-- ──────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- ↑ uuid_generate_v4() を使う場合に必要。RDS aurora-postgres でも使える。

-- ──────────────────────────────────────────────────────────────────────
-- orders: 注文ヘッダ
-- ──────────────────────────────────────────────────────────────────────
-- - 1 注文 = 1 行。Stripe Checkout Session 作成時に INSERT、webhook 受信で UPDATE。
-- - status enum は文字列で持つ (enum 型を切ると migration で揺れやすい)。
--   `pending` (Stripe Session 作成済 / payment 未確定)
--   `paid`    (webhook で payment_intent.succeeded を受信済)
--   `failed`  (payment 失敗 / 期限切れ)
--   `canceled` (ユーザがキャンセル)
-- - amount_jpy は税込 (= cart の OrderSummary.totalAmount と同じ単位)。
--   多通貨対応 (§17 Future Work) では `amount_minor + currency` に切り替える破壊的 migration。
CREATE TABLE IF NOT EXISTS orders (
    -- UUID v4。Stripe Session の client_reference_id にも乗せる。
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- セッション識別子 (= cart_store の session token に対応する想定)。
    -- Cookie ベース session が入るまでは固定 "anonymous" でも回す。
    session_id      TEXT NOT NULL,
    -- Stripe Checkout Session の id (= cs_test_... / cs_live_...)。
    -- Phase 9 で Stripe を絡めるまでは NULL のままでも OK。
    stripe_session_id TEXT,
    -- Stripe PaymentIntent の id (= pi_...)。webhook で確定後に書く。
    stripe_payment_intent_id TEXT,
    -- 注文ステータス (上記コメント参照)。
    status          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'paid', 'failed', 'canceled')),
    -- 合計金額 (税込・JPY)。多通貨化時は別 column を追加して移行する。
    amount_jpy      BIGINT NOT NULL CHECK (amount_jpy >= 0),
    -- 配送料 (税込・JPY)。NULL なら配送料 0 扱い。
    shipping_jpy    BIGINT,
    -- メモ用 free-form jsonb (= raw cart snapshot 等を debug 目的で保存)。
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_session_id_created_at
    ON orders (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_stripe_session_id
    ON orders (stripe_session_id)
    WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_status
    ON orders (status);

-- ──────────────────────────────────────────────────────────────────────
-- order_items: 注文 1 行 (= 商品 × 数量)
-- ──────────────────────────────────────────────────────────────────────
-- - cart の LineItem block を永続化したもの。注文確定時に snapshot を取って書く。
-- - product_id は商品マスタの id (= mock_store の "p-hh-m-142" 等)。
--   将来 products テーブルを切る場合は FK にするが、MVP では文字列のまま。
-- - unit_price_jpy / qty / subtotal_jpy は server 側で計算して保存
--   (= "client が改ざんして送る" 経路を遮断)。
CREATE TABLE IF NOT EXISTS order_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id      TEXT NOT NULL,
    -- 商品名 (注文時点でのスナップショット = 後から商品名が変わっても履歴は保存)。
    title           TEXT NOT NULL,
    unit_price_jpy  BIGINT NOT NULL CHECK (unit_price_jpy >= 0),
    qty             INTEGER NOT NULL CHECK (qty >= 1 AND qty <= 99),
    subtotal_jpy    BIGINT NOT NULL CHECK (subtotal_jpy >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
    ON order_items (order_id);

-- ──────────────────────────────────────────────────────────────────────
-- shipping_addresses: 配送先 (注文ヘッダごとに 1 件)
-- ──────────────────────────────────────────────────────────────────────
-- - 注文時点での配送先を保存 (= 注文後にユーザがマスタを変更しても履歴は保存)。
-- - 1 注文に 1 配送先。複数配送先対応は将来。
CREATE TABLE IF NOT EXISTS shipping_addresses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id        UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    -- form_field の name と対応 (§5.8.2)。
    address_name    TEXT NOT NULL,
    address_tel     TEXT NOT NULL,
    address_zip     TEXT NOT NULL,
    address_pref    TEXT NOT NULL,
    address_addr    TEXT NOT NULL,
    shipping_method_id TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────
-- updated_at trigger (orders 用)
-- ──────────────────────────────────────────────────────────────────────
-- UPDATE 時に updated_at を自動更新するトリガ。
-- 簡素化のため orders のみ適用 (order_items / shipping_addresses は immutable な想定)。
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_set_updated_at ON orders;
CREATE TRIGGER trg_orders_set_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
