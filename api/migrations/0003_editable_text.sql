-- text ブロックへの editable 付与(ホーム以外)。
-- editable は「人間向け編集UIを出すか」の宣言(進化規約1に沿った additive フィールド)。
-- 注: seed時の構造(カード/ブロックの位置)を前提にした jsonb_set。テキスト内容は保持される。

UPDATE page_definitions
SET definition = jsonb_set(jsonb_set(jsonb_set(definition,
        '{page,content,regions,header,0,blocks,0,content,editable}', 'true'),
        '{page,content,regions,header,0,blocks,1,content,editable}', 'true'),
        '{page,content,regions,body,0,blocks,0,content,editable}', 'true'),
    updated_at = now(),
    updated_by = 'migration:0003'
WHERE page_key = 'care';

UPDATE page_definitions
SET definition = jsonb_set(jsonb_set(jsonb_set(jsonb_set(definition,
        '{page,content,regions,body,0,blocks,0,content,editable}', 'true'),
        '{page,content,regions,body,1,blocks,0,content,editable}', 'true'),
        '{page,content,regions,body,2,blocks,0,content,editable}', 'true'),
        '{page,content,regions,body,2,blocks,1,content,editable}', 'true'),
    updated_at = now(),
    updated_by = 'migration:0003'
WHERE page_key = 'specimen_detail';
