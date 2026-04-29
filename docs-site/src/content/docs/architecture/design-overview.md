---
title: "insect_app 設計概要"
description: "新規参画者向けの全体像。アーキテクチャ / DB スキーマ / API・型契約 / 主要処理フローの 4 観点でまとめた最初の 1 枚。"
sidebar:
  order: 0
---

> **読み方**: このページは新規開発者が短時間で全体像を掴むための導線です。SDUI に閉じた話は [SDUI 三層モデル概観](/insect_app/architecture/sdui-overview/) と [SDUI v6 設計書 (正典)](/insect_app/architecture/sdui-three-layer-model-v6/) を、API の逆引きは [`/api/v1/*` エンドポイント一覧](/insect_app/architecture/api-v1-endpoints/) を参照してください。
>
> **正典**: `docs/design-overview.md` (リポジトリ直下) が source of truth。本ページはそのミラーです。

最終更新: 2026-04-29

## 1. プロダクト概要

`insect_app` は **昆虫（カブト・クワガタ等）の飼育管理 × EC × C2C マーケット** を統合した Web アプリケーションです。主な機能ドメインは以下の 4 つです。

- **個体管理 (Specimen)** — 卵 / 幼虫 / 蛹 / 成虫のライフサイクル記録、給餌・体重・脱皮ログ、血統 (父母) リンク
- **繁殖管理 (Mating / Bloodline)** — ペアリング記録、産卵数、孵化予測の日次バッチ
- **EC (B2C)** — 商品カタログ、カート、Stripe による決済、注文履歴
- **マーケット (C2C)** — 出品、入札（オークション）、ウォッチリスト

UI は **SDUI (Server-Driven UI) v6** という独自スキーマでサーバから配信し、クライアントは描画に専念する構造を取っています。

---

## 2. リポジトリ構成

```
insect_app/
├── server/                 # Rust / Axum バックエンド
│   ├── src/
│   │   ├── main.rs         # 起動エントリ。Pool 初期化・キャッシュ warm・Worker 起動
│   │   ├── lib.rs          # 公開モジュール
│   │   ├── routes.rs       # /api/v1 ルーティング
│   │   ├── state.rs        # AppState { db: Option<PgPool> }
│   │   ├── session.rs      # Cookie セッション + CSRF ミドルウェア
│   │   ├── error.rs        # AppError → IntoResponse
│   │   ├── openapi.rs      # utoipa による OpenAPI ドキュメント
│   │   ├── handlers/       # Axum ハンドラ群（リクエスト処理）
│   │   ├── repos/          # SQLx を使うデータアクセス層
│   │   ├── sdui/           # SDUI 型定義・バリデーション
│   │   ├── workers/        # 非同期ワーカー（email_send, eclosion_daily）
│   │   └── stripe/         # Stripe 連携・Webhook 検証
│   └── migrations/         # PostgreSQL マイグレーション (sqlx)
├── client_solid/           # Solid.js フロントエンド (TypeScript / Vite)
│   └── src/
│       ├── App.tsx         # ルート + グローバルストア
│       ├── pages/          # 画面コンポーネント
│       ├── components/     # 再利用コンポーネント
│       ├── sdui/           # SDUI レンダラ・型 (ts-rs 生成)
│       └── store/          # Solid 反応的ストア (auth, cart, ...)
├── docs-site/              # Astro + Starlight ドキュメントサイト（本サイト）
└── docs/                   # 設計ドキュメント（正典）
```

---

## 3. 技術スタック

| レイヤ | 採用技術 | 補足 |
|---|---|---|
| HTTP サーバ | Axum 0.8 / Tokio 1 | ミドルウェア: Cookie セッション + CSRF + tracing + CORS |
| DB | PostgreSQL + SQLx 0.8 | コンパイル時クエリ検証 (`query_as!`) |
| 認証 | Argon2id + Cookie セッション | パスワード/セッショントークンの両方を phc 形式でハッシュ |
| API スキーマ | utoipa 5 (OpenAPI) | `/openapi.json` + Swagger UI |
| 型生成 | ts-rs 9 / schemars 0.8 | Rust → TypeScript / JSON Schema |
| 決済 | Stripe (Webhook は HMAC-SHA256 検証) | `STRIPE_WEBHOOK_SECRET` 必須（本番） |
| メール | lettre 0.11 (SMTP) + 独自 Mailer Trait | 開発時は StubMailer |
| ジョブ | `tokio::spawn` + `FOR UPDATE SKIP LOCKED` | 自前リレー。apalis 等は使用しない |
| クライアント | Solid.js 1.9 / @solidjs/router | Vite 5 / Vitest 2 |
| 型連携 | openapi-typescript 7 | `/openapi.json` から fetch クライアント自動生成 |

---

## 4. システム全体アーキテクチャ

```mermaid
flowchart LR
    subgraph Client["client_solid (Solid.js / Vite)"]
        Pages["pages/*"]
        SDUI_R["sdui/CardRenderer\nRegionRenderer\nBlockRenderer"]
        Stores["store/* (auth, cart, ...)"]
        APIClient["sdui/api.ts (fetch)"]
        Pages --> SDUI_R --> APIClient
        Pages --> Stores --> APIClient
    end

    subgraph Server["server (Rust / Axum)"]
        Routes["routes.rs\n/api/v1/**"]
        MW["session_middleware\ncsrf_middleware"]
        Handlers["handlers/*\n(cards, cart, checkout, auth, ...)"]
        Repos["repos/*\n(SQLx)"]
        SDUI_S["sdui/blocks.rs\nsdui/validate.rs"]
        Workers["workers/*\nemail_send / eclosion_daily"]
        Routes --> MW --> Handlers
        Handlers --> Repos
        Handlers --> SDUI_S
    end

    subgraph Infra["Infra"]
        DB[("PostgreSQL")]
        SMTP[("SMTP Relay")]
        Stripe[("Stripe API\n+ Webhook")]
    end

    APIClient -- "JSON / Cookie" --> Routes
    Repos --> DB
    Workers --> DB
    Workers --> SMTP
    Handlers <-- "Webhook" --> Stripe
```

### 4.1 SDUI 三層モデル

UI はサーバが組み立てた `CardBlock` を JSON で返し、クライアントが描画します。

```mermaid
flowchart TB
    Card["CardBlock\n(ProductFeature / ProductDetail / Cart)"]
    Region["Region\nheader / media / hero / gallery / spec / pricing / cta / items / summary ..."]
    Block["Block\nText / Badge / Media / LineItem / MetricList / Cta / FormField / OrderSummary / ShippingMethodPicker ..."]
    Role["Role (TextRole / BadgeRole 等)\neyebrow / headline / subhead / body / caption / status / warning ..."]

    Card --> Region --> Block --> Role
```

意図は次の 3 点です。

- レイアウト変更を **デプロイ無し** で配信する（A/B テスト・実験）
- アクセシビリティ規則 (`headline` ブロックは Region 内に最大 1 つ等) を **サーバ側で強制**
- Rust の型 (`Block`, `Localizable`, `Href`) を `ts-rs` で TypeScript に同期し、**型安全** に描画

---

## 5. データモデル / DB スキーマ

マイグレーションは `server/migrations/` にあり、現状 `0001`〜`0018` まで一方向で適用されます。主要テーブルを ER 図で示します。

```mermaid
erDiagram
    users ||--o{ user_sessions : "owns"
    users ||--o{ specimens : "owner_user_id"
    users ||--o{ mating_records : "breeder_user_id"
    users ||--o{ listings : "seller_user_id"
    users ||--o{ bids : "bidder_user_id"
    users ||--o{ orders : "user_id"
    users ||--o{ password_resets : ""
    users ||--o{ product_watches : ""
    users ||--o{ listing_watches : ""

    species ||--o{ specimens : "species_id"
    species ||--o{ products : "species_id"

    specimens ||--o{ specimen_logs : ""
    specimens ||--o{ specimen_status_history : ""
    specimens ||--o{ mating_records : "father_id / mother_id"
    specimens ||--o{ listings : "specimen_id"

    products ||--o{ order_items : ""
    orders ||--o{ order_items : ""
    orders ||--o| shipping_addresses : ""
    shipping_methods ||--o{ shipping_addresses : ""

    listings ||--o{ bids : ""
    listings ||--o{ listing_watches : ""

    orders ||--o{ stripe_webhook_events : "by stripe_session_id"
    email_outbox }o--|| users : "to user (optional)"
```

### 5.1 主要テーブル

| テーブル | 役割 | 重要カラム |
|---|---|---|
| `users` | アカウント | `public_id`, `role` (breeder/admin/shop_owner), `password_hash` (Argon2 phc) |
| `user_sessions` | Cookie セッション | `token_hash` (Argon2), `user_id` (NULL 可 = 匿名), `expires_at` |
| `specimens` | 飼育個体 | `public_id`, `species_id`, `sex`, `stage`, `eclosion_eta`, `father_id`, `mother_id`, `life_status` |
| `specimen_logs` | 飼育ログ | `log_type` (weight/feed/mat/molt/observation), `metrics` (JSONB) |
| `specimen_status_history` | 個体状態履歴（**immutable**） | `status`, `changed_at`, `author_user_id` |
| `mating_records` | 繁殖記録 | `father_id`, `mother_id`, `mated_at`, `egg_count`, `status` |
| `products` | EC 商品 | カテゴリ・難易度フィルタ |
| `orders` / `order_items` | EC 注文 | `stripe_session_id`, `status` (pending/paid/failed/canceled), `fulfilled_specimen_id` |
| `cart_items` | カート (セッション単位) | `undoable_token` で削除復元 |
| `listings` / `bids` | C2C 出品・入札 | `is_auction`, `current_price_jpy`, `ends_at` |
| `email_outbox` | メール送信キュー | `kind`, `template_args` (JSONB), `status`, `idempotency_key` |
| `stripe_webhook_events` | Webhook 監査ログ | event id を一意に保持 |
| `assets` | アップロード資産 | `status` (pending/uploaded) — 3 段階アップロード |

詳細なテーブル定義および設計判断は [DB スキーマ設計](/insect_app/architecture/db-schema-design/) を参照してください。

### 5.2 設計の勘所

- **個体状態は履歴を残す**（Medium #3 規律）。`specimens.life_status` の更新と同時に `specimen_status_history` へ INSERT し、履歴は削除しない。
- **メール送信は冪等**。`email_outbox.idempotency_key` (例 `eclosion:{specimen_id}:{eta}`) に UNIQUE 制約を張り、日次バッチの再実行で重複送信しない。
- **Pool が無くても動く**。`AppState.db: Option<PgPool>` とし、各 repo は `pool=None` のときスレッドローカルなインメモリストアへフォールバックする。MVP/開発・テスト時に有効。
- **マスタは OnceLock キャッシュ**。products フィルタ、shipping_methods、prefectures は起動時に warm し、handler から参照する。

---

## 6. API / 型契約

### 6.1 ルーティング (代表例)

`/api/v1` 配下に約 40 エンドポイント。`server/src/routes.rs` 参照。網羅的な逆引きは [`/api/v1/*` エンドポイント一覧](/insect_app/architecture/api-v1-endpoints/) を参照してください。

| カテゴリ | メソッド + パス | 説明 |
|---|---|---|
| SDUI | `GET /cards/products`, `/cards/products/{id}`, `/cards/products/{id}/detail`, `/cards/cart` | カード/領域/ブロックを組み立てて返す |
| Cart | `POST /cart` / `PATCH /cart/items/{token}` / `DELETE /cart/items/{token}` | セッション単位のカート操作 |
| Checkout | `PATCH /checkout/shipping_field/{name}` / `/checkout/shipping_method` / `POST /checkout/submit` | 配送先入力 → Stripe Session 生成 |
| Auth | `POST /auth/register|login|logout` / `GET /auth/me` / `POST /auth/password_reset_request|confirm` | 登録・ログイン・パスワードリセット |
| Specimen | `GET /specimens/me` / `POST /specimens` / `GET /specimens/{public_id}` / `PATCH /specimens/{id}/notes` / `POST /specimens/{id}/life_status` | 個体管理 |
| Logs | `POST /specimens/{id}/logs` / `GET /specimens/{id}/logs` / `GET /me/logs` | 飼育ログ |
| Mating | `POST /mating_records` / `GET /mating_records/me` / `POST /mating_records/{id}/status` | 繁殖記録 |
| Market | `GET|POST /listings` / `GET /listings/{public_id}` / `POST /listings/{id}/bids|watch` | C2C |
| Orders | `GET /orders/me` / `GET /orders/{id}` | 注文履歴 |
| Webhook | `POST /stripe/webhook` | Stripe からの通知（CSRF 例外） |

### 6.2 型契約のフロー

```mermaid
flowchart LR
    Rust["Rust 型\n(handlers / sdui::blocks)"]
    Utoipa["utoipa\n(#[utoipa::path])"]
    Schemars["schemars\n(JSON Schema)"]
    TsRs["ts-rs\n(#[ts(export)])"]
    OpenAPI["/openapi.json"]
    OAPITS["openapi-typescript"]
    SDUITypes["client_solid/src/sdui/types.ts"]
    Stubs["client_solid/src/generated/openapi.ts"]
    Client["Solid.js コンポーネント"]

    Rust --> Utoipa --> OpenAPI --> OAPITS --> Stubs --> Client
    Rust --> Schemars --> OpenAPI
    Rust --> TsRs --> SDUITypes --> Client
```

クライアント側の型生成スクリプト:

- `npm run gen:openapi` — `/openapi.json` を取得し `openapi-typescript` で fetch クライアント生成
- `npm run gen:sdui` — `cargo build` で ts-rs を起動し SDUI 型をエクスポート

### 6.3 ハンドラ実装パターン

```rust
#[utoipa::path(post, path = "/api/v1/cart", responses((status = 200, body = CartResponse)))]
pub async fn add_to_cart(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(body): Json<AddToCartRequest>,
) -> Result<Json<CartResponse>, AppError> {
    let item = repos::cart_items::add_to_cart(state.db.as_ref(), session_id, body).await?;
    Ok(Json(CartResponse::from(item)))
}
```

戻り値は `Result<Json<T>, AppError>`。`AppError` は `IntoResponse` を実装し、`NotFound` / `BadRequest(String)` / `Unauthorized` / `Internal(anyhow::Error)` を JSON エラーへ変換します（`server/src/error.rs`）。

### 6.4 SDUI バリデーション

`server/src/sdui/validate.rs` に 2 つの trait があり、ハンドラはレスポンス組立後に必ず呼びます。

- **`ValidateKeys`** — `Block.key` の一意性を `CardBlock` 単位で検証（複合キーは `<block.key>::<item.key>`）
- **`ValidateA11y`** — Region 内の `headline` ロール Block を最大 1 つに制限（スクリーンリーダ要件）

検証失敗時は 400 Bad Request を返却。

---

## 7. 処理フロー（シーケンス）

### 7.1 認証 + セッションミドルウェア

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant SM as session_middleware
    participant CS as csrf_middleware
    participant H as Handler
    participant R as repos::user_sessions / users
    participant DB as PostgreSQL

    C->>SM: HTTP リクエスト + Cookie kochu_session=<id>:<secret>
    SM->>R: verify(id, secret)
    R->>DB: SELECT token_hash WHERE id=$1
    DB-->>R: phc hash
    R-->>SM: ok / fail
    alt verify 失敗 or Cookie 無し
        SM->>R: create_anonymous() → 新トークン
        R->>DB: INSERT user_sessions (token_hash = Argon2(secret))
        SM-->>C: Set-Cookie (新トークン)
    end
    SM->>CS: Origin チェック (POST/PATCH/DELETE のみ)
    CS-->>H: Extension(SessionId)
    H->>R: 業務処理
    R->>DB: ...
    H-->>C: JSON レスポンス
```

ポイント:

- セッションは **常に発行** され、未ログイン (`user_id = NULL`) でもカートやウォッチが追跡できる
- ログイン時は同じセッションに `user_id` を紐づけ、`cart_items` / `product_watches` を user 所有へ昇格
- CSRF は Origin ヘッダ検証で実装し、`/stripe/webhook` のみ例外

### 7.2 チェックアウト → Stripe Webhook → 注文確定 → メール

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (CartSdui)
    participant CO as POST /checkout/submit
    participant ST as Stripe API
    participant W as POST /stripe/webhook
    participant ORD as repos::orders
    participant OUT as repos::email_outbox
    participant ES as worker::email_send
    participant SMTP as SMTP

    C->>CO: 配送先 + カート確定
    CO->>ORD: INSERT orders (status=pending)
    CO->>ST: Checkout Session 作成
    ST-->>CO: session.url
    CO-->>C: { orderId, sessionUrl }
    C->>ST: ブラウザで決済完了

    ST->>W: checkout.session.completed
    W->>W: HMAC-SHA256 検証 (STRIPE_WEBHOOK_SECRET)
    W->>ORD: UPDATE status = paid
    W->>OUT: enqueue (kind=order_confirmation)

    loop ポーリング (KOCHU_EMAIL_POLL_SEC)
        ES->>OUT: SELECT ... FOR UPDATE SKIP LOCKED LIMIT N
        ES->>SMTP: send()
        ES->>OUT: mark_sent / mark_failed
    end
```

メールリレーは **`FOR UPDATE SKIP LOCKED`** で複数ワーカー間の競合を防ぎ、開発時は `StubMailer` がログ出力に切り替わります（`KOCHU_WORKER_ENABLE`, `Mailer` trait）。

### 7.3 個体ライフサイクル + 孵化リマインダ

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant SP as POST /specimens
    participant LG as POST /specimens/{id}/logs
    participant ST as POST /specimens/{id}/life_status
    participant ED as worker::eclosion_daily
    participant OUT as email_outbox

    U->>SP: 個体登録 (eclosion_eta 含む)
    SP->>SP: INSERT specimens (life_status=active)

    loop 飼育中
        U->>LG: ログ追記 (weight/feed/molt 等)
        LG->>LG: INSERT specimen_logs (metrics JSONB)
    end

    U->>ST: 状態変更 (deceased など)
    ST->>ST: INSERT specimen_status_history
    ST->>ST: UPDATE specimens.life_status

    Note over ED: 03:00 JST 起動 (毎日)
    ED->>ED: SELECT specimens WHERE eclosion_eta IN (today, today+7]
    loop 各個体
        ED->>OUT: enqueue (kind=eclosion_reminder,\n idempotency_key=eclosion:{id}:{eta})
    end
```

`idempotency_key` の UNIQUE 制約により、同じ個体・同じ予測日のリマインダは複数日跨いでも 1 通だけ送られます。

### 7.4 SDUI レンダリング

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant H as handlers::cards
    participant R as repos::*
    participant V as sdui::validate

    C->>H: GET /cards/products/{id}/detail
    H->>R: 商品・在庫・配送・i18n データ取得
    H->>H: ProductDetailRegions { gallery, hero, spec, pricing, cta, promise }
    H->>H: CardBlock::ProductDetail { regions, experiments }
    H->>V: card.validate_keys() / card.validate_a11y()
    V-->>H: Ok / Err(400)
    H-->>C: JSON: CardBlock
    C->>C: CardRenderer → RegionRenderer → BlockRenderer
    C->>C: AnalyticsContext (impression を /events に POST)
```

クライアントは `CardRenderer` → `RegionRenderer` → `BlockRenderer` のディスパッチのみで、レイアウトロジックを持ちません。`AnalyticsContext` がインプレッション/クリックイベントをまとめて `POST /events` に送信します。

---

## 8. バックグラウンドワーカー

`server/src/workers/` に 2 種類。`KOCHU_WORKER_ENABLE=true` のとき `spawn_all(state)` から起動します。

| ワーカー | 起動契機 | 責務 |
|---|---|---|
| `email_send` | `KOCHU_EMAIL_POLL_SEC` (既定 2 秒) ポーリング | `email_outbox` の `pending` を `FOR UPDATE SKIP LOCKED` で取り、Mailer 実装で送信 |
| `eclosion_daily` | 03:00 JST (= 18:00 UTC) | 7 日以内に羽化予測がある個体を抽出し、`email_outbox` に冪等エンキュー |

`Mailer` トレイトは `StubMailer` (開発: tracing ログ + 内部 Vec) と `AsyncSmtpTransport` (本番: lettre 経由 SMTP) の 2 実装を切替可能です。

---

## 9. 環境変数 / 運用上の注意

| 変数 | 用途 | 備考 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 接続 | 失敗時はインメモリフォールバック (MVP) |
| `KOCHU_ENV` | `production` のとき下記 3 つを必須化 | — |
| `STRIPE_WEBHOOK_SECRET` | Webhook HMAC 検証 | 本番必須 |
| `KOCHU_ALLOWED_ORIGINS` | CSRF Origin 許可リスト | 本番必須 |
| `KOCHU_COOKIE_SECURE` | `true` で Set-Cookie に Secure 付与 | 本番必須 |
| `KOCHU_WORKER_ENABLE` | ワーカー起動可否 | サービス分離時は false |
| `KOCHU_EMAIL_POLL_SEC` | email_send のポーリング間隔 | 既定 2 秒 |

---

## 10. 主要な設計判断と理由

1. **SDUI を採用** — レイアウト/A11y/実験フラグをサーバで管理し、クライアント変更なしで段階リリースできる。
2. **セッショントークンも phc 形式で保存** — Argon2 のパラメータをハッシュに埋め込むことで、将来のセキュリティパラメータ変更に耐性を持たせる。
3. **個体状態履歴は immutable** — 監査・血統トレーサビリティ要件に対応するための規律。
4. **In-Memory フォールバック** — Pool 未接続でもエンドポイントが動作。MVP のローカル開発と CI を高速化。
5. **マスタは `OnceLock` で warm** — products / shipping_methods / prefectures は起動時にロードし、ホットパスで DB 不要。
6. **メールは冪等エンキュー + リレー** — `FOR UPDATE SKIP LOCKED` で複数インスタンス対応、`idempotency_key` で重複送信防止。
7. **Stripe Webhook は CSRF 例外** — 外部から POST を受けるため Origin チェックを skip し、HMAC 検証で代替。
8. **ts-rs + schemars + utoipa の三本柱** — Rust の型 1 つから TS 型・JSON Schema・OpenAPI が同時に出るため、契約のドリフトが起きにくい。

---

## 11. 開発者がはじめに見るべきファイル

| 目的 | ファイル |
|---|---|
| 起動シーケンスを追う | `server/src/main.rs` |
| ルーティング全体像 | `server/src/routes.rs` |
| 認可・セッション | `server/src/session.rs` |
| エラー方針 | `server/src/error.rs` |
| SDUI 型定義 | `server/src/sdui/blocks.rs` |
| SDUI バリデーション | `server/src/sdui/validate.rs` |
| 決済 Webhook | `server/src/handlers/stripe_webhook.rs` |
| 日次バッチ | `server/src/workers/eclosion_daily.rs` |
| クライアント起点 | `client_solid/src/App.tsx` |
| SDUI レンダラ | `client_solid/src/sdui/CardRenderer.tsx` |
| 型生成スクリプト | `client_solid/scripts/gen-openapi.mjs`, `gen-sdui-types.mjs` |
| マイグレーション一覧 | `server/migrations/` |

---

## 付録 A. SDUI コア型 (抜粋)

```rust
// server/src/sdui/blocks.rs
pub enum Block {
    Text { key: String, role: TextRole, content: Localizable, analytics_id: Option<String> },
    Badge { key: String, role: BadgeRole, label: Localizable, analytics_id: Option<String> },
    Media { key: String, kind: MediaKind, src: String, alt: Localizable, /* ... */ },
    LineItem { key: String, title: Localizable, unit_price: MetricItem, /* ... */, actions: Option<LineItemAction> },
    MetricList { key: String, items: Vec<MetricItem> },
    MetaLine { key: String, role: MetaLineItemRole, label: Localizable, value: Localizable },
    Cta { key: String, action: CtaAction, label: Localizable, intent: CtaIntent, /* ... */ },
    FormField { key: String, kind: FormFieldKind, label: Localizable, value: String, /* ... */ },
    OrderSummary { key: String, subtotal_amount: i64, shipping_amount: Option<i64>, tax_included: bool, /* ... */ },
    ShippingMethodPicker { key: String, options: Vec<ShippingMethodOption>, selected_id: String, /* ... */ },
    // ... EclosionForecast, Divider, Price
}

pub enum Localizable {
    Raw { text: String },
    I18nRef { key: I18nKey, fallback: Option<String> },
}

pub struct Href(String);    // "/..." または "https://..." のみ許容
pub struct I18nKey(String); // "scope.key" 形式
```

## 付録 B. AppError → HTTP 対応

| バリアント | HTTP | 用途 |
|---|---|---|
| `NotFound` | 404 | リソース未発見 |
| `BadRequest(String)` | 400 | 入力検証エラー、SDUI バリデーション失敗 |
| `Unauthorized` | 401 | 未ログイン / セッション無効 |
| `Internal(anyhow::Error)` | 500 | 想定外エラー（ログ出力後にマスク） |
