-- カードビルダーの入口(閉じた動詞の2例目 add_card)。共有 care の footer に配置。
-- ボタンの存在・位置・文言は定義 = 運用対象(Phase 1 の action_button 機構をそのまま利用)。
-- すでに page-tools カードがある環境では no-op。

UPDATE page_definitions
SET definition = jsonb_insert(
        definition,
        '{page,content,regions,footer,-1}',
        $json${ "key": "page-tools", "size": "full", "blocks": [
          { "type": "action_button", "content": {
              "key": "add-card", "intent": "secondary",
              "label": "＋ カードを追加", "action": "add_card" } }
        ] }$json$::jsonb,
        true
    ),
    updated_at = now(),
    updated_by = 'migration:0021'
WHERE page_key = 'care'
  AND NOT (definition #> '{page,content,regions,footer}' @> '[{"key": "page-tools"}]'::jsonb);
