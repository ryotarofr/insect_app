-- デザイン刷新に伴い、ホームの「はじめての飼育ガイド」カードを反転(accent)トーンにする。
-- tone は additive なセマンティックトークン(def.rs CardTone)。定義更新のみで反映される。

UPDATE page_definitions
SET definition = jsonb_set(definition, '{page,content,regions,body,1,tone}', '"accent"'),
    updated_at = now(),
    updated_by = 'migration:0008'
WHERE page_key = 'home';
