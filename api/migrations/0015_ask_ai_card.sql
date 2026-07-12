-- ホームに「insect_app_r2 に質問」カードを追加(飼育ガイドの隣・half)。
-- AIへのサイトQ&A機能の予告枠。機能実装時はこのカードの caption を
-- 専用ブロック(例: ask_widget)に差し替えるだけでよい(配置は本migrationで確保済み)。

UPDATE page_definitions
SET definition = jsonb_insert(
        definition,
        '{page,content,regions,body,-1}',
        $json$
        { "key": "ask-ai", "size": "half", "blocks": [
          { "type": "text", "content": { "key": "ask-title", "role": "headline", "text": "insect_app_r2 に質問" } },
          { "type": "text", "content": { "key": "ask-body", "role": "body", "text": "出品や飼育方法など、このサイトについてAIに質問できる機能を準備しています。", "editable": true } },
          { "type": "text", "content": { "key": "ask-note", "role": "caption", "text": "近日公開", "editable": true } }
        ] }
        $json$::jsonb,
        true
    ),
    updated_at = now(),
    updated_by = 'migration:0015'
WHERE page_key = 'home';
