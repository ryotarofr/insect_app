-- 0004_users.sql — users + user_sessions + 既存テーブルへの FK 後付け
--                  (Phase 9.C / DB設計書 v2 §3.3)
--
-- **目的**:
--   - User account を持つユーザの基礎マスタを追加 (= 認証 / 監査 / C2C 出品の seller)
--   - `user_sessions` テーブルで Cookie ベース session を支える (= phc 形式の token_hash)
--   - 0003 / 0002 で deferred としていた `created_by` / `updated_by` の FK を後付け
--
-- **設計判断** (= db-schema-design.md §3.3):
--   - users.id = UUID。public_id = handle ("t_yamada") として URL に乗せる
--   - role は CHECK 制約で値域固定 (= セキュリティ判定の根拠なので typo 防止 / 高 #3)
--   - email は UNIQUE / 任意。MVP は使わないが将来の OAuth 連携で活きる
--   - user_sessions.user_id は NULL 許容 (= 匿名 cart も session 扱い可)
--   - token_hash は Argon2 phc 形式 ("$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>")。
--     algo 移行時に algo / params / salt がすべて文字列内に閉じるので互換性を保ちやすい。
--   - 監査トリガ `set_updated_at()` は 0001 で定義済み

-- ──────────────────────────────────────────────────────────────────────
-- users: ユーザマスタ
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- public_id は URL / @-handle に出す short slug。例: "t_yamada"
    public_id       TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,                          -- "山田 徹"
    -- High #3: role の値域を CHECK で固定 (= セキュリティ判定の根拠なので typo 防止)
    role            TEXT NOT NULL DEFAULT 'breeder'
                       CHECK (role IN ('breeder', 'admin', 'shop_owner')),
    -- 認証は Phase 9.F で oauth2 / jsonwebtoken を入れた時に実装
    email           TEXT UNIQUE,                            -- 任意 (将来)
    -- 表示用
    avatar_initial  TEXT NOT NULL,                          -- "山"
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),     -- "2024.03"
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_active   ON users (is_active);
CREATE INDEX idx_users_role     ON users (role);
-- public_id / email は UNIQUE 制約で自動 index される

CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- user_sessions: Cookie ベース認証セッション
-- ──────────────────────────────────────────────────────────────────────
-- - 1 行 = 1 アクティブ session。expires_at を超えたら GC で物理削除予定。
-- - user_id = NULL は匿名 session (= ログイン前の cart 等を session に紐付ける用途)
-- - token_hash は phc 形式 (Argon2 標準)。`$<algo>$<version>$<params>$<salt>$<hash>`
CREATE TABLE user_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = anonymous
    -- Medium #6: token_hash は phc 形式 (= Argon2 標準フォーマット)。
    -- algo / params / salt がすべて文字列に内包されるので algo 移行が容易。
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- phc format ざっくりチェック: 最低 3 つの '$' を含む形を弾けないので前置チェック。
    -- 厳密検証は libargon2 / argon2 crate 側に任せる (= migration はあくまで防御)。
    CONSTRAINT token_hash_phc_format CHECK (token_hash LIKE '$%$%$%')
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);

-- ──────────────────────────────────────────────────────────────────────
-- 0003 / 0002 の audit カラムに FK を後付け (= ALTER TABLE)
-- ──────────────────────────────────────────────────────────────────────
-- 各テーブルの created_by / updated_by は UUID 型のみで宣言されており、
-- ここで初めて users(id) への参照制約を付ける。NULL 許容 (= migration 投入時に
-- 既存行が created_by を持たないため)。
--
-- ON DELETE SET NULL: ユーザ削除時にレコード本体は残し作成者だけ NULL に。
-- (=「歴史」を消さない / 監査ログ的な扱い)
ALTER TABLE products
    ADD CONSTRAINT fk_products_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_products_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shipping_methods
    ADD CONSTRAINT fk_shipping_methods_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_shipping_methods_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

-- ──────────────────────────────────────────────────────────────────────
-- seed: ユーザ 1 件 (= MVP / fixture でしか使わない)
-- ──────────────────────────────────────────────────────────────────────
-- 設計書では 山田 徹 (t_yamada / breeder) を例として置いている。
-- 本番運用では本 seed は削除し、init script から ops が `INSERT` する想定。
INSERT INTO users (public_id, name, role, avatar_initial) VALUES
  ('t_yamada', '山田 徹', 'breeder', '山');
