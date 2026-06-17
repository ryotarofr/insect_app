-- 0018_species_stats.sql — 種別の幼虫期 / 蛹期データ (Sprint 2 / N1 羽化予測)
--
-- **目的**:
--   `specimens.eclosion_eta` を「birth_date + larva_days + pupa_days」で自動算出するため、
--   種別の標準的な日数を持つマスタを準備する。
--
-- **設計判断**:
--   - **species_id を PK**: 1 species = 1 stats 行 (= 累代 / 飼育条件で日数差は無視)
--   - **将来の精度向上**: WF / CBF / 飼育温度等で日数を分けたい場合は (species_id, environment_key)
--     複合キーへ拡張する破壊的 migration を切る
--   - **CHECK 制約で正値強制**: 0 や負値は明らかに異常データ
--   - **seed 値は breeder community の代表値**: 実データ収集が進んだら ops 経由で更新する想定
--   - **set_updated_at() トリガ**: 0001 で定義済の関数を再利用
--
-- **依存**:
--   - 0002_master_data.sql (species テーブル + 5 件 seed)
--
-- **本テーブルが使われる場所** (= PR N-4 で配線):
--   - handler 側: specimens 作成 / stage 遷移時に compute_eta(species_id, birth_date) を呼ぶ
--   - worker 側: eclosion_daily で全 active specimen を再計算 + 7 日前判定 → email_outbox enqueue

CREATE TABLE species_stats (
    -- species への 1:1 link。0002 の text PK をそのまま使う。
    species_id      TEXT PRIMARY KEY REFERENCES species(id) ON DELETE CASCADE,
    -- 幼虫期 (= 卵孵化〜前蛹) の標準日数。breeder 報告値の中央値を採用。
    larva_days      INTEGER NOT NULL CHECK (larva_days > 0),
    -- 蛹期 (= 蛹化〜羽化) の標準日数。
    pupa_days       INTEGER NOT NULL CHECK (pupa_days > 0),
    -- データソース / メモ (= ops が更新理由を記録できるよう)。
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_species_stats_updated
    BEFORE UPDATE ON species_stats
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- seed: 0002_master_data.sql に登録された 5 種の標準日数
-- ──────────────────────────────────────────────────────────────────────
-- 値は breeder community の代表値で **暫定**:
--   - dhh (ヘラクレス):     幼虫 ~18 ヶ月 / 蛹 ~3 ヶ月  → 540 / 90
--   - cat (コーカサス):     幼虫 ~14 ヶ月 / 蛹 ~2 ヶ月  → 420 / 60
--   - aki (アクタエオン):   幼虫 ~24 ヶ月 / 蛹 ~3 ヶ月  → 720 / 90
--   - nat (国産カブトムシ): 幼虫 ~10 ヶ月 / 蛹 ~1 ヶ月  → 300 / 30
--   - neo (ネプチューン):   幼虫 ~18 ヶ月 / 蛹 ~3 ヶ月  → 540 / 90
-- 実データ収集が進んだら ops 側で `UPDATE species_stats SET ...` で精緻化する。
INSERT INTO species_stats (species_id, larva_days, pupa_days, note) VALUES
    ('dhh', 540, 90, 'breeder community 暫定値 (= 18ヶ月 + 3ヶ月)'),
    ('cat', 420, 60, 'breeder community 暫定値 (= 14ヶ月 + 2ヶ月)'),
    ('aki', 720, 90, 'breeder community 暫定値 (= 24ヶ月 + 3ヶ月)'),
    ('nat', 300, 30, 'breeder community 暫定値 (= 10ヶ月 + 1ヶ月)'),
    ('neo', 540, 90, 'breeder community 暫定値 (= 18ヶ月 + 3ヶ月)');
