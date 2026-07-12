-- 飼育管理: specimens / care_logs / species_notes + careページ・個体詳細ページの定義seed

CREATE TABLE specimens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    species_name    text NOT NULL,
    scientific_name text,
    stage           text NOT NULL CHECK (stage IN ('egg', 'larva', 'pupa', 'adult')),
    sex             text,
    line            text,          -- 累代 (例: CB F2)
    measure         text,          -- 最終計測 (例: 98g(3令時))
    egg_date        date,
    next_action     text,          -- 未設定なら一覧hintは最新記録から生成
    alert           boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE care_logs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    specimen_id uuid NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
    at          date NOT NULL,
    kind        text NOT NULL,
    body        text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE species_notes (
    species_name text PRIMARY KEY,
    note         text NOT NULL
);

-- seed: 個体
INSERT INTO specimens (code, name, species_name, scientific_name, stage, sex, line, measure, egg_date, next_action, alert) VALUES
  ('DHH-E01', 'ヘラクレス 卵',        'ヘラクレスヘラクレス', 'Dynastes hercules hercules', 'egg',   NULL, 'CB F2', NULL,          '2026-06-28', '割出予定 7/20 ― 転卵しない', false),
  ('DHH-E02', 'ヘラクレス 卵',        'ヘラクレスヘラクレス', 'Dynastes hercules hercules', 'egg',   NULL, 'CB F2', NULL,          '2026-06-30', '割出予定 7/22', false),
  ('NIJI-E01', 'ニジイロ 卵',         'ニジイロクワガタ',     'Phalacrognathus muelleri',   'egg',   NULL, 'CB F3', NULL,          '2026-07-02', NULL, false),
  ('NIJI-E02', 'ニジイロ 卵',         'ニジイロクワガタ',     'Phalacrognathus muelleri',   'egg',   NULL, 'CB F3', NULL,          '2026-07-05', NULL, false),
  ('DHH-010', 'ヘラクレス 3令 ♂',    'ヘラクレスヘラクレス', 'Dynastes hercules hercules', 'larva', '♂', 'CB F2', '118g(3令)',   '2025-10-12', 'マット交換 8/01', false),
  ('DHH-012', 'ヘラクレス 3令 ♂',    'ヘラクレスヘラクレス', 'Dynastes hercules hercules', 'larva', '♂', 'CB F2', '98g(3令)',    '2025-10-12', 'マット交換 9日経過', true),
  ('DHH-013', 'ヘラクレス 2令',       'ヘラクレスヘラクレス', 'Dynastes hercules hercules', 'larva', NULL, 'CB F2', NULL,          '2026-04-02', NULL, false),
  ('NIJI-10', 'ニジイロ 3令 ♂',      'ニジイロクワガタ',     'Phalacrognathus muelleri',   'larva', '♂', 'CB F3', '18g(3令)',    '2026-01-20', NULL, false),
  ('OOK-01',  'オオクワ 3令 ♂',      'オオクワガタ',         'Dorcus hopei binodulosus',   'larva', '♂', 'CB F5', '28g(3令)',    '2026-02-11', '菌糸交換 9/15', false),
  ('DHH-007', 'ヘラクレス 蛹 ♂',     'ヘラクレスヘラクレス', 'Dynastes hercules hercules', 'pupa',  '♂', 'CB F2', '98g(3令時)',  '2025-10-12', '羽化予測 7/25 ±5日 ― 蛹室に振動を与えない', false),
  ('DHH-008', 'ヘラクレス 蛹 ♀',     'ヘラクレスヘラクレス', 'Dynastes hercules hercules', 'pupa',  '♀', 'CB F2', '62g(3令時)',  '2025-10-12', '羽化予測 8/05 ±5日', false),
  ('NIJI-08', 'ニジイロ 蛹 ♂',       'ニジイロクワガタ',     'Phalacrognathus muelleri',   'pupa',  '♂', 'CB F3', NULL,          '2026-01-20', NULL, false),
  ('DHH-001', 'ヘラクレス ♂ 152mm',  'ヘラクレスヘラクレス', 'Dynastes hercules hercules', 'adult', '♂', 'CB F1', '152mm',       '2024-11-02', NULL, false),
  ('DHH-002', 'ヘラクレス ♀ 68mm',   'ヘラクレスヘラクレス', 'Dynastes hercules hercules', 'adult', '♀', 'CB F1', '68mm',        '2024-11-02', '産卵セット中 ― 7/18 に割出予定', false),
  ('NIJI-03', 'ニジイロ ♂ 52mm',     'ニジイロクワガタ',     'Phalacrognathus muelleri',   'adult', '♂', 'CB F2', '52mm',        '2025-08-15', 'ゼリー交換 3日経過', true),
  ('OOK-A1',  'オオクワ ♂ 78mm',     'オオクワガタ',         'Dorcus hopei binodulosus',   'adult', '♂', 'CB F4', '78mm',        '2024-06-20', NULL, false);

-- seed: 飼育記録
INSERT INTO care_logs (specimen_id, at, kind, body) VALUES
  ((SELECT id FROM specimens WHERE code = 'DHH-007'), '2026-07-10', 'メモ',        '蛹室内で正常。色づき始め'),
  ((SELECT id FROM specimens WHERE code = 'DHH-007'), '2026-06-28', 'ステージ変化', '蛹化を確認(3令 → 蛹)'),
  ((SELECT id FROM specimens WHERE code = 'DHH-007'), '2026-06-01', '計測',        '3令 98g'),
  ((SELECT id FROM specimens WHERE code = 'DHH-007'), '2026-05-20', 'マット交換',   'Uマット 8L、加水やや強め'),
  ((SELECT id FROM specimens WHERE code = 'DHH-012'), '2026-07-02', 'マット交換',   'Uマット 8L'),
  ((SELECT id FROM specimens WHERE code = 'DHH-012'), '2026-06-20', '計測',        '3令 98g'),
  ((SELECT id FROM specimens WHERE code = 'DHH-010'), '2026-07-01', 'マット交換',   'Uマット 8L ― 118g'),
  ((SELECT id FROM specimens WHERE code = 'NIJI-03'), '2026-07-08', 'ゼリー交換',   '高タンパク 16g × 2'),
  ((SELECT id FROM specimens WHERE code = 'DHH-001'), '2026-07-09', 'ゼリー交換',   '高タンパク 16g × 2'),
  ((SELECT id FROM specimens WHERE code = 'DHH-E01'), '2026-06-28', '採卵',        '産卵セットから割出、個別管理へ');

-- seed: 種の飼育メモ
INSERT INTO species_notes (species_name, note) VALUES
  ('ヘラクレスヘラクレス', 'ヘラクレスの蛹期は約2ヶ月。羽化直後は上翅が白く、硬化まで3週間は掘り出さないこと。'),
  ('ニジイロクワガタ',     'ニジイロは高温に弱く25℃以下を維持。菌糸・マットどちらでも飼育可。'),
  ('オオクワガタ',         'オオクワは低温に強く長寿。菌糸ビン飼育が基本、交換は3ヶ月目安。');

-- 飼育管理ページ(SDUI定義)
INSERT INTO page_definitions (page_key, definition) VALUES ('care', $json$
{
  "schemaVersion": 1,
  "page": {
    "template": "feed",
    "content": {
      "regions": {
        "header": [
          { "key": "memo", "size": "full", "blocks": [
            { "type": "text", "content": { "key": "memo-title", "role": "headline", "text": "今季の飼育メモ" } },
            { "type": "text", "content": { "key": "memo-body", "role": "body", "text": "梅雨明け後は28℃超に注意。ケース内の蒸れ対策を。" } }
          ] }
        ],
        "body": [
          { "key": "roster", "size": "full", "blocks": [
            { "type": "text", "content": { "key": "roster-title", "role": "headline", "text": "飼育一覧" } },
            { "type": "specimen_list", "content": { "key": "roster-list" } }
          ] }
        ],
        "footer": []
      }
    }
  }
}
$json$::jsonb);

-- 個体詳細ページ(SDUI定義・全個体で共有、?specimen= コンテキストで解決)
INSERT INTO page_definitions (page_key, definition) VALUES ('specimen_detail', $json$
{
  "schemaVersion": 1,
  "page": {
    "template": "feed",
    "content": {
      "regions": {
        "header": [
          { "key": "profile", "size": "full", "blocks": [
            { "type": "specimen_profile", "content": { "key": "profile-main" } }
          ] }
        ],
        "body": [
          { "key": "logs", "size": "full", "blocks": [
            { "type": "text", "content": { "key": "logs-title", "role": "headline", "text": "飼育記録" } },
            { "type": "care_log_list", "content": { "key": "logs-list" } }
          ] },
          { "key": "species-note", "size": "half", "blocks": [
            { "type": "text", "content": { "key": "note-title", "role": "headline", "text": "種の飼育メモ" } },
            { "type": "species_note", "content": { "key": "note-body" } }
          ] },
          { "key": "photo", "size": "half", "blocks": [
            { "type": "text", "content": { "key": "photo-title", "role": "headline", "text": "写真" } },
            { "type": "text", "content": { "key": "photo-note", "role": "caption", "text": "写真アップロードは準備中です。" } }
          ] }
        ],
        "footer": []
      }
    }
  }
}
$json$::jsonb);
