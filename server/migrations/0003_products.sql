-- 0003_products.sql — 商品マスタ + 翻訳テーブル (Phase 9.B / DB設計書 v2 §3.2)
--
-- 既存の `server/src/handlers/cards.rs::product_filter_meta()` (= hardcoded
-- HashMap で 6 件) を DB 化する。本 migration が入れば handler 側を repo 経由
-- に切り替えるだけで済む。
--
-- **設計判断** (= db-schema-design.md §2 + レビュー対応):
--   - 内部 PK = UUID (gen_random_uuid)、URL slug = public_id (= "p-hh-m-142")
--   - badge は i18n 化 (= badge_kind enum + SDUI 辞書側で表示文字列管理)
--   - sex 値域は specimens と統一 (= male/female/unknown)、ペア販売は is_pair で別表現
--   - 計測値 (size_mm) は NUMERIC で表示信頼性確保
--   - audit (created_by/updated_by) + 楽観ロック (version) を最初から持つ
--   - 部分 index は MVP では通常 index、archived 比率を計測して Future Work で再検討
--
-- **0004_users.sql 依存**:
--   created_by / updated_by は users(id) への FK が望ましいが、users テーブルが
--   この時点で存在しないため、本 migration では型のみ (UUID) で宣言し、FK 制約
--   は 0004 で追加する (= ALTER TABLE ... ADD CONSTRAINT)。

-- ──────────────────────────────────────────────────────────────────────
-- products: 商品マスタ
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- public_id は URL に乗る human-readable slug。
    -- 命名規則: `p-<species>-<sex>-<size>` 例: "p-hh-m-142"
    public_id       TEXT NOT NULL UNIQUE,
    shop_id         UUID NOT NULL REFERENCES shops(id),
    -- kind: 商品の大分類 (= 生体 / 用品)
    kind            TEXT NOT NULL CHECK (kind IN ('live', 'supply')),
    -- difficulty: 飼育難易度 (= live のみ意味あり)
    difficulty      TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
    -- 生体属性
    species_id      TEXT REFERENCES species(id),
    sex             TEXT CHECK (sex IN ('male', 'female', 'unknown')),
    is_pair         BOOLEAN NOT NULL DEFAULT false,     -- ペア販売 (= 雌雄セット)
    generation      TEXT,                               -- "CBF2" / "WF1" 等
    size_mm         NUMERIC(5,1),                       -- 142.0 (= NUMERIC で 142.000... 回避)
    -- 価格 (税込, JPY)
    price_jpy       BIGINT NOT NULL CHECK (price_jpy >= 0),
    -- バッジは enum 化 (= 表示は client_solid/src/sdui/i18n/dict.ts で
    --   "badge.recommended" → "おすすめ" 等にマップ)
    badge_kind      TEXT CHECK (badge_kind IN (
        'recommended', 'new', 'low_stock', 'rare', 'larva',
        'consumable', 'popular', 'warning'
    )),
    tone            TEXT NOT NULL CHECK (tone IN ('forest', 'amber')),
    -- placeholder image label (= MVP 維持 / Phase 9.x で image_cdn_url に置換予定)
    ph_label        TEXT NOT NULL,
    -- 状態
    is_active       BOOLEAN NOT NULL DEFAULT true,
    -- audit (= レビュー Medium #5)
    --   FK 制約は 0004_users.sql で後付け。型は UUID のみで先行宣言。
    created_by      UUID,
    updated_by      UUID,
    version         INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 整合性: live なら species_id NOT NULL を強制
    CONSTRAINT live_requires_species CHECK (
        kind != 'live' OR species_id IS NOT NULL
    )
);

-- 通常 index (= 部分 index ではない / MVP は active 比率高い前提)
CREATE INDEX idx_products_kind          ON products (kind);
CREATE INDEX idx_products_difficulty    ON products (difficulty);
CREATE INDEX idx_products_species       ON products (species_id);
CREATE INDEX idx_products_shop          ON products (shop_id);
CREATE INDEX idx_products_created_at    ON products (created_at DESC);
CREATE INDEX idx_products_active        ON products (is_active);
-- public_id は UNIQUE 制約で自動 index される

CREATE TRIGGER trg_products_updated
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- product_translations: 商品名・説明の locale 別表記
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE product_translations (
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    locale      TEXT NOT NULL,                          -- "ja" / "en"
    title       TEXT NOT NULL,                          -- "ヘラクレスオオカブト ♂ 142mm"
    description TEXT,
    PRIMARY KEY (product_id, locale)
);

CREATE INDEX idx_product_translations_locale
    ON product_translations (locale);

-- ──────────────────────────────────────────────────────────────────────
-- seed: 既存 mock 6 件 (server::handlers::cards::product_filter_meta と完全一致)
-- ──────────────────────────────────────────────────────────────────────
-- public_id / kind / difficulty / price_jpy は handler の値そのまま。
-- badge_kind は server 側 hardcoded badge label からの変換マップ:
--   "おすすめ"   → 'recommended'
--   "幼虫"       → 'larva'
--   "飼育注意"   → 'warning'
--   "希少"       → 'rare'
--   "消耗品"     → 'consumable'
--   "人気"       → 'popular'
INSERT INTO products (
    public_id, shop_id,
    kind, difficulty, species_id, sex, is_pair, generation, size_mm,
    price_jpy, badge_kind, tone, ph_label
) VALUES
  -- p-hh-m-142: ヘラクレス ♂ 142mm
  ('p-hh-m-142',
   (SELECT id FROM shops WHERE public_id = 'anchor-beetle'),
   'live', 'hard', 'dhh', 'male', false, 'CBF2', 142.0,
   48000, 'recommended', 'forest', 'D'),
  -- p-cat-l: コーカサス幼虫 (sex 不明 → unknown)
  ('p-cat-l',
   (SELECT id FROM shops WHERE public_id = 'anchor-beetle'),
   'live', 'medium', 'cat', 'unknown', false, 'CBF3', NULL,
   12000, 'larva', 'forest', 'C'),
  -- p-neo-m: ネプチューン ♂ 初令ペア (= cards.rs::ProductMeta.title と一致)
  ('p-neo-m',
   (SELECT id FROM shops WHERE public_id = 'anchor-beetle'),
   'live', 'hard', 'neo', 'male', true, 'CBF2', NULL,
   28000, 'warning', 'forest', 'N'),
  -- p-aki: アクタエオン WILD F1 ♂ (= cards.rs::ProductMeta.title と一致 / sex は male に)
  ('p-aki',
   (SELECT id FROM shops WHERE public_id = 'anchor-beetle'),
   'live', 'hard', 'aki', 'male', false, 'WF1', NULL,
   62000, 'rare', 'forest', 'A'),
  -- p-jelly: 高栄養ゼリー (用品 / cards.rs では difficulty="easy" で表現)
  --   設計判断: supply は本来 difficulty 概念を持たないが、既存 UI の難易度フィルタで
  --   「初心者向け」chip に supply 2 件を載せる挙動を保つため、'easy' で seed する。
  --   将来 supply に専用 chip 群を出す時はここを NULL に戻し、フィルタ側を分岐する。
  ('p-jelly',
   (SELECT id FROM shops WHERE public_id = 'anchor-beetle'),
   'supply', 'easy', NULL, NULL, false, NULL, NULL,
   1480, 'consumable', 'amber', 'J'),
  -- p-mat: 完熟発酵マット 10L (= cards.rs::ProductMeta.title / price と一致 / difficulty="easy")
  ('p-mat',
   (SELECT id FROM shops WHERE public_id = 'anchor-beetle'),
   'supply', 'easy', NULL, NULL, false, NULL, NULL,
   1280, 'popular', 'amber', 'M');

-- 商品名 (ja) — server 側 ProductMeta.title と完全一致
INSERT INTO product_translations (product_id, locale, title) VALUES
  ((SELECT id FROM products WHERE public_id = 'p-hh-m-142'), 'ja', 'ヘラクレスオオカブト ♂ 142mm'),
  ((SELECT id FROM products WHERE public_id = 'p-cat-l'),    'ja', 'コーカサス幼虫 3齢 ♂ 52g'),
  ((SELECT id FROM products WHERE public_id = 'p-neo-m'),    'ja', 'ネプチューン ♂ 初令ペア'),
  ((SELECT id FROM products WHERE public_id = 'p-aki'),      'ja', 'アクタエオン WILD F1 ♂'),
  ((SELECT id FROM products WHERE public_id = 'p-jelly'),    'ja', '高栄養ゼリー 17g × 50個'),
  ((SELECT id FROM products WHERE public_id = 'p-mat'),      'ja', '完熟発酵マット 10L');
