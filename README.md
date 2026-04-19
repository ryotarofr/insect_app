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
