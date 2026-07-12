-- 飼育一覧のタブ軸を「閉じたステージenum」から「ユーザ定義グループ(虫かご等)」へ置換。
-- 既存の4ステージは初期グループとして移行し、以後は自由に追加・改名できる。
-- SDUI 定義(specimen_list { key })は無変更 — タブのラベルはドメインデータ。

CREATE TABLE specimen_groups (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label      text NOT NULL UNIQUE,
    sort_order int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO specimen_groups (label, sort_order) VALUES
    ('卵', 1), ('幼虫', 2), ('蛹', 3), ('成虫', 4);

ALTER TABLE specimens ADD COLUMN group_id uuid REFERENCES specimen_groups(id);

UPDATE specimens s
SET group_id = g.id
FROM specimen_groups g
WHERE g.label = CASE s.stage
    WHEN 'egg'   THEN '卵'
    WHEN 'larva' THEN '幼虫'
    WHEN 'pupa'  THEN '蛹'
    WHEN 'adult' THEN '成虫'
END;

ALTER TABLE specimens ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE specimens DROP COLUMN stage;
