-- 0024_listings_buyout_price.sql — listings に buyout_price_jpy 追加 (Phase 6c-1 / 即決価格併用)
--
-- **背景**:
--   オークション出品で「即決価格」(= Buy It Now / 早期終了) を併用したいというユーザ要望がモック設計
--   段階で挙がっていた。落札を待たずに即決価格で買える経路を提供すると C2C の摩擦低減になる。
--
-- **設計判断**:
--   - **NULL 許容**: 既存出品 (= 旧仕様で作成済) は NULL で互換維持。
--   - **適用対象**: auction (= is_auction=true) かつ任意。即決のみ (is_auction=false) では starting_price_jpy
--     自体が即決価格として扱われるため buyout_price_jpy は意味を持たない (= NULL 強制)。
--   - **CHECK 制約**:
--       1. buyout_price_jpy >= 0 (= 負値拒否)
--       2. 即決のみ出品 (is_auction=false) では NULL でなければならない
--       3. auction の場合、設定するなら starting_price_jpy より大きい (= 即決額が下回ると意味不明)
--   - 上記 3 を 1 つの CHECK でまとめると判別が辛いので、3 つに分けて貼る。

ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS buyout_price_jpy BIGINT;

-- 1. 非負
ALTER TABLE listings
    ADD CONSTRAINT buyout_price_nonneg
    CHECK (buyout_price_jpy IS NULL OR buyout_price_jpy >= 0);

-- 2. 即決のみ出品では設定不可
ALTER TABLE listings
    ADD CONSTRAINT buyout_only_for_auction
    CHECK (is_auction = true OR buyout_price_jpy IS NULL);

-- 3. auction で設定する場合は starting_price_jpy より高い (= "即決" の意味を保つ)
ALTER TABLE listings
    ADD CONSTRAINT buyout_price_gt_starting
    CHECK (buyout_price_jpy IS NULL OR buyout_price_jpy > starting_price_jpy);
