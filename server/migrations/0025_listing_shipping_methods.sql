-- 0025_listing_shipping_methods.sql — 出品ごとの対応可能配送方法 (Phase 6c-2)
--
-- **背景**:
--   C2C では 出品者の地域 / 季節 / 梱包能力で対応可能な配送方法が変わる。
--   listings 単位で「自分が対応可能な方法」を絞り込めるようにし、checkout で購入者は
--   その中からのみ選べる仕組みにする (= 死着リスク低減)。
--
-- **設計判断** (= docs/implementation-plan-shop-management.md の方針):
--   - 関連テーブルで持つ。`TEXT[]` / `JSONB` ではなく `listing_shipping_methods` を切る。
--     - 将来の `extra_fee_jpy` (= 出品者ごとの送料カスタム) 追加に強い。
--     - 既存 `listing_watches` / `bids` と同じパターン。
--   - PK = `(listing_id, shipping_method_id)`。1 listing × 1 method の重複を弾く。
--   - listing 削除時は CASCADE で連鎖削除 (= 履歴は残さない)。
--   - shipping_method_id は既存 `shipping_methods.id` を参照する FK だが、shipping_methods
--     テーブルは seed 主体で柔軟性を保つため **論理参照に留める** (= FK は張らない)。
--     CHECK 制約で値域を握ると seed 追加のたびに migration 改訂が必要になるため、
--     値域チェックは application 側 (= handlers / repos) で行う。
--
-- **未対応 = 全方法 OK の解釈**:
--   - listing_shipping_methods に行が 1 件も無い場合、「全方法に対応」とみなす (= 旧仕様互換)。
--   - 行があるなら「その集合のみ対応」(= 出品者の絞り込み意思を尊重)。
--   - この解釈は repos / handlers 側で実装する。

CREATE TABLE listing_shipping_methods (
    listing_id          UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    shipping_method_id  TEXT NOT NULL,
    -- 将来: 出品者ごとのカスタム送料 (NULL = shipping_methods.amount_jpy を使う)。
    -- MVP では未使用、定義のみ用意して後続 PR でフォーム化する余地を残す。
    extra_fee_jpy       BIGINT CHECK (extra_fee_jpy IS NULL OR extra_fee_jpy >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (listing_id, shipping_method_id)
);

-- listing_id 単独のクエリも頻出 (= 1 listing の対応方法を引く詳細ページ)。
-- ただし PRIMARY KEY の前置 prefix が listing_id なので追加 index は不要。

-- shipping_method_id 単独で「この方法に対応している listing 一覧」を引きたい時用 (= 検索フィルタ将来)。
CREATE INDEX idx_listing_shipping_methods_method
    ON listing_shipping_methods (shipping_method_id);
