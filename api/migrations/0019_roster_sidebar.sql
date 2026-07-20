-- 飼育一覧カードを sidebar レイアウトに(SDUI改修 Phase 3)。
-- 「タブ左・行リスト右」の横並びを閉じたレイアウトトークンとして定義側から表現する:
--   見出し(text)と action_button = 全幅の前置行 / group_tabs = 側柱 / specimen_rows = 本体。
-- これで分解図の5部位のうち、固定コードに残るのはフォームの中身だけになる(REFACTOR §4)。
-- layout を外せば(または "stack" にすれば)縦積みへ戻る — レイアウトも定義の運用対象。

UPDATE page_definitions
SET definition = jsonb_set(definition, '{page,content,regions,body,0,layout}', '"sidebar"'),
    updated_at = now(),
    updated_by = 'migration:0019'
WHERE page_key = 'care'
  AND definition #> '{page,content,regions,body,0,key}' = '"roster"'::jsonb;
