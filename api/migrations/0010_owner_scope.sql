-- Phase B: 飼育ドメインのユーザ分離。
-- 定義(page_definitions)と市場データ(listings)は共有のまま、
-- specimens / specimen_groups / species_notes を owner_id でスコープする。

ALTER TABLE specimens       ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE specimen_groups ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE species_notes   ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE CASCADE;

-- 既存データの帰属: 最初の登録ユーザ。ユーザが居なければログイン不能な
-- シードユーザを作成して割り当てる(password_hash が argon2 形式でないため認証不可)。
DO $$
DECLARE seed_owner uuid;
BEGIN
    SELECT id INTO seed_owner FROM users ORDER BY created_at LIMIT 1;
    IF seed_owner IS NULL THEN
        INSERT INTO users (email, password_hash, display_name)
        VALUES ('seed@local.invalid', '!disabled', 'シードユーザ')
        RETURNING id INTO seed_owner;
    END IF;
    UPDATE specimens       SET owner_id = seed_owner WHERE owner_id IS NULL;
    UPDATE specimen_groups SET owner_id = seed_owner WHERE owner_id IS NULL;
    UPDATE species_notes   SET owner_id = seed_owner WHERE owner_id IS NULL;
END $$;

ALTER TABLE specimens       ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE specimen_groups ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE species_notes   ALTER COLUMN owner_id SET NOT NULL;

-- 一意制約をユーザ単位へ変更
ALTER TABLE specimens       DROP CONSTRAINT specimens_code_key;
ALTER TABLE specimens       ADD CONSTRAINT specimens_owner_code_key UNIQUE (owner_id, code);
ALTER TABLE specimen_groups DROP CONSTRAINT specimen_groups_label_key;
ALTER TABLE specimen_groups ADD CONSTRAINT specimen_groups_owner_label_key UNIQUE (owner_id, label);
ALTER TABLE species_notes   DROP CONSTRAINT species_notes_pkey;
ALTER TABLE species_notes   ADD PRIMARY KEY (owner_id, species_name);

CREATE INDEX specimens_owner_idx       ON specimens (owner_id);
CREATE INDEX specimen_groups_owner_idx ON specimen_groups (owner_id);
