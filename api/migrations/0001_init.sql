-- SDUI POC: 画面定義テーブル + 最小の出品テーブル + seed
--
-- page_definitions.definition が「画面」の実体。
-- メタデータは JSONB に入れず DB カラムで持つ(定義本体をポータブルに保つ)。

CREATE TABLE page_definitions (
    page_key   text PRIMARY KEY,
    definition jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL DEFAULT 'seed'
);

CREATE TABLE listings (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title        text NOT NULL,
    price_amount bigint NOT NULL,
    image_src    text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO listings (title, price_amount, created_at) VALUES
    ('ヘラクレスヘラクレス ♂ 145mm 完品', 58000, now() - interval '1 hour'),
    ('ニジイロクワガタ ペア(累代CB)',      8800, now() - interval '5 hour'),
    ('オオクワガタ 能勢YG ♂ 82mm',        24000, now() - interval '1 day'),
    ('パプアキンイロクワガタ ♀ 単品',       2400, now() - interval '2 day'),
    ('ギラファノコギリクワガタ 幼虫 3頭',    3600, now() - interval '3 day'),
    ('タランドゥスオオツヤクワガタ ♂ 78mm', 15800, now() - interval '4 day'),
    ('コーカサスオオカブト ♂ 118mm',       12000, now() - interval '5 day'),
    ('ヘラクレス幼虫 2令 マット飼育',        4500, now() - interval '6 day');

-- ホーム画面の初期定義(adjacently-tagged / Page → Region → Card → Block)
INSERT INTO page_definitions (page_key, definition) VALUES ('home', $json$
{
  "schemaVersion": 1,
  "page": {
    "template": "feed",
    "content": {
      "regions": {
        "header": [
          { "key": "hero", "size": "full", "blocks": [
            { "type": "text", "content": { "key": "hero-title", "role": "headline", "text": "夏のヘラクレス特集" } },
            { "type": "text", "content": { "key": "hero-lead", "role": "lead", "text": "今週の新着から、状態の良い個体を中心にピックアップしました。" } }
          ] }
        ],
        "body": [
          { "key": "new-arrivals", "size": "full", "blocks": [
            { "type": "text", "content": { "key": "na-title", "role": "headline", "text": "新着の出品" } },
            { "type": "listing_grid", "content": { "key": "na-grid", "query": { "sort": "newest", "limit": 6 } } }
          ] },
          { "key": "guide", "size": "half", "blocks": [
            { "type": "text", "content": { "key": "guide-title", "role": "headline", "text": "はじめての飼育ガイド" } },
            { "type": "text", "content": { "key": "guide-text", "role": "caption", "text": "マット交換の頻度、温度管理、産卵セットの組み方まで。" } },
            { "type": "cta", "content": { "key": "guide-link", "intent": "secondary", "label": "ガイドを読む", "href": "/guide" } }
          ] }
        ],
        "footer": [
          { "key": "footer-cta", "size": "full", "blocks": [
            { "type": "cta", "content": { "key": "all-listings", "intent": "primary", "label": "すべての出品を見る", "href": "/listings" } }
          ] }
        ]
      }
    }
  }
}
$json$::jsonb);
