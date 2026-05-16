-- 0019_product_bloodlines.sql — 商品単位の血統情報 (= /products/:id の購入動線で表示)
--
-- **目的**:
--   フロント `client_solid/src/components/products/bloodline-fixture.ts` の
--   `PRODUCT_BLOODLINE` (4 商品分の手書き fixture) を DB 化する。
--
-- **本 migration の範囲**:
--   - `product_bloodlines`           : 商品ごとの血統サマリ (1:1 with products)
--   - `product_bloodline_ancestors`  : 親 / 祖父母までの 6 役割 × 商品の系図ノード
--
-- **対象**:
--   `kind: "live"` の商品のみ (用品にはぶら下がらない)。本 migration 自体では
--   kind 制約を CHECK で書かず、application 側で「supply 商品には INSERT しない」
--   運用で守る (= 互換性を狭くしすぎない)。
--
-- **設計判断**:
--   - `product_bloodlines.product_id` を PK にして 1:1 を強制
--   - `inbreeding_coef` は NUMERIC(5,4) (= 0.0625 等の精度を保つ; 0..1 範囲)
--   - `ancestors` は別テーブル + role enum: 6 行までフラットに持たせる
--     (= JSONB より探索しやすく、整合性は CHECK で担保できる)
--   - role に CHECK を入れて入力値を 6 種に固定
--   - sex は specimens テーブルと違って 'm' / 'f' のショート表記をそのまま採用
--     (= フロント `BlAncestor.sex` 型と完全一致 / 内部用変換を避ける)

-- ──────────────────────────────────────────────────────────────────────
-- product_bloodlines: 商品ごとの血統サマリ
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE product_bloodlines (
    product_id              UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    -- 商品自身の世代タグ ("CBF2" / "WF1" 等)
    generation              TEXT NOT NULL,
    -- 近交係数 (Wright's F)。0..1 の範囲。
    inbreeding_coef         NUMERIC(5,4) NOT NULL CHECK (inbreeding_coef >= 0 AND inbreeding_coef <= 1),
    -- 認証バッジ
    breeder_certified       BOOLEAN NOT NULL DEFAULT false,
    third_party_verified    BOOLEAN NOT NULL DEFAULT false,
    -- 起源・累代の要約 (= 商品詳細でフル表示 / サマリで 2 行)
    pedigree_notes          TEXT NOT NULL DEFAULT '',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_product_bloodlines_updated
    BEFORE UPDATE ON product_bloodlines
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- product_bloodline_ancestors: 親 / 祖父母 (= 6 役割)
-- ──────────────────────────────────────────────────────────────────────
-- 1 商品につき role ごとに最大 1 行。父母は必須運用 (= application で保証)、
-- 祖父母 4 役割は任意 (= 揃わない商品もある = `p-aki` の WF1 など)。
CREATE TABLE product_bloodline_ancestors (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID NOT NULL REFERENCES product_bloodlines(product_id) ON DELETE CASCADE,
    role                TEXT NOT NULL CHECK (role IN (
        'father', 'mother',
        'paternal_father', 'paternal_mother',
        'maternal_father', 'maternal_mother'
    )),
    -- 表示 ID (= "#DHH-0150" / "#WILD-DHH-A" 等)。specimens.public_id とは別空間。
    ancestor_public_id  TEXT NOT NULL,
    name                TEXT NOT NULL,
    -- specimens は 'male'/'female'/'unknown' だが、本テーブルは表示直結なので 'm'/'f' で持つ。
    sex                 TEXT NOT NULL CHECK (sex IN ('m', 'f')),
    -- 世代タグ ("WILD" / "F0" / "CBF1" 等の自由文字列)
    generation_label    TEXT NOT NULL,
    size_mm             NUMERIC(5,1),
    is_wild             BOOLEAN NOT NULL DEFAULT false,
    -- 「故 (2025-10-02)」のような死亡注記。サマリでは非表示、modal で表示。
    deceased_note       TEXT,
    UNIQUE (product_id, role)
);

CREATE INDEX idx_product_bloodline_ancestors_product
    ON product_bloodline_ancestors (product_id);

-- ──────────────────────────────────────────────────────────────────────
-- seed: フロント PRODUCT_BLOODLINE の 4 商品を移植
-- ──────────────────────────────────────────────────────────────────────
-- 元値: client_solid/src/components/products/bloodline-fixture.ts:73 以降
--
-- 値の対応:
--   - inbreedingCoef → inbreeding_coef
--   - breederCertified → breeder_certified
--   - thirdPartyVerified → third_party_verified
--   - pedigreeNotes → pedigree_notes
--   - father / mother / grandparents.* → product_bloodline_ancestors の 6 役割

INSERT INTO product_bloodlines (
    product_id, generation, inbreeding_coef,
    breeder_certified, third_party_verified, pedigree_notes
) VALUES
  -- p-hh-m-142: ヘラクレス CBF2
  ((SELECT id FROM products WHERE public_id = 'p-hh-m-142'),
   'CBF2', 0.0500, true, false,
   'ANCHOR BEETLE CO. 自家累代。父系は 2019 グアドループ産 WILD から 3 代目。母系は ANCHOR BEETLE CO. 自家累代 F0。F値 0.05 で安全圏内。'),
  -- p-cat-l: コーカサス CBF3
  ((SELECT id FROM products WHERE public_id = 'p-cat-l'),
   'CBF3', 0.0800, true, false,
   'ANCHOR BEETLE CO. 自家累代 CBF3。父系・母系ともに KUWAGATA.jp 由来 F0 ペアから。F値 0.08 で「注意」域。次サイクルは別系統との交配を推奨。'),
  -- p-neo-m: ネプチューン CBF2
  ((SELECT id FROM products WHERE public_id = 'p-neo-m'),
   'CBF2', 0.0000, true, true,
   'MIYAMA FARM 自家累代 CBF2。父系・母系ともに別系統の MIYAMA FARM F0 ペア。F値 0.00 で完全に安全圏。第三者血統認証済。'),
  -- p-aki: アクタエオン WF1 (祖父母不明)
  ((SELECT id FROM products WHERE public_id = 'p-aki'),
   'WF1', 0.0000, true, true,
   'MIYAMA FARM が 2024 年に直輸入した WILD ペアから採れた WF1。両親ともペルー産野生個体で完全血統不明 + F値 0.00。第三者認証済。');

-- p-hh-m-142 の祖先 6 役割 (祖父母 4 含む / 母方は WILD ペア)
INSERT INTO product_bloodline_ancestors (
    product_id, role, ancestor_public_id, name, sex, generation_label, size_mm, is_wild, deceased_note
) VALUES
  ((SELECT id FROM products WHERE public_id = 'p-hh-m-142'),
   'father', '#DHH-0213', '漆黒', 'm', 'CBF1', 152.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-hh-m-142'),
   'mother', '#DHH-0244', 'マリア', 'f', 'F0', 66.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-hh-m-142'),
   'paternal_father', '#DHH-0150', '月影', 'm', 'F0', 148.0, false, '故 (2025-10-02)'),
  ((SELECT id FROM products WHERE public_id = 'p-hh-m-142'),
   'paternal_mother', '#DHH-0204', '花音', 'f', 'F0', 68.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-hh-m-142'),
   'maternal_father', '#WILD-DHH-A', '野生 ♂', 'm', 'WILD', NULL, true, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-hh-m-142'),
   'maternal_mother', '#WILD-DHH-B', '野生 ♀', 'f', 'WILD', NULL, true, NULL);

-- p-cat-l の祖先 (sibling 交配で母方祖父母 = 父方祖父母と同個体)
INSERT INTO product_bloodline_ancestors (
    product_id, role, ancestor_public_id, name, sex, generation_label, size_mm, is_wild, deceased_note
) VALUES
  ((SELECT id FROM products WHERE public_id = 'p-cat-l'),
   'father', '#CAT-0118', '雷', 'm', 'CBF1', 95.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-cat-l'),
   'mother', '#CAT-0089', '雪', 'f', 'CBF1', 50.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-cat-l'),
   'paternal_father', '#CAT-0091', '嵐', 'm', 'F0', 110.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-cat-l'),
   'paternal_mother', '#CAT-0097', '蘭', 'f', 'F0', 60.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-cat-l'),
   'maternal_father', '#CAT-0091', '嵐', 'm', 'F0', 110.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-cat-l'),
   'maternal_mother', '#CAT-0097', '蘭', 'f', 'F0', 60.0, false, NULL);

-- p-neo-m の祖先 (母方祖父母 = WILD ペア)
INSERT INTO product_bloodline_ancestors (
    product_id, role, ancestor_public_id, name, sex, generation_label, size_mm, is_wild, deceased_note
) VALUES
  ((SELECT id FROM products WHERE public_id = 'p-neo-m'),
   'father', '#NEO-0058', '青嵐', 'm', 'CBF1', 102.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-neo-m'),
   'mother', '#NEO-0024', '凜', 'f', 'F0', 68.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-neo-m'),
   'paternal_father', '#NEO-0011', '蒼', 'm', 'F0', 125.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-neo-m'),
   'paternal_mother', '#NEO-0007', '翠', 'f', 'F0', 65.0, false, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-neo-m'),
   'maternal_father', '#WILD-NEO-A', '野生 ♂', 'm', 'WILD', NULL, true, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-neo-m'),
   'maternal_mother', '#WILD-NEO-B', '野生 ♀', 'f', 'WILD', NULL, true, NULL);

-- p-aki の祖先 (WF1 = 祖父母不明 = 父母 2 役割のみ)
INSERT INTO product_bloodline_ancestors (
    product_id, role, ancestor_public_id, name, sex, generation_label, size_mm, is_wild, deceased_note
) VALUES
  ((SELECT id FROM products WHERE public_id = 'p-aki'),
   'father', '#WILD-AKI-A', '野生 ♂ ペルー', 'm', 'WILD', NULL, true, NULL),
  ((SELECT id FROM products WHERE public_id = 'p-aki'),
   'mother', '#WILD-AKI-B', '野生 ♀ ペルー', 'f', 'WILD', NULL, true, NULL);
