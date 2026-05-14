-- 0026_users_stripe_connect.sql — users に Stripe Connect 連携カラム追加 (Phase 7)
--
-- **背景**:
--   C2C で「売上が出品者に振り込まれる」ようにするため、Stripe Connect Express で
--   各出品者にサブアカウントを発行する。本 migration は users 側に必要なメタデータを追加。
--
-- **設計判断**:
--   - `stripe_connect_account_id` は Stripe API の `acct_xxxxx` 文字列を保持。
--     1 user = 1 Connect account なので UNIQUE 制約。NULL = 未連携。
--   - `stripe_connect_status` は FSM:
--       'unlinked'   : 連携前 (= account_id NULL と等価。明示的に列で持つことで status 単独
--                      で判別可、index 効率も向上)
--       'pending'    : Account 作成済 / Account Link 発行済 / KYC 入力途中
--       'active'     : charges_enabled = true && payouts_enabled = true
--       'restricted' : 一部制限 (= Stripe からの追加情報要求 / 一時停止)
--     account.updated webhook で値を同期する (Phase 7-7)。
--   - 出品 wizard / 受取フローは status='active' のみ許可する (= handler で握る)。
--
-- **依存**:
--   - 0004_users.sql (users テーブル)

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_connect_status TEXT NOT NULL DEFAULT 'unlinked'
        CHECK (stripe_connect_status IN ('unlinked', 'pending', 'active', 'restricted'));

-- 1 user = 1 Connect account の保証 (NULL は重複を許す = unlinked が複数並んで OK)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_stripe_connect_account_id
    ON users (stripe_connect_account_id)
    WHERE stripe_connect_account_id IS NOT NULL;

-- account.updated webhook で account_id 経由 user lookup する hot path 用。
-- (= 上の UNIQUE index で実質カバーされるが、PostgreSQL は partial index に対する
--  通常 SELECT を最適化するため別途は不要)。
