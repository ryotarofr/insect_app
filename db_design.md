# KOCHU insect_app DB 設計書

`server/migrations/0001_initial.sql 〜 0011_orders_user_fk.sql` を統合した、全 23 テーブルの設計書です。
ER 図 (`db_design_er.drawio`) と組み合わせて参照してください。

## 目次

- [1. user 系](#1-user-系)
  - [1.1 users](#11-users)
  - [1.2 user_sessions](#12-user_sessions)
- [2. master 系](#2-master-系)
  - [2.1 species](#21-species)
  - [2.2 species_translations](#22-species_translations)
  - [2.3 shops](#23-shops)
  - [2.4 prefectures](#24-prefectures)
  - [2.5 shipping_methods](#25-shipping_methods)
  - [2.6 shipping_method_translations](#26-shipping_method_translations)
  - [2.7 stripe_webhook_events](#27-stripe_webhook_events)
- [3. product 系](#3-product-系)
  - [3.1 products](#31-products)
  - [3.2 product_translations](#32-product_translations)
  - [3.3 cart_items](#33-cart_items)
  - [3.4 product_watches](#34-product_watches)
- [4. order 系](#4-order-系)
  - [4.1 orders](#41-orders)
  - [4.2 order_items](#42-order_items)
  - [4.3 shipping_addresses](#43-shipping_addresses)
- [5. specimen 系](#5-specimen-系)
  - [5.1 specimens](#51-specimens)
  - [5.2 specimen_status_history](#52-specimen_status_history)
  - [5.3 specimen_logs](#53-specimen_logs)
  - [5.4 mating_records](#54-mating_records)
- [6. market 系](#6-market-系)
  - [6.1 listings](#61-listings)
  - [6.2 bids](#62-bids)
  - [6.3 listing_watches](#63-listing_watches)
  - [6.4 v_listings_with_counts (VIEW)](#64-v_listings_with_counts-view)

---

## 凡例

- **PK**: 主キー / **FK**: 外部キー / **PFK**: 主キー兼外部キー
- **NN**: NOT NULL / **U**: UNIQUE 制約
- 型表記は PostgreSQL 互換 (`UUID` / `TEXT` / `BIGINT` / `TIMESTAMPTZ` / `JSONB` 等)
- `set_updated_at()` トリガが付くテーブルは更新時に自動で `updated_at = now()` が走る

---

## 1. user 系

### 1.1 `users`

ユーザマスタ。認証・監査・C2C 出品の seller として参照される。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | 内部 PK |
| public_id | TEXT | NN, U | | URL/@-handle に出る short slug。例: `t_yamada` |
| name | TEXT | NN | | 表示名。例: `山田 徹` |
| role | TEXT | NN, CHECK | `'breeder'` | 役割。`breeder` / `admin` / `shop_owner` |
| email | TEXT | U | NULL | 任意。OAuth/login 用 |
| avatar_initial | TEXT | NN | | アバター 1 文字。例: `山` |
| joined_at | TIMESTAMPTZ | NN | `now()` | 加入日時。表示用 (`2024.03`) |
| is_active | BOOLEAN | NN | `true` | 有効フラグ |
| password_hash | TEXT | CHECK (phc 形式) | NULL | Argon2id ハッシュ。OAuth ユーザは NULL 可 |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

**インデックス**: `idx_users_active(is_active)` / `idx_users_role(role)` / public_id・email は UNIQUE による自動 index

### 1.2 `user_sessions`

Cookie ベース認証セッション。1 行 = 1 アクティブ session。`expires_at` を超えたら GC で物理削除。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | session id |
| user_id | UUID | FK→users(id) ON DELETE CASCADE | NULL | NULL = 匿名 session (ログイン前 cart 等) |
| token_hash | TEXT | NN, U, CHECK (phc 形式) | | Argon2id phc 文字列 |
| expires_at | TIMESTAMPTZ | NN | | 有効期限 |
| created_at | TIMESTAMPTZ | NN | `now()` | |

**インデックス**: `idx_user_sessions_user_id(user_id)` / `idx_user_sessions_expires(expires_at)`

---

## 2. master 系

### 2.1 `species`

種マスタ。半固定 (= ops が稀に編集) のため `text PK` を採用。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | TEXT | PK, NN | | 短い slug。例: `dhh` / `cat` |
| sci_name | TEXT | NN | | 学名。例: `Dynastes hercules hercules` |
| region | TEXT | NN | | 生息地。例: `中南米` |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

### 2.2 `species_translations`

種名の locale 別表記。複合 PK で 1 種 × 1 locale に 1 行。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| species_id | TEXT | PFK→species(id) ON DELETE CASCADE | |
| locale | TEXT | PK | `ja` / `en` 等 |
| name | TEXT | NN | 例: `ヘラクレスオオカブト` |

### 2.3 `shops`

ショップマスタ。MVP は 1 行 (= ANCHOR BEETLE CO.) のみだが将来複数ショップに拡張可能。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | |
| public_id | TEXT | NN, U | | URL に乗る slug。例: `anchor-beetle` |
| name | TEXT | NN | | 例: `ANCHOR BEETLE CO.` |
| description | TEXT | | NULL | |
| is_active | BOOLEAN | NN | `true` | |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

**インデックス**: `idx_shops_active(is_active)`

### 2.4 `prefectures`

47 都道府県マスタ。`code` は JIS X 0401 (`01` 〜 `47`)。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| code | TEXT | PK, NN | JIS コード (zero-pad 2桁) |
| name_ja | TEXT | NN | 日本語名。例: `北海道` |
| name_en | TEXT | | 英語名。例: `Hokkaido` |
| sort_order | INTEGER | NN | JIS 順 (1〜47) |

### 2.5 `shipping_methods`

配送方法マスタ。MVP は `cold` (温度制御便 1800円) / `normal` (通常便 800円) の 2 件。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | TEXT | PK, NN | | `cold` / `normal` 等 |
| sort_order | INTEGER | NN | `0` | UI 表示順 |
| amount_jpy | BIGINT | NN, CHECK (≥0) | | 配送料 (JPY) |
| is_active | BOOLEAN | NN | `true` | |
| created_by | UUID | FK→users(id) ON DELETE SET NULL | NULL | 監査 (作成者) |
| updated_by | UUID | FK→users(id) ON DELETE SET NULL | NULL | 監査 (更新者) |
| version | INTEGER | NN | `0` | 楽観ロック |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

**インデックス**: `idx_shipping_methods_active(is_active, sort_order)`

### 2.6 `shipping_method_translations`

配送方法の locale 別文言。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| method_id | TEXT | PFK→shipping_methods(id) ON DELETE CASCADE | |
| locale | TEXT | PK | |
| name | TEXT | NN | 例: `温度制御便（推奨）` |
| description | TEXT | | 例: `生体含むため必須設定 · 15〜25℃` |

### 2.7 `stripe_webhook_events`

Stripe webhook 受信履歴 + event_id による冪等性確保。同じ `evt_xxx` を 2 度処理しない。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | TEXT | PK, NN | | Stripe event id (例: `evt_test_xxx`) |
| event_type | TEXT | NN | | 例: `checkout.session.completed` |
| received_at | TIMESTAMPTZ | NN | `now()` | 受信時刻 |
| payload_json | JSONB | NN | `'{}'` | raw body (replay/debug 用) |

**インデックス**: `idx_stripe_webhook_events_received_at(received_at DESC)` (90 日 GC 用)

---

## 3. product 系

### 3.1 `products`

商品マスタ。`kind = live`(生体) / `supply`(用品) の 2 種。`live` は `species_id NOT NULL` を CHECK 制約で強制。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | |
| public_id | TEXT | NN, U | | URL slug。命名: `p-<species>-<sex>-<size>` 例: `p-hh-m-142` |
| shop_id | UUID | FK→shops(id), NN | | 出品ショップ |
| kind | TEXT | NN, CHECK | | `live` / `supply` |
| difficulty | TEXT | CHECK | NULL | `easy` / `medium` / `hard` (live のみ意味あり) |
| species_id | TEXT | FK→species(id) | NULL | live なら必須 (CHECK 制約) |
| sex | TEXT | CHECK | NULL | `male` / `female` / `unknown` |
| is_pair | BOOLEAN | NN | `false` | ペア販売 (雌雄セット) |
| generation | TEXT | | NULL | 系統。例: `CBF2` / `WF1` |
| size_mm | NUMERIC(5,1) | | NULL | 計測値 (mm) |
| price_jpy | BIGINT | NN, CHECK (≥0) | | 税込 JPY |
| badge_kind | TEXT | CHECK | NULL | `recommended` / `new` / `low_stock` / `rare` / `larva` / `consumable` / `popular` / `warning` |
| tone | TEXT | NN, CHECK | | `forest` / `amber` (UI トーン) |
| ph_label | TEXT | NN | | placeholder image label (例: `D`) |
| is_active | BOOLEAN | NN | `true` | |
| created_by | UUID | FK→users(id) ON DELETE SET NULL | NULL | 監査 |
| updated_by | UUID | FK→users(id) ON DELETE SET NULL | NULL | 監査 |
| version | INTEGER | NN | `0` | 楽観ロック |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

**CHECK 制約**: `live_requires_species` (`kind != 'live' OR species_id IS NOT NULL`)
**インデックス**: kind / difficulty / species_id / shop_id / created_at / is_active 各単独 index

### 3.2 `product_translations`

商品名・説明の locale 別表記。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| product_id | UUID | PFK→products(id) ON DELETE CASCADE | |
| locale | TEXT | PK | |
| title | TEXT | NN | 例: `ヘラクレスオオカブト ♂ 142mm` |
| description | TEXT | | NULL 可 |

**インデックス**: `idx_product_translations_locale(locale)`

### 3.3 `cart_items`

カート行 (= server 永続のカート)。`session_id` または `user_id` のどちらかが必須 (guest cart 対応)。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | Undo token として hex で client に返す |
| session_id | UUID | FK→user_sessions(id) ON DELETE CASCADE | NULL | guest cart |
| user_id | UUID | FK→users(id) ON DELETE CASCADE | NULL | login 後 |
| product_id | UUID | FK→products(id), NN | | |
| qty | INTEGER | NN, CHECK (1〜99) | | UI 上限と一致 |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

**CHECK 制約**: `cart_owner_present` (`session_id IS NOT NULL OR user_id IS NOT NULL`)
**インデックス**: 部分 index で session/user 各々を NULL でない側だけ拾う + product_id

### 3.4 `product_watches`

商品ウォッチ (ハートマーク留め)。`(user_id, product_id)` 複合 PK で 1 ユーザ × 1 商品 = 1 行。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| user_id | UUID | PFK→users(id) ON DELETE CASCADE | |
| product_id | UUID | PFK→products(id) ON DELETE CASCADE | |
| created_at | TIMESTAMPTZ | NN, default `now()` | |

**インデックス**: `idx_product_watches_product(product_id)` (商品側からの逆引き)

---

## 4. order 系

### 4.1 `orders`

注文ヘッダ。1 注文 = 1 行。Stripe Checkout Session 作成時に INSERT、webhook 受信で UPDATE。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `uuid_generate_v4()` | Stripe Session の `client_reference_id` にも乗せる |
| user_id | UUID | FK→users(id) ON DELETE SET NULL | NULL | 0011 で追加。匿名注文は NULL |
| session_id | TEXT | NN | | cart_store の session token |
| stripe_session_id | TEXT | | NULL | `cs_test_...` / `cs_live_...` |
| stripe_payment_intent_id | TEXT | | NULL | `pi_...` (webhook 確定後に書く) |
| status | TEXT | NN, CHECK | `'pending'` | `pending` / `paid` / `failed` / `canceled` |
| amount_jpy | BIGINT | NN, CHECK (≥0) | | 税込合計 |
| shipping_jpy | BIGINT | | NULL | 配送料 (NULL=0扱い) |
| metadata | JSONB | NN | `'{}'` | raw cart snapshot 等 (debug) |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

**インデックス**: `idx_orders_session_id_created_at(session_id, created_at DESC)` / `idx_orders_stripe_session_id` (部分: NOT NULL) / `idx_orders_status(status)` / `idx_orders_user_id(user_id, created_at DESC)` (部分: NOT NULL)

### 4.2 `order_items`

注文 1 行 (商品 × 数量)。注文確定時の snapshot。商品名・価格は注文時点で固定。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `uuid_generate_v4()` | |
| order_id | UUID | FK→orders(id) ON DELETE CASCADE, NN | | |
| product_id | TEXT | NN | | 注文時の `public_id` snapshot (例: `p-hh-m-142`) |
| product_uuid | UUID | FK→products(id) ON DELETE SET NULL | NULL | 0005 で追加。参照整合性確保 |
| title | TEXT | NN | | 注文時点の商品名 snapshot |
| unit_price_jpy | BIGINT | NN, CHECK (≥0) | | server 側計算 (改ざん防止) |
| qty | INTEGER | NN, CHECK (1〜99) | | |
| subtotal_jpy | BIGINT | NN, CHECK (≥0) | | server 側計算 |
| created_at | TIMESTAMPTZ | NN | `now()` | |

**インデックス**: `idx_order_items_order_id(order_id)` / `idx_order_items_product_uuid(product_uuid)`

### 4.3 `shipping_addresses`

配送先 (注文ヘッダごとに 1 件)。`order_id` UNIQUE で 1 注文 = 1 配送先。注文時点の snapshot。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `uuid_generate_v4()` | |
| order_id | UUID | FK→orders(id) ON DELETE CASCADE, NN, U | | 1注文1住所 |
| address_name | TEXT | NN | | 受取人氏名 |
| address_tel | TEXT | NN | | |
| address_zip | TEXT | NN | | 郵便番号 |
| address_pref | TEXT | NN | | 都道府県 |
| address_addr | TEXT | NN | | 住所詳細 |
| shipping_method_id | TEXT | NN | | (現状FKなし。`shipping_methods.id` 参照想定) |
| created_at | TIMESTAMPTZ | NN | `now()` | |

---

## 5. specimen 系

### 5.1 `specimens`

個体カルテ。飼育中の昆虫個体マスタ。削除しない方針 (`is_archived` で非表示化)。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | |
| public_id | TEXT | NN, U | | 例: `#DHH-0271` |
| owner_user_id | UUID | FK→users(id), NN | | 飼育者 |
| species_id | TEXT | FK→species(id), NN | | 種 |
| name | TEXT | NN | | 個体名。例: `ヘラクレス 黒曜` |
| sex | TEXT | NN, CHECK | | `male` / `female` / `unknown` |
| stage | TEXT | NN | | 飼育ステージ自由文字列 (蛹/成虫/幼虫N齢/前蛹) |
| stage_progress | NUMERIC(3,2) | NN, CHECK (0〜1) | | ステージ内進捗 |
| size_mm | NUMERIC(5,1) | | NULL | 体長 |
| weight_g | NUMERIC(6,2) | | NULL | 体重 |
| birth_date | DATE | | NULL | |
| purchased_at | DATE | | NULL | 取得日 |
| purchased_from_shop_id | UUID | FK→shops(id) | NULL | 取得元 |
| generation | TEXT | | NULL | 系統 (`CBF2` 等) |
| purchase_price_jpy | BIGINT | | NULL | 取得時価格 |
| eclosion_eta | DATE | | NULL | 羽化予測日 |
| life_status | TEXT | NN, CHECK | `'active'` | `active` / `deceased` / `transferred` / `escaped` |
| life_status_at | DATE | | NULL | 死着/譲渡/脱走日 |
| life_status_note | TEXT | | NULL | |
| notes | TEXT | | NULL | 自由メモ |
| father_id | UUID | FK→specimens(id) ON DELETE SET NULL | NULL | 父個体 (自己参照) |
| mother_id | UUID | FK→specimens(id) ON DELETE SET NULL | NULL | 母個体 (自己参照) |
| father_label | TEXT | | NULL | "野生" 等の自由テキスト fallback |
| mother_label | TEXT | | NULL | 同上 |
| is_archived | BOOLEAN | NN | `false` | 非表示化フラグ |
| created_by | UUID | FK→users(id) ON DELETE SET NULL | NULL | 監査 |
| updated_by | UUID | FK→users(id) ON DELETE SET NULL | NULL | 監査 |
| version | INTEGER | NN | `0` | 楽観ロック |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

**インデックス**: owner / archived / species / eclosion_eta(部分) / father(部分) / mother(部分)

### 5.2 `specimen_status_history`

`specimens.life_status` の遷移履歴 (不可逆ログ)。app 側で UPDATE 時に必ず INSERT する規律。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | UUID | PK, NN, default `gen_random_uuid()` | |
| specimen_id | UUID | FK→specimens(id) ON DELETE CASCADE, NN | |
| status | TEXT | NN, CHECK | `active` / `deceased` / `transferred` / `escaped` |
| changed_at | DATE | NN | 状態変更日 |
| note | TEXT | | NULL |
| author_user_id | UUID | FK→users(id), NN | 変更者 |
| created_at | TIMESTAMPTZ | NN, default `now()` | |

**インデックス**: `idx_specimen_status_specimen(specimen_id, changed_at DESC)`

### 5.3 `specimen_logs`

飼育ログ (体重 / 餌 / マット / 脱皮 / 観察)。`metrics` JSONB で log_type ごとの構造化データを保持。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | |
| specimen_id | UUID | FK→specimens(id) ON DELETE CASCADE, NN | | |
| author_user_id | UUID | FK→users(id), NN | | 投稿者 |
| log_type | TEXT | NN, CHECK | | `weight` / `feed` / `mat` / `molt` / `observation` |
| logged_at | DATE | NN | | ユーザ入力日 |
| logged_at_time | TIME | | NULL | 24h 表記、TZ なし (日本時刻ローカル前提) |
| title | TEXT | NN | | |
| body | TEXT | NN | `''` | |
| has_photo | BOOLEAN | NN | `false` | |
| metrics | JSONB | NN | `'{}'` | weight: `{weight_g}` / molt: `{head_width_mm, instar}` 等 |
| created_at | TIMESTAMPTZ | NN | `now()` | |

**インデックス**: specimen+logged_at / log_type / author

### 5.4 `mating_records`

交配試行記録 (specimens 化前の planning 段階)。系図完成前の途中経過を管理。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | |
| breeder_user_id | UUID | FK→users(id), NN | | 飼育者 |
| father_id | UUID | FK→specimens(id) ON DELETE SET NULL | NULL | 父 (登録済個体) |
| mother_id | UUID | FK→specimens(id) ON DELETE SET NULL | NULL | 母 (登録済個体) |
| father_label | TEXT | | NULL | 自由テキスト fallback |
| mother_label | TEXT | | NULL | 同上 |
| mated_at | DATE | NN | | 交配日 |
| egg_count | INTEGER | CHECK (NULL or ≥0) | NULL | 採卵数 |
| status | TEXT | NN, CHECK | `'planned'` | `planned` / `mated` / `eggs_laid` / `hatched` / `failed` |
| notes | TEXT | | NULL | |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

**インデックス**: breeder+mated_at / father(部分) / mother(部分)

---

## 6. market 系

### 6.1 `listings`

C2C 出品 (自分が育てた specimens を売る / 即決 or auction)。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | |
| public_id | TEXT | NN, U | | 例: `L-0421` |
| seller_user_id | UUID | FK→users(id), NN | | 出品者 |
| specimen_id | UUID | FK→specimens(id) ON DELETE SET NULL | NULL | 出品対象個体 |
| title | TEXT | NN | | 例: `ヘラクレス♂ 148mm 自家累代CBF3` |
| description | TEXT | | NULL | |
| is_auction | BOOLEAN | NN | `false` | true=オークション / false=即決 |
| starting_price_jpy | BIGINT | NN, CHECK (≥0) | | 開始価格 |
| current_price_jpy | BIGINT | | NULL | auction で更新される現在価格 |
| ends_at | TIMESTAMPTZ | | NULL | auction 終了時刻 (auction なら必須) |
| status | TEXT | NN, CHECK | `'active'` | `active` / `sold` / `canceled` / `expired` |
| is_verified | BOOLEAN | NN | `false` | 信頼マーク (MVP は手動) |
| created_by | UUID | FK→users(id) ON DELETE SET NULL | NULL | 監査 |
| updated_by | UUID | FK→users(id) ON DELETE SET NULL | NULL | 監査 |
| version | INTEGER | NN | `0` | 楽観ロック |
| created_at | TIMESTAMPTZ | NN | `now()` | |
| updated_at | TIMESTAMPTZ | NN | `now()` | トリガ自動更新 |

**CHECK 制約**:
- `auction_requires_ends_at` (`NOT is_auction OR ends_at IS NOT NULL`)
- `current_price_ge_starting` (`current_price_jpy IS NULL OR current_price_jpy >= starting_price_jpy`)

**インデックス**: status+ends / seller / specimen(部分)

### 6.2 `bids`

入札履歴 (auction の各入札を不可逆に記録)。

| カラム | 型 | 制約 | 既定値 | 説明 |
|---|---|---|---|---|
| id | UUID | PK, NN | `gen_random_uuid()` | |
| listing_id | UUID | FK→listings(id) ON DELETE CASCADE, NN | | |
| bidder_user_id | UUID | FK→users(id), NN | | 入札者 |
| amount_jpy | BIGINT | NN, CHECK (>0) | | 入札額 |
| bid_at | TIMESTAMPTZ | NN | `now()` | 入札時刻 |

**インデックス**: listing+bid_at / bidder

### 6.3 `listing_watches`

出品ウォッチ (`product_watches` の listing 版)。複合 PK で 1 ユーザ × 1 出品 = 1 行。

| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| user_id | UUID | PFK→users(id) ON DELETE CASCADE | |
| listing_id | UUID | PFK→listings(id) ON DELETE CASCADE | |
| created_at | TIMESTAMPTZ | NN, default `now()` | |

**インデックス**: `idx_listing_watches_listing(listing_id)`

### 6.4 `v_listings_with_counts` (VIEW)

`listings` に `bid_count` / `watcher_count` を派生集計した VIEW。drift を避けるため列に持たず VIEW で計算。

```sql
SELECT
    l.*,
    (SELECT COUNT(*) FROM bids b           WHERE b.listing_id = l.id) AS bid_count,
    (SELECT COUNT(*) FROM listing_watches w WHERE w.listing_id = l.id) AS watcher_count
FROM listings l;
```

| 派生カラム | 型 | 説明 |
|---|---|---|
| `l.*` | listings 全列 | |
| bid_count | BIGINT | `bids` の件数 |
| watcher_count | BIGINT | `listing_watches` の件数 |

**性能メモ**: MVP の規模 (数百件) なら subquery で十分。規模拡大時は MATERIALIZED VIEW + REFRESH に切替。

---

## 付録: 共通設計方針

### A. 主キー戦略

- **UUID PK** + `public_id` スラッグ: 内部 PK は UUID、URL/API には `public_id` (slug) を出す
  - 採用: `users` / `shops` / `products` / `specimens` / `listings` 等
  - 利点: rename / merge に強い、内部 ID リーク防止
- **TEXT PK 直接**: 半固定マスタで ops が変えない (URL に乗らない)
  - 採用: `species` / `prefectures` / `shipping_methods` / `stripe_webhook_events`

### B. 監査・楽観ロック (audit + version)

mutate 頻度の高いテーブルは以下 5 列を持つ:

- `created_by UUID FK→users(id) ON DELETE SET NULL`
- `updated_by UUID FK→users(id) ON DELETE SET NULL`
- `version INTEGER NOT NULL DEFAULT 0`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` + `set_updated_at()` トリガ

### C. 削除戦略

- **CASCADE**: 子テーブルのライフサイクルが親に従属する場合 (例: `order_items.order_id`)
- **SET NULL**: 履歴・監査として親が消えても子は残すべき場合 (例: `order_items.product_uuid`, audit `created_by` 全般)
- **物理削除しない**: `specimens` は `is_archived` フラグで非表示化

### D. i18n 戦略

商品名・種名・配送方法名など locale 依存の文言は別テーブル (`*_translations`) に分離:

- 親テーブルの追加で ALTER 不要
- 複合 PK `(parent_id, locale)` で 1 親 × 1 locale = 1 行
- `ON DELETE CASCADE` で親消失時に翻訳行も消える

### E. CHECK 制約の活用

enum 型ではなく `TEXT NOT NULL CHECK (col IN (...))` を採用:

- **理由**: enum は ALTER で値を増やしにくい (= migration が揺れる)
- **適用例**: `status` / `role` / `kind` / `sex` / `life_status` / `log_type` 等

### F. 部分 index

NULL を含む列で「NULL でない側だけ検索が走る」場合に部分 index を使用:

```sql
CREATE INDEX idx_cart_items_session ON cart_items (session_id) WHERE session_id IS NOT NULL;
```

### G. 拡張機能依存

- `uuid-ossp`: `uuid_generate_v4()` (0001 で `CREATE EXTENSION`)
- `pgcrypto` 不要: PG 13+ は `gen_random_uuid()` を built-in で提供
- Aurora PostgreSQL 互換性確認済

---

**最終更新**: 2026-04-27 (migration 0001 〜 0011 反映)
