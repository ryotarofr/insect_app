-- デモ/テストデータの一斉整理。
--
-- 削除するもの: 出品(seedデモ含む全件)/ 個体(飼育記録はCASCADEで一緒に消える)/ 種メモ
-- 残すもの:     ユーザ・セッション / タブ(specimen_groups)/ 画面定義(page_definitions)
--
-- 順序: listings.specimen_id が ON DELETE RESTRICT のため、出品 → 個体の順で消す。
-- 以後、新規DB(docker compose down -v)でも 0001/0002 の seed はこの migration で消える
-- = どの環境でも「空のデータ + 画面定義」から始まる。

DELETE FROM listings;
DELETE FROM specimens;
DELETE FROM species_notes;
