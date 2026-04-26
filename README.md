# 昆虫EC × 飼育管理プラットフォーム

昆虫（カブトムシ・クワガタ等）の販売ECと飼育管理を統合したプラットフォーム。個体カルテ、血統管理、消耗品の自動補充、羽化予測などを一体で提供する。

## 技術スタック概要

| レイヤー | 技術 |
|----------|------|
| Web クライアント | Solid.js（PWA対応） |
| iOS クライアント | Swift / SwiftUI |
| バックエンド | Rust + Axum |
| データベース | PostgreSQL |
| キャッシュ / キュー | Redis |
| オブジェクトストレージ | Cloudflare R2 / AWS S3 |
| 検索 | Meilisearch |
| 動画変換 | Cloudflare Stream / Mux |
| 通知 | Apple Push Notification service (APNs) |

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
       ┌────────▼────────┐
       │   Axum API      │
       │   (utoipa)      │
       └────────┬────────┘
                │
    ┌───────────┼───────────┬──────────┐
    │           │           │          │
┌───▼────┐  ┌───▼───┐  ┌────▼───┐  ┌───▼───┐
│Postgres│  │ Redis │  │ R2/S3  │  │ APNs  │
│(sqlx)  │  │(apalis│  │(画像/  │  │       │
│        │  │ jobs) │  │ 動画)  │  │       │
└────────┘  └───────┘  └────────┘  └───────┘
    │           │
    └───────────┴──→ Meilisearch（検索）
                 ↓
            Cloudflare Stream / Mux（動画変換）
                 ↓
            OpenAI / Claude API（AI機能）
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

- `a2`：APNs クライアント（HTTP/2、JWT 認証対応）
- トークン管理はサーバー側 DB に保存
- サーバートリガーで silent / alert 通知を送出

### 画像・動画処理

- `image`：画像リサイズ・フォーマット変換
- `libvips`（バインディング）：高品質な画像処理
- 動画変換は Cloudflare Stream / Mux など外部サービスにオフロード
- クライアントから R2 に直接アップロードし、サーバーには完了通知のみ送る設計

### ストレージ

- `aws-sdk-s3`：S3 / R2 の公式 SDK
- 署名 URL 発行によるダイレクトアップロード

### 検索

- `meilisearch-sdk`：商品・ブリーダー・個体カルテの横断検索
- 補助的に PostgreSQL 全文検索（`pg_trgm` + GIN index）

### バックグラウンドジョブ

- `apalis`：ジョブキュー（Redis / PostgreSQL バックエンド対応）
- `tokio-cron-scheduler`：定期実行
- 用途：
  - 羽化予測の日次バッチ
  - 補充提案のユーザーごと計算
  - 死着補償の自動処理
  - メール・SMS・通知の非同期送信

### AI 統合

- `async-openai`：OpenAI API
- Claude API：`reqwest` で直接呼び出し
- `ort`（ONNX Runtime）または `candle`：自前 ML 推論
- 画像認識（種同定）は初期は Cloud Vision API 等にオフロード

### リアルタイム機能

- `axum::extract::ws`：WebSocket
- Redis Pub/Sub または NATS でスケール対応
- スケール時は Ably / Pusher 等の MaaS 検討

### メール・SMS

- `lettre`：SMTP 経由
- SendGrid / Twilio 等は REST 直叩き

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

開封動画・個体動画の変換を自前サーバーで抱えるとリソースが瞬殺されるため、Cloudflare Stream や Mux に完全にオフロードする。サーバーはメタデータ管理とアクセス制御のみ担当する。

### ダイレクトアップロード

画像・動画はクライアントから R2 / S3 へ直接アップロードする。サーバーは署名 URL 発行と完了通知受信のみを担当し、帯域を使わない。

### Webhook の信頼性

Stripe、APNs、動画変換サービスからの Webhook は `axum::middleware` で署名検証と冪等性確保を共通化する。受信失敗時のリトライ・デッドレター処理も初期から組み込む。

### 型の一気通貫

OpenAPI を一次情報とし、Rust / Swift / TypeScript の型が同一スキーマから生成される状態を維持する。手書きの型定義を各クライアントに置かない。

### コンパイル速度対策

- `mold` linker 導入（Linux 環境で劇的に速い）
- `cargo-watch` / `bacon` で変更検知と自動再ビルド
- ワークスペース分割で影響範囲を局所化

## 外部依存サービス

| 用途 | サービス候補 |
|------|--------------|
| 決済（海外） | Stripe |
| 決済（国内） | KOMOJU / GMO / Stripe 日本版 |
| メール配信 | SendGrid / Resend |
| SMS 配信 | Twilio |
| オブジェクトストレージ | Cloudflare R2 / AWS S3 |
| 動画変換・配信 | Cloudflare Stream / Mux |
| 画像 CDN | Cloudflare Images |
| 検索エンジン | Meilisearch（セルフホストまたは Meilisearch Cloud） |
| AI | OpenAI API / Claude API |
| プッシュ通知 | Apple Push Notification service |

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
```

`DB_AUTO_MIGRATE=true` (default) なら起動時に `server/migrations/*.sql` が自動で流れる (= `orders` / `order_items` / `shipping_addresses` テーブルが作られる)。

DB 接続失敗 / `DATABASE_URL` 未設定でも server は起動する (= MVP では DB 無しでも一部 handler は動く)。production では `db::init_pool` 直接呼び出しに切り替えて DB 不在 = fatal にする想定。

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

production / staging では本 docker-compose は使わず、AWS RDS (Aurora PostgreSQL) を CDK / Terraform で立てる想定。`DATABASE_URL` は AWS Secrets Manager から ECS Task Definition 経由で注入する。具体は Phase 9 infra docs (`docs/infra/`) で扱う。

