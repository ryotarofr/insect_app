---
title: "SDUI 三層モデル 設計方針 v2"
description: "SDUI 三層モデル v2 (歴史的資料)。"
sidebar:
  order: 2
---

:::caution[歴史的資料]
このページは過去のバージョンです。現行の正典は [SDUI 三層モデル v6](/insect_app/architecture/sdui-three-layer-model-v6/) を参照してください。設計判断の根拠としてここを引用しないでください。
:::

> KOCHU のカード／セクションを動的にデータ駆動で表示するための、Server-Driven UI (SDUI) スキーマ設計。
>
> v1 のレビュー結果を反映し、i18n / 計測 / a11y / セキュリティ / 命名の閉鎖性を強化したバージョン。

## 0. v1 からの変更点 (Changelog)

| 区分 | 変更点 | 理由 |
|---|---|---|
| 高 | `meta_line.items[].role` を閉じた enum (`MetaLineItemRole`) に変更 | 設計原則 #3 (語彙は閉じた enum) との一貫性 |
| 高 | `text.level` を廃止。見出しレベルはテンプレートが決定 | a11y。CMS 入稿でアウトラインが壊れる事故を防ぐ |
| 高 | `cta.href` を `Href` ブランド型 + 許容スキーム enum で制約 | XSS 対策 (`javascript:` URL を入稿不能にする) |
| 高 | テキスト値を i18n キー方式に統一 (`value` ではなく `i18nKey`) | 多言語化を後付けで破壊的変更にしないため |
| 中 | `experiment` をカードのトップレベルに追加 | A/B テスト前提でスキーマを設計しておく |
| 中 | パーソナライズ／条件表示の責任をバック側に明示 (Non-Goals 拡張) | スキーマ肥大化防止 |
| 中 | `price.currency` を `Currency` enum 化 | 将来の多通貨対応を破壊的変更にしないため |
| 中 | `Block.key` を必須化、React の key にインデックス利用を禁止 | 並び替え時の再マウント事故を防ぐ |
| 中 | `forecast` ブロックを `eclosion_forecast` に分離 (ドメイン特化型) | §3 の「ロールでなくブロック型で分ける」方針との一貫性 |
| 低 | `CardBlock` を `template` で判別される判別共用体に変更 | `variant` を template 従属の閉じた enum にできる |
| 低 | テンプレートごとに `headline` リージョンの有無を明文化 | 「`body` に含めても可」の二枚舌を解消 |
| 低 | テスト戦略 (§13) / キャッシュ戦略 (§14) を新設 | 実装に入る前に契約を明確化 |

## 1. 目的

ヒーロー、商品ハイライト、約束カードなどの UI を **DB 駆動** で出し分けたい。一方で **デザインシステム・アクセシビリティ・パフォーマンス** は壊したくない。将来的に、運営／ブリーダーが管理画面から内容を編集できる土台を作る。

「データを動的に」「スタイルは破綻させない」を両立させるために、**レイアウトはコード／コンテンツは DB** という分離を、三層の抽象で表現する。

## 2. 設計原則

1. **位置情報そのものを DB に持たせない**。座標・余白・レスポンシブ規則はすべてコード側 (TSX) の責務。
2. **DB が決めるのは「どのテンプレートを使うか」「各リージョンに何を入れるか」だけ**。
3. **語彙は閉じた enum で統制**する。新規追加は設計レビューを通す。`role` / `kind` / `intent` のように外見が string 型に見えるフィールドも、必ず enum で閉じる。
4. **多重度 (同じ役割の繰り返し) は配列で表現**する。`primaryCta` / `secondaryCta` のような ad-hoc 命名は禁止。
5. **フロント・バックで型定義を共有**し、CI で網羅性を保証する。
6. **未知のテンプレート・ブロックは安全に縮退**する fallback を必ず実装する。
7. **a11y を壊し得るプロパティはデータ側に持たせない**。見出しレベル・読み順・タブ順序などは、テンプレートが決定する。
8. **計測 ID は最初から仕込む**。`analyticsId` / `experiment` は optional で構わないので、Phase 1 の段階でスキーマに含める (後付けはマイグレ地獄になる)。
9. **テキスト値は i18n キーで持つ**。生のローカライズ済み文字列を DB に直接入れない。

## 3. 三層モデル

| 層 | 役割 | 個数 | 実体 |
|---|---|---|---|
| **Region (リージョン)** | カード内の論理的な「場所」。テンプレートが定義する | 数個に固定 | Map |
| **Block (ブロック)** | リージョン内に並ぶ要素。型を持つ | 各リージョン 0..N | Array |
| **Role (ロール)** | ブロック型の中での意味的サブ分類 | ブロックの属性 | enum |

### 3.1 Region (リージョン)

カード横断で共通の論理的配置場所。テンプレートが「どのリージョンを持ち、それをどう描画するか」を決める。

標準セット (KOCHU での初期値):

- `header` — 上部の冒頭要素 (eyebrow、バッジなど)
- `media` — 画像／動画／アイコン
- `meta` — ID、ショップ名、コードなどの補助情報行
- `headline` — 主見出し領域。**テンプレートごとに「持つ／持たない」を §5 のテンプレート定義表で明示する**
- `body` — 本文／副見出し
- `actions` — CTA、リンク
- `footer` — 価格、補助メタ、予測バナー

### 3.2 Block (ブロック)

リージョンに入る配列要素。`type` で識別される閉じた enum。

初期セット:

- `text` — テキスト全般 (ロールでさらに分類)
- `cta` — ボタン／リンク (intent で primary/secondary/tertiary)
- `media` — 画像／動画／アイコン (kind で分類)
- `badge` — 状態バッジ (role で status/evidence/warning/promo)
- `metric_list` — 数値ラベル群 (累計カルテ 12,480 件 など)
- `meta_line` — ID／ショップ名／コードなど 1 行のメタ情報
- `price` — 価格表示専用ブロック
- `eclosion_forecast` — 羽化予測バナー (羽化に特化したブロック型)
- `divider` — 区切り線

> 将来「発送予測」「次回入荷予測」などが必要になった場合は、汎用 `forecast` を作るのではなく、`shipping_forecast` / `restock_forecast` のように **ドメイン特化型ブロックを追加**する (§3 のブロック分割原則)。

### 3.3 Role (ロール)

ブロックの `type` ごとに **異なる closed enum** を持つ。

#### `text` のロール
新聞・雑誌の組版用語を借用する。`description` のような曖昧な名前は避ける。

| ロール | 用途 | 例 |
|---|---|---|
| `eyebrow` | 主見出しの上に置く小さなラベル | `── ようこそ KOCHU へ` |
| `headline` | 主見出し | `買う、育てる、継ぐ。` |
| `subhead` | 副見出し | `Dynastes hercules hercules` |
| `lead` | 本文より太めのリード文 | ヒーロー説明 |
| `body` | 本文 | 約束カードの説明 |
| `caption` | 補助テキスト | 画像キャプション |
| `byline` | 出典・著者 | ブリーダー名表示 |

> **見出しレベル (h1-h6) はデータに含めない**。テンプレート + リージョン位置から決定する (例: `hero_intro` の `headline` リージョンの role:headline は h1、`product_feature` の `body` リージョンの role:headline は h3、など)。

#### `cta` の intent
`primary` / `secondary` / `tertiary` / `destructive`

#### `media` の kind
`image` / `video` / `icon` / `placeholder`

#### `badge` の role
`status` / `evidence` / `warning` / `promo`

#### `meta_line.items[]` の role
`id` / `shop` / `code` / `lot` / `breeder`

> 必要に応じて追加するが、**必ず enum を閉じる**。`role: string` は禁止。

## 4. スキーマ全体形

```typescript
// shared/schema/blocks.ts — フロント・バック共通の単一の真実

// ── 基本 enum ─────────────────────────────────────────
export type RegionName =
  | "header" | "media" | "meta" | "headline"
  | "body" | "actions" | "footer";

export type BlockType =
  | "text" | "cta" | "media" | "badge"
  | "metric_list" | "meta_line"
  | "price" | "eclosion_forecast" | "divider";

export type TextRole =
  | "eyebrow" | "headline" | "subhead"
  | "lead" | "body" | "caption" | "byline";

export type CtaIntent         = "primary" | "secondary" | "tertiary" | "destructive";
export type MediaKind         = "image" | "video" | "icon" | "placeholder";
export type BadgeRole         = "status" | "evidence" | "warning" | "promo";
export type MetaLineItemRole  = "id" | "shop" | "code" | "lot" | "breeder";

// ── 値オブジェクト ────────────────────────────────────
export type Currency = "JPY" | "USD" | "EUR";   // 当面 JPY のみ運用

/**
 * Href ブランド型。`https:` / 内部パス (`/...`) / `mailto:` / `tel:` のみ許容。
 * 構築は assertHref(raw: string): Href を経由する (バック側で一度だけ検証)。
 * `javascript:` 等は構築時点で reject される。
 */
export type Href = string & { readonly __brand: "Href" };

/**
 * I18n キー。`<scope>.<key>.<version>` 形式 (例: `hero.intro.headline.v1`)。
 * フロント側で辞書解決される。生の文字列を value に入れることは禁止。
 */
export type I18nKey = string & { readonly __brand: "I18nKey" };

// ── ブロック ──────────────────────────────────────────
export type Block =
  | { key: string; type: "text";        role: TextRole; i18nKey: I18nKey;
      analyticsId?: string }
  | { key: string; type: "cta";         intent: CtaIntent; labelI18nKey: I18nKey; href: Href;
      analyticsId?: string }
  | { key: string; type: "media";       kind: MediaKind; src?: string;
      altI18nKey?: I18nKey; iconName?: string;
      analyticsId?: string }
  | { key: string; type: "badge";       role: BadgeRole; labelI18nKey: I18nKey;
      analyticsId?: string }
  | { key: string; type: "metric_list"; items: { labelI18nKey: I18nKey; valueI18nKey: I18nKey }[];
      analyticsId?: string }
  | { key: string; type: "meta_line";   items: { role: MetaLineItemRole; value: string;
                                                 align?: "start" | "end" }[];
      analyticsId?: string }
  | { key: string; type: "price";       amount: number; currency: Currency; taxIncluded: boolean;
      analyticsId?: string }
  | { key: string; type: "eclosion_forecast"; daysAhead: number; date: string; tolerance: number;
      analyticsId?: string }
  | { key: string; type: "divider" };

// ── 実験 ──────────────────────────────────────────────
export type Experiment = {
  /** 実験のキー (例: "hero_cta_2026q2") */
  key: string;
  /** バリアント名 (例: "A" | "B" | "control") */
  variant: string;
};

// ── テンプレート (判別共用体) ─────────────────────────
/**
 * テンプレートごとに variant を異なる閉じた enum で持つ。
 * 破壊的変更が必要な時は `product_feature.v2` のように suffix を付け、
 * 両方をレジストリに登録して段階移行する。
 */
export type CardBlock =
  | {
      template: "hero_intro";
      id: string;
      variant?: "default";
      experiment?: Experiment;
      analyticsId?: string;
      regions: Partial<Record<"header" | "headline" | "body" | "actions" | "footer", Block[]>>;
    }
  | {
      template: "product_feature";
      id: string;
      variant?: "default" | "featured" | "compact";
      experiment?: Experiment;
      analyticsId?: string;
      regions: Partial<Record<"header" | "media" | "meta" | "body" | "footer", Block[]>>;
    }
  | {
      template: "promise_step";
      id: string;
      variant?: "default";
      experiment?: Experiment;
      analyticsId?: string;
      regions: Partial<Record<"header" | "media" | "body" | "actions", Block[]>>;
    };

export type TemplateName = CardBlock["template"];
```

> **注**: `Href` / `I18nKey` のブランド型は実行時には素の string と区別されないため、構築は **必ずバック側のバリデータを経由する** こと。フロント側で `as Href` キャストするのは禁止。

## 5. テンプレート定義

各テンプレートが持つリージョンと、そのリージョン内の許容ブロックを明示する。

| Template | header | media | meta | headline | body | actions | footer |
|---|---|---|---|---|---|---|---|
| `hero_intro` | text(eyebrow) | — | — | text(headline, **h1**) | text(lead/body) | cta×N | metric_list |
| `product_feature` | badge×N | media×1 | meta_line | — | text(headline **h3**, subhead) | — | price, eclosion_forecast |
| `promise_step` | text(eyebrow) | media(icon) | — | — | text(headline **h3**, body) | cta×N | — |

### 5.1 ヒーロー紹介カード `hero_intro`

```jsonc
{
  "id": "hero-main",
  "template": "hero_intro",
  "experiment": { "key": "hero_copy_2026q2", "variant": "B" },
  "analyticsId": "hero.main",
  "regions": {
    "header": [
      { "key": "eb",  "type": "text", "role": "eyebrow",
        "i18nKey": "hero.intro.eyebrow.v1" }
    ],
    "headline": [
      { "key": "hl",  "type": "text", "role": "headline",
        "i18nKey": "hero.intro.headline.v1" }
    ],
    "body": [
      { "key": "ld",  "type": "text", "role": "lead",
        "i18nKey": "hero.intro.lead.v1" }
    ],
    "actions": [
      { "key": "cta1", "type": "cta", "intent": "primary",
        "labelI18nKey": "hero.intro.cta.find_specimens.v1",
        "href": "/products",
        "analyticsId": "hero.main.cta.find_specimens" },
      { "key": "cta2", "type": "cta", "intent": "secondary",
        "labelI18nKey": "hero.intro.cta.about.v1",
        "href": "/about",
        "analyticsId": "hero.main.cta.about" }
    ],
    "footer": [
      { "key": "ml", "type": "metric_list", "items": [
          { "labelI18nKey": "hero.metric.karte.label.v1",
            "valueI18nKey": "hero.metric.karte.value.v1" },
          { "labelI18nKey": "hero.metric.breeders.label.v1",
            "valueI18nKey": "hero.metric.breeders.value.v1" },
          { "labelI18nKey": "hero.metric.compensation.label.v1",
            "valueI18nKey": "hero.metric.compensation.value.v1" }
      ]}
    ]
  }
}
```

### 5.2 商品ハイライトカード `product_feature`

```jsonc
{
  "id": "DHH-0271",
  "template": "product_feature",
  "variant": "featured",
  "analyticsId": "product.DHH-0271",
  "regions": {
    "header": [
      { "key": "b1", "type": "badge", "role": "status",
        "labelI18nKey": "badge.featured.v1" },
      { "key": "b2", "type": "badge", "role": "evidence",
        "labelI18nKey": "badge.pedigreed.v1" }
    ],
    "media": [
      { "key": "img", "type": "media", "kind": "image",
        "src": "...",
        "altI18nKey": "product.DHH-0271.image.alt.v1" }
    ],
    "meta": [
      { "key": "ml", "type": "meta_line", "items": [
          { "role": "id",   "value": "#DHH-0271" },
          { "role": "shop", "value": "ANCHOR BEETLE CO." },
          { "role": "code", "value": "CBF2", "align": "end" }
      ]}
    ],
    "body": [
      { "key": "hl", "type": "text", "role": "headline",
        "i18nKey": "product.DHH-0271.name.v1" },
      { "key": "sh", "type": "text", "role": "subhead",
        "i18nKey": "product.DHH-0271.scientific_name.v1" }
    ],
    "footer": [
      { "key": "pr", "type": "price",
        "amount": 48000, "currency": "JPY", "taxIncluded": true },
      { "key": "ef", "type": "eclosion_forecast",
        "daysAhead": 15, "date": "2026-05-04", "tolerance": 5 }
    ]
  }
}
```

### 5.3 約束カード `promise_step`

```jsonc
{
  "id": "promise-01",
  "template": "promise_step",
  "analyticsId": "promise.01",
  "regions": {
    "header": [
      { "key": "eb", "type": "text", "role": "eyebrow",
        "i18nKey": "promise.01.eyebrow.v1" }
    ],
    "media": [
      { "key": "ic", "type": "media", "kind": "icon", "iconName": "clipboard" }
    ],
    "body": [
      { "key": "hl", "type": "text", "role": "headline",
        "i18nKey": "promise.01.headline.v1" },
      { "key": "bd", "type": "text", "role": "body",
        "i18nKey": "promise.01.body.v1" }
    ],
    "actions": [
      { "key": "cta", "type": "cta", "intent": "tertiary",
        "labelI18nKey": "promise.01.cta.example.v1",
        "href": "/karte/example",
        "analyticsId": "promise.01.cta.example" }
    ]
  }
}
```

## 6. フロントエンドの実装パターン

### 6.1 テンプレートレジストリ

```tsx
// templates/registry.ts
export const TEMPLATE_REGISTRY = {
  hero_intro:      HeroIntro,
  product_feature: ProductFeature,
  promise_step:    PromiseStep,
} as const;

export function CardRenderer({ block }: { block: CardBlock }) {
  const Component = TEMPLATE_REGISTRY[block.template];
  if (!Component) return <FallbackCard id={block.id} />;
  // impression 計測 (analyticsId / experiment があれば送る)
  useImpression(block);
  return <Component {...block} />;
}
```

### 6.2 リージョンレンダラー (テンプレート横断で共通)

```tsx
function RegionRenderer({ blocks }: { blocks?: Block[] }) {
  if (!blocks?.length) return null;
  // ★ 必ず block.key を使う。インデックスは禁止。
  return <>{blocks.map(b => <BlockRenderer key={b.key} block={b} />)}</>;
}

function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case "text":              return <TextBlock {...block} />;
    case "cta":               return <CtaButton {...block} />;
    case "media":             return <MediaBlock {...block} />;
    case "badge":             return <BadgeBlock {...block} />;
    case "metric_list":       return <MetricList {...block} />;
    case "meta_line":         return <MetaLine {...block} />;
    case "price":             return <PriceBlock {...block} />;
    case "eclosion_forecast": return <EclosionForecastBanner {...block} />;
    case "divider":           return <hr className="card__divider" />;
    default: {
      // TypeScript の網羅性検査でここに到達できないことが保証される
      const _exhaustive: never = block;
      return null;
    }
  }
}
```

### 6.3 テンプレート例 (見出しレベルはテンプレートが決定)

```tsx
function ProductFeature({ regions }: Extract<CardBlock, { template: "product_feature" }>) {
  return (
    <article className="card card--product-feature">
      <header className="card__header"><RegionRenderer blocks={regions.header} /></header>
      <div    className="card__media"> <RegionRenderer blocks={regions.media}  /></div>
      <div    className="card__meta">  <RegionRenderer blocks={regions.meta}   /></div>
      {/* body 内の text(headline) は h3 で描画される (TextBlock 側で context 解釈) */}
      <div    className="card__body">  <RegionRenderer blocks={regions.body}   /></div>
      <footer className="card__footer"><RegionRenderer blocks={regions.footer} /></footer>
    </article>
  );
}
```

`TextBlock` は React Context (TemplateHeadingContext) から「自分が何 h で描画されるべきか」を取り、データ側の `level` には依存しない。

## 7. バックエンド (Rust) の型表現

`#[serde(tag = "type")]` でタグ付き enum にすれば、TypeScript と同じ網羅性をコンパイル時に強制できる。

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Text {
        key: String,
        role: TextRole,
        i18n_key: I18nKey,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
    Cta {
        key: String,
        intent: CtaIntent,
        label_i18n_key: I18nKey,
        href: Href,                       // ← バリデート済みブランド型
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
    Media { /* ... */ },
    Badge { /* ... */ },
    MetricList { key: String, items: Vec<MetricItem>, ..  },
    MetaLine   { key: String, items: Vec<MetaItem>, .. },
    Price      { key: String, amount: u64, currency: Currency, tax_included: bool, .. },
    EclosionForecast {
        key: String,
        days_ahead: u32,
        date: NaiveDate,
        tolerance: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
    Divider { key: String },
}

/// 許容スキーム: https / 内部パス / mailto / tel のみ
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Href(String);

impl Href {
    pub fn parse(raw: &str) -> Result<Self, HrefError> {
        // javascript:, data: などを reject
        // 内部パス (`/...`) は許可
        // 詳細は href.rs に
        todo!()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct I18nKey(String);

#[derive(Serialize, Deserialize)]
#[serde(tag = "template", rename_all = "snake_case")]
pub enum CardBlock {
    HeroIntro {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        variant: Option<HeroIntroVariant>,
        #[serde(skip_serializing_if = "Option::is_none")]
        experiment: Option<Experiment>,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
        regions: BTreeMap<HeroIntroRegion, Vec<Block>>,
    },
    ProductFeature { /* ... */ },
    PromiseStep   { /* ... */ },
}

#[derive(Serialize, Deserialize)]
pub struct Experiment {
    pub key: String,
    pub variant: String,
}
```

## 8. 命名規則

- **テンプレート名**: `snake_case` の名詞 + 用途。`hero_intro`, `product_feature`, `promise_step`
- **リージョン名**: 場所を表す共通名。固有用途 (例: `eclosion_banner`) はリージョンではなくブロック型として持つ
- **ブロック型**: `snake_case`、内容の型を表す。レイアウト的な名前 (`top_block` など) は禁止
- **ロール名**: 組版・出版業界の語彙を借用。`description` のような曖昧語は不可
- **`analyticsId` の命名**: `<scope>.<id>.<element>` の **ドット区切り階層**。例: `product.DHH-0271.cta.add_to_cart` / `hero.main.cta.find_specimens`
- **`I18nKey` の命名**: `<scope>.<key>.<version>` の **ドット区切り + バージョンサフィックス**。例: `hero.intro.headline.v1`。コピー差し替え時は `.v2` を切り、旧キーは段階削除する
- **`experiment.key` の命名**: `<feature>_<purpose>_<period>`。例: `hero_cta_2026q2`
- **テンプレートのバージョニング**: 破壊的変更が必要な時は `product_feature.v2` のように suffix を付け、レジストリに両方登録して段階移行する

## 9. 多重度の扱い

- **配列の長さで自然に表現する**。`eyebrow` を 2 つ並べたければ `header` に同じブロックを 2 つ入れる
- **位置で命名しない**。`leftButton` / `rightButton` のような名前は禁止 (モバイルで縦積みになる瞬間に意味が崩壊する)
- **役割で区別したい場合は属性で**。CTA なら `intent: "primary"` のように属性で示す
- 「ちょうど 1 つしか取り得ない」リージョンも、配列で持つ (将来の柔軟性のため)。ただしテンプレート側は `blocks[0]` のみ描画する選択肢もあり

## 10. fallback / 縮退戦略

- 未知の `template` → `FallbackCard` を描画してログ通知
- 未知の `block.type` → 無視 (描画しない) + ログ通知
- 既知 type だが未知の `role` → デフォルトロールにフォールバック (text なら `body`、cta なら `tertiary`)
- 必須リージョンが空 → テンプレートが個別に「最低限の見た目」を担保
- 画像 src が解決できない → `placeholder` kind に置換
- `i18nKey` の解決失敗 → 開発環境ではキー名を表示、本番では空文字＋エラーログ
- `Href.parse` 失敗 → バック側で 400 を返してデータ投入を拒否 (フロントには到達させない)

これらは **「フロントが古く、バックが先行した」状態でも UI が壊れない** ことを保証する生命線。

## 11. 計測・実験 (Analytics & Experiments)

### 11.1 二段階の粒度

- **カード単位**: `CardBlock.analyticsId` + `experiment` で impression / 全体の click 系イベントを集計
- **ブロック単位**: 各 `Block.analyticsId` で個別 CTA や badge の click を集計

両方を併用するのが基本。例: `hero.main.cta.find_specimens` のクリックは、カードの `experiment: { key: "hero_copy_2026q2", variant: "B" }` と JOIN されて分析される。

### 11.2 イベントスキーマ (フロント → 計測基盤)

```ts
type AnalyticsEvent = {
  type: "card_impression" | "block_click";
  card: { id: string; template: TemplateName; analyticsId?: string };
  block?: { key: string; type: BlockType; analyticsId?: string };
  experiment?: Experiment;
  timestamp: string;  // ISO 8601
  // user_id / session_id 等は計測基盤側で付与
};
```

### 11.3 A/B テストの割り当て責任

**バックがリクエストコンテキスト (user_id / session_id) を見て、どの variant の `CardBlock` を返すかを決定する**。フロントは届いた `experiment` を **そのまま記録するだけ** で、フラグ評価をしない。これにより:

- フロントに experiment SDK を入れずに済む (バンドルサイズ削減)
- A/B テストのキャッシュキーがバック側で完結する
- experiment ロジックを 1 箇所に集約できる

## 12. i18n

### 12.1 値は I18n キー

DB / API レスポンスに **生のローカライズ済み文字列を入れない**。`i18nKey` のみを保持し、フロントが辞書を解決する。

### 12.2 辞書の所在

- 既存・固定文言 (テンプレート骨格、UI ラベル) → フロントリポジトリ内の JSON
- 商品名・説明など可変文言 → バック側で「locale 別 i18n 辞書 API」を提供

### 12.3 例外

`meta_line.items[].value` (例: `"#DHH-0271"`, `"ANCHOR BEETLE CO."`) は **固有名詞・ID** であり翻訳対象外なので、`i18nKey` ではなく `value: string` を直接持つ。

## 13. テスト戦略

### 13.1 フィクスチャ駆動の Storybook

`fixtures/cards/*.json` に各テンプレートの全 variant のサンプル `CardBlock` を置き、Storybook で全パターンを描画する。これがビジュアル契約のゴールデン。

```
fixtures/cards/
  hero_intro.default.json
  product_feature.default.json
  product_feature.featured.json
  product_feature.compact.json
  promise_step.default.json
```

### 13.2 スキーマ契約テスト

- TypeScript と Rust の型から JSON Schema を生成し、両者が一致することを CI で検証
- フィクスチャが TypeScript 型を満たすことを CI で検証

### 13.3 縮退テスト

`fixtures/cards/broken/` に「未知 template」「未知 block.type」「i18n キー欠損」「無効 href」などの異常系フィクスチャを置き、`FallbackCard` や placeholder への置換を確認する。

## 14. キャッシュ戦略

- `CardBlock` は `id + updated_at` で **ETag** を発行し、CDN で短期キャッシュ (60 秒程度)
- experiment が絡むレスポンスは **variant をキャッシュキーに含める** (`/api/cards/hero?variant=B`)
- ユーザー固有データ (パーソナライズ、ログイン状態) は **別 API に分離**して `CardBlock` には混ぜない
- i18n 辞書は locale 単位で長期キャッシュ (1 時間〜)、バージョンサフィックスで cache-bust

## 15. 段階導入プラン

KOCHU の現状 (テンプレート 3-5 個) なら、いきなり全部やらなくても良い。次の順で導入する。

### Phase 0: 現状認識
ヒーロー・約束カード・商品カードはハードコード。動的化の必要性が低いので保留。

### Phase 1: 商品カードのみ三層で型を切る
- 既に DB 駆動なので一番費用対効果が高い
- `product_feature` テンプレート + ブロック型 5-6 個から開始
- フロントはまだハードコードで、API 形だけ揃える「Strangler Fig」アプローチ
- **`analyticsId` / `experiment` / `i18nKey` / `Href` ブランド型は最初から導入する** (後付けは破壊的変更)

### Phase 2: ヒーローセクション
- 運営側からの入稿頻度を見て判断
- 必要なら `hero_intro` をスキーマ化し、CMS / 管理画面接続
- A/B テスト基盤 (バック側 variant 解決) をここで本格稼働

### Phase 3: 約束カード・他セクション
- パターンが固まってきた段階で、ページ全体をブロックツリーで持つかを判断
- ここで初めて「ページ = セクション配列、セクション = カード配列」の二段抽象を入れる

## 16. やらないこと (Non-Goals)

- **任意の CSS/style を DB に保存しない**。アクセサーカラーや余白は CSS 変数 + 限定 enum で表現
- **生の HTML を DB に保存しない**。リッチテキストが必要なら `text` ブロックの拡張で限定的にサポート
- **位置・座標を DB に保存しない**。レスポンシブで破綻するため
- **見出しレベル (h1-h6) を DB に保存しない**。テンプレート + リージョン位置で決定する
- **生のローカライズ済み文字列を DB に保存しない**。`i18nKey` 経由で解決する
- **任意の `href` を許容しない**。`Href` ブランド型でスキームを制限する
- **パーソナライズ / 条件出し分けを SDUI スキーマに入れない**。`visibleWhen` のような評価式は持たない。バック側でリクエストコンテキスト (ログイン状態 / 顧客属性 / カート内容) を見て、出すべき `CardBlock` を選別済みで返す
- **A/B テストのフラグ評価をフロントでしない**。バックが variant を解決し、フロントは `experiment` をそのまま記録する
- **画像最適化 (srcset / picture / AVIF) を DB に持たせない**。フロント / 画像配信側で解決する
- **Notion レベルの自由ブロックツリーは目指さない**。KOCHU は構造化されたコンテンツの方が価値が高い

## 17. 参考にした設計

- Sanity CMS Portable Text — ブロック配列の考え方
- Airbnb DLS / Server-Driven UI — テンプレート + データ分離
- Shopify Polaris — クローズドな語彙統制
- Material Design Tokens — テーマトークンの限定列挙
- 新聞組版用語 (eyebrow / headline / lead / byline) — テキストロール命名
- ICU MessageFormat / FormatJS — i18n キー方式
- GrowthBook / Optimizely — サーバ側 A/B 解決パターン
