-- 「+ 個体を追加」ボタンをフロント固定コードから定義(DB)へ移す(SDUI改修 Phase 1)。
-- careの「飼育一覧」カード(roster)の見出し直後・specimen_list の手前に action_button を挿入。
-- 振る舞いは閉じた動詞 add_specimen(実装は care ページの actions provider)。
--
-- 誤挿入防止のため、body[0] が roster かつ blocks[1] が specimen_list の場合のみ実行
-- (定義はユーザ編集され得る実行時データ。形が違う環境では no-op とし、
--  必要なら PUT /api/pages/care で同ブロックを投入して回復する — それ自体がこの機能の主旨)。

UPDATE page_definitions
SET definition = jsonb_insert(
        definition,
        '{page,content,regions,body,0,blocks,1}',
        $json${ "type": "action_button", "content": {
          "key": "roster-add", "intent": "secondary",
          "label": "＋ 個体を追加", "action": "add_specimen" } }$json$::jsonb
    ),
    updated_at = now(),
    updated_by = 'migration:0017'
WHERE page_key = 'care'
  AND definition #> '{page,content,regions,body,0,key}' = '"roster"'::jsonb
  AND definition #> '{page,content,regions,body,0,blocks,1,type}' = '"specimen_list"'::jsonb;
