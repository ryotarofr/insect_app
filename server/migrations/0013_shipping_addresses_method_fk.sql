-- 0013_shipping_addresses_method_fk.sql — shipping_addresses.shipping_method_id に FK を付与
--
-- review fix (minor):
--   `shipping_addresses.shipping_method_id TEXT NOT NULL` (= 0001_initial.sql:L104) は
--   `shipping_methods(id)` (= 0002_master_data.sql 追加) を参照する想定で運用しているが、
--   FK 制約が無いため client / 内部 bug で無効値が混入しうる。歴史的注文の整合性
--   維持と「払い戻し計算で配送方法 ID から amount を引けない行が残る」事故を避けるため、
--   既存データを保護した上で追加 FK を貼る。
--
-- **追記原則** (= CODE_REVIEW_PROMPT §2.3):
--   既存ファイル (0001_initial.sql) は **編集しない**。新規 migration を 1 ファイル増やす。
--
-- **方針**:
--   1. 既存データに不整合 (= 参照先が存在しない shipping_method_id) があれば
--      ALTER は失敗する。先に診断クエリで残骸を確認しておくこと:
--        SELECT shipping_method_id FROM shipping_addresses
--        WHERE shipping_method_id NOT IN (SELECT id FROM shipping_methods);
--   2. ON DELETE RESTRICT: shipping_methods から行を消すには、参照している全 order の
--      shipping_addresses を作り直す必要がある (= 歴史的整合性を守る)。
--   3. ON UPDATE CASCADE: master の id 変更は通常起こらないが、起きた場合は子側を
--      自動追従させる (= 手作業の運用ミスを防ぐ)。

ALTER TABLE shipping_addresses
    ADD CONSTRAINT fk_shipping_addresses_method
        FOREIGN KEY (shipping_method_id)
        REFERENCES shipping_methods(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE;

-- 検索用 index (= JOIN 高速化 / 配送方法別の集計クエリで効く)。
-- shipping_method_id への filter は admin 集計で日常的に走るため、
-- FK 追加と同時に btree index を貼る (= FK 自動 index に頼らない)。
CREATE INDEX IF NOT EXISTS idx_shipping_addresses_method_id
    ON shipping_addresses (shipping_method_id);
