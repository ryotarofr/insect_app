-- specimen_list を group_tabs + specimen_rows に分割する(SDUI改修 Phase 2)。
-- 選択タブはページコンテキスト(?group= → HydrateCtx.group)へ移り、hydrate は
-- 選択グループの行だけを解決するようになる。カード構成が初めて定義から見える。
--
-- roster-title の editable 等ユーザ編集済みフィールドに触れないよう、対象ブロックのみ操作:
--   blocks[2](specimen_list)を削除 → 末尾に group_tabs / specimen_rows を追記。
-- 0017 適用後の想定形(blocks = [title, action_button, specimen_list])でのみ実行
-- (形が違う環境では no-op。必要なら PUT /api/pages/care で同構成を投入して回復する)。
-- 旧ブロック specimen_list は後方互換のため語彙には残っている(非推奨)。

UPDATE page_definitions
SET definition = jsonb_insert(
        jsonb_insert(
            definition #- '{page,content,regions,body,0,blocks,2}',
            '{page,content,regions,body,0,blocks,-1}',
            $json${ "type": "group_tabs", "content": { "key": "roster-tabs" } }$json$::jsonb,
            true),
        '{page,content,regions,body,0,blocks,-1}',
        $json${ "type": "specimen_rows", "content": { "key": "roster-rows" } }$json$::jsonb,
        true),
    updated_at = now(),
    updated_by = 'migration:0018'
WHERE page_key = 'care'
  AND definition #> '{page,content,regions,body,0,key}' = '"roster"'::jsonb
  AND definition #> '{page,content,regions,body,0,blocks,2,type}' = '"specimen_list"'::jsonb;
