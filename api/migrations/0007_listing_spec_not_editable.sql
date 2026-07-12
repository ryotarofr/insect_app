-- 出品詳細の「個体スペック」見出しから編集アフォーダンスを外す。
-- editable キーを削除(= default の false 扱い)するだけの定義変更で、コード変更なし。

UPDATE page_definitions
SET definition = definition #- '{page,content,regions,body,0,blocks,0,content,editable}',
    updated_at = now(),
    updated_by = 'migration:0007'
WHERE page_key = 'listing_detail';
