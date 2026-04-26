-- 0006_cart_and_watches.sql — cart_items + product_watches (Phase 9.E 部分先行)
--                            (DB設計書 v2 §3.7 / 元 plan の 0008 を 2 分割)
--
-- **本 migration が扱う範囲**:
--   - `cart_items`        : 既存 in-memory cart_store の DB 化先
--   - `product_watches`   : 既存 in-memory watch_store の DB 化先
--
-- **本 migration が扱わない範囲** (= specimens / Phase 9.D 完了後の別 migration へ):
--   - `listings` / `bids` / `listing_watches` / `v_listings_with_counts`
--   - 理由: `listings.specimen_id` が specimens テーブル (Phase 9.D) を要求し、
--     `listing_watches` は `listings` を参照するため、まとめて後送りにする。
--   - cart / watch ハンドラの DB 化は本 migration だけで成立するため、ここで切る価値が高い。
--
-- **設計判断** (= db-schema-design.md §3.7 / レビュー反映済):
--   - cart_items.session_id → user_sessions(id) FK + ON DELETE CASCADE (Medium #1)
--   - cart_items.user_id    → users(id) FK (= ログイン後の cart 引き継ぎで使う)
--   - cart_items は session_id か user_id のいずれかが必須 (= guest cart 対応)
--   - cart_items.qty は CHECK (qty BETWEEN 1 AND 99) で UI 上限と整合
--   - cart_items.id (UUID) を Undo token として hex 文字列で client に返す想定 (§8.1)
--   - product_watches は (user_id, product_id) 複合 PK (= polymorphic 回避 / High #1 案 C)

-- ──────────────────────────────────────────────────────────────────────
-- cart_items: カート (= server 永続のカート行)
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE cart_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- session_id か user_id のどちらかが必須 (= guest cart 対応)
    session_id      UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES products(id),
    qty             INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99),
    -- Undo token = cart_items.id を hex で返すだけ (= §8.1 採用)。
    -- 別カラム不要、削除は physical DELETE。
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cart_owner_present CHECK (
        session_id IS NOT NULL OR user_id IS NOT NULL
    )
);

-- 部分 index: NULL でない側だけ拾う (= 検索効率 + index サイズ縮小)
CREATE INDEX idx_cart_items_session
    ON cart_items (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_cart_items_user
    ON cart_items (user_id)    WHERE user_id IS NOT NULL;
CREATE INDEX idx_cart_items_product
    ON cart_items (product_id);

CREATE TRIGGER trg_cart_items_updated
    BEFORE UPDATE ON cart_items
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- product_watches: 商品ウォッチ (= ハートマーク留め)
-- ──────────────────────────────────────────────────────────────────────
-- (user_id, product_id) 複合 PK。1 ユーザが同じ商品を 2 回登録できない。
-- 取消は DELETE で physical 削除 (= ON / OFF 切替を toggle で実現)。
--
-- listing_watches (= C2C 出品用) は listings テーブル新設後に別 migration で追加。
CREATE TABLE product_watches (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id)
);

-- 商品側からの逆引き (= 「この商品をウォッチしているユーザ数」を集計する場合用)
CREATE INDEX idx_product_watches_product ON product_watches (product_id);
