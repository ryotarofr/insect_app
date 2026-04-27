-- 0012_product_watches_session_owner.sql — product_watches を session_id 許容に拡張
--                                          (Phase 9.E 残り / cart_items と同等の owner モデル)
--
-- **目的**:
--   匿名 (= cookie のみ) ユーザでも product_watches を DB 永続化できるようにする。
--   元 schema (= 0006_cart_and_watches.sql) は `(user_id, product_id)` 複合 PK で
--   user_id NOT NULL を要求していた → login 必須機能だった。本 migration で
--   cart_items と同じ「session_id か user_id どちらか必須」owner モデルに揃える。
--
-- **設計判断**:
--   - 既存 PK (user_id, product_id) を削除し、UUID id を新 PK に
--   - user_id を NULLABLE にし、session_id UUID を新規追加 (= user_sessions FK / ON DELETE CASCADE)
--   - CHECK (user_id IS NOT NULL OR session_id IS NOT NULL) で空 owner を弾く
--   - UNIQUE 部分 index `(COALESCE(user_id, session_id), product_id)` で同 owner × 同 product
--     の重複を防ぐ (= login で複数 row がでるのを防止)
--   - 既存 row (= 0006 投入直後の dev DB なら 0 件想定) は ADD COLUMN id ... DEFAULT
--     gen_random_uuid() で自動埋め
--
-- **手順**:
--   1. 既存 (user_id, product_id) PK を drop
--   2. id UUID PK を ADD (= existing rows は random UUID)
--   3. session_id UUID を ADD (= 既存行は NULL のまま、user_id 経由で owner 判定)
--   4. user_id を NULLABLE に
--   5. CHECK 制約 (user_id IS NOT NULL OR session_id IS NOT NULL) を ADD
--   6. UNIQUE 部分 index で重複防止

ALTER TABLE product_watches DROP CONSTRAINT IF EXISTS product_watches_pkey;

ALTER TABLE product_watches
    ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ADD COLUMN session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
    ALTER COLUMN user_id DROP NOT NULL,
    ADD CONSTRAINT product_watches_owner_present CHECK (
        user_id IS NOT NULL OR session_id IS NOT NULL
    );

-- 同一 owner (= login user 経由 or anonymous session 経由) で同じ product を 2 回登録しないよう
-- COALESCE で「実質 owner 値」を計算して unique にする。NULL は cart_items と違って絶対通らない
-- (= CHECK で OR 制約済み) ので COALESCE 結果は常に non-NULL。
CREATE UNIQUE INDEX uq_product_watches_owner_product
    ON product_watches (COALESCE(user_id, session_id), product_id);

-- session 側からの逆引き (= 「この session が watch している商品の数」を集計する場合用)
CREATE INDEX idx_product_watches_session
    ON product_watches (session_id) WHERE session_id IS NOT NULL;

-- 旧 (user_id, product_id) は元 PK で auto-index されていた。PK 削除で index も消えるので
-- user 経由の検索を支える index を別途張り直す。
CREATE INDEX idx_product_watches_user
    ON product_watches (user_id) WHERE user_id IS NOT NULL;
