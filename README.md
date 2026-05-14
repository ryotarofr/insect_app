# 昆虫C2Cマーケット × 飼育管理プラットフォーム

昆虫（カブトムシ・クワガタ等）の **C2C 取引** と飼育管理を統合したプラットフォーム。
飼育者が育てた個体を直接売買でき、個体カルテ・血統管理・羽化予測を一体で提供する。

> **C2C pivot (2026-05)**: 旧 B2C ショップモデル (= ANCHOR BEETLE CO. が商品を売る形) を全廃し、
> ユーザ間 (= ブリーダー → ブリーダー) の出品 / 購入モデルに切り替え済。
> `listings` が販売対象の唯一のエンティティで、購入確定時に specimen の owner が
> seller → buyer に譲渡される。詳細は [マイグレーション 0021](server/migrations/0021_c2c_pivot_drop_b2c_tables.sql) と
> [`docs/api-v1-endpoints.md`](docs/api-v1-endpoints.md) 参照。

## 技術スタック概要

> **インフラ方針 (2026-05 更新)**: インフラはすべて AWS に統一。
> 自社運用の OSS (Meilisearch / Redis 自前) と Cloudflare 系サービスは廃し、
> マネージドサービス (Aurora / ElastiCache / OpenSearch / S3 / MediaConvert 等) に寄せる。

| レイヤー | 技術 |
|----------|------|
| Web クライアント | Solid.js（PWA対応） |
| iOS クライアント | Swift / SwiftUI |
| バックエンド | Rust + Axum |
| コンピュート | **AWS ECS on Fargate** (API + Workers を別タスク) |
| コンテナレジストリ | **Amazon ECR** |
| ロードバランサ | **Application Load Balancer (ALB)** + **AWS WAF** |
| データベース | **Amazon Aurora PostgreSQL (Serverless v2)** |
| キャッシュ / キュー | **Amazon ElastiCache for Redis** |
| オブジェクトストレージ | **Amazon S3** |
| CDN / 画像配信 | **Amazon CloudFront** (+ S3 オリジン) |
| 動画変換 | **AWS Elemental MediaConvert** |
| 検索 | **Amazon OpenSearch Service** |
| AI | **Amazon Bedrock** (Claude 系モデル) |
| メール | **Amazon SES** |
| SMS | **Amazon SNS (SMS)** |
| プッシュ通知 | **Amazon SNS Mobile Push → APNs** |
| DNS | **Amazon Route 53** |
| TLS 証明書 | **AWS Certificate Manager (ACM)** |
| シークレット管理 | **AWS Secrets Manager** |
| ログ / メトリクス | **Amazon CloudWatch** |
| 分散トレーシング | **AWS X-Ray** (OpenTelemetry 経由) |
| ネットワーク | **VPC** (private subnet on API/DB, public on ALB) |

Androidは初期スコープから外す。PWAとしてAndroidユーザーにも最低限の体験を提供する。

## アーキテクチャ全体図

```
┌─────────────┐  ┌─────────────┐
│  Solid.js   │  │ Swift (iOS) │
│  (PWA対応)  │  │  SwiftUI    │
└──────┬──────┘  └──────┬──────┘
       │                │
       │  REST + OpenAPI│
       └────────┬───────┘
                │
        ┌───────▼────────┐
        │  CloudFront    │  ← 画像配信は S3 オリジンで合流
        └───────┬────────┘
                │
        ┌───────▼────────┐
        │  Route53 + WAF │
        └───────┬────────┘
                │
       ┌────────▼────────┐
       │      ALB        │
       └────────┬────────┘
                │
   ┌────────────┴────────────┐
   │                         │
┌──▼──────────┐      ┌───────▼─────────┐
│ ECS Fargate │      │  ECS Fargate    │
│  (API)      │      │  (Workers)      │
│  Axum +     │      │  apalis +       │
│  utoipa     │      │  scheduler      │
└──┬──────────┘      └────────┬────────┘
   │                          │
   │   ┌──────────────────────┘
   │   │
┌──▼───▼───┐  ┌───────────┐  ┌──────────┐  ┌────────────┐
│  Aurora  │  │ElastiCache│  │ OpenSearch│  │ Bedrock    │
│PostgreSQL│  │  (Redis)  │  │  Service  │  │ (Claude)   │
│ (sqlx)   │  │           │  │           │  │            │
└──────────┘  └───────────┘  └───────────┘  └────────────┘
       │
       └→ S3 (画像/動画 直接アップロード)
            │
            └→ MediaConvert（動画変換）→ S3 → CloudFront

外部連携: Stripe (決済) / SES (メール) / SNS (SMS, APNs Push)
シークレット: Secrets Manager / 監視: CloudWatch + X-Ray
```

## クライアントと API の契約

API は REST + OpenAPI 方式で定義する。Axum 側のハンドラに `utoipa` の属性を付与して OpenAPI スキーマを自動生成し、そのスキーマから両クライアントの型を生成する。

- Swift 側：`apple/swift-openapi-generator`
- TypeScript 側：`openapi-typescript` または `orval`

これにより、API の型が片方で変われば他方でコンパイルエラーになり、契約違反を構造的に防げる。

## バックエンド：コンポーネント別のクレート選定

### Web / 基盤

- `axum`：Web フレームワーク
- `tokio`：非同期ランタイム
- `tower` / `tower-http`：ミドルウェア
- `tracing` + `tracing-subscriber`：構造化ログ
- `config` + `envy`：設定

### データベース

- `sqlx`：型安全な SQL クエリ（コンパイル時検証可能）
- `sqlx-cli`：マイグレーション管理
- PostgreSQL：血統データ・飼育ログは JSONB 列で柔軟に扱う

### 認証・認可

- `jsonwebtoken`：JWT
- `argon2`：パスワードハッシュ
- `oauth2`：Google / Apple Sign In
- `tower-sessions`：セッション管理

### API 定義

- `utoipa`：OpenAPI スキーマ生成
- `utoipa-swagger-ui`：開発時の UI 確認

### 決済

- `async-stripe`：Stripe 統合（コミュニティ製、実運用多数）
- 国内決済（KOMOJU / GMO 等）は `reqwest` で REST 直叩き
- `hmac` + `sha2`：Webhook 署名検証

### プッシュ通知

- **Amazon SNS Mobile Push** 経由で APNs にディスパッチ
- iOS デバイストークンは `users` 配下の DB テーブルで管理し、SNS の Platform Application Endpoint に紐付け
- `aws-sdk-sns`：Rust 公式 SDK でサーバー側からトピック publish
- silent / alert はペイロード組み立てで切替

### 画像・動画処理

- 画像: クライアントから **S3** に直接アップロード (presigned URL)
- 配信は **CloudFront** + S3 オリジン。リサイズ/フォーマット変換が必要な場合は **Lambda@Edge** または **CloudFront Functions** で URL ベースの変換を実装
- 動画変換: **AWS Elemental MediaConvert** にジョブ投入、完了通知を **EventBridge → SNS** で受け取り、`assets` テーブルへ反映
- 変換後の HLS/DASH も S3 + CloudFront で配信

### ストレージ

- `aws-sdk-s3`：S3 公式 SDK (Rust)
- 署名 URL 発行によるダイレクトアップロード (帯域節約)
- バケットは用途別に分離: `kochu-assets-uploads` (生原本) / `kochu-assets-public` (CloudFront 配信)

### 検索

- **Amazon OpenSearch Service** (managed Elasticsearch 互換): 出品 / 個体カルテ / ブリーダーの横断検索
- ドメイン側は `kuromoji` analyzer で日本語形態素解析
- インデックス更新は API ハンドラから `aws-sdk-opensearch` または HTTP クライアント (`reqwest`) で書き込み
- 補助的に PostgreSQL 全文検索（`pg_trgm` + GIN index）も併用 (即時整合性が要る場面用)

### バックグラウンドジョブ

- `apalis`：ジョブキュー（Redis / PostgreSQL バックエンド対応）
- `tokio-cron-scheduler`：定期実行
- 用途：
  - 羽化予測の日次バッチ
  - 補充提案のユーザーごと計算
  - 死着補償の自動処理
  - メール・SMS・通知の非同期送信

### AI 統合

- **Amazon Bedrock** (Claude 系モデル) を一次バックエンドとする
- `aws-sdk-bedrockruntime`：InvokeModel / InvokeModelWithResponseStream
- IAM Role で API key 不要、VPC Endpoint 経由で AWS ネットワーク内に閉じる
- 画像認識（種同定）は **Amazon Rekognition** または Bedrock のマルチモーダルモデルを使用
- `ort`（ONNX Runtime）または `candle`：将来の自前 ML 推論用 (オプション)

### リアルタイム機能

- `axum::extract::ws`：WebSocket
- ElastiCache (Redis) Pub/Sub でスケール対応
- 規模拡大時は **Amazon API Gateway WebSocket** または AppSync へ移行検討

### メール・SMS

- **Amazon SES** (メール): `aws-sdk-sesv2` でテンプレ送信。バウンス/苦情は SNS topic で受領
- **Amazon SNS (SMS)** (SMS): `aws-sdk-sns` で publish。送信ログは CloudWatch Logs に蓄積
- ローカル開発では SES サンドボックス + 検証済アドレスのみで動かす

## プロジェクト構成

Cargo workspace でクレートを分離し、コアロジックをインフラから切り離す。

```
insect-app/
├── crates/
│   ├── core/            # ドメインロジック（純粋 Rust）
│   │   ├── domain/      # 個体、血統、注文等のエンティティ
│   │   └── service/     # ビジネスロジック
│   ├── api/             # Axum HTTP サーバー
│   │   ├── handlers/
│   │   ├── middleware/
│   │   └── openapi/
│   ├── workers/         # バックグラウンドジョブ
│   │   ├── predictions/
│   │   ├── notifications/
│   │   └── restock/
│   └── infrastructure/  # DB、外部 API、ストレージ
│       ├── db/
│       ├── stripe/
│       ├── apns/
│       └── storage/
├── migrations/          # sqlx マイグレーション
├── openapi/             # 生成された OpenAPI スキーマ
└── Cargo.toml           # ワークスペース定義
```

## 設計上の方針

### 動画処理の外部化

開封動画・個体動画の変換を自前サーバーで抱えるとリソースが瞬殺されるため、**AWS Elemental MediaConvert** に完全にオフロードする。S3 へのアップロードを EventBridge で受け、ジョブテンプレで HLS / DASH に変換する。サーバーはメタデータ管理とアクセス制御のみ担当する。

### ダイレクトアップロード

画像・動画はクライアントから **S3** へ直接アップロードする (presigned URL)。サーバーは署名 URL 発行と完了通知受信 (EventBridge) のみを担当し、帯域を使わない。

### Webhook の信頼性

Stripe、APNs、動画変換サービスからの Webhook は `axum::middleware` で署名検証と冪等性確保を共通化する。受信失敗時のリトライ・デッドレター処理も初期から組み込む。

### 型の一気通貫

OpenAPI を一次情報とし、Rust / Swift / TypeScript の型が同一スキーマから生成される状態を維持する。手書きの型定義を各クライアントに置かない。

### コンパイル速度対策

- `mold` linker 導入（Linux 環境で劇的に速い）
- `cargo-watch` / `bacon` で変更検知と自動再ビルド
- ワークスペース分割で影響範囲を局所化

## 外部依存サービス

> AWS 統一方針 (2026-05) に基づき、インフラ系はすべてマネージド AWS サービスに集約。
> 外部 SaaS は Stripe (決済) のみ残し、AWS で代替可能なものは AWS に寄せる。

### AWS 内サービス

| 用途 | AWS サービス |
|------|--------------|
| コンピュート (API / Workers) | **ECS on Fargate** |
| コンテナレジストリ | **ECR** |
| ロードバランサ / WAF | **ALB** + **AWS WAF** |
| DB | **Aurora PostgreSQL (Serverless v2)** |
| キャッシュ / キュー | **ElastiCache for Redis** |
| オブジェクトストレージ | **S3** |
| CDN / 画像配信 | **CloudFront** |
| 画像変換 (将来) | **Lambda@Edge** または **CloudFront Functions** |
| 動画変換 | **Elemental MediaConvert** |
| 検索 | **OpenSearch Service** |
| AI | **Bedrock** (Claude 系) |
| 画像認識 | **Rekognition** または Bedrock マルチモーダル |
| メール | **SES** |
| SMS | **SNS (SMS)** |
| プッシュ通知 (iOS) | **SNS Mobile Push → APNs** |
| イベント連携 | **EventBridge** + **SNS** |
| DNS | **Route 53** |
| TLS 証明書 | **Certificate Manager (ACM)** |
| シークレット管理 | **Secrets Manager** |
| ログ / メトリクス | **CloudWatch** |
| 分散トレーシング | **X-Ray** |
| バックアップ | **AWS Backup** (Aurora の自動バックアップに加え長期保管) |

### 外部 SaaS (AWS 外)

| 用途 | サービス候補 | 備考 |
|------|--------------|------|
| 決済（海外） | Stripe | webhook を ALB → ECS に受信 |
| 決済（国内） | KOMOJU / GMO / Stripe 日本版 | 同上 |
| Apple プッシュ通知 | APNs | SNS Mobile Push 経由でディスパッチ |

## スコープ外（将来検討）

- Android ネイティブアプリ
- 広告モデル
- 国際展開（台湾・タイ等）
- 昆虫食事業との統合
- 生体の死亡保険


```
bun run gen:sdui

bun run typecheck

bun run test
```

```
cargo run
```

## 開発環境セットアップ (Phase 9 / DB 連携)

### 1. PostgreSQL を Docker で起動

```bash
# repo ルートで
docker compose up -d postgres adminer
```

- `kochu_postgres_dev` (image: `postgres:16-alpine`) が `localhost:5432` で立ち上がる
- `kochu_adminer_dev` (image: `adminer:5`) が `http://localhost:8081` で開く (= ad-hoc に SQL を叩ける)
- データは `kochu_pgdata_dev` named volume に永続化。`docker compose down -v` で消去。

接続情報 (dev 専用):

| 項目 | 値 |
|---|---|
| host | `localhost` |
| port | `5432` |
| user | `kochu` |
| password | `kochu_dev_password` |
| db | `kochu_dev` |

### 2. server/.env を準備

```bash
cp server/.env.example server/.env
# 必要なら値を編集
```

`server/.env` は `.gitignore` 済み。`DATABASE_URL` / `DB_MAX_CONNECTIONS` / `DB_AUTO_MIGRATE` を含む。

### 3. server を起動

```bash
cd server
cargo run
# or
cargo run --bin insect_app_server
```

`DB_AUTO_MIGRATE=true` (default) なら起動時に `server/migrations/*.sql` が自動で流れる。Phase 9.A〜9.G の対応で 0001〜0011 が揃っており、適用後は以下のテーブル / 列が利用可能:

| migration | 主なテーブル / 変更 |
|---|---|
| 0001_initial | `orders` / `order_items` / `shipping_addresses` |
| 0002_master_data | `species` / `shops` / `prefectures` / `shipping_methods` (+ 各翻訳) |
| 0003_products | `products` / `product_translations` (= 6 商品 seed) |
| 0004_users | `users` / `user_sessions` (+ products / shipping_methods への audit FK 後付け) |
| 0005_order_items_product_fk | `order_items.product_uuid` 列 + FK + 既存行 backfill |
| 0006_cart_and_watches | `cart_items` / `product_watches` |
| 0007_specimens | `specimens` / `specimen_status_history` / `specimen_logs` / `mating_records` |
| 0008_users_password | `users.password_hash` 列 (= Argon2id phc 文字列 / NULL 許容) |
| 0009_market | `listings` / `bids` / `listing_watches` + `v_listings_with_counts` VIEW |
| 0010_stripe_webhook_events | `stripe_webhook_events` (= event_id 冪等性キャッシュ) |
| 0011_orders_user_fk | `orders.user_id` FK + 既存行の session 経由 backfill |
| 0012_product_watches_session_owner | `product_watches` を session_id 許容に拡張 (= UUID PK + CHECK + UNIQUE 部分 index) |
| 0013〜0020 | shipping_addresses FK / order_items.fulfilled_specimen_id / email_outbox / password_resets / assets / species_stats / product_bloodlines / cohorts |
| **0021_c2c_pivot_drop_b2c_tables** | **C2C pivot**: `cart_items.product_id` → `listing_id` (FK to listings) / `order_items` を listing_id 化 / `products` / `product_translations` / `product_bloodlines` / `product_watches` を DROP |

DB 接続失敗 / `DATABASE_URL` 未設定でも server は起動する (= 各 repo が in-memory fallback を持つので、cart / watch / cookie session / auth (= dynamic store) が機能限定で動く)。production では `db::init_pool` 直接呼び出しに切り替えて DB 不在 = fatal にする想定。

実機での動作確認チェックリストは [`docs/db-verify-checklist.md`](docs/db-verify-checklist.md) を参照。
API エンドポイントの詳細は [`docs/api-v1-endpoints.md`](docs/api-v1-endpoints.md) を参照。

### production hardening の env 設定

| env 変数 | 用途 | dev での値 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 接続文字列 | `postgresql://kochu:kochu_dev_password@localhost:5432/kochu_dev` |
| `STRIPE_PROVIDER` | `mock` / `live` | `mock` (= 既定) |
| `STRIPE_WEBHOOK_SECRET` | webhook の HMAC-SHA256 検証 secret | 未設定 (= scaffolding mode で skip) |
| `KOCHU_STRIPE_TOLERANCE_SEC` | Stripe-Signature の `t=` から現在時刻のドリフト許容秒数 | `300` (= 5 分) |
| `KOCHU_COOKIE_SECURE` | cookie に Secure 属性を付ける | 未設定 (= localhost で cookie が立たないため off) |
| `KOCHU_ALLOWED_ORIGINS` | CSRF Origin allowlist (CSV) | 未設定 (= dev で CSRF check skip) |

### 4. migration を手で流したい場合

```bash
# sqlx-cli を未インストールならまず:
cargo install sqlx-cli --no-default-features --features postgres,rustls

# repo ルートまたは server/ で:
cd server
sqlx migrate run --database-url postgresql://kochu:kochu_dev_password@localhost:5432/kochu_dev

# 巻き戻したい時 (= 1 つ前の version まで):
sqlx migrate revert --database-url postgresql://kochu:kochu_dev_password@localhost:5432/kochu_dev
```

### 5. PostgreSQL を停止 / リセット

```bash
docker compose down            # 停止のみ (data は残る)
docker compose down -v         # data volume も削除 (= 全リセット)
```

### 6. 本番環境

production / staging では本 docker-compose は使わず、すべて AWS マネージドサービスで構成する。

| レイヤー | 構成 |
|---|---|
| ネットワーク | VPC (3 AZ / public + private + isolated subnet) |
| エッジ | Route 53 → CloudFront → AWS WAF → ALB |
| API / Workers | ECS on Fargate (private subnet)。タスクは API / Worker で分離 |
| イメージ | ECR (lifecycle policy で旧 tag を自動削除) |
| DB | Aurora PostgreSQL Serverless v2 (isolated subnet, Multi-AZ) |
| キャッシュ | ElastiCache for Redis (cluster mode、isolated subnet) |
| 検索 | OpenSearch Service (private VPC domain) |
| ストレージ | S3 (バケット: uploads / public / backups / logs) |
| 動画 | MediaConvert (S3 トリガで EventBridge → SNS → API) |
| 通知 | SNS Mobile Push → APNs / SES |
| AI | Bedrock (VPC Endpoint 経由) |
| シークレット | Secrets Manager (`DATABASE_URL` / Stripe / etc.) → ECS Task Definition から injection |
| 監視 | CloudWatch Logs / Metrics / Alarms + X-Ray |
| バックアップ | AWS Backup (Aurora 日次スナップショット 30日保持) |
| IaC | (未定) CDK / Terraform / CloudFormation のいずれか |

具体は Phase 9 infra docs (`docs/infra/`) で扱う。

