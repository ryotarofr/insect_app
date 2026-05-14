-- 0023_assets_target_kind_listing.sql — assets.target_kind に 'listing' を追加 (Phase 6b / 出品作成 wizard)
--
-- **背景**:
--   出品 wizard で 4 スロットの写真アップロードを実装するにあたり、`assets.target_kind` に
--   `'listing'` を許可する必要がある。
--
--   既存 CHECK は `('specimen', 'product', 'specimen_log')` で、'product' は C2C pivot
--   (migration 0021) で廃止済 (= products テーブル自体が DROP されている)。MVP では
--   'product' を残しておいても害はないが、将来の整理コスト削減のため本 migration で
--   一緒に外す。
--
-- **手順**:
--   1. 旧 CHECK 制約を DROP (= 名前は PostgreSQL の自動採番 `assets_target_kind_check`)
--   2. 新 CHECK を ADD (= 'specimen', 'specimen_log', 'listing')
--
-- **注意**:
--   既存データに 'product' が混入している場合、新 CHECK 適用時に NOT VALID なしだと
--   ALTER が失敗する。ただし migration 0021 で products テーブルが消えており、product 紐付け
--   asset は GC 済の前提。実環境で残っていれば事前に DELETE / UPDATE する必要あり。

ALTER TABLE assets
    DROP CONSTRAINT IF EXISTS assets_target_kind_check;

ALTER TABLE assets
    ADD CONSTRAINT assets_target_kind_check
    CHECK (target_kind IN ('specimen', 'specimen_log', 'listing'));
