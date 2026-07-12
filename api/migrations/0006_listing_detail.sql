-- 出品詳細ページ: listings にスペック系カラムを追加し、listing_detail 定義を seed。
-- 定義1枚を全出品で共有し、?listing={id} コンテキストで解決する(specimen_detail と同型)。

ALTER TABLE listings
    ADD COLUMN scientific_name text,
    ADD COLUMN sex             text,
    ADD COLUMN size_note       text,
    ADD COLUMN line            text,
    ADD COLUMN locality        text,
    ADD COLUMN seller_comment  text,
    ADD COLUMN status          text NOT NULL DEFAULT 'active';

-- seed 補完(スペックが埋まっている例をいくつか作る。NULL の属性はチップ非表示)
UPDATE listings SET
    scientific_name = 'Dynastes hercules hercules',
    sex = '♂', size_note = '145mm', line = 'CB F2', locality = 'グアドループ',
    seller_comment = '羽化後3ヶ月、後食開始済み。ディンプル無しの完品です。'
WHERE title LIKE 'ヘラクレスヘラクレス ♂%';

UPDATE listings SET
    scientific_name = 'Phalacrognathus muelleri', line = 'CB',
    seller_comment = '発色の良いグリーン系ペアです。'
WHERE title LIKE 'ニジイロクワガタ%';

UPDATE listings SET
    scientific_name = 'Dorcus hopei binodulosus',
    sex = '♂', size_note = '82mm', line = '能勢YG CB'
WHERE title LIKE 'オオクワガタ%';

UPDATE listings SET status = 'trading'
WHERE title LIKE 'タランドゥス%';

-- 出品詳細ページ(SDUI定義・全出品で共有)
INSERT INTO page_definitions (page_key, definition) VALUES ('listing_detail', $json$
{
  "schemaVersion": 1,
  "page": {
    "template": "feed",
    "content": {
      "regions": {
        "header": [
          { "key": "hero", "size": "full", "blocks": [
            { "type": "listing_hero", "content": { "key": "hero-main" } }
          ] }
        ],
        "body": [
          { "key": "spec", "size": "full", "blocks": [
            { "type": "text", "content": { "key": "spec-title", "role": "headline", "text": "個体スペック", "editable": true } },
            { "type": "listing_spec", "content": { "key": "spec-chips" } }
          ] }
        ],
        "footer": []
      }
    }
  }
}
$json$::jsonb);
