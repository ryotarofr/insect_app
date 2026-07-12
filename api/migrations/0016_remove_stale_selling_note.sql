-- 飼育管理「出品中」カードの注記を削除。
-- 「個体との紐付け・出品フローは今後実装」という文言は 0011 で実装済みとなり死文化したため。
-- 対象が本当に selling-note の場合のみ実行する。

UPDATE page_definitions
SET definition = definition #- '{page,content,regions,body,1,blocks,1}',
    updated_at = now(),
    updated_by = 'migration:0016'
WHERE page_key = 'care'
  AND definition #> '{page,content,regions,body,1,blocks,1,content,key}' = '"selling-note"'::jsonb;
