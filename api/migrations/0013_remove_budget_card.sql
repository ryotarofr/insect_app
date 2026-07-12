-- ホームから「お手頃価格の出品」カードを削除(定義変更のみ・コード変更なし)。
-- 誤削除防止のため、body[2] が本当に budget カードである場合のみ実行する。
-- (0001のseedから budget カードを外した環境では no-op になる)

UPDATE page_definitions
SET definition = definition #- '{page,content,regions,body,2}',
    updated_at = now(),
    updated_by = 'migration:0013'
WHERE page_key = 'home'
  AND definition #> '{page,content,regions,body,2,key}' = '"budget"'::jsonb;
