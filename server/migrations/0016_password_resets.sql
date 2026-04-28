-- 0016_password_resets.sql — password reset token テーブル (Week 2 / F8 + N2)
--
-- **目的**:
--   `POST /auth/password_reset_request` で生成する 1 回限りの token を保存し、
--   `POST /auth/password_reset_confirm` で検証 + 消費する。
--
-- **設計判断**:
--   - **token は plain で保存しない**: users.password_hash と同じ Argon2id phc 文字列で保存し、
--     URL に乗せる plain token と DB の token_hash を比較する。DB ダンプ漏洩で token を即時悪用
--     できないように防御。
--   - **expires_at**: 通常 1 時間。env (= KOCHU_PASSWORD_RESET_TTL_SEC) で上書き可能にする想定。
--     handler 側で `now() < expires_at` を都度 verify。
--   - **used_at NOT NULL は不可**: token を 1 回限りにする運用なので、初期 NULL → 利用時 now() を
--     入れる。`used_at IS NOT NULL` の token は即座に reject (= 二重利用防止)。
--   - **user_id ON DELETE CASCADE**: ユーザ削除で残骸 token が users(id) を参照不能にしない。
--   - **GC は別 task**: 期限切れ token は cron で物理削除する想定。本 migration では DELETE 経路は
--     用意しない (= ops or apalis cron で `DELETE FROM password_resets WHERE expires_at < now() - INTERVAL '7 days'`).
--   - **idempotency / rate-limit はここで持たない**: 「同じ user に対し 1 分に 5 回までリクエスト」
--     のような制御は handler / Redis 側で実装する想定。本 migration はストレージ層のみ。
--
-- **依存**:
--   - 0004_users.sql (users + password_hash)
--   - 0008_users_password.sql (password_hash 列追加 / Argon2id phc 形式)

CREATE TABLE password_resets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 対象 user。削除されたら token も即廃棄 (= ON DELETE CASCADE)。
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Argon2id phc 文字列。users.password_hash と同じ CHECK 制約スタイルで preg-match。
    -- 例: "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>"
    token_hash  TEXT NOT NULL CHECK (token_hash LIKE '$argon2id$%'),
    -- 期限 (= 通常 created_at + 1 hour)。handler で都度 verify する。
    expires_at  TIMESTAMPTZ NOT NULL,
    -- 利用済タイムスタンプ。NULL = 未使用、Some = 既に使われた (= 2 回目は reject)。
    used_at     TIMESTAMPTZ,
    -- 監査用 (= リクエスト元の origin / IP を将来追加する余地)。今は created_at のみ。
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 整合性: used_at は created_at より後 (= 過去に「使われた」ことになる事故防止)。
    CONSTRAINT used_after_created CHECK (used_at IS NULL OR used_at >= created_at),
    -- 整合性: expires_at は created_at より後 (= 既に切れた token を発行する事故防止)。
    CONSTRAINT expires_after_created CHECK (expires_at > created_at)
);

-- 「ある user の最新リクエスト」を引く index。
-- 古いリクエストの自動失効 (= 同 user の前 token は新 token 発行で実質無効化) を実装する時に使う。
CREATE INDEX idx_password_resets_user
    ON password_resets (user_id, created_at DESC);

-- GC 用 (= 期限切れの token を一掃する batch から WHERE expires_at < ... を引きやすくする)。
CREATE INDEX idx_password_resets_expires
    ON password_resets (expires_at);

-- 未使用 token のみ引く部分 index (= 検証経路 used_at IS NULL を高速化)。
CREATE INDEX idx_password_resets_unused
    ON password_resets (user_id)
    WHERE used_at IS NULL;
