---
title: "KOCHU SDUI フロントエンド統合ガイド"
description: "SDUI API を消費するフロントエンド開発者向け 30 分統合ガイド。"
sidebar:
  order: 20
---

> **対象**: KOCHU の SDUI API を消費して UI を描画する **フロントエンド開発者**
> **所要時間**: 30 分
> **ベース仕様**: `docs/sdui-three-layer-model-v6.md` (Phase 1〜8 反映版)
> **API base**: `https://api.kochu.example/api/v1`

このガイドを読むと、「**API レスポンスを受け取って UI を組み立て、ユーザ操作をサーバに反映する**」までの一通りができるようになります。完全な仕様は v6 ドキュメントを参照してください。

---

## 0. 3 行サマリ

1. **サーバが「テンプレート + データ」を JSON で返す**。クライアントは決められた語彙で描画するだけ。
2. **UI 構造は 3 層**: `Region` (場所) → `Block` (要素) → `Role` (意味)。すべて閉じた `enum` で語彙が固定される。
3. **mutation を伴う UI (カート / 入力フォーム) は、PATCH 後に snapshot を再 fetch する**。クライアント側でローカル state を持たない。

---

## 1. SDUI とは何か

Server-Driven UI (SDUI) は **「画面に何を出すかをサーバが決める」** アーキテクチャです。クライアントはレイアウトのコード (TSX) を持ちますが、何を表示するかはすべて API レスポンスに従います。

### この設計が解く問題

| 課題 | SDUI の解 |
|---|---|
| 商品ハイライトの並び・文言を運営が変えたい | DB を編集すれば反映される (アプリリリース不要) |
| A/B テスト・実験的バリアントを試したい | `experiment.bucket` をレスポンスに同梱 |
| 多言語対応したい | `Localizable` でキー解決をフロントが担当 |
| 一貫したデザインを保ちたい | 語彙が `enum` で閉じられ、勝手な独自 UI が混入しない |

### この設計の制約 (= 守ってもらうこと)

- **DB に座標・余白・色は書かない**。レイアウトはコード側 (TSX) の責務。
- **見出しレベル (h1〜h6) はレスポンスに含まれない**。テンプレートが決定する。
- **`role: string` のような開いた型は出てこない**。すべて closed enum。
- **`innerHTML` / `dangerouslySetInnerHTML` 禁止**。すべて `textContent` で描画する。

---

## 2. 三層モデル (Region / Block / Role)

### 2.1 三層の役割

| 層 | 役割 | 例 |
|---|---|---|
| **Region** | カード内の論理的な「場所」 | `header` / `media` / `body` / `footer` |
| **Block** | リージョンに並ぶ要素 (全 13 種) | `text` / `cta` / `media` / `price` / `line_item` |
| **Role** | ブロック内の意味的サブ分類 | `text.role: "headline"` / `cta.intent: "primary"` |

### 2.2 構造のイメージ

```
CardBlock {
  template: "product_feature",
  id: "DHH-0271",
  regions: {
    header: [ Block, Block, ... ],   ← Region (場所)
    body:   [ Block, ... ],
    footer: [ Block, ... ]
  }
}
        ↑          ↑
        |          └── Block (要素)
        └── 各 Block は role / kind / intent などの「Role」を持つ
```

ポイントは **Region の構成はテンプレートが決め打ちで定義**していることです。`product_feature` には `header / media / meta / body / footer` の 5 リージョンしか存在せず、JSON で `gallery: [...]` を送ると `deny_unknown_fields` で 400 が返ります。

### 2.3 全テンプレート一覧 (v6 時点)

| Template | リージョン構成 | エンドポイント |
|---|---|---|
| `product_feature` | `header` / `media` / `meta` / `body` / `footer` | `GET /cards/products/{id}` |
| `product_detail` | `gallery` / `hero` / `spec` / `pricing` / `cta` / `promise` | `GET /cards/products/{id}/detail` |
| `cart` | `header` / `items` / `shipping` / `shippingMethod` / `summary` / `cta` | `GET /cards/cart` |

> **命名規則メモ**: Rust 側のフィールド名は `snake_case` (`shipping_method`)、JSON 出力は **すべて `camelCase`** (`shippingMethod`) に自動変換されます (`#[serde(rename_all = "camelCase")]`)。本ガイドの JSON サンプルはすべて camelCase 表記、文中で region を指す時は読みやすさ優先で `shipping_method` のような snake_case を使うことがあります。同じものです。
> **`promise` リージョン (Phase 2 追加)** は `product_detail` のみに存在し、安心保証カードを独立区画として表現します。

新しいテンプレートが必要な場合はサーバ側でリリースします。クライアントは未知 `template` を受け取ったら **`FallbackCard` で安全に縮退**してください (§9 参照)。

---

## 3. クイックスタート (5 分)

商品 1 件を取得して描画する最小フローです。

### 3.1 リクエスト

```bash
curl https://api.kochu.example/api/v1/cards/products/DHH-0271
```

### 3.2 レスポンス (実例)

```json
{
  "id": "DHH-0271",
  "template": "product_feature",
  "variant": "featured",
  "analyticsId": "product.DHH-0271",
  "regions": {
    "header": [
      {
        "key": "header-b1",
        "type": "badge",
        "role": "status",
        "label": { "source": "i18n", "key": "badge.featured" }
      }
    ],
    "media": [
      {
        "key": "media-img",
        "type": "media",
        "kind": "image",
        "src": "https://cdn.kochu.example/specimens/DHH-0271.jpg",
        "alt": { "source": "raw", "text": "ヘラクレス 個体写真" }
      }
    ],
    "meta": [
      {
        "key": "meta-ml",
        "type": "meta_line",
        "items": [
          { "key": "id",   "role": "id",   "value": "#DHH-0271" },
          { "key": "shop", "role": "shop", "value": "ANCHOR BEETLE CO." }
        ]
      }
    ],
    "body": [
      {
        "key": "body-hl",
        "type": "text",
        "role": "headline",
        "content": { "source": "raw", "text": "ヘラクレスオオカブト ♂ 142mm" }
      }
    ],
    "footer": [
      {
        "key": "footer-pr",
        "type": "price",
        "amount": 48000,
        "currency": "JPY",
        "taxIncluded": true
      }
    ]
  }
}
```

### 3.3 描画の最小ロジック (擬似コード)

```ts
// CardRenderer: template で template component を選ぶ
function CardRenderer({ card }: { card: CardBlock }) {
  switch (card.template) {
    case "product_feature": return <ProductFeatureCard card={card} />;
    case "product_detail":  return <ProductDetailCard  card={card} />;
    case "cart":            return <CartCard           card={card} />;
    default:                return <FallbackCard id={card.id} />;
  }
}

// 各テンプレートは region ごとに Block 配列を流す
function ProductFeatureCard({ card }) {
  return (
    <article>
      <header>{card.regions.header.map(b => <BlockRenderer block={b} />)}</header>
      <figure>{card.regions.media.map(b => <BlockRenderer block={b} />)}</figure>
      <div className="meta">{card.regions.meta.map(b => <BlockRenderer block={b} />)}</div>
      <div className="body">{card.regions.body.map(b => <BlockRenderer block={b} />)}</div>
      <footer>{card.regions.footer.map(b => <BlockRenderer block={b} />)}</footer>
    </article>
  );
}

// BlockRenderer: type で Block component を選ぶ
function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case "text":              return <TextView block={block} />;
    case "cta":               return <CtaView  block={block} />;
    case "media":             return <MediaView block={block} />;
    case "badge":             return <BadgeView block={block} />;
    case "metric_list":       return <MetricListView block={block} />;
    case "meta_line":         return <MetaLineView block={block} />;
    case "price":             return <PriceView block={block} />;
    case "eclosion_forecast": return <EclosionForecastView block={block} />;
    case "divider":           return <hr />;
    case "line_item":         return <LineItemView block={block} />;
    case "order_summary":     return <OrderSummaryView block={block} />;
    case "form_field":        return <FormFieldView block={block} />;
    case "shipping_method_picker": return <ShippingMethodPickerView block={block} />;
    default: return null;  // 未知 type は skip + log (§9)
  }
}
```

これで描画は終わりです。あとは **各 Block view を 1 ファイルずつ実装するだけ**。次のセクションから細部に入ります。

---

## 4. 共通ルール

### 4.1 Localizable (= 翻訳対象 文字列)

すべての user-facing 文字列は次の **タグ付き union** で送られてきます。

```ts
type Localizable =
  | { source: "i18n"; key: string; params?: Record<string, string | number> }
  | { source: "raw";  text: string };
```

| パターン | 意味 | 例 |
|---|---|---|
| `{ source: "i18n", key: "..." }` | 静的 UI コピー。フロントの辞書で解決 | ボタンラベル / バッジ文言 |
| `{ source: "i18n", key: "...", params: { n: 7 } }` | 部分動的 (ICU 風) | 「{n} 日後に羽化予測」 |
| `{ source: "raw", text: "..." }` | データ駆動の生文字列 | 商品名 / ID / ショップ名 |

#### 描画ヘルパ

```ts
function renderL(value: Localizable | undefined, t: Translator): string | undefined {
  if (!value) return undefined;
  return value.source === "raw" ? value.text : t(value.key, value.params);
}
```

**重要**: 「`raw` は翻訳しないでよい」というだけで、**innerHTML 注入の許可ではない**。`raw.text` も必ず textContent で描画してください。

### 4.2 `id` と `key`

| フィールド | スコープ | 不変性 | 用途 |
|---|---|---|---|
| `CardBlock.id` | グローバル | 不変 | キャッシュキー / 計測 ID のフォールバック |
| `Block.key` | カード内一意 | 可変 | 同一 region 内の reorder 時に再マウント識別 |
| `MetricItem.key` / `MetaItem.key` | items 配列内一意 | 可変 | 同上 |

サーバ側で重複・空文字は 400 で reject されるので、**フロントは「届いた `key` をそのまま React/Solid の `key={...}` に流す」だけ**で OK です。

### 4.3 数値と通貨

- **金額系フィールド (`amount` / `subtotalAmount` / `totalAmount` 等) はすべて `number`** (税込・整数・通貨の最小単位)
- **`currency`** は現状 `"JPY"` のみ。`amount` の単位は **円整数** (= `48000` は 48,000 円)
- **`taxIncluded: true`** は契約上常に true (= 全 `Price` は税込表示)

⚠️ **クライアント側で `unitPrice * qty` の再計算をしない**。`subtotalAmount` / `totalAmount` はサーバが確定値を返します。表示はそれをそのまま使ってください。

---

## 5. テンプレート別レスポンス

3 つのテンプレートそれぞれの構造とサンプル JSON を示します。

### 5.1 `product_feature` (商品ハイライトカード)

商品 1 件を一覧やヒーローに置く小さめのカード。

#### リージョンと描画タグ

| Region | 主な Block | HTML タグ |
|---|---|---|
| `header` | `badge` × N | `<header>` |
| `media` | `media` × 1 | `<figure>` |
| `meta` | `meta_line` | `<dl>` または `<div class="meta">` |
| `body` | `text` (`role: headline` を 1 つ) | `<div>` 内に `<h3>` (見出し) |
| `footer` | `price` / `eclosion_forecast` | `<footer>` |

サンプル JSON は §3.2 を参照。

### 5.2 `product_detail` (商品詳細ページ)

商品 1 件の詳細ページ。`product_feature` と同じ `id` で並立可能 (= キャッシュキーは別)。

#### リージョン構成

| Region | 用途 | 主な Block |
|---|---|---|
| `gallery` | 大画像 + サムネ | `media` × N |
| `hero` | 店名 / タイトル / 学名 / chip | `text` (byline / headline / subhead) + `badge` |
| `spec` | スペック (サイズ / 性別 / 累代 / 産地) | `metric_list` / `meta_line` |
| `pricing` | 価格 (税込 / 配送料注記) | `price` + `text` (caption) |
| `cta` | カート追加 / ウォッチ等 | `cta` × N (`action` 持ち) |
| `promise` | 安心保証 (死着補償・温度制御便) | `text` × 3-4 + 末尾 `cta` × 1 |

#### サンプル JSON (抜粋)

```bash
curl https://api.kochu.example/api/v1/cards/products/DHH-0271/detail
```

```json
{
  "id": "DHH-0271",
  "template": "product_detail",
  "variant": "default",
  "analyticsId": "product.DHH-0271.detail",
  "regions": {
    "gallery": [
      { "key": "g-1", "type": "media", "kind": "image",
        "src": "https://cdn.kochu.example/specimens/DHH-0271-1.jpg",
        "alt": { "source": "raw", "text": "上面" } },
      { "key": "g-2", "type": "media", "kind": "image",
        "src": "https://cdn.kochu.example/specimens/DHH-0271-2.jpg",
        "alt": { "source": "raw", "text": "側面" } }
    ],
    "hero": [
      { "key": "hero-by", "type": "text", "role": "byline",
        "content": { "source": "raw", "text": "ANCHOR BEETLE CO." } },
      { "key": "hero-hl", "type": "text", "role": "headline",
        "content": { "source": "raw", "text": "ヘラクレスオオカブト ♂ 142mm" } },
      { "key": "hero-sh", "type": "text", "role": "subhead",
        "content": { "source": "raw", "text": "Dynastes hercules hercules" } },
      { "key": "hero-b1", "type": "badge", "role": "evidence",
        "label": { "source": "i18n", "key": "badge.cb_f1" } }
    ],
    "spec": [
      { "key": "spec-m", "type": "metric_list",
        "items": [
          { "key": "size",   "label": { "source": "i18n", "key": "spec.size" },
                             "value": { "source": "raw",  "text": "142mm" } },
          { "key": "gender", "label": { "source": "i18n", "key": "spec.gender" },
                             "value": { "source": "i18n", "key": "spec.male" } },
          { "key": "gen",    "label": { "source": "i18n", "key": "spec.gen" },
                             "value": { "source": "raw",  "text": "CB F1" } }
        ]
      }
    ],
    "pricing": [
      { "key": "p-pr", "type": "price",
        "amount": 48000, "currency": "JPY", "taxIncluded": true },
      { "key": "p-cap", "type": "text", "role": "caption",
        "content": { "source": "i18n", "key": "pricing.shipping_note" } }
    ],
    "cta": [
      { "key": "cta-add", "type": "cta", "intent": "primary",
        "label": { "source": "i18n", "key": "cta.add_to_cart" },
        "href":  "/cart?add=DHH-0271",
        "action": { "type": "add_to_cart", "productId": "DHH-0271", "qty": 1 },
        "analyticsId": "product.DHH-0271.cta.add" },
      { "key": "cta-wat", "type": "cta", "intent": "secondary",
        "label": { "source": "i18n", "key": "cta.watch" },
        "href":  "/watch/DHH-0271",
        "action": { "type": "toggle_watch", "productId": "DHH-0271" } }
    ],
    "promise": [
      { "key": "pr-hl", "type": "text", "role": "headline",
        "content": { "source": "i18n", "key": "promise.title" } },
      { "key": "pr-b1", "type": "text", "role": "body",
        "content": { "source": "i18n", "key": "promise.dead_on_arrival" } },
      { "key": "pr-cta", "type": "cta", "intent": "tertiary",
        "label": { "source": "i18n", "key": "promise.detail_link" },
        "href":  "/about/promise" }
    ]
  }
}
```

**走査順** (アクセシビリティ・視線誘導): `gallery → hero → spec → pricing → promise → cta`。

### 5.3 `cart` (カート + チェックアウト)

1 ユーザにつき 1 枚 (`id` は固定で `"cart"`)。

#### リージョン構成

| Region | 用途 | 主な Block |
|---|---|---|
| `header` | 「あなたのカート (3 件)」 | `text` (×1, headline) |
| `items` | カート行。空 = カート空 | `line_item` × N |
| `shipping` | 配送先入力フォーム | `form_field` × 5 |
| `shippingMethod` | 配送方法ピッカー | `shipping_method_picker` × 1 |
| `summary` | 合計行 | `order_summary` × 1 |
| `cta` | 「Stripe で決済」「買い物を続ける」 | `cta` × N |

#### サンプル JSON (抜粋)

```bash
curl https://api.kochu.example/api/v1/cards/cart \
  -H "Cookie: session=xxx"
```

```json
{
  "id": "cart",
  "template": "cart",
  "variant": "default",
  "regions": {
    "header": [
      { "key": "h-hl", "type": "text", "role": "headline",
        "content": { "source": "i18n", "key": "cart.title", "params": { "n": 2 } } }
    ],
    "items": [
      {
        "key": "li-DHH-0271",
        "type": "line_item",
        "productId": "DHH-0271",
        "title": { "source": "raw", "text": "ヘラクレスオオカブト ♂ 142mm" },
        "imageSrc": "https://cdn.kochu.example/specimens/DHH-0271.jpg",
        "imageAlt": { "source": "raw", "text": "ヘラクレス 個体写真" },
        "unitPriceAmount": 48000,
        "currency": "JPY",
        "qty": 2,
        "subtotalAmount": 96000,
        "detailHref": "/products/DHH-0271",
        "decrementAction": { "type": "set_qty", "token": "tok_abc", "qty": 1 },
        "incrementAction": { "type": "set_qty", "token": "tok_abc", "qty": 3 },
        "removeAction":    { "type": "remove",  "token": "tok_abc" },
        "analyticsId": "cart.line.DHH-0271"
      }
    ],
    "shipping": [
      {
        "key": "ff-name",
        "type": "form_field",
        "name": "addressName",
        "label":       { "source": "i18n", "key": "checkout.name.label" },
        "value":       "山田太郎",
        "required":    true,
        "autocomplete": "name",
        "kind":        { "inputType": "text" },
        "patchAction": { "type": "patch_field", "fieldName": "addressName" }
      },
      {
        "key": "ff-pref",
        "type": "form_field",
        "name": "addressPref",
        "label": { "source": "i18n", "key": "checkout.pref.label" },
        "value": "13",
        "required": true,
        "kind": {
          "inputType": "select",
          "options": [
            { "id": "13", "label": { "source": "raw", "text": "東京都" } },
            { "id": "14", "label": { "source": "raw", "text": "神奈川県" } }
          ]
        },
        "patchAction": { "type": "patch_field", "fieldName": "addressPref" }
      }
    ],
    "shippingMethod": [
      {
        "key": "smp-method",
        "type": "shipping_method_picker",
        "options": [
          { "id": "cold",
            "name":        { "source": "raw", "text": "温度制御便（推奨）" },
            "description": { "source": "raw", "text": "生体含むため必須 · 15〜25℃" },
            "amount": 1800, "currency": "JPY" },
          { "id": "normal",
            "name":        { "source": "raw", "text": "通常便" },
            "description": { "source": "raw", "text": "用品のみ・常温配送" },
            "amount":  800, "currency": "JPY" }
        ],
        "selectedId": "cold",
        "patchAction": { "type": "patch_method" }
      }
    ],
    "summary": [
      {
        "key": "sum",
        "type": "order_summary",
        "lineCount": 1,
        "totalQty":  2,
        "subtotalAmount": 96000,
        "shippingAmount": 1800,
        "taxAmount":      null,
        "totalAmount":   97800,
        "currency": "JPY"
      }
    ],
    "cta": [
      { "key": "cta-checkout", "type": "cta", "intent": "primary",
        "label": { "source": "i18n", "key": "cart.checkout" },
        "href":  "/checkout/submit" }
    ]
  }
}
```

**空カート** は `items` / `shipping` / `shippingMethod` / `summary` を全て `[]` で返す。クライアントは `regions.items.length === 0` で empty state を出してください。

---

## 6. 一覧シェル `ProductListResponse`

商品一覧ページは **CardBlock より一段上** の shell 型を返します。

### 6.1 リクエスト

```bash
curl "https://api.kochu.example/api/v1/cards/products?category=live&sort=price_asc&page=2&q=ヘラクレス"
```

### 6.2 レスポンス構造

```json
{
  "filterBar": { "groups": [...] },
  "sortBar":   { "current": "price_asc", "options": [...] },
  "searchBox": { "query": "ヘラクレス", "submitHref": "/products", "paramName": "q",
                 "placeholder": { "source": "i18n", "key": "search.placeholder" } },
  "pagination": { "page": 2, "perPage": 20, "totalCount": 42, "totalPages": 3,
                  "prevHref": "/products?page=1", "nextHref": "/products?page=3",
                  "pages": [
                    { "kind": "page", "number": 1, "href": "/products?page=1", "selected": false },
                    { "kind": "page", "number": 2, "href": "/products?page=2", "selected": true  },
                    { "kind": "page", "number": 3, "href": "/products?page=3", "selected": false }
                  ] },
  "cards": [
    { "id": "DHH-0271", "template": "product_feature", "regions": { ... } },
    { "id": "DHH-0341", "template": "product_feature", "regions": { ... } }
  ]
}
```

### 6.3 重要な契約

| 要素 | フロントの責務 | サーバの責務 |
|---|---|---|
| **`filterBar.groups[].chips[].href`** | `<a href>` で踏むだけ | toggle 後の URL を計算して返す |
| **`sortBar.options[].href`** | `<a href>` で踏むだけ | 現在の filter / search を維持した URL を返す |
| **`pagination.pages`** | `for (link of pages) { ... }` | 省略 (ellipsis) を含めて collapse 済み |
| **`searchBox`** | `<form action="{submitHref}" method="get">` で送信 | クエリパラメータの正規化 |
| **`filterChip.count`** | 数字を表示するだけ | 「他軸維持で切り替えたら何件か」を計算 |

⚠️ **toggle URL を client で組まない**。サーバが返した `href` をそのまま使ってください。クエリ正規化 (`?page=1` を消す等) もサーバ側です。

### 6.4 連鎖順序

> filter → search (q) → sort → paginate

faceted count は「**filter のみ適用後**」の母集団で計算されます。検索 box に文字を打っても filter chip の数字は揺らぎません。

---

## 7. Action と server-driven state pattern

ここがフロント実装で **一番重要** なセクションです。

### 7.1 Action 4 種

mutation を伴う UI は、その UI の Block 自体に **「これをクリックしたら何の API を叩くか」** が含まれています。これを Action と呼びます。

| 親 Block | Action enum | バリアント | エンドポイント |
|---|---|---|---|
| `Cta` | `CtaAction` | `add_to_cart` | `POST /cart` |
| `Cta` | `CtaAction` | `toggle_watch` | `POST /watch/{productId}` |
| `LineItem` | `LineItemAction` | `set_qty` | `PATCH /cart/items/{token}` |
| `LineItem` | `LineItemAction` | `remove` | `DELETE /cart/items/{token}` |
| `FormField` | `CheckoutFieldAction` | `patch_field` | `PATCH /checkout/shipping_field/{fieldName}` |
| `ShippingMethodPicker` | `CheckoutMethodAction` | `patch_method` | `PATCH /checkout/shipping_method` |

**規約**: Block を渡せば **何を呼べば良いか自明** に組まれています。クライアントは「URL を組み立てる」のではなく「Block の Action フィールドを読んでそのまま endpoint を叩く」だけです。

### 7.2 Action から URL への組み立て例

```ts
function urlForCtaAction(a: CtaAction): { method: string; url: string; body?: any } {
  switch (a.type) {
    case "add_to_cart":
      return {
        method: "POST", url: "/api/v1/cart",
        body: { productId: a.productId, qty: a.qty }
      };
    case "toggle_watch":
      return {
        method: "POST",
        url: `/api/v1/watch/${encodeURIComponent(a.productId)}`
      };
  }
}

function urlForLineItemAction(a: LineItemAction): { method: string; url: string; body?: any } {
  const token = encodeURIComponent(a.token);
  switch (a.type) {
    case "set_qty":
      return {
        method: "PATCH", url: `/api/v1/cart/items/${token}`,
        body: { qty: a.qty }
      };
    case "remove":
      return {
        method: "DELETE", url: `/api/v1/cart/items/${token}`
      };
  }
}

function urlForCheckoutFieldAction(a: CheckoutFieldAction, value: string) {
  return {
    method: "PATCH",
    url: `/api/v1/checkout/shipping_field/${encodeURIComponent(a.fieldName)}`,
    body: { value }
  };
}

function urlForCheckoutMethodAction(a: CheckoutMethodAction, selectedId: string) {
  // a.type === "patch_method" の 1 ケースのみ。payload は selectedId のみ。
  return {
    method: "PATCH", url: "/api/v1/checkout/shipping_method",
    body: { selectedId }
  };
}
```

### 7.3 server-driven state pattern (= ここが核心)

**規律**: カートの数量や入力フォームの値を **クライアントで保持しない**。次のフローを必ず守ってください。

```
ユーザ操作 (例: + ボタン押下)
   ↓
client は LineItemAction を読んで PATCH /cart/items/{token} { qty: qty+1 } を発行
   ↓
server は cart_store を更新し 204 No Content を返す
   ↓
client は GET /cards/cart で snapshot を再 fetch
   ↓
新しい CardBlock を CardRenderer に流し込む
   ↓
UI が server の真実値で再描画される
```

#### なぜこれを守るのか

- **client / server で値がズレる事故が原理的に起きない** (= 真実は常に server 側)
- **optimistic update reducer をクライアントに書く必要がない** (UI コードが薄い)
- **server-side validation の結果がそのまま UI に出る** (在庫切れ・必須未入力)
- **多デバイス同時操作でも最後の fetch が真実**

#### 例外: 純粋なフロント表示状態

サーバに上げる必要のないものは普通の signals/state で OK です。

| 種別 | server-driven? |
|---|---|
| カートの qty | **YES** |
| 配送先のフィールド値 | **YES** |
| 配送方法の selectedId | **YES** |
| ギャラリーのサムネ選択 (UI のみ) | NO (ローカル signal) |
| アコーディオンの開閉 | NO |
| トースト通知の表示中フラグ | NO |

### 7.4 シーケンス例: カート行の数量を 2 → 3 にする

```
1. ユーザが + ボタンを押す
   → block.incrementAction = { type: "set_qty", token: "tok_abc", qty: 3 }

2. フロント:
   PATCH /api/v1/cart/items/tok_abc
   Content-Type: application/json
   { "qty": 3 }

3. サーバ: 204 No Content

4. フロント:
   GET /api/v1/cards/cart
   → 新しい CardBlock (qty=3, subtotalAmount=144000, totalAmount=145800 ...)

5. フロント: CardRenderer に流して再描画
```

#### debounce の指針

| Block | debounce |
|---|---|
| `LineItem` の +/- ボタン | なし (即発火) |
| `LineItem` の `remove` | なし (即発火) |
| `FormField` (text / tel / postal) | 300ms |
| `FormField` (select) | なし (change で即発火) |
| `ShippingMethodPicker` | なし (radio change で即発火) |

### 7.5 form field の validationError

サーバ側 validation に失敗すると、再 fetch 後の `FormField.validationError` に Localizable が乗って返ります:

```json
{
  "key": "ff-zip", "type": "form_field",
  "name": "addressZip",
  "value": "abc",
  "validationError": { "source": "i18n", "key": "checkout.zip.invalid" },
  ...
}
```

クライアントは「`validationError` が `null` でなければ赤枠 + メッセージ表示」というルールで描画してください。**クライアント側で先に validate して PATCH を止めるな**。サーバが真実です (将来 server が `regex` ヒントを返すかも、というのは Future Work)。

---

## 8. エンドポイント一覧

### 8.1 全エンドポイント (v6)

```
# Cards (read)
GET    /api/v1/cards/products                           # 一覧 shell
GET    /api/v1/cards/products/{id}                      # product_feature
GET    /api/v1/cards/products/{id}/detail               # product_detail
GET    /api/v1/cards/cart                               # cart

# Cart mutations
POST   /api/v1/cart                                     # add (returns undoToken)
PATCH  /api/v1/cart/items/{token}                       # set qty
DELETE /api/v1/cart/items/{token}                       # remove / undo

# Watch
POST   /api/v1/watch/{productId}                        # toggle

# Checkout mutations
PATCH  /api/v1/checkout/shipping_field/{name}           # 配送先 1 フィールド
PATCH  /api/v1/checkout/shipping_method                 # 配送方法

# Analytics ingest
POST   /api/v1/events                                   # batch (impression / click)
```

### 8.2 リクエスト/レスポンス契約

| メソッド | エンドポイント | リクエストボディ | レスポンス |
|---|---|---|---|
| GET | `/cards/...` | なし | `CardBlock` または `ProductListResponse` (200) |
| POST | `/cart` | `{ productId, qty }` | `{ undoToken: "..." }` (200) |
| PATCH | `/cart/items/{token}` | `{ qty: number }` | 204 No Content |
| DELETE | `/cart/items/{token}` | なし | 204 No Content |
| POST | `/watch/{productId}` | なし | `{ watching: boolean }` (200) |
| PATCH | `/checkout/shipping_field/{name}` | `{ value: string }` | 204 No Content |
| PATCH | `/checkout/shipping_method` | `{ selectedId: string }` | 204 No Content |
| POST | `/events` | `{ events: [...] }` | 204 No Content |

### 8.3 共通レスポンスヘッダ

```http
ETag: "kochu-DHH-0271-20260420T1230Z"
Last-Modified: Mon, 20 Apr 2026 12:30:00 GMT
Cache-Control: public, max-age=60          # /cards/products, /cards/products/{id}
Cache-Control: no-store                     # /cards/cart (personalized)
Content-Type: application/json
```

カート系は personalized なので **`If-None-Match` での 304 を期待しない** でください。常に 200 で再 snapshot されます。

### 8.4 Analytics ingest

UI 表示・クリックを batch で送信します。

```bash
POST /api/v1/events
Content-Type: application/json

{
  "events": [
    { "analyticsId": "product.DHH-0271",
      "eventType": "impression",
      "timestampMs": 1714060800000,
      "context": { "variant": "featured" } },
    { "analyticsId": "product.DHH-0271.cta.add",
      "eventType": "click",
      "timestampMs": 1714060810000,
      "context": {} }
  ]
}
```

| 制約 | 値 |
|---|---|
| `events.length` | ≤ 100 / batch (超過 → 413) |
| `analyticsId` | 1〜128 文字 / 空不可 |
| `context` キー数 | ≤ 32 / event |
| `context` 値長 | ≤ 256 文字 |
| body サイズ | ≤ 64 KB |

`analyticsId` 未指定時のフォールバックは `card.id` または `${cardAnalyticsId}.${block.key}` を機械的に組み立てます (§4.2)。

---

## 9. エラーと縮退戦略

### 9.1 サーバから返ってくる主要なエラー

| ステータス | 状況 | フロントの挙動 |
|---|---|---|
| 400 | 不正な `Href` (`javascript:` 等) / key 重複 / 未知 enum | バグなのでログ。リトライしない |
| 400 | Action body の qty < 1 など整数違反 | 操作を止める |
| 404 | `LineItemAction.token` がサーバ側未知 | カートを再 fetch (= 多人数同時操作) |
| 413 | analytics batch 超過 | 50 件ずつに分割して再送 |
| 5xx | サーバ障害 | リトライ (exponential backoff)、トースト通知 |

### 9.2 クライアント側の縮退ルール

| 状況 | 挙動 |
|---|---|
| 未知の `template` | `FallbackCard` を描画 + ログ通知 |
| 未知の `block.type` | その block を skip + ログ通知 |
| 既知 type だが未知の `role` | デフォルトロールにフォールバック |
| `media.src` が解決不能 | `MediaFallback` (= プレースホルダ + alt) |
| `Localizable.i18n` のキー解決失敗 | dev: キー名表示 / prod: 空文字 + ログ |
| `FormField.validationError` が non-null | サーバ返却の Localizable を `localizable()` で解決してフィールド直下に赤字表示 |
| `regions.items` が `[]` (cart) | empty state を描画 |
| `pagination` / `filterBar` 等が `undefined` | そのシェル要素を描かない |

**重要**: 未知の variant は **アプリをクラッシュさせない**。サーバが新しい block を追加した時、古いクライアントは新しい block を skip して残りを描画する、という前方互換を保ってください。

### 9.3 MediaFallback の a11y 規約

`alt` の有無で必ず分岐させてください (中間状態は禁止):

```tsx
{props.alt
  ? <div role="img" aria-label={resolvedAlt}><Icon /></div>      // 意味のある画像
  : <div role="presentation" aria-hidden="true"><Icon /></div>}  // 装飾
```

---

## 10. やってはいけないこと (Anti-patterns)

| ❌ NG | ✅ Do instead |
|---|---|
| `innerHTML` / `dangerouslySetInnerHTML` で Localizable を流す | 必ず textContent (`{value}` で展開) |
| `unitPriceAmount * qty` で subtotal を再計算 | サーバが返す `subtotalAmount` をそのまま表示 |
| カートの qty / フォーム値を `useState` で持つ | PATCH → 再 fetch で server 値に統一 |
| filter chip の URL を client で組み立てる | サーバが返した `chip.href` をそのまま使う |
| `LineItemAction.SetQty { qty: 0 }` を送る | `Remove` を使う (qty < 1 は 400) |
| `Action.token` の中身を解釈する | 不透明 ID として扱う (中身は契約外) |
| `block.key` を自前で生成 / 上書き | サーバが返したものをそのまま `key={...}` に流す |
| ブラウザストレージ (localStorage 等) に SDUI レスポンスをキャッシュ | HTTP キャッシュに任せる (ETag / max-age) |
| `Block.Cta.action` を見て、`href` を無視 | **両方使う** (action は JS あり、href は no-JS フォールバック) |
| 未知の `block.type` で例外を throw | skip + ログ (= 前方互換) |
| 自分でキー解決した文字列を `params` に渡す | params は数値・ID のみ。文字列は別キーに |

---

## 付録 A: Block 全 13 種

| `type` | 用途 | 主要フィールド | 導入 |
|---|---|---|---|
| `text` | テキスト全般 | `role` (eyebrow/headline/subhead/lead/body/caption/byline) + `content: Localizable` | Phase 1 |
| `cta` | ボタン / リンク | `intent` + `label` + `href` + `action?` | Phase 1 |
| `media` | 画像 / 動画 / アイコン | `kind` (image/video/icon/placeholder) + `src?` + `alt?` | Phase 1 |
| `badge` | 状態バッジ | `role` (status/evidence/warning/promo) + `label` | Phase 1 |
| `metric_list` | 数値ラベル群 | `items[]: { key, label, value }` | Phase 1 |
| `meta_line` | 1 行メタ | `items[]: { key, role: id/shop/code/lot/breeder, value }` | Phase 1 |
| `price` | 価格 | `amount` + `currency` + `taxIncluded` | Phase 1 |
| `eclosion_forecast` | 羽化予測 | `daysAhead` + `date` + `tolerance` | Phase 1 |
| `divider` | 区切り線 | (none) | Phase 1 |
| `line_item` | カート 1 行 | `productId` + `title` + `qty` + `unitPriceAmount` + `subtotalAmount` + 3 Action | Phase 7 |
| `order_summary` | カート集計 | `subtotalAmount` + `shippingAmount?` + `taxAmount?` + `totalAmount` | Phase 7 |
| `form_field` | 入力 1 フィールド | `name` + `label` + `value?` + `kind` (text/tel/postal_code/select) + `patchAction` | Phase 8 |
| `shipping_method_picker` | 配送方法 radio | `options[]` + `selectedId` + `patchAction` | Phase 8 |

---

## 付録 B: よくある質問

**Q1. `template` を増やしたいです。**
→ サーバ側 PR で対応します。クライアントは `FallbackCard` で縮退するので、リリース順は「サーバ → クライアント」で OK。

**Q2. レスポンスに `updated_at` を含められませんか?**
→ `CardBlock` 本体には入れません。HTTP の `ETag` / `Last-Modified` ヘッダを使ってください。

**Q3. 多通貨対応はいつ?**
→ Future Work。当面は `currency: "JPY"` 固定で扱ってください。

**Q4. WebSocket で push してほしい (cart の他デバイス同期)。**
→ Future Work。現状はポーリング or 操作後の再 fetch で対応してください。

**Q5. オフライン対応は?**
→ 未対応。SDUI レスポンスを永続化キャッシュしないでください (古いスキーマと新しいクライアントの組み合わせで誤描画する)。

**Q6. クライアントで型を生成する仕組みは?**
→ サーバ側 Rust から ts-rs で `.ts` を生成し、`generated/sdui.ts` に集約します。アプリコードは **`branded.ts` 経由** で import します (`Href` / `I18nKey` がブランド型として強化される)。詳細は v6 §7.5。

**Q7. テスト用のフィクスチャはありますか?**
→ `fixtures/cards/*.json` に各テンプレート × variant のサンプルがあります。Storybook + JSON Schema 検証で前方互換を確認できます。

---

## 参考リンク

- `docs/sdui-three-layer-model-v6.md` — 完全仕様書 (Source of Truth)
- `docs/sdui-three-layer-model-v6.md` §11.8 — server-driven state pattern の根拠
- `docs/sdui-three-layer-model-v6.md` §15.2 — 全エンドポイント定義
- `docs/sdui-three-layer-model-v6.md` §16 — Non-Goals (やらないこと一覧)

質問・フィードバックは Slack の `#sdui` チャネルへ。
