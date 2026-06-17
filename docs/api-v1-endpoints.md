# `/api/v1/*` エンドポイント一覧 (Phase 9.A〜9.G + hardening)

> このドキュメントは `server/src/routes.rs` と各 `handlers/*.rs` の実装を逆引きできる
> reference。frontend (`client_solid/src/sdui/api.ts`) や別 client (Swift / iOS) を実装する際の
> 一次情報源として使う。
>
> サーバ実装の **single source of truth** は Rust コード (= `routes.rs` + handler の
> ts-rs 派生型 + `*RegisterRequest` 等の `#[derive(Deserialize)]` struct)。本ドキュメントが
> ずれた場合は実装側を信用する。

## 共通仕様

- **ベース URL**: `/api/v1`
- **JSON encoding**: `serde(rename_all = "camelCase")` を全 DTO で適用 → 全フィールド camelCase。
- **content-type**: 全 POST / PATCH は `application/json`。Stripe webhook のみ `body: Bytes` を直接受ける。
- **Cookie**: `session_middleware` が全 `/api/v1/*` リクエストに `kochu_session=<id>:<secret>` cookie を発行・維持
  (= HttpOnly / SameSite=Lax / 本番では `KOCHU_COOKIE_SECURE=true` で Secure 属性)。
  `<id>` は UUID v4、`<secret>` は 32-byte 暗号学的乱数の hex 表現で、サーバ側は secret を
  Argon2id でハッシュ化して `user_sessions.token_hash` に保存する (Phase 9.H 以降)。
- **CSRF**: 状態変更 (POST/PATCH/DELETE/PUT) には `Origin` ヘッダが
  `KOCHU_ALLOWED_ORIGINS` env (= CSV) のいずれかと一致することを要求。env 未設定 (= dev) は skip。
  Stripe webhook は HMAC で別経路の検証あり → CSRF skip。
- **エラー JSON**: `AppError::IntoResponse` で `{ "error": "<message>" }` 形式 + 適切な status。
  - `400 Bad Request`: validation 失敗 / parse 失敗
  - `401 Unauthorized`: 未ログインの protected route / login で資格情報誤り (= account enumeration 対策で同一文言)
  - `404 Not Found`: 不存在 / cross-user access (= 情報漏れを防ぐため認可エラーも 404 に倒す)
  - `403 Forbidden`: CSRF check 失敗
  - `500 Internal Server Error`: 想定外 (= 内部詳細は出さない)

## マスタ系 (種マスタのみ / C2C pivot 後)

> **C2C pivot (= 0021 migration) で削除済 endpoint**:
> 旧 `GET /cards/products` / `/cards/products/{id}` / `/cards/products/{id}/detail` /
> `/cards/cart` / `/products` / `/product_bloodlines` / `/watch/{productId}` は全て廃止。
> B2C 商品マスタの概念ごと撤去し、販売対象は `listings` (= C2C 出品) のみ。

### `GET /api/v1/species`

種マスタ (= ヘラクレス / コーカサス 等)。認証不要 / public。

レスポンス: `Vec<SpeciesResponse>` (= `id` / `sciName` / `name` / `region`)。

## カート (C2C pivot 後 / `handlers::cart`)

| Method | Path | Auth | 概要 |
|---|---|---|---|
| POST | `/cart` | session 必須 | `{ listingId, qty }` で listing をカートに追加。`{ cartCount, undoToken }` 返す (= token は cart_items.id UUID 文字列) |
| PATCH | `/cart/items/{token}` | session 必須 | `{ qty }` で qty 上書き。1〜99 範囲 (= ただし C2C は 1 listing = 1 unique specimen のため実質 qty=1) |
| DELETE | `/cart/items/{token}` | session 必須 | 物理削除 |

**C2C pivot**: cart_items が `listing_id` (UUID FK to listings) を持つ。`listingId` (request body) は
listings.public_id を渡し、server 側で UUID 解決して cart_items.listing_id に格納。

cart は cookie session 別で分離 (= cart_items.session_id FK to user_sessions)。
login すると `cart_items::promote_session_to_user` で user_id に紐付け直される。

## チェックアウト / 決済 (C2C pivot 後)

| Method | Path | Auth | 概要 |
|---|---|---|---|
| GET | `/checkout` | session | 配送先 + 配送方法の現在 state |
| PATCH | `/checkout/shipping_field/{name}` | session | 1 フィールド更新 (`addressName` / `addressTel` / `addressZip` / `addressPref` / `addressAddr`) |
| PATCH | `/checkout/shipping_method` | session | `cold` / `normal` 切替 |
| POST | `/checkout/submit` | session | 注文確定 → `orders` + `order_items` INSERT (= listing_id FK) + Stripe Session 発行 + `{ orderId, sessionUrl }` |
| POST | `/stripe/webhook` | HMAC | Stripe 通知。`evt_xxx` 単位で冪等。CSRF skip 経路 |

`/checkout/submit` は login 中なら orders.user_id を埋め、anonymous なら NULL のまま (= guest checkout)。

**Webhook → 譲渡フロー** (`handlers::specimen_fulfillment::fulfill_paid_order`):

1. orders.status = "paid" に遷移
2. 未 fulfill な order_items を列挙し、各 item について:
   - `listing_id` から `listings` を引き、`specimen_id` を取得
   - `mark_item_fulfilled` で `fulfilled_specimen_id` を埋める (= 行レベル冪等性ガード)
   - `specimens.transfer_owner` で owner を seller → buyer に書き換え
   - seller に `listing_sold` メールを email_outbox に enqueue (= idempotency_key=`seller_sale:{item_id}`)
3. buyer に `order_confirmation` メールを email_outbox に enqueue (= idempotency_key=`order:{order_id}`)

## 認証 (Phase 9.G / `handlers::auth`)

| Method | Path | Auth | 概要 |
|---|---|---|---|
| POST | `/auth/register` | session | `{ publicId, name, email, password, avatarInitial, role? }` で新規登録。Argon2id で password hash + session を user_id に attach |
| POST | `/auth/login` | session | `{ email, password }` で検証 → session を user_id に昇格 + cart 承継。**401 は account enumeration 対策で email 不在 / password 不一致を区別しない** |
| POST | `/auth/logout` | session | session の user_id を NULL に倒す。session 行は残し cart は保つ。`204` |
| GET | `/auth/me` | login | 現在 login 中の user 情報。anonymous は 401 |

## 注文履歴 (Phase 9.G / `handlers::orders`)

| Method | Path | Auth | 概要 |
|---|---|---|---|
| GET | `/orders/me` | login | 自分の注文履歴 (= `orders.user_id == current user`)。created_at 降順 |
| GET | `/orders/{id}` | session ※ | 1 注文 + `lineItems` (= `OrderDetail`)。所有者 (= user_id 一致) **or 同 session_id** で閲覧可、それ以外は 404 |

※ 「同 session_id」例外は **匿名で買い物 → 決済直後の "ご注文ありがとうございました" 画面** を許可するためのもの。

## 個体カルテ / 飼育 (Phase 9.D / `handlers::specimens` + `specimen_logs` + `mating_records`)

| Method | Path | Auth | 概要 |
|---|---|---|---|
| GET | `/specimens/me` | login | 自分の active な individuals (= archived 除外) |
| POST | `/specimens` | login | 新規登録。`owner_user_id = current user` 固定 |
| GET | `/specimens/{public_id}` | public | 1 件取得 (= 公開閲覧 OK / archived は 404) |
| POST | `/specimens/{id}/archive` | login + 所有者 | 論理削除 (= is_archived = true) |
| POST | `/specimens/{id}/life_status` | login + 所有者 | `{ status, changedAt, note? }` で life_status 遷移。`specimens` UPDATE と `specimen_status_history` INSERT を **tx 化** (= Medium #3) |
| GET | `/specimens/{id}/status_history` | public | life_status の遷移履歴 (= changed_at 降順 / archived は 404) |
| GET | `/specimens/{id}/logs` | public | 飼育ログ (= 体重 / 餌 / マット / 脱皮 / 観察)。logged_at desc + 同日 time desc |
| POST | `/specimens/{id}/logs` | login + 所有者 | ログ追加。`{ logType, loggedAt, loggedAtTime?, title, body, hasPhoto, metrics }` |

### 交配記録 (= mating_records)

| Method | Path | Auth | 概要 |
|---|---|---|---|
| POST | `/mating_records` | login | 新規記録。`breeder_user_id = current user` 固定 |
| GET | `/mating_records/me` | login | 自分の交配記録 (= mated_at 降順) |
| POST | `/mating_records/{id}/status` | login + 所有者 | `planned` → `mated` → `eggs_laid` → `hatched` / `failed` の遷移 |
| POST | `/mating_records/{id}/egg_count` | login + 所有者 | 採卵数を後から更新 (= ≥ 0) |

## C2C marketplace (`handlers::listings`)

| Method | Path | Auth | 概要 |
|---|---|---|---|
| GET | `/listings` | public | active な出品一覧。`ListingViewWithCounts[]` (= seller_name / bid_count / watcher_count 同梱) |
| POST | `/listings` | login | 新規出品。`seller_user_id = current user` 固定。auction なら `endsAt` 必須 |
| GET | `/listings/{public_id}` | public | 1 件取得。**戻り値は `ListingViewWithCounts`** (= 一覧と同 shape、seller_name 等を JOIN 済) |
| POST | `/listings/{id}/cancel` | login + 所有者 | active を canceled に倒す |
| POST | `/listings/{id}/bids` | login | `{ amountJpy }` で入札。auction かつ active かつ amount > 現在値、seller の自分入札は不可 |
| POST | `/listings/{id}/watch` | login | watch トグル (= `{ watching: bool }`) |

## 配送 / その他

| Method | Path | 概要 |
|---|---|---|
| GET | `/health` (= /api/v1 配下ではない / 外側) | health check (= LB / k8s 用) |

> **C2C pivot で削除**: 旧 `POST /watch/{productId}` (= 商品ウォッチ) は廃止。listing watch は
> 上記 `POST /listings/{id}/watch` を使う。

## イベント (= analytics ingest, Phase M3)

| Method | Path | 概要 |
|---|---|---|
| POST | `/events` | analytics events を batch ingest。serverReceivedAtMs を server で stamp |
| GET | `/events?limit=N` | 直近イベントを debug 用に取り出す (= ring buffer) |

## エラー時の細かい挙動

- **CSRF check 失敗**: `403 Forbidden` + `csrf check failed` 文。state-changing メソッドのみ。
- **session 行不存在**: middleware が cookie 経由で SessionId を発行するが、DB INSERT が失敗した
  ような場合に発生しうる。`/auth/me` 等は 401 で吸収。
- **specimen / listing / order の所有権エラー**: 認可漏れ (= "他人の id を投げた") は **404 NotFound**
  に倒し、id 存在の有無自体を漏らさない (= "他人の注文" を 403 で返すと存在を漏らすため)。
- **Stripe webhook 重複**: 同 `evt_xxx` を 2 回受信すると 2 回目は 200 + 早期 return (= side effect 無し)。

## 参考

- 設計: [`db-schema-design.md`](db-schema-design.md)
- 動作確認: [`db-verify-checklist.md`](db-verify-checklist.md)
- SDUI 三層モデル: [`sdui-three-layer-model-v6.md`](sdui-three-layer-model-v6.md)
