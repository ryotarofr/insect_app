-- 0009_market.sql — C2C 出品 + 入札 + ウォッチ + 派生 VIEW (Phase 9.E 残り / 設計書 §3.7)
--
-- **本 migration が扱う範囲**:
--   - `listings`               : C2C 出品 (= 自分が育てた specimens を売る / 即決 or auction)
--   - `bids`                   : 入札履歴 (= auction の各入札を不可逆に記録)
--   - `listing_watches`        : 出品 watch (= ウォッチリストの 2 テーブル分割側 / High #1 案 C)
--   - `v_listings_with_counts` : bid_count / watcher_count を派生集計する VIEW (Medium #2)
--
-- **設計判断** (= db-schema-design.md §3.7 / レビュー反映済):
--   - High #4: auction 整合性を CHECK 制約 (auction_requires_ends_at /
--              current_price_ge_starting) で握る
--   - Medium #2: bid_count / watcher_count は drift を避けるため列に持たず VIEW で集計
--                MVP の規模 (= 数百件 / list ページ) なら subquery で十分高速。
--                規模が増えて遅くなった時点で MATERIALIZED VIEW + REFRESH に切り替える。
--   - Medium #5: ops 監査 + 楽観ロック (created_by / updated_by / version)
--   - 0007 で specimens が存在することを前提 (= listings.specimen_id FK)

-- ──────────────────────────────────────────────────────────────────────
-- listings: C2C 出品
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE listings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id       TEXT NOT NULL UNIQUE,                       -- "L-0421" (= random suffix)
    seller_user_id  UUID NOT NULL REFERENCES users(id),
    -- 出品対象は specimen への直接参照 or 自由 title の 2 通り
    specimen_id     UUID REFERENCES specimens(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,                              -- "ヘラクレス♂ 148mm 自家累代CBF3"
    description     TEXT,
    -- オークション or 即決
    is_auction      BOOLEAN NOT NULL DEFAULT false,
    starting_price_jpy BIGINT NOT NULL CHECK (starting_price_jpy >= 0),
    current_price_jpy  BIGINT,                                  -- auction で更新
    ends_at         TIMESTAMPTZ,                                -- auction 終了時刻
    -- 出品状態
    status          TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'sold', 'canceled', 'expired')),
    -- 出品者の信頼マーク (= 過去取引から計算するが、MVP は手動)
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    -- Medium #5: ops 監査 + 楽観ロック
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    version         INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- High #4: 整合性チェック
    CONSTRAINT auction_requires_ends_at CHECK (
        NOT is_auction OR ends_at IS NOT NULL
    ),
    CONSTRAINT current_price_ge_starting CHECK (
        current_price_jpy IS NULL OR current_price_jpy >= starting_price_jpy
    )
);

CREATE INDEX idx_listings_status_ends   ON listings (status, ends_at);
CREATE INDEX idx_listings_seller        ON listings (seller_user_id);
CREATE INDEX idx_listings_specimen      ON listings (specimen_id) WHERE specimen_id IS NOT NULL;

CREATE TRIGGER trg_listings_updated
    BEFORE UPDATE ON listings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- bids: 入札履歴
-- ──────────────────────────────────────────────────────────────────────
-- 1 入札 = 1 行。listings.current_price_jpy はトリガで MAX(amount_jpy) に更新する想定。
-- VIEW v_listings_with_counts は本テーブルから COUNT を引く。
CREATE TABLE bids (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id      UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    bidder_user_id  UUID NOT NULL REFERENCES users(id),
    amount_jpy      BIGINT NOT NULL CHECK (amount_jpy > 0),
    bid_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bids_listing           ON bids (listing_id, bid_at DESC);
CREATE INDEX idx_bids_bidder            ON bids (bidder_user_id);

-- ──────────────────────────────────────────────────────────────────────
-- listing_watches: 出品ウォッチ (= product_watches の listing 版)
-- ──────────────────────────────────────────────────────────────────────
-- High #1 案 C: polymorphic + UNIQUE NULL の罠を回避し、product_watches と
-- listing_watches の 2 テーブル分割で型安全 + JOIN シンプルに。
CREATE TABLE listing_watches (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, listing_id)
);

-- 出品側からの逆引き (= 「この出品をウォッチしているユーザ数」を集計する場合用)
CREATE INDEX idx_listing_watches_listing ON listing_watches (listing_id);

-- ──────────────────────────────────────────────────────────────────────
-- v_listings_with_counts: 派生値を VIEW で集計 (Medium #2)
-- ──────────────────────────────────────────────────────────────────────
-- bid_count / watcher_count は drift を避けるため列に持たず VIEW で計算。
-- MVP の規模なら subquery で十分。規模が増えて遅くなったら MATERIALIZED VIEW +
-- REFRESH に切り替える (= 設計書 §3.7 / Medium #2 の方針)。
CREATE VIEW v_listings_with_counts AS
SELECT
    l.*,
    (SELECT COUNT(*) FROM bids b           WHERE b.listing_id = l.id) AS bid_count,
    (SELECT COUNT(*) FROM listing_watches w WHERE w.listing_id = l.id) AS watcher_count
FROM listings l;
