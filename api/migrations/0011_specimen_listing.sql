-- 個体⇔出品の紐付け(飼育詳細からの出品機能)。
--
-- - specimen_id は ON DELETE RESTRICT: 出品が残っている個体は削除できない
--   (将来個体削除を作った時、「一覧に存在しない個体の出品」を制約レベルで防ぐ)
-- - 1個体につき出品中(active)は1件まで(部分ユニークインデックス)
-- - 既存seed出品は specimen_id / seller_id が NULL のまま = 市場のデモデータ扱い

ALTER TABLE listings
    ADD COLUMN specimen_id uuid REFERENCES specimens(id) ON DELETE RESTRICT,
    ADD COLUMN seller_id   uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX listings_active_specimen_idx
    ON listings (specimen_id)
    WHERE status = 'active';

CREATE INDEX listings_seller_idx ON listings (seller_id);

-- 飼育管理の「出品中」カードを自分の出品のみに(seller: "mine" を additive 追加)
UPDATE page_definitions
SET definition = jsonb_set(
        definition,
        '{page,content,regions,body,1,blocks,2,content,query,seller}',
        '"mine"'
    ),
    updated_at = now(),
    updated_by = 'migration:0011'
WHERE page_key = 'care';

-- 個体詳細に「出品」カードを挿入(飼育記録の直後 = body index 1 の位置)
UPDATE page_definitions
SET definition = jsonb_insert(
        definition,
        '{page,content,regions,body,1}',
        $json$
        { "key": "selling", "size": "full", "blocks": [
          { "type": "text", "content": { "key": "selling-title", "role": "headline", "text": "出品" } },
          { "type": "listing_settings", "content": { "key": "selling-settings" } }
        ] }
        $json$::jsonb
    ),
    updated_at = now(),
    updated_by = 'migration:0011'
WHERE page_key = 'specimen_detail';
