-- 0008_users_password.sql — users.password_hash 列追加 (Phase 9.G / login flow)
--
-- **目的**:
--   - users に Argon2id でハッシュした password_hash 列を追加し、
--     POST /api/v1/auth/register で書き込めるようにする。
--   - 既存 seed (t_yamada) は password_hash NULL のままにし、
--     「login 不可のサンプルユーザ」として残す (= app fixture から触る用途)。
--
-- **設計判断**:
--   - NOT NULL にしない (= 後付け migration で既存行を壊さないため + OAuth で
--     password 不要なユーザを許容する余地を残す)。
--   - phc 形式チェックを最低限の `LIKE '$%$%$%'` で持つ (= argon2 / scrypt / bcrypt の
--     phc 文字列はすべてマッチする / 平文や fixed 値が入った時に弾ける)。
--     厳密検証は argon2 crate 側に任せる。
--   - login 時は WHERE email = $1 で引いた後 password_hash を verify する想定。
--     email は users で既に UNIQUE 制約済 (0004_users.sql 参照)。

ALTER TABLE users
    ADD COLUMN password_hash TEXT,
    ADD CONSTRAINT users_password_hash_phc_format CHECK (
        password_hash IS NULL OR password_hash LIKE '$%$%$%'
    );

-- email で login する経路の index (= 0004 で UNIQUE は付いているが index 名を明示的に揃える)。
-- UNIQUE 制約が自動 index を作るので追加 index は不要。
-- (ここではコメントで意図を残すだけ。)
