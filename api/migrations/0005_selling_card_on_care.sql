-- 出品一覧は独立ページにせず、飼育管理ページへ「出品中」カードを埋め込む。
-- 既存語彙(text + listing_grid)のみで構成できるため、この定義追記だけで完結
-- = 「コード変更ゼロの画面変更」(成功指標2)の実例。
-- jsonb_insert で body 末尾に追記(ユーザが編集済みの文言等は保持される)。

UPDATE page_definitions
SET definition = jsonb_insert(
        definition,
        '{page,content,regions,body,-1}',
        $json$
        { "key": "selling", "size": "full", "blocks": [
          { "type": "text", "content": { "key": "selling-title", "role": "headline", "text": "出品中", "editable": true } },
          { "type": "text", "content": { "key": "selling-note", "role": "caption", "text": "個体との紐付け・出品フローは今後実装。現在は新着の出品を表示しています。", "editable": true } },
          { "type": "listing_grid", "content": { "key": "selling-grid", "query": { "sort": "newest", "limit": 4 } } }
        ] }
        $json$::jsonb,
        true
    ),
    updated_at = now(),
    updated_by = 'migration:0005'
WHERE page_key = 'care';
