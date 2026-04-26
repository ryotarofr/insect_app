-- 0002_master_data.sql — マスタ系テーブル (Phase 9.A / DB設計書 v2 §3.1)
--
-- ops が日常編集する低頻度書き換えのマスタ系を整理する:
--   - species             : 種マスタ (text PK = "dhh" 等)
--   - species_translations: 種名の locale 別表記
--   - shops               : ショップマスタ
--   - prefectures         : 47 都道府県
--   - shipping_methods    : 配送方法マスタ (text PK = "cold" / "normal")
--   - shipping_method_translations: 配送方法の locale 別文言
--
-- **設計判断** (= db-schema-design.md §2):
--   - 半固定マスタ (species / prefectures / shipping_methods) は **text PK 直接**
--     (= 短く ops が変えない / URL に乗らない)
--   - i18n は translation サブテーブル分離 (= en 追加が ALTER 不要)
--   - shops は UUID PK + public_id (= URL に "anchor-beetle" として乗りうる)
--   - 新規テーブルから `gen_random_uuid()` 採用 (= PG 13+ built-in / Aurora 互換)
--   - `set_updated_at()` トリガ関数は 0001_initial.sql で定義済み
--
-- **Phase 9.B (= 0003_products.sql) で species_id を FK 参照**するため、
-- 本 migration の seed (= 5 種) が先に入っていることが前提。

-- ──────────────────────────────────────────────────────────────────────
-- species: 種マスタ
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE species (
    id          TEXT PRIMARY KEY,                       -- "dhh" / "cat" 等の短い slug
    sci_name    TEXT NOT NULL,                          -- 学名 "Dynastes hercules hercules"
    region      TEXT NOT NULL,                          -- "中南米" / "東南アジア" 等
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_species_updated
    BEFORE UPDATE ON species
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE species_translations (
    species_id  TEXT NOT NULL REFERENCES species(id) ON DELETE CASCADE,
    locale      TEXT NOT NULL,                          -- "ja" / "en"
    name        TEXT NOT NULL,                          -- "ヘラクレスオオカブト"
    PRIMARY KEY (species_id, locale)
);

-- ──────────────────────────────────────────────────────────────────────
-- shops: ショップマスタ
-- ──────────────────────────────────────────────────────────────────────
-- 将来「複数ショップが商品を出す」可能性 → products.shop_id NOT NULL を最初から要求。
-- MVP では 1 行 (= ANCHOR BEETLE CO.) しか入らないが構造は拡張可能にしておく。
CREATE TABLE shops (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id   TEXT NOT NULL UNIQUE,                   -- "anchor-beetle"
    name        TEXT NOT NULL,                          -- "ANCHOR BEETLE CO."
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shops_active ON shops (is_active);

CREATE TRIGGER trg_shops_updated
    BEFORE UPDATE ON shops
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- prefectures: 47 都道府県
-- ──────────────────────────────────────────────────────────────────────
-- code は JIS X 0401 (= "01" 〜 "47" の zero-pad)。
-- name_ja / name_en の両方を最初から持つ (= レビュー Low #4 の方針)。
CREATE TABLE prefectures (
    code        TEXT PRIMARY KEY,                       -- "01" 〜 "47"
    name_ja     TEXT NOT NULL,                          -- "北海道"
    name_en     TEXT,                                   -- "Hokkaido"
    sort_order  INTEGER NOT NULL                        -- JIS 順 1〜47
);

-- ──────────────────────────────────────────────────────────────────────
-- shipping_methods: 配送方法マスタ
-- ──────────────────────────────────────────────────────────────────────
-- 既存 server::handlers::checkout::SHIPPING_METHODS の DB 化:
--   - "cold"   : 温度制御便（推奨）/ 1800 円
--   - "normal" : 通常便           /  800 円
--
-- amount_jpy は migration 投入時の値。ops が UPDATE で変更可能。
-- name / description は i18n テーブル経由で取得 (= en 対応の余地)。
CREATE TABLE shipping_methods (
    id              TEXT PRIMARY KEY,                   -- "cold" / "normal"
    sort_order      INTEGER NOT NULL DEFAULT 0,         -- UI 表示順
    amount_jpy      BIGINT NOT NULL CHECK (amount_jpy >= 0),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    -- audit (= レビュー Medium #5)
    created_by      UUID,                               -- FK は 0004 で後付け
    updated_by      UUID,
    version         INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shipping_methods_active ON shipping_methods (is_active, sort_order);

CREATE TRIGGER trg_shipping_methods_updated
    BEFORE UPDATE ON shipping_methods
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE shipping_method_translations (
    method_id   TEXT NOT NULL REFERENCES shipping_methods(id) ON DELETE CASCADE,
    locale      TEXT NOT NULL,
    name        TEXT NOT NULL,                          -- "温度制御便（推奨）"
    description TEXT,                                   -- "生体含むため必須設定 · 15〜25℃"
    PRIMARY KEY (method_id, locale)
);

-- ──────────────────────────────────────────────────────────────────────
-- seed: species 5 件
-- ──────────────────────────────────────────────────────────────────────
INSERT INTO species (id, sci_name, region) VALUES
  ('dhh', 'Dynastes hercules hercules', '中南米'),
  ('cat', 'Chalcosoma chiron',          '東南アジア'),
  ('aki', 'Megasoma actaeon',           '南米'),
  ('nat', 'Trypoxylus dichotomus',      '日本'),
  ('neo', 'Dynastes neptunus',          '南米');

INSERT INTO species_translations (species_id, locale, name) VALUES
  ('dhh', 'ja', 'ヘラクレスオオカブト'),
  ('cat', 'ja', 'コーカサスオオカブト'),
  ('aki', 'ja', 'アクタエオンゾウカブト'),
  ('nat', 'ja', '国産カブトムシ'),
  ('neo', 'ja', 'ネプチューンオオカブト');

-- ──────────────────────────────────────────────────────────────────────
-- seed: shipping_methods 2 件 + 翻訳
-- ──────────────────────────────────────────────────────────────────────
INSERT INTO shipping_methods (id, sort_order, amount_jpy, is_active) VALUES
  ('cold',   0, 1800, true),
  ('normal', 1,  800, true);

INSERT INTO shipping_method_translations (method_id, locale, name, description) VALUES
  ('cold',   'ja', '温度制御便（推奨）', '生体含むため必須設定 · 15〜25℃'),
  ('normal', 'ja', '通常便',              '用品のみ・常温配送');

-- ──────────────────────────────────────────────────────────────────────
-- seed: shops 1 件
-- ──────────────────────────────────────────────────────────────────────
INSERT INTO shops (public_id, name, description) VALUES
  ('anchor-beetle', 'ANCHOR BEETLE CO.', '生体・幼虫の総合ショップ');

-- ──────────────────────────────────────────────────────────────────────
-- seed: 47 都道府県 (JIS X 0401 順)
-- ──────────────────────────────────────────────────────────────────────
INSERT INTO prefectures (code, name_ja, name_en, sort_order) VALUES
  ('01', '北海道',   'Hokkaido',  1),
  ('02', '青森県',   'Aomori',    2),
  ('03', '岩手県',   'Iwate',     3),
  ('04', '宮城県',   'Miyagi',    4),
  ('05', '秋田県',   'Akita',     5),
  ('06', '山形県',   'Yamagata',  6),
  ('07', '福島県',   'Fukushima', 7),
  ('08', '茨城県',   'Ibaraki',   8),
  ('09', '栃木県',   'Tochigi',   9),
  ('10', '群馬県',   'Gunma',    10),
  ('11', '埼玉県',   'Saitama',  11),
  ('12', '千葉県',   'Chiba',    12),
  ('13', '東京都',   'Tokyo',    13),
  ('14', '神奈川県', 'Kanagawa', 14),
  ('15', '新潟県',   'Niigata',  15),
  ('16', '富山県',   'Toyama',   16),
  ('17', '石川県',   'Ishikawa', 17),
  ('18', '福井県',   'Fukui',    18),
  ('19', '山梨県',   'Yamanashi',19),
  ('20', '長野県',   'Nagano',   20),
  ('21', '岐阜県',   'Gifu',     21),
  ('22', '静岡県',   'Shizuoka', 22),
  ('23', '愛知県',   'Aichi',    23),
  ('24', '三重県',   'Mie',      24),
  ('25', '滋賀県',   'Shiga',    25),
  ('26', '京都府',   'Kyoto',    26),
  ('27', '大阪府',   'Osaka',    27),
  ('28', '兵庫県',   'Hyogo',    28),
  ('29', '奈良県',   'Nara',     29),
  ('30', '和歌山県', 'Wakayama', 30),
  ('31', '鳥取県',   'Tottori',  31),
  ('32', '島根県',   'Shimane',  32),
  ('33', '岡山県',   'Okayama',  33),
  ('34', '広島県',   'Hiroshima',34),
  ('35', '山口県',   'Yamaguchi',35),
  ('36', '徳島県',   'Tokushima',36),
  ('37', '香川県',   'Kagawa',   37),
  ('38', '愛媛県',   'Ehime',    38),
  ('39', '高知県',   'Kochi',    39),
  ('40', '福岡県',   'Fukuoka',  40),
  ('41', '佐賀県',   'Saga',     41),
  ('42', '長崎県',   'Nagasaki', 42),
  ('43', '熊本県',   'Kumamoto', 43),
  ('44', '大分県',   'Oita',     44),
  ('45', '宮崎県',   'Miyazaki', 45),
  ('46', '鹿児島県', 'Kagoshima',46),
  ('47', '沖縄県',   'Okinawa',  47);
