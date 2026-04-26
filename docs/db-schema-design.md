# KOCHU DB スキーマ設計 (Phase 9.x マスタ移行)

> 画面側 / サーバ側でハードコードされている定数 (= mock データ含む) を **PostgreSQL** に移行する設計。Phase 9.1 の `orders` 系 migration (`0001_initial.sql`) の後続として段階展開する。
>
> **本ドキュメントは実装前のレビュー用 + 実装後の整合確認用**。テーブル定義 / migration 順序 / API 影響範囲 / 未解決事項を先に固めてから着手する。

## 実装ステータス (= source of truth は `server/migrations/*.sql` + `server/src/repos/*.rs`)

設計に対する現状の実装進捗:

| Phase | 範囲 | migration | repo / handler | 状態 |
|---|---|---|---|---|
| 9.1 | orders / order_items / shipping_addresses | `0001_initial.sql` | `repos::orders` / `handlers::checkout::post_checkout_submit` / `handlers::stripe_webhook` | ✅ 完了 |
| 9.A | species / shops / prefectures / shipping_methods (+ 翻訳) | `0002_master_data.sql` | `repos::{prefectures, shipping_methods}` / handler 切替済 | ✅ 完了 |
| 9.B | products / product_translations | `0003_products.sql` | `repos::products` / `handlers::cards::product_filter_meta` 切替済 | ✅ 完了 |
| 9.C | users / user_sessions (+ audit FK 後付け) | `0004_users.sql` | `repos::{users, user_sessions}` (skeleton) / Cookie middleware で session 永続化 | ✅ 基盤完了 (login flow 未) |
| 9.F | order_items.product_uuid を FK 化 + backfill | `0005_order_items_product_fk.sql` | `OrderLineInsert.product_uuid` / post_checkout_submit で UUID 解決 | ✅ 完了 |
| 9.E (cart/watch) | cart_items / product_watches | `0006_cart_and_watches.sql` | `repos::{cart_items, product_watches}` / `handlers::cart` は repo 経由に移行済 / `handlers::watch` は session 分離 in-memory | 🟡 部分完了 (watch DB 化は schema 拡張待ち) |
| 9.D | specimens / specimen_status_history / specimen_logs / mating_records | `0007_specimens.sql` | `repos::specimens` (skeleton) | 🟡 schema + 基本 repo 完了 / handler 未 |
| 9.E (market) | listings / bids / listing_watches / `v_listings_with_counts` | (未投入) | (未) | ⏳ 9.D 完了後に着手 |

横串:
- `state::AppState { db: Option<PgPool> }` を全 handler に届ける配線済 (= 各 repo は `Option<&PgPool>` を受け取る `pool 有り → DB / 無し → in-memory fallback` パターンで動く)
- Cookie session middleware (= `kochu_session` cookie / `SessionId(Uuid)` extension / pool 有り時は user_sessions に INSERT)
- 実機検証手順は [`db-verify-checklist.md`](db-verify-checklist.md) に整理

## レビュー対応 Changelog (v2)

シニアレビュー 19 件 (High 5 / Medium 7 / Low 3 / Info 4) を反映。判断ログ:

### High (5件すべて採用)

| # | 指摘 | 対応 | 反映先 |
|---|---|---|---|
| 1 | `watches` の polymorphic + UNIQUE NULL 重複バグ | **案 C 採用**: `product_watches` / `listing_watches` の 2 テーブル分割 (= 型安全 + JOIN シンプル + target_type 不要) | §3.7 |
| 2 | `products.badge` に日本語直書き → §2.2 i18n 方針と矛盾 | `badge_kind TEXT CHECK (...)` の enum 化 + 表示は SDUI 辞書から引く。`ph_label` は CDN URL の方が将来性ありなので併せて削除候補 (§17 Future Work へ) | §3.2 |
| 3 | `users.role` の CHECK 制約欠落 | 他テーブルと同じく `CHECK (role IN ('breeder','admin','shop_owner'))` 追加 | §3.3 |
| 4 | `listings` のオークション整合性 CHECK 欠落 | `auction_requires_ends_at` + `current_price_ge_starting` の 2 件 CHECK 追加 | §3.7 |
| 5 | `specimen_logs.logged_at_time` を TEXT で持つ | `TIME WITHOUT TIME ZONE` 型に変更 | §3.5 |

### Medium (7件)

| # | 指摘 | 対応 |
|---|---|---|
| 1 | `cart_items.session_id` の FK 無し → orphan 化 | `user_sessions(id) ON DELETE CASCADE` で FK 化 (= 案 1 採用、別 `cart_sessions` テーブル分離は責務的にやり過ぎと判断) |
| 2 | `listings.bid_count/watcher_count` の drift | **案 B 採用**: 列を持たず `v_listings_with_counts` VIEW で都度集計 (= bids / listing_watches テーブルから COUNT)。MVP の規模なら十分高速 |
| 3 | `specimens` 状態遷移が現在値スナップショットのみ | **採用**: `specimen_status_history` テーブル新設。current 状態は specimens の `life_status` カラムに残し、履歴は併設 (= 二重持ちで読み取り簡単) |
| 4 | `size_mm` 等を `REAL` で持つ → 浮動小数丸め | `NUMERIC(precision, scale)` に変更 (size_mm: 5,1 / weight_g: 6,2 / stage_progress: 3,2) |
| 5 | audit (`created_by`/`updated_by`) + 楽観ロック (`version`) 欠落 | 採用: products / specimens / listings / shipping_methods に追加 |
| 6 | `user_sessions.token_hash` に algo 識別子無し | **phc 形式 (Argon2 標準フォーマット) を採用**: TEXT 維持で `LIKE '$%$%$%'` の format CHECK を追加。BYTEA より運用が楽 (algo / salt / params が string に内包) |
| 7 | `products.sex` と `specimens.sex` の値域不一致 | `products.is_pair BOOLEAN` を別カラム化し、両者の sex 値域を `{male, female, unknown}` で揃える |

### Low (3件)

| # | 指摘 | 対応 |
|---|---|---|
| 1 | `specimens.purchased_from` 命名規約違反 | `purchased_from_shop_id` にリネーム |
| 2 | `WHERE is_active` 部分 index は MVP で過剰 | **採用**: 通常 index に変更。Phase 9.B 投入後に active 比率を計測して再検討 (= §17 Future Work へ) |
| 3 | `uuid_generate_v4()` vs `gen_random_uuid()` | **新規 migration から `gen_random_uuid()` に統一**。既存 0001_initial.sql は据え置き (= ALTER で混乱するより一貫性犠牲を選ぶ)。`uuid-ossp` 拡張は 0001 で既に有効化済みなので残す |

### Info (4件)

すべて「現状維持で良い」評価のため採用方針に変更なし。Identity 戦略 / i18n 翻訳分離 / CHECK enum / XOR CHECK が「お手本」と評されたので継続。

### 判断保留 (= ユーザ最終確認したい 2 点)

これら 2 点は実装着手前にユーザの一言確認をいただきたい:

| # | 論点 | 推奨デフォルト |
|---|---|---|
| A | `bids` テーブルを **同時に新設** するか? Medium #2 の VIEW 集計案は `bids` テーブル前提 | **新設する**: §3.7 で `bids (id, listing_id, bidder_user_id, amount_jpy, bid_at)` を追加 |
| B | `products.ph_label` を削除して **CDN URL 列に置換**するか? それとも MVP は維持? | **MVP は維持** (= ph_label TEXT のまま、Phase 9.x で `image_cdn_url TEXT` 追加時に削除) |



## 0. 結論サマリ

5 段階の Phase で展開:

| Phase | 内容 | テーブル | 想定 migration | 影響範囲 |
|---|---|---|---|---|
| **9.A** | マスタ (= ops が編集する低頻度書き換え) | `species` / `shops` / `prefectures` / `shipping_methods` | `0002_master_data.sql` | server (= シードのみ) |
| **9.B** | 商品マスタ | `products` / `product_translations` | `0003_products.sql` | server `product_filter_meta` 全置換 |
| **9.C** | ユーザ | `users` / `user_sessions` | `0004_users.sql` | session middleware 追加 |
| **9.D** | 個体カルテ + ログ + 血統 | `specimens` / `specimen_logs` / `mating_records` / `bloodlines` | `0005_specimens.sql` / `0006_logs.sql` / `0007_bloodlines.sql` | client `api/specimens.ts` / `api/logs.ts` 全置換 |
| **9.E** | C2C 出品 + ウォッチ | `listings` / `watches` | `0008_market.sql` | server `watch.rs` の in-memory 廃止 |

各 Phase は独立に着手可能。9.A → 9.B に依存 (= products が species FK を引くため)。9.C は他から独立だが Cookie session middleware を要求。

## 1. 移行候補の現状調査

### 1.1 client 側 (mock + localStorage)

`client_solid/src/api/*.ts` で `APP_DATA` (= `data.ts` の固定 seed) を返す関数群:

| API | 現実装 | DB 移行先 | 永続化必要性 |
|---|---|---|---|
| `getCurrentUser()` | `APP_DATA.user` 固定 1 名 | `users` table | **必須** (multi-tenant の前提) |
| `listProducts()` / `getProduct()` | `APP_DATA.products` (= 6+ 件) | `products` table | **必須** (ops が CRUD) |
| `listSpecimens()` / `getSpecimen()` | `APP_DATA.specimens` (= 7 件) | `specimens` table | **必須** (user 所有データ) |
| `listLogs()` / `addLog()` | seed + localStorage merge | `specimen_logs` table | **必須** (user データ; 機種跨ぎで失われない) |
| `listMarketListings()` | `APP_DATA.listings` | `listings` table | **必須** (C2C 取引データ) |
| `getShopStats()` | `APP_DATA.shopStats` 固定値 | aggregation view (= orders から計算) | DB 化は必要だが migration ではなく view |
| `listOrders()` | `APP_DATA.orders` | `orders` (= 既存) を join | 既存 `0001_initial.sql` で OK |

`localStorage` で擬似永続化されているもの (= 機種跨ぎで失われる現状の制約):
- `LS_KEYS.logs` → `specimen_logs` table
- `LS_KEYS.memos` → `specimens.notes` カラム or 別 `specimen_memos` table
- `LS_KEYS.matingRecords` → `mating_records` table

`store/checkout.ts` (= 配送先 form state) は server `checkout_store` に統合済み (Phase 8) → DB 化は session 紐付けで `user_shipping_addresses` table を別途検討。

### 1.2 server 側 hardcoded

| 場所 | 現実装 | DB 移行先 | 移行緊急度 |
|---|---|---|---|
| `handlers/cards.rs::product_filter_meta()` | `&'static HashMap<&str, ProductMeta>` (= 6 件) | `products` table | **高** (商品の追加/削除/価格変更が ops の日常業務) |
| `handlers/cards.rs::mock_store()` / `detail_mock_store()` | CardBlock 全体を hardcode | DB から組み立てる関数に置換 | **高** (商品マスタ DB 化と同時) |
| `handlers/cards.rs::japan_prefectures()` | `&'static [&str]` 47 件 | `prefectures` table | **中** (固定 47 件だが i18n 対応で価値) |
| `handlers/checkout.rs::SHIPPING_METHODS` | `&'static [ShippingMethodDef]` 2 件 | `shipping_methods` table | **中** (料金変更が想定される) |
| `handlers/checkout.rs::ALLOWED_FIELDS` | `&'static [&str]` 5 件 | **コード残置** (= form 構造の宣言、データではない) | — |
| `handlers/cart.rs` cart_store | `Mutex<HashMap<token, entry>>` | `cart_items` table (session 紐付け) | **中** (再起動で消えるのは UX 上問題) |
| `handlers/checkout.rs` checkout_store | `Mutex<CheckoutState>` | `user_shipping_addresses` (= ユーザ毎 1 件) | **中** |
| `handlers/watch.rs` (= ウォッチリスト) | `Mutex<HashSet<product_id>>` | `watches` table | **中** |
| `handlers/events.rs` ring buffer | `Mutex<VecDeque<AnalyticsEvent>>` | (将来) `analytics_events` table or DynamoDB / S3 | **低** (debug only) |

### 1.3 コードに残すもの (DB に移さない)

discriminator / 構造定義は **コード側 enum** で表現する:
- `LogType` (= weight / feed / mat / molt / observation) — 5 値固定、i18n キーで UI 表示
- `LifeStatus` (= active / deceased / transferred / escaped) — 4 値固定
- `CtaIntent` / `BadgeRole` / `MediaKind` 等 — SDUI スキーマ enum
- `RouteKey` — URL ↔ UI 紐付け
- `Currency` — `JPY` 固定 (多通貨化時は §17 Future Work)
- `ALLOWED_FIELDS` (= shipping form の field 名) — DB に置くと typed access ができず、validation が runtime に倒れる

判断基準: **「ops が運用で変更する可能性があるか」** = Yes なら DB / No ならコード。

## 2. 設計判断 (= 重要な選択肢)

### 2.1 Identity 戦略 — human-readable ID + internal UUID の **二重持ち**

商品 ID (`p-hh-m-142`) や個体 ID (`#DHH-0271`) は **URL に乗る public slug** として極めて有用 (短い / 意味的) なので維持したい。一方で内部参照 (FK) は UUID にしないと:
- ID renaming で全 FK を更新する保守コスト
- URL slug 衝突の連鎖

**採用方針**:
```sql
-- products の例
CREATE TABLE products (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),  -- 内部 PK
    public_id   TEXT NOT NULL UNIQUE,  -- "p-hh-m-142" 等; URL / SDUI レスポンスで使う
    ...
);
-- FK は id (UUID) で、URL マッピングは public_id で。
-- public_id を変更したくなった時は ALTER TABLE で UPDATE 一発。
```

**例外**:
- `prefectures.code` (= "01" 〜 "47") は半固定なので code 自体を PRIMARY KEY にする (= UUID 不要)。
- `shipping_methods.id` (= "cold" / "normal") も同様。
- `species.id` (= "dhh" / "cat") も短く ops が変えない前提なら text PK で良い。

### 2.2 i18n 戦略 — **2 段構成**

商品名 / 学名は将来 en 対応が必要 → **translation テーブル分離**:

```sql
CREATE TABLE products (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    public_id   TEXT NOT NULL UNIQUE,
    ...
    -- "ja" カラムを直書きせず translation table へ
);

CREATE TABLE product_translations (
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    locale      TEXT NOT NULL,    -- "ja" / "en"
    title       TEXT NOT NULL,
    description TEXT,
    PRIMARY KEY (product_id, locale)
);
```

種マスタ (`species`) も同じ。

**動的 vs 静的の境界**:
- 商品名 / 学名 / 種 ja 名 → translation テーブル (動的)
- UI コピー (= "カートに追加" 等) → 既存 `client_solid/src/sdui/i18n/dict.ts` (静的、コードと密結合)

### 2.3 ID 表記の統一

- 商品 public_id: `p-<species>-<sex>-<size>` (= `p-hh-m-142` 等)。kebab-case。
- 個体 public_id: `#<SPECIES>-<seq>` (= `#DHH-0271`)。`#` プレフィックス + uppercase。
- order_id: UUID (= public_id 不要 / 推測されたくない)。
- listing_id: 上記 order_id と同じ理由で UUID + `L-<short_random>` の short slug を SET。

### 2.4 削除戦略 — **soft delete を採用**

- `specimens`: lifeStatus が `deceased` / `transferred` / `escaped` でも履歴として残す → 物理削除しない。`is_archived BOOLEAN` カラムで非アクティブ化。
- `products`: `is_active BOOLEAN`。出品取り下げ後も orders の参照整合性を保つため物理削除しない。
- `listings`: 同上。`status` カラム (`active` / `sold` / `canceled` / `expired`) で表現。
- `users`: GDPR 対応で物理削除も検討する必要あり (= 将来 Phase 9.F+)。

### 2.5 多テナント想定

将来「複数ショップが商品を出す」可能性 → `products.shop_id UUID NOT NULL REFERENCES shops(id)` を最初から持たせる。MVP では `shops` 1 行 (= "ANCHOR BEETLE CO.") で運用するが、構造的に拡張可能にしておく。

## 3. テーブル設計 (= migration ごと)

### 3.1 `0002_master_data.sql` — マスタ系

```sql
-- ── species: 種マスタ ─────────────────────────────────────────────
CREATE TABLE species (
    id          TEXT PRIMARY KEY,                       -- "dhh" / "cat" 等
    sci_name    TEXT NOT NULL,                          -- 学名 "Dynastes hercules hercules"
    region      TEXT NOT NULL,                          -- "中南米" / "東南アジア" 等
    -- 将来 difficulty デフォルトを species に持たせるなら別カラム化
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 種名の locale 別翻訳 (= ja のみ MVP、en は将来)
CREATE TABLE species_translations (
    species_id  TEXT NOT NULL REFERENCES species(id) ON DELETE CASCADE,
    locale      TEXT NOT NULL,
    name        TEXT NOT NULL,                          -- "ヘラクレスオオカブト"
    PRIMARY KEY (species_id, locale)
);

-- ── shops: ショップマスタ ─────────────────────────────────────────
CREATE TABLE shops (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    public_id   TEXT NOT NULL UNIQUE,                   -- "anchor-beetle"
    name        TEXT NOT NULL,                          -- "ANCHOR BEETLE CO."
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── prefectures: 都道府県マスタ ──────────────────────────────────
CREATE TABLE prefectures (
    code        TEXT PRIMARY KEY,                       -- "01" 〜 "47" (= JIS X 0401)
    name_ja     TEXT NOT NULL,                          -- "北海道"
    name_en     TEXT,                                   -- "Hokkaido" (将来)
    sort_order  INTEGER NOT NULL                        -- JIS 順 1〜47
);

-- ── shipping_methods: 配送方法マスタ ─────────────────────────────
CREATE TABLE shipping_methods (
    id              TEXT PRIMARY KEY,                   -- "cold" / "normal"
    sort_order      INTEGER NOT NULL DEFAULT 0,         -- UI 表示順
    amount_jpy      BIGINT NOT NULL CHECK (amount_jpy >= 0),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    -- name / description は i18n テーブルへ
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shipping_method_translations (
    method_id   TEXT NOT NULL REFERENCES shipping_methods(id) ON DELETE CASCADE,
    locale      TEXT NOT NULL,
    name        TEXT NOT NULL,                          -- "温度制御便（推奨）"
    description TEXT,                                   -- "生体含むため必須設定 · 15〜25℃"
    PRIMARY KEY (method_id, locale)
);

-- updated_at trigger を流用 (= 0001_initial.sql で定義済みの set_updated_at())
CREATE TRIGGER trg_species_updated     BEFORE UPDATE ON species     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_shops_updated       BEFORE UPDATE ON shops       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_shipping_methods_updated BEFORE UPDATE ON shipping_methods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 初期 seed (47 都道府県 / cold/normal / dhh/cat/aki/nat/neo / anchor-beetle)
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

INSERT INTO shipping_methods (id, sort_order, amount_jpy, is_active) VALUES
  ('cold',   0, 1800, true),
  ('normal', 1,  800, true);

INSERT INTO shipping_method_translations (method_id, locale, name, description) VALUES
  ('cold',   'ja', '温度制御便（推奨）', '生体含むため必須設定 · 15〜25℃'),
  ('normal', 'ja', '通常便',              '用品のみ・常温配送');

-- (47 都道府県は別ファイル / 別 INSERT で投入)
INSERT INTO prefectures (code, name_ja, sort_order) VALUES
  ('01', '北海道', 1), ('02', '青森県', 2), ... ('47', '沖縄県', 47);

INSERT INTO shops (public_id, name, description) VALUES
  ('anchor-beetle', 'ANCHOR BEETLE CO.', '生体・幼虫の総合ショップ');
```

### 3.2 `0003_products.sql` — 商品マスタ

```sql
CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id       TEXT NOT NULL UNIQUE,               -- "p-hh-m-142"
    shop_id         UUID NOT NULL REFERENCES shops(id),
    -- kind: 生体 / 用品 (= 商品の大分類)
    kind            TEXT NOT NULL CHECK (kind IN ('live', 'supply')),
    -- difficulty: 飼育難易度 (= live のみ意味あり、supply では NULL)
    difficulty      TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
    -- 生体属性 (kind='live' のときのみ NOT NULL)
    species_id      TEXT REFERENCES species(id),
    -- High #4 / Medium #7: sex 値域は specimens と揃え、ペア販売は is_pair で別表現
    sex             TEXT CHECK (sex IN ('male', 'female', 'unknown')),
    is_pair         BOOLEAN NOT NULL DEFAULT false,     -- ペア販売 (= 雌雄セット)
    generation      TEXT,                               -- "CBF2" / "WF1" 等
    -- Medium #4: REAL → NUMERIC で表示信頼性確保 (= 142.0 が 141.999... にならない)
    size_mm         NUMERIC(5,1),                       -- 142.0
    -- 価格
    price_jpy       BIGINT NOT NULL CHECK (price_jpy >= 0),
    -- High #2: badge を i18n 化。表示は client_solid/src/sdui/i18n/dict.ts で
    -- "badge.recommended" → "おすすめ" / "Recommended" 等にマップ。
    badge_kind      TEXT CHECK (badge_kind IN (
        'recommended','new','low_stock','rare','larva',
        'consumable','popular','warning'
    )),
    tone            TEXT NOT NULL CHECK (tone IN ('forest', 'amber')),
    -- 判断保留 B: ph_label は MVP 維持 (= 後で image_cdn_url に置換予定)
    ph_label        TEXT NOT NULL,
    -- 状態
    is_active       BOOLEAN NOT NULL DEFAULT true,
    -- Medium #5: ops 監査 + 楽観ロック
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    version         INTEGER NOT NULL DEFAULT 0,
    -- 並び替え用
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 整合性チェック: live なら species_id NOT NULL を強制
    CONSTRAINT live_requires_species CHECK (
        kind != 'live' OR species_id IS NOT NULL
    )
);

-- Low #2: 部分 index は archived 比率が大多数になるまで通常 index に倒す
CREATE INDEX idx_products_kind        ON products (kind);
CREATE INDEX idx_products_difficulty  ON products (difficulty);
CREATE INDEX idx_products_species     ON products (species_id);
CREATE INDEX idx_products_shop        ON products (shop_id);
CREATE INDEX idx_products_created_at  ON products (created_at DESC);
CREATE INDEX idx_products_active      ON products (is_active);

CREATE TABLE product_translations (
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    locale      TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    PRIMARY KEY (product_id, locale)
);

CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 既存 mock 6 件を seed として投入 ──────────────────────────────
-- public_id は server::handlers::cards::product_filter_meta() と完全一致
INSERT INTO products (public_id, shop_id, kind, difficulty, species_id, sex, generation, size_mm, price_jpy, badge, tone, ph_label) VALUES
  ('p-hh-m-142', (SELECT id FROM shops WHERE public_id='anchor-beetle'), 'live',   'hard',   'dhh', 'male', 'CBF2', 142, 48000, 'おすすめ', 'forest', 'D'),
  ('p-cat-l',    (SELECT id FROM shops WHERE public_id='anchor-beetle'), 'live',   'medium', 'cat', NULL,   'CBF3', NULL, 12000, '幼虫', 'forest', 'C'),
  ('p-neo-m',    (SELECT id FROM shops WHERE public_id='anchor-beetle'), 'live',   'hard',   'neo', 'male', 'CBF2', NULL, 28000, '飼育注意', 'forest', 'N'),
  ('p-aki',      (SELECT id FROM shops WHERE public_id='anchor-beetle'), 'live',   'hard',   'aki', NULL,   'WF1',  NULL, 62000, '希少', 'forest', 'A'),
  ('p-jelly',    (SELECT id FROM shops WHERE public_id='anchor-beetle'), 'supply', NULL,     NULL,  NULL,   NULL,   NULL,  1480, '消耗品', 'amber',  'J'),
  ('p-mat',      (SELECT id FROM shops WHERE public_id='anchor-beetle'), 'supply', NULL,     NULL,  NULL,   NULL,   NULL,  3200, '人気', 'amber',  'M');

INSERT INTO product_translations (product_id, locale, title) VALUES
  ((SELECT id FROM products WHERE public_id='p-hh-m-142'), 'ja', 'ヘラクレスオオカブト ♂ 142mm'),
  ((SELECT id FROM products WHERE public_id='p-cat-l'),    'ja', 'コーカサス幼虫 3齢 ♂ 52g'),
  ((SELECT id FROM products WHERE public_id='p-neo-m'),    'ja', 'ネプチューンオオカブト ♂ 102mm'),
  ((SELECT id FROM products WHERE public_id='p-aki'),      'ja', 'アクタエオンゾウカブト 幼虫 WF1'),
  ((SELECT id FROM products WHERE public_id='p-jelly'),    'ja', '高栄養ゼリー 17g × 50個'),
  ((SELECT id FROM products WHERE public_id='p-mat'),      'ja', '発酵マット 10L');
```

> **⚠️ 実装との差分** (= source of truth は `server/migrations/0003_products.sql` + `cards.rs::product_filter_meta`):
>
> - `badge` 列は **i18n 化** されて `badge_kind TEXT CHECK (...)` 形式 (= `'recommended'` / `'larva'` / `'warning'` / `'rare'` / `'consumable'` / `'popular'` / `'new'` / `'low_stock'`) に変更済。表示の日本語文字列は `client_solid/src/sdui/i18n/dict.ts` 側で `badge.recommended` 等のキー解決。
> - `is_pair`, `is_active`, `created_by`, `updated_by`, `version` の audit / 楽観ロック列を実装で追加 (= 上の例には未掲載)。
> - 翻訳 / 価格の差分 (cards.rs と整合させる過程で確定):
>   - `p-neo-m`: `ネプチューンオオカブト ♂ 102mm` → **`ネプチューン ♂ 初令ペア`** + `is_pair=true`
>   - `p-aki`: `アクタエオンゾウカブト 幼虫 WF1` → **`アクタエオン WILD F1 ♂`** + `sex='male'`
>   - `p-mat`: `発酵マット 10L` (3200円) → **`完熟発酵マット 10L`** (**1280円**)
> - supply 商品 (`p-jelly` / `p-mat`) の `difficulty` は NULL ではなく **`'easy'`** で seed (= 既存 UI の「初心者向け」chip に乗せるため)。将来 supply に専用 chip 群を出すなら NULL に戻す。

### 3.3 `0004_users.sql` — ユーザ + セッション

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id       TEXT NOT NULL UNIQUE,               -- "t_yamada" (= handle)
    name            TEXT NOT NULL,                      -- "山田 徹"
    -- High #3: role の値域を CHECK で固定 (= セキュリティ判定の根拠なので typo 防止)
    role            TEXT NOT NULL DEFAULT 'breeder'
                       CHECK (role IN ('breeder', 'admin', 'shop_owner')),
    -- 認証は Phase 9.F で oauth2 / jsonwebtoken を入れた時に実装
    email           TEXT UNIQUE,                        -- 任意 (将来)
    -- 表示用
    avatar_initial  TEXT NOT NULL,                      -- "山"
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(), -- "2024.03"
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = anonymous
    -- Medium #6: token_hash は phc 形式 (= Argon2 標準フォーマット
    -- "$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>") で保存。
    -- algo / params / salt がすべて文字列に内包されるので algo 移行が容易。
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT token_hash_phc_format CHECK (token_hash LIKE '$%$%$%')
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO users (public_id, name, role, avatar_initial) VALUES
  ('t_yamada', '山田 徹', 'breeder', '山');
```

### 3.4 `0005_specimens.sql` — 個体カルテ

```sql
CREATE TABLE specimens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id       TEXT NOT NULL UNIQUE,               -- "#DHH-0271"
    owner_user_id   UUID NOT NULL REFERENCES users(id),
    species_id      TEXT NOT NULL REFERENCES species(id),
    name            TEXT NOT NULL,                      -- "ヘラクレス 黒曜"
    sex             TEXT NOT NULL CHECK (sex IN ('male', 'female', 'unknown')),
    -- 飼育ステージ (= 蛹 / 成虫 / 幼虫 N齢 / 前蛹)
    stage           TEXT NOT NULL,                      -- 自由文字列 (UI 表示で使う)
    -- Medium #4: REAL → NUMERIC で表示信頼性確保
    stage_progress  NUMERIC(3,2) NOT NULL CHECK (stage_progress >= 0 AND stage_progress <= 1),
    -- 物理計測値 (= 表示そのまま記録される必要あり = 28.4 → 28.4 が確定)
    size_mm         NUMERIC(5,1),                       -- 142.0
    weight_g        NUMERIC(6,2),                       -- 28.4
    -- ライフサイクル日付
    birth_date      DATE,                               -- 2024-08-12
    purchased_at    DATE,                               -- 2025-11-03
    -- Low #1: 命名規約 _id サフィックス統一
    purchased_from_shop_id  UUID REFERENCES shops(id),
    -- 系統
    generation      TEXT,                               -- "CBF2" 等
    purchase_price_jpy BIGINT,                          -- 取得時価格 (任意)
    -- 羽化予測
    eclosion_eta    DATE,                               -- "2026-05-04"
    -- ライフステータス (= 現在値スナップショット;
    --   遷移履歴は specimen_status_history で別途記録 = Medium #3)
    life_status     TEXT NOT NULL DEFAULT 'active'
                       CHECK (life_status IN ('active', 'deceased', 'transferred', 'escaped')),
    life_status_at  DATE,                               -- 死着日 / 譲渡日 / 脱走日
    life_status_note TEXT,
    -- 自由メモ (= 旧 specimen.notes + memos の統合)
    notes           TEXT,
    -- 血統リンク (= specimens 自己参照)
    father_id       UUID REFERENCES specimens(id),      -- NULL なら "野生" 扱い
    mother_id       UUID REFERENCES specimens(id),
    -- "野生" 等で specimens に登録されない親の自由テキスト fallback
    father_label    TEXT,
    mother_label    TEXT,
    -- 削除しない方針: archived フラグで非表示化 (= 表示は「故」「譲渡済」より上の概念)
    is_archived     BOOLEAN NOT NULL DEFAULT false,
    -- Medium #5: ops 監査 + 楽観ロック
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    version         INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Low #2: 部分 index は archived 比率を計測してから判断 (= MVP は通常 index)
CREATE INDEX idx_specimens_owner            ON specimens (owner_user_id);
CREATE INDEX idx_specimens_archived         ON specimens (is_archived);
CREATE INDEX idx_specimens_species          ON specimens (species_id);
CREATE INDEX idx_specimens_eclosion_eta     ON specimens (eclosion_eta) WHERE eclosion_eta IS NOT NULL;
CREATE INDEX idx_specimens_father           ON specimens (father_id) WHERE father_id IS NOT NULL;
CREATE INDEX idx_specimens_mother           ON specimens (mother_id) WHERE mother_id IS NOT NULL;

-- Medium #3: 状態遷移の履歴 (= 個体カルテの「歴史」を保持する核)
-- specimens.life_status は最新値のスナップショット、履歴は別テーブル。
-- application 側で UPDATE specimens.life_status する際に必ず本テーブルに INSERT する規律。
-- 過去データが消失すると回復不能なので、最初から作る。
CREATE TABLE specimen_status_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    specimen_id     UUID NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
    status          TEXT NOT NULL
                       CHECK (status IN ('active', 'deceased', 'transferred', 'escaped')),
    changed_at      DATE NOT NULL,
    note            TEXT,
    author_user_id  UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_specimen_status_specimen
    ON specimen_status_history (specimen_id, changed_at DESC);
-- public_id は UNIQUE 制約で自動 index される

CREATE TRIGGER trg_specimens_updated BEFORE UPDATE ON specimens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### 3.5 `0006_specimen_logs.sql` — 飼育ログ

```sql
CREATE TABLE specimen_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    specimen_id     UUID NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
    author_user_id  UUID NOT NULL REFERENCES users(id),
    -- log 種別 (= LogType と完全一致 / コード側 enum と source of truth を共有)
    log_type        TEXT NOT NULL CHECK (log_type IN ('weight', 'feed', 'mat', 'molt', 'observation')),
    -- ユーザ表示日 (Date.now() ではなく user 入力)
    logged_at       DATE NOT NULL,
    -- High #5: TEXT → TIME 型で型安全 + ORDER BY が時間順になる
    -- 24h 表記、TZ なし (= 日本時刻ローカル前提)。NULL 許容は維持。
    logged_at_time  TIME WITHOUT TIME ZONE,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL DEFAULT '',
    has_photo       BOOLEAN NOT NULL DEFAULT false,
    -- 構造化フィールド (log_type ごとに使う / 使わないが揺れる) は JSONB で
    -- 例: weight log なら { "weight_g": 28.4 }
    --     molt log なら { "head_width_mm": 12.5, "instar": 3 }
    metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_specimen_logs_specimen     ON specimen_logs (specimen_id, logged_at DESC);
CREATE INDEX idx_specimen_logs_type         ON specimen_logs (log_type);
CREATE INDEX idx_specimen_logs_author       ON specimen_logs (author_user_id);
```

### 3.6 `0007_bloodlines.sql` — 交配記録 (= mating_records)

specimens の `father_id` / `mother_id` で系図は表現できるが、**交配の試行記録** (= まだ specimen として登録されていない計画段階) は別テーブルが要る:

```sql
CREATE TABLE mating_records (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    breeder_user_id UUID NOT NULL REFERENCES users(id),
    -- 雄雌 (= specimens に登録済みの個体への参照)
    father_id       UUID REFERENCES specimens(id),
    mother_id       UUID REFERENCES specimens(id),
    -- 親が "野生" 等で specimens テーブルに無い場合の fallback (= 自由テキスト)
    father_label    TEXT,
    mother_label    TEXT,
    -- 交配日 / 採卵日 / 状態
    mated_at        DATE NOT NULL,
    egg_count       INTEGER,                            -- 採卵数 (任意)
    status          TEXT NOT NULL DEFAULT 'planned'
                       CHECK (status IN ('planned', 'mated', 'eggs_laid', 'hatched', 'failed')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mating_records_breeder ON mating_records (breeder_user_id, mated_at DESC);
CREATE INDEX idx_mating_records_father  ON mating_records (father_id) WHERE father_id IS NOT NULL;
CREATE INDEX idx_mating_records_mother  ON mating_records (mother_id) WHERE mother_id IS NOT NULL;

CREATE TRIGGER trg_mating_records_updated BEFORE UPDATE ON mating_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### 3.7 `0008_market.sql` — C2C 出品 + ウォッチ + cart

```sql
-- ── listings: C2C 出品 ────────────────────────────────────────────
-- High #4: オークション関連の整合性 CHECK を追加
-- Medium #2: bid_count / watcher_count は列で持たず VIEW で集計 (= drift 防止)
CREATE TABLE listings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id       TEXT NOT NULL UNIQUE,               -- "L-0421" (= random suffix)
    seller_user_id  UUID NOT NULL REFERENCES users(id),
    -- 出品対象は specimen への直接参照 or 自由 title の 2 通り
    specimen_id     UUID REFERENCES specimens(id),
    title           TEXT NOT NULL,                      -- "ヘラクレス♂ 148mm 自家累代CBF3"
    description     TEXT,
    -- オークション or 即決
    is_auction      BOOLEAN NOT NULL DEFAULT false,
    starting_price_jpy BIGINT NOT NULL CHECK (starting_price_jpy >= 0),
    current_price_jpy  BIGINT,                          -- auction で更新
    ends_at         TIMESTAMPTZ,                        -- auction 終了時刻
    -- 出品状態
    status          TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'sold', 'canceled', 'expired')),
    -- 出品者の信頼マーク (= 過去取引から計算するが、MVP は手動)
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    -- Medium #5: ops 監査 + 楽観ロック
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    version         INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- High #4: 整合性チェック
    CONSTRAINT auction_requires_ends_at CHECK (
        NOT is_auction OR ends_at IS NOT NULL
    ),
    CONSTRAINT current_price_ge_starting CHECK (
        current_price_jpy IS NULL OR current_price_jpy >= starting_price_jpy
    )
);

CREATE INDEX idx_listings_status_ends   ON listings (status, ends_at);
CREATE INDEX idx_listings_seller        ON listings (seller_user_id);

CREATE TRIGGER trg_listings_updated BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── bids: 入札履歴 (= 判断保留 A の確認後に新設) ─────────────────
-- 1 入札 = 1 行。listings.current_price_jpy はトリガで MAX(amount_jpy) に更新する想定。
-- VIEW v_listings_with_counts は本テーブルから COUNT を引く。
CREATE TABLE bids (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id      UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    bidder_user_id  UUID NOT NULL REFERENCES users(id),
    amount_jpy      BIGINT NOT NULL CHECK (amount_jpy > 0),
    bid_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bids_listing           ON bids (listing_id, bid_at DESC);
CREATE INDEX idx_bids_bidder            ON bids (bidder_user_id);

-- ── watches: 2 テーブル分割 (= High #1 案 C 採用) ────────────────
-- polymorphic + UNIQUE NULL の重複バグを回避し、JOIN プランナにも優しい構成。
-- target_type 列は不要、コード側でも Rust 型レベルで分かれる。

CREATE TABLE product_watches (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id)
);

CREATE TABLE listing_watches (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, listing_id)
);

CREATE INDEX idx_product_watches_product ON product_watches (product_id);
CREATE INDEX idx_listing_watches_listing ON listing_watches (listing_id);

-- ── v_listings_with_counts: 派生値を view で集計 (= Medium #2 案 B 採用) ──
-- bid_count / watcher_count は drift を避けるため列に持たず view で計算。
-- MVP の規模 (= 数百件 / list ページ) なら subquery で十分高速。
-- 規模が増えて遅くなった時点で MATERIALIZED VIEW + REFRESH に切り替える。
CREATE VIEW v_listings_with_counts AS
SELECT
    l.*,
    (SELECT COUNT(*) FROM bids b WHERE b.listing_id = l.id) AS bid_count,
    (SELECT COUNT(*) FROM listing_watches w WHERE w.listing_id = l.id) AS watcher_count
FROM listings l;

-- ── cart_items: カート (session 紐付け) ──────────────────────────
-- 既存 in-memory cart_store の DB 化
-- Medium #1: session_id を user_sessions(id) への FK + ON DELETE CASCADE で
-- 孤児防止。
CREATE TABLE cart_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- session_id か user_id のどちらかが必須 (= guest cart 対応)
    session_id      UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES products(id),
    qty             INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99),
    -- Undo token = cart_items.id を hex で返すだけ (= §8.1 採用)
    -- 別カラム不要、削除は physical DELETE。
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cart_owner_present CHECK (
        session_id IS NOT NULL OR user_id IS NOT NULL
    )
);

CREATE INDEX idx_cart_items_session     ON cart_items (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_cart_items_user        ON cart_items (user_id) WHERE user_id IS NOT NULL;

CREATE TRIGGER trg_cart_items_updated BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

## 4. ER 図 (= テキスト)

```
species (id text)
   │
   │ 1:N
   ▼
products (id uuid)              users (id uuid)              shops (id uuid)
   │ N:1                          │ 1:N                       │ 1:N
   │                              │                           │
   ▼                              ▼                           ▼
product_translations          specimens (id uuid)         listings (id uuid)
                                  │  ▲    ▲                  │
                                  │  │    │                  │ N:1
                                  │  └─父─┤                  │
                                  │       │                  ▼
                                  │  ┌─母─┘              users (seller)
                                  │  │
                                  ▼  │
                              specimen_logs              watches (uuid)
                                                          │ N:1
                                                          ▼
                                                       users / products / listings

orders (id uuid; Phase 9.1 既存) ─── 1:N ─── order_items
                                  └── 1:1 ─── shipping_addresses

cart_items (id uuid)  ─── N:1 ─── products
                      └── N:1 ─── users (or session_id)

shipping_methods (id text)
prefectures (code text PK)
```

## 5. Migration 順序と依存

```
0001_initial.sql (= 既存 / orders 系)
  ↓
0002_master_data.sql      species / shops / prefectures / shipping_methods
  ↓
0003_products.sql         products → species / shops を参照
  ↓
0004_users.sql            users / user_sessions
  ↓ (ここから user-owned data)
0005_specimens.sql        specimens → users / species / shops 参照 + 自己参照
  ↓
0006_specimen_logs.sql    specimen_logs → specimens / users
0007_bloodlines.sql       mating_records → specimens / users
  ↓
0008_market.sql           listings / watches / cart_items
  ↓ (orders 関連の order_items.product_id を products に FK 化)
0009_orders_link_products.sql    order_items.product_id を TEXT → UUID + FK
```

## 6. Rust / API 影響範囲

### 6.1 server 側 handler の置換ポイント

| 既存 | 移行先 | 影響度 |
|---|---|---|
| `cards.rs::product_filter_meta()` (= HashMap 返す) | `repos::products.rs::list_products(filter)` (= sqlx クエリ) | **大** (cart card 構築 / list_product_cards 全部) |
| `cards.rs::mock_store()` / `detail_mock_store()` | `repos::products.rs::find_by_public_id` + card builder で組み立て | **大** |
| `cards.rs::japan_prefectures()` | `repos::prefectures.rs::list_all()` (= cache OnceLock + 47 件 fetch) | 中 |
| `checkout.rs::SHIPPING_METHODS` | `repos::shipping_methods.rs::list_active()` | 中 |
| `cart.rs::cart_store()` (= Mutex<HashMap>) | `repos::cart.rs` 経由で `cart_items` テーブル | 大 (cart 操作は server-driven なので handler 全体差し替え) |
| `checkout.rs::checkout_store()` | `repos::shipping_addresses.rs` (= user 単位) | 中 |
| `watch.rs` in-memory | `repos::watches.rs` | 中 |

### 6.2 client 側 `api/*.ts` の置換ポイント

| 既存 | 移行先 |
|---|---|
| `api/user.ts::getCurrentUser()` | `GET /api/v1/me` (= session から自分を引く) |
| `api/products.ts::listProducts()` | 既存 `/api/v1/cards/products` で代替 (= SDUI ProductListResponse) |
| `api/specimens.ts::listSpecimens()` | `GET /api/v1/me/specimens` (新設) |
| `api/logs.ts::listLogs()` | `GET /api/v1/me/specimens/{id}/logs` (新設) |
| `api/market.ts::listMarketListings()` | `GET /api/v1/listings` (新設) |
| `api/shop.ts::getShopStats()` | `GET /api/v1/shops/{id}/stats` (新設) |

### 6.3 SDUI 側との関係

- `cards/products` 系は既に SDUI 経由で server から組み立てて返している → 内部実装が `product_filter_meta` から DB に変わるだけで client の SDUI コードは無変更。
- 個体カルテ / ログ / 市場は **まだ SDUI 化されていない** (= mock data 直読み)。Phase 9.D で「DB 化 + SDUI 化」を同時にやる選択肢もあるが、本ドキュメントは DB 化に集中。SDUI 化は別 Phase。

## 7. 段階的展開 (= 実装ロードマップ)

| Step | Phase | 工数目安 | 依存 |
|---|---|---|---|
| 1 | 0002 + 0003 (= マスタ + products) を migration として書く | 1d | 既存 0001 |
| 2 | `repos::products.rs` を sqlx で実装 (list / find_by_public_id) | 0.5d | step 1 |
| 3 | `cards.rs` の `product_filter_meta` 呼び出し全箇所を repo 経由に切替 | 1d | step 2 |
| 4 | mock_store / detail_mock_store を builder 関数化 (= DB から組み立て) | 1d | step 3 |
| 5 | テスト fixture を SQL transaction 内で seed する pattern を確立 | 0.5d | step 4 |
| 6 | 0002 の `shipping_methods` / `prefectures` を server で使う handler に切替 | 0.5d | step 1 |
| 7 | 0004 (= users + sessions) + Cookie middleware | 1d | step 1 |
| 8 | 0005 + 0006 + 0007 (= specimens / logs / bloodlines) | 2d | step 7 |
| 9 | client `api/*.ts` を `fetch /api/v1/me/*` に置換 | 1d | step 8 |
| 10 | 0008 (= listings / watches / cart_items) | 1.5d | step 7 |
| 11 | 0009 (= order_items.product_id を FK 化) | 0.5d | step 10 |

合計: 約 10.5 日。実装中に未解決事項が出て Phase 切り直しになる可能性あり。

## 8. 未解決事項 (= 要決定)

### 8.1 既存 in-memory store の挙動互換性

- `cart_store::add_to_cart` は新しい token を発行して返す。DB 化したら `cart_items.id (UUID)` を token として返すか、別カラム `undo_token` を持つか?
- Undo は時間制限が無く、`DELETE /cart/items/{token}` でいつでも消せる。DB 化したら soft delete + TTL を導入するか?

→ **提案**: Undo token は cart_items.id (UUID) を hex で返すだけにし、削除は physical DELETE のままにする (= 1 ユーザの操作なので race も少ない)。Soft delete は不要。

### 8.2 cart の「セッション → ユーザ紐付け」

未ログインユーザがカートに入れて、その後ログインしたとき、`session_id` ベースの cart を `user_id` に bind する処理が要る:

```sql
UPDATE cart_items SET user_id = $login_user_id, session_id = NULL
WHERE session_id = $current_session_id;
```

→ **提案**: Phase 9.C (users + session) と Phase 9.E (cart_items DB 化) で同時に実装。

### 8.3 specimens の bloodline (father_id / mother_id) の野生親

`bloodline: { father: "野生", mother: "野生" }` は specimens テーブルに該当 row が無いので FK で表現できない。

→ **提案**: NULLABLE FK + 別フィールド `father_label` / `mother_label` で表現 (= mating_records と同じパターン)。

### 8.4 `data.ts` の seed をいつ削除するか

DB 移行後、`client_solid/src/data.ts` の `APP_DATA` は不要になる。ただし client 側 component 一部 (= SDUI 化されていない MyPage 等) はまだ参照している。

→ **提案**: Phase 9.D 完了 + 関連 SDUI 化が終わるまで `APP_DATA` は残し、test fixture として `client_solid/src/data.legacy.ts` に退避する (= Cart.legacy.tsx と同じパターン)。

### 8.5 product translation の locale 既定値

product / species の i18n は MVP では ja のみ。`locale="ja"` 行が無い場合のフォールバックは?

→ **提案**: server 側 query で `WHERE locale = $1 OR locale = 'ja'` で `'ja'` を fallback として優先。client 側で「翻訳が無いなら public_id を表示」のような縮退も検討。

### 8.6 価格 / amount のスケーリング

`amount_jpy` / `price_jpy` を `BIGINT` で持つが、設計書 §4.2.2 で言及した「多通貨化時は minor unit (= USD cent) に統一する破壊的変更」とどう整合させるか?

→ **提案**: 多通貨化時は新カラム `amount_minor BIGINT` + `currency TEXT` を追加し、既存の `*_jpy` を `GENERATED ALWAYS AS (CASE WHEN currency='JPY' THEN amount_minor ELSE NULL END)` で互換維持する。

### 8.7 Auth strategy

users.email / password 等の認証情報は **Phase 9.F (= 後続)** で `argon2` + `jsonwebtoken` を入れる前提。MVP では:
- Cookie ベース session のみ
- "anonymous" session は user_id = NULL の `user_sessions` 行で表現
- ログイン UI / 登録 UI は本ドキュメントのスコープ外

### 8.8 RDS / Aurora での運用差異

production (= AWS Aurora PostgreSQL 互換) では `uuid-ossp` 拡張が利用可能。serverless v2 で連続スケールするので connection pool サイズに注意 (= sqlx default 5 → production 増加検討)。

## 9. 設計書として確定したい論点

実装着手前に以下を確定してください:

| # | 論点 | 推奨デフォルト |
|---|---|---|
| 1 | `products.public_id` の命名規則 (= `p-<species>-<sex>-<size>`) を契約として固定するか? | **固定する** (= URL slug としてユーザの目に触れる) |
| 2 | `specimens.public_id` の `#DHH-0271` 形式は維持? `#` プレフィックスは必要? | **維持** (= UI と完全一致 / ハッシュタグ風 ID で発見しやすい) |
| 3 | `listings.public_id` の `L-0421` 形式は連番 vs random? | **random suffix** (= 連番だと出品数が漏れる) |
| 4 | i18n: ja のみ MVP / en は将来? | **ja のみ MVP** (= en 対応は §17 Future Work) |
| 5 | カート Undo の TTL を入れるか? | **入れない** (= MVP では永久; ユーザが明示削除するまで残す) |
| 6 | specimens の物理削除を許すか? | **許さない** (= soft delete のみ; lifeStatus + is_archived) |
| 7 | analytics_events を DB 化するタイミング | **Phase 9 では DB 化しない** (= ring buffer のまま、Phase 10+ で S3 / Athena に流す) |
| 8 | shopStats を view にするか materialized view にするか | **view (read-only)** (= MVP の order 数では十分) |
| 9 | Phase 9.A〜E のうち、**最優先で着手するもの**は? | **9.B (products)** (= product_filter_meta の置換が一番影響範囲広く、設計検証になる) |

## 10. 着手提案 (= ユーザレビュー後)

レビュー後の着手順:

1. **段階 0**: 本ドキュメント §9 の論点を確定
2. **段階 1**: `0002_master_data.sql` + `0003_products.sql` を書いて `cargo sqlx migrate run` で適用、adminer で seed 確認
3. **段階 2**: `repos::products.rs` を実装し、`cards.rs::product_filter_meta` 呼び出しを 1 箇所だけ repo 経由に切替 (= smoke test)
4. **段階 3**: 残り全箇所を切替 / mock_store も DB 経由に
5. **段階 4**: 既存 cargo test + vitest で回帰確認
6. **段階 5**: Phase 9.A の他テーブル (= shipping_methods / prefectures) も同様に切替
7. **段階 6**: Phase 9.C (= users + session middleware) に進む

各段階で **migration を 1 ファイル単位で commit** し、roll back 可能にする (= 1 migration = 1 PR)。

## 11. 参考にした既存設計

- `docs/sdui-three-layer-model-v6.md` §4.2.2 (= 数値型のマッピング規約 = i64 → number)
- `docs/sdui-three-layer-model-v6.md` §17 Future Work (= 多通貨対応の minor unit)
- `server/migrations/0001_initial.sql` (= orders / order_items / shipping_addresses の既存 schema)
- `server/src/handlers/cards.rs::product_filter_meta` (= 商品マスタの現行 hardcoded 定義)
- `client_solid/src/data.ts::APP_DATA` (= mock データ全体)
tore()` | `repos::shipping_addresses.rs` (= user 単位) | 中 |
| `watch.rs` in-memory | `repos::product_watches.rs` / `repos::listing_watches.rs` (= 2 分割) | 中 |
| `handlers/events.rs` ring buffer | (将来) `analytics_events` table or DynamoDB / S3 | 低 |

### 6.2 client 側 `api/*.ts` の置換ポイント

| 既存 | 移行先 |
|---|---|
| `api/user.ts::getCurrentUser()` | `GET /api/v1/me` (= session から自分を引く) |
| `api/products.ts::listProducts()` | 既存 `/api/v1/cards/products` で代替 (= SDUI ProductListResponse) |
| `api/specimens.ts::listSpecimens()` | `GET /api/v1/me/specimens` (新設) |
| `api/logs.ts::listLogs()` | `GET /api/v1/me/specimens/{id}/logs` (新設) |
| `api/market.ts::listMarketListings()` | `GET /api/v1/listings` (新設) |
| `api/shop.ts::getShopStats()` | `GET /api/v1/shops/{id}/stats` (新設) |

### 6.3 SDUI 側との関係

- `cards/products` 系は既に SDUI 経由で server から組み立てて返している → 内部実装が `product_filter_meta` から DB に変わるだけで client の SDUI コードは無変更。
- 個体カルテ / ログ / 市場は **まだ SDUI 化されていない** (= mock data 直読み)。Phase 9.D で「DB 化 + SDUI 化」を同時にやる選択肢もあるが、本ドキュメントは DB 化に集中。SDUI 化は別 Phase。

## 7. 段階的展開 (= 実装ロードマップ)

| Step | Phase | 工数目安 | 依存 |
|---|---|---|---|
| 1 | 0002 + 0003 (= マスタ + products) を migration として書く | 1d | 既存 0001 |
| 2 | `repos::products.rs` を sqlx で実装 (list / find_by_public_id) | 0.5d | step 1 |
| 3 | `cards.rs` の `product_filter_meta` 呼び出し全箇所を repo 経由に切替 | 1d | step 2 |
| 4 | mock_store / detail_mock_store を builder 関数化 (= DB から組み立て) | 1d | step 3 |
| 5 | テスト fixture を SQL transaction 内で seed する pattern を確立 | 0.5d | step 4 |
| 6 | 0002 の `shipping_methods` / `prefectures` を server で使う handler に切替 | 0.5d | step 1 |
| 7 | 0004 (= users + sessions) + Cookie middleware | 1d | step 1 |
| 8 | 0005 + 0006 + 0007 (= specimens / logs / bloodlines + status_history) | 2d | step 7 |
| 9 | client `api/*.ts` を `fetch /api/v1/me/*` に置換 | 1d | step 8 |
| 10 | 0008 (= listings / bids / watches / cart_items) + VIEW | 1.5d | step 7 |
| 11 | 0009 (= order_items.product_id を FK 化) | 0.5d | step 10 |

合計: 約 10.5 日。レビュー対応により `specimen_status_history` / `bids` / `product_watches` / `listing_watches` / `v_listings_with_counts` が増えたが、各テーブルは小規模なので工数増加は誤差レベル。

## 8. 未解決事項 → レビュー対応で確定したもの

レビュー v2 で以下を確定:

| # | 元論点 | 確定 |
|---|---|---|
| 8.1 | カート Undo token は何を返すか | `cart_items.id (UUID)` を hex で返す。soft delete 不要、physical DELETE のまま (Medium #1 と整合) |
| 8.2 | session → user 紐付けの cart 引き継ぎ | Phase 9.C (users + session) と Phase 9.E (cart_items DB 化) で同時実装。`UPDATE cart_items SET user_id = $login_user_id, session_id = NULL WHERE session_id = $current_session_id;` |
| 8.3 | specimens の野生親表現 | NULLABLE FK + `father_label` / `mother_label` フィールドで補完 (= specimens に追加済み) |
| 8.4 | `data.ts` APP_DATA の削除タイミング | Phase 9.D 完了 + 関連 SDUI 化が終わるまで残置。完了時に `data.legacy.ts` に退避 (= Cart.legacy.tsx と同じパターン) |
| 8.5 | product/species translation の locale fallback | server query で `WHERE locale = $1 OR locale = 'ja'` で `'ja'` を fallback。client 側でも「翻訳が無いなら public_id 表示」の縮退を想定 |
| 8.6 | 多通貨化時の amount スケーリング | 多通貨化時は `amount_minor BIGINT` + `currency TEXT` を追加し、`*_jpy` を `GENERATED ALWAYS AS (CASE WHEN currency='JPY' THEN amount_minor ELSE NULL END)` で互換維持 |
| 8.7 | Auth strategy | Phase 9.F で `argon2` + `jsonwebtoken`。MVP は Cookie-only (anonymous = user_id NULL) |
| 8.8 | RDS / Aurora 差異 | `gen_random_uuid()` (PG 13+ 標準) は Aurora でも利用可。connection pool は production で 5 → 30 程度に拡張想定 |

## 9. 確定した論点 (= レビュー対応 v2)

実装着手前のレビュー結果:

| # | 論点 | 確定 |
|---|---|---|
| 1 | `products.public_id` の命名規則 | **固定** (`p-<species>-<sex>-<size>` を契約として明文化) |
| 2 | `specimens.public_id` の `#DHH-0271` 形式 | **維持** |
| 3 | `listings.public_id` 形式 | **random suffix** (= 連番だと出品数が漏れる) |
| 4 | i18n 多言語対応 | **ja のみ MVP** / en は `name_en` カラムを `prefectures` で先行採用 (= 軽量) |
| 5 | カート Undo TTL | **入れない** (永久; ユーザ明示削除のみ) |
| 6 | specimens 物理削除 | **許さない** (= soft delete のみ; lifeStatus + is_archived) |
| 7 | analytics_events DB 化 | **Phase 9 では DB 化しない** (= ring buffer のまま、Phase 10+ で S3 / Athena) |
| 8 | shopStats: view vs materialized view | **view (read-only)** |
| 9 | Phase 9.A〜E の最優先 | **9.B (products)** |

レビュー追加で確定:

| # | 論点 | 確定 |
|---|---|---|
| 10 | watches モデル | **2 テーブル分割** (`product_watches` / `listing_watches`) |
| 11 | products.badge 表現 | **`badge_kind` TEXT enum** + i18n は SDUI 辞書から |
| 12 | listings.bid_count / watcher_count | **VIEW で集計** (= 列に持たない) |
| 13 | 状態遷移履歴 | `specimen_status_history` を最初から作る |
| 14 | 数値型 | **NUMERIC** (= REAL の浮動小数丸めを回避) |
| 15 | 認証 token format | **phc 形式** (TEXT) + `LIKE '$%$%$%'` の format CHECK |
| 16 | sex 値域不一致 | **`is_pair BOOLEAN` で別表現**、sex は両者揃える |
| 17 | 部分 index | **MVP は通常 index** / archived 比率を計測してから判断 |
| 18 | UUID 生成関数 | **新規 migration から `gen_random_uuid()`** / 0001 は据え置き |
| 19 | bids テーブル | **新設** (Medium #2 の VIEW 集計案前提) |

## 10. 着手提案 (= ユーザレビュー後)

レビュー後の着手順:

1. **段階 0 完了**: 本ドキュメント §9 の論点 19 件確定 ✅
2. **段階 1**: `0002_master_data.sql` + `0003_products.sql` を書いて `cargo sqlx migrate run` で適用、adminer で seed 確認
3. **段階 2**: `repos::products.rs` を実装し、`cards.rs::product_filter_meta` 呼び出しを 1 箇所だけ repo 経由に切替 (= smoke test)
4. **段階 3**: 残り全箇所を切替 / mock_store も DB 経由に
5. **段階 4**: 既存 cargo test + vitest で回帰確認
6. **段階 5**: Phase 9.A の他テーブル (= shipping_methods / prefectures) も同様に切替
7. **段階 6**: Phase 9.C (= users + session middleware) に進む

各段階で **migration を 1 ファイル単位で commit** し、roll back 可能にする (= 1 migration = 1 PR)。

## 11. 参考にした既存設計

- `docs/sdui-three-layer-model-v6.md` §4.2.2 (= 数値型のマッピング規約 = i64 → number)
- `docs/sdui-three-layer-model-v6.md` §17 Future Work (= 多通貨対応の minor unit)
- `server/migrations/0001_initial.sql` (= orders / order_items / shipping_addresses の既存 schema)
- `server/src/handlers/cards.rs::product_filter_meta` (= 商品マスタの現行 hardcoded 定義)
- `client_solid/src/data.ts::APP_DATA` (= mock データ全体)

## 12. Future Work (= レビューで指摘されたが MVP 範囲外)

| 項目 | トリガ条件 | 内容 |
|---|---|---|
| `specimen_logs` パーティショニング | 行数 100 万件 / メンテ窓拡大時 | `RANGE PARTITION BY (logged_at)` で年 or 月単位 |
| 部分 index 化 | archived 比率が 90%+ になった時 | `WHERE is_active` / `WHERE NOT is_archived` の部分 index に切替 |
| 多通貨対応 | 海外ショップ参入時 | `amount_minor BIGINT + currency TEXT` 追加、`*_jpy` を GENERATED 互換維持 |
| `bids` の current_price 自動更新 | bids 数が 1000 件超で確認 | AFTER INSERT トリガで `listings.current_price_jpy = MAX(amount_jpy)` |
| `gen_random_uuid()` への 0001 統一 | scheme version 揃え必要時 | 既存 0001 を新 migration で書き換える破壊的変更 |
| `products.image_cdn_url` 追加 | 画像 CDN (R2/CloudFront) 整備時 | `ph_label` を削除し画像 URL 直書き |
| materialized view 化 (shopStats) | order 数 10 万件超 | `CREATE MATERIALIZED VIEW shop_stats` + 1 時間ごと REFRESH |
