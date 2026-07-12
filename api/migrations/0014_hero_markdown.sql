-- ホームのheroカードの本文(text lead)を markdown ブロックに差し替え(定義変更のみ)。
-- 誤置換防止のため、対象が本当に hero-lead の場合のみ実行する。

UPDATE page_definitions
SET definition = jsonb_set(
        definition,
        '{page,content,regions,header,0,blocks,1}',
        $json$
        { "type": "markdown", "content": {
            "key": "hero-md",
            "markdown": "今週の新着から、状態の良い個体を中心にピックアップしました。\n\n- **ヘラクレスヘラクレス** ♂145mm ― 完品・後食開始済み\n- 蛹・幼虫の出品も順次追加予定\n\n気になる個体は [飼育管理](/care) から記録も確認できます。",
            "editable": true
        } }
        $json$::jsonb
    ),
    updated_at = now(),
    updated_by = 'migration:0014'
WHERE page_key = 'home'
  AND definition #> '{page,content,regions,header,0,blocks,1,content,key}' = '"hero-lead"'::jsonb;
