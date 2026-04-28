---
title: "SDUI 三層モデル 設計方針"
description: "SDUI 三層モデル v1 (歴史的資料 / 設計初期版)。"
sidebar:
  order: 1
---

:::caution[歴史的資料]
このページは過去のバージョンです。現行の正典は [SDUI 三層モデル v6](/insect_app/architecture/sdui-three-layer-model-v6/) を参照してください。設計判断の根拠としてここを引用しないでください。
:::

> KOCHU のカード／セクションを動的にデータ駆動で表示するための、Server-Driven UI (SDUI) スキーマ設計。

## 1. 目的

- ヒーロー、商品ハイライト、約束カードなどの UI を **DB 駆動** で出し分けたい
- 一方で **デザインシステム・アクセシビリティ・パフォーマンス** は壊したくない
- 将来的に、運営／ブリーダーが管理画面から内容を編集できる土台を作る

「データを動的に」「スタイルは破綻させない」を両立させるために、**レイアウトはコード／コンテンツは DB** という分離を、三層の抽象で表現する。

## 2. 設計原則

1. **位置情報そのものを DB に持たせない**。座標・余白・レスポンシブ規則はすべてコード側 (TSX) の責務。
2. **DB が決めるのは「どのテンプレートを使うか」「各リージョンに何を入れるか」だけ**。
3. **語彙は閉じた enum で統制**する。新規追加は設計レビューを通す。
4. **多重度 (同じ役割の繰り返し) は配列で表現**する。`primaryCta` / `secondaryCta` のような ad-hoc 命名は禁止。
5. **フロント・バックで型定義を共有**し、CI で網羅性を保証する。
6. **未知のテンプレート・ブロックは安全に縮退**する fallback を必ず実装する。

## 3. 三層モデル

| 層 | 役割 | 個数 | 実体 |
|---|---|---|---|
| **Region (リージョン)** | カード内の論理的な「場所」。テンプレートが定義する | 数個に固定 | Map |
| **Block (ブロック)** | リージョン内に並ぶ要素。型を持つ | 各リージョン 0..N | Array |
| **Role (ロール)** | ブロック型の中での意味的サブ分類 | ブロックの属性 | enum |

### 3.1 Region (リージョン)

- カード横断で共通の論理的配置場所
- テンプレートが「どのリージョンを持ち、それをどう描画するか」を決める
- 標準セット (KOCHU での初期値):
  - `header` — 上部の冒頭要素 (eyebrow、バッジなど)
  - `media` — 画像／動画／アイコン
  - `meta` — ID、ショップ名、コードなどの補助情報行
  - `headline` — 主見出し領域 (任意。`body` に含めても可)
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
- `forecast` — 羽化予測など、独自バナー
- `divider` — 区切り線

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

#### `cta` の intent

`primary` / `secondary` / `tertiary` / `destructive`

#### `media` の kind

`image` / `video` / `icon` / `placeholder`

#### `badge` の role

`status` / `evidence` / `warning` / `promo`

## 4. スキーマ全体形

```typescript
// shared/schema/blocks.ts — フロント・バック共通の単一の真実

export type RegionName =
  | "header" | "media" | "meta" | "headline"
  | "body" | "actions" | "footer";

export type BlockType =
  | "text" | "cta" | "media" | "badge"
  | "metric_list" | "meta_line"
  | "price" | "forecast" | "divider";

export type TextRole =
  | "eyebrow" | "headline" | "subhead"
  | "lead" | "body" | "caption" | "byline";

export type CtaIntent     = "primary" | "secondary" | "tertiary" | "destructive";
export type MediaKind     = "image" | "video" | "icon" | "placeholder";
export type BadgeRole     = "status" | "evidence" | "warning" | "promo";

export type Block =
  | { type: "text";        role: TextRole; level?: 1|2|3|4|5|6; value: string }
  | { type: "cta";         intent: CtaIntent; label: string; href: string }
  | { type: "media";       kind: MediaKind; src?: string; alt?: string; name?: string }
  | { type: "badge";       role: BadgeRole; value: string }
  | { type: "metric_list"; items: { label: string; value: string }[] }
  | { type: "meta_line";   items: { role: string; value: string; align?: "start"|"end" }[] }
  | { type: "price";       amount: number; currency: "JPY"; taxIncluded: boolean }
  | { type: "forecast";    kind: "eclosion"; daysAhead: number; date: string; tolerance: number }
  | { type: "divider" };

export type CardBlock = {
  id: string;
  template: TemplateName;
  variant?: VariantName;
  regions: Partial<Record<RegionName, Block[]>>;
};
```

## 5. テンプレート例

### 5.1 ヒーロー紹介カード `hero_intro`

```jsonc
{
  "id": "hero-main",
  "template": "hero_intro",
  "regions": {
    "header": [
      { "type": "text", "role": "eyebrow", "value": "ようこそ KOCHU へ" }
    ],
    "headline": [
      { "type": "text", "role": "headline", "level": 1,
        "value": "買う、育てる、継ぐ。\nひとつの場所で。" }
    ],
    "body": [
      { "type": "text", "role": "lead",
        "value": "KOCHU は、国産・海外産カブクワの専門 EC と…" }
    ],
    "actions": [
      { "type": "cta", "intent": "primary",   "label": "生体を探す",      "href": "/products" },
      { "type": "cta", "intent": "secondary", "label": "KOCHU について", "href": "/about" }
    ],
    "footer": [
      { "type": "metric_list", "items": [
          { "label": "累計カルテ",     "value": "12,480 件" },
          { "label": "認証ブリーダー", "value": "86 名"     },
          { "label": "死着補償",       "value": "99.2%"     }
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
  "regions": {
    "header": [
      { "type": "badge", "role": "status",   "value": "featured" },
      { "type": "badge", "role": "evidence", "value": "pedigreed" }
    ],
    "media": [
      { "type": "media", "kind": "image", "src": "...", "alt": "ヘラクレス 個体写真" }
    ],
    "meta": [
      { "type": "meta_line", "items": [
          { "role": "id",   "value": "#DHH-0271" },
          { "role": "shop", "value": "ANCHOR BEETLE CO." },
          { "role": "code", "value": "CBF2", "align": "end" }
      ]}
    ],
    "body": [
      { "type": "text", "role": "headline", "level": 3, "value": "ヘラクレスオオカブト ♂ 142mm" },
      { "type": "text", "role": "subhead",  "value": "Dynastes hercules hercules" }
    ],
    "footer": [
      { "type": "price",    "amount": 48000, "currency": "JPY", "taxIncluded": true },
      { "type": "forecast", "kind": "eclosion",
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
  "regions": {
    "header": [
      { "type": "text", "role": "eyebrow", "value": "01 — 買う" }
    ],
    "media": [
      { "type": "media", "kind": "icon", "name": "clipboard" }
    ],
    "body": [
      { "type": "text", "role": "headline", "level": 3, "value": "自動カルテ生成" },
      { "type": "text", "role": "body",
        "value": "チェックアウトの次の画面は、マイページ。\nそこにはもう、あなたの個体のカルテがある。" }
    ],
    "actions": [
      { "type": "cta", "intent": "tertiary", "label": "カルテの例を見る", "href": "/karte/example" }
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
  return <Component {...block} />;
}
```

### 6.2 リージョンレンダラー (テンプレート横断で共通)

```tsx
function RegionRenderer({ blocks }: { blocks?: Block[] }) {
  if (!blocks?.length) return null;
  return <>{blocks.map((b, i) => <BlockRenderer key={i} block={b} />)}</>;
}

function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case "text":         return <TextBlock {...block} />;
    case "cta":          return <CtaButton {...block} />;
    case "media":        return <MediaBlock {...block} />;
    case "badge":        return <BadgeBlock {...block} />;
    case "metric_list":  return <MetricList {...block} />;
    case "meta_line":    return <MetaLine {...block} />;
    case "price":        return <PriceBlock {...block} />;
    case "forecast":     return <ForecastBanner {...block} />;
    case "divider":      return <hr className="card__divider" />;
    default: {
      // TypeScript の網羅性検査でここに到達できないことが保証される
      const _exhaustive: never = block;
      return null;
    }
  }
}
```

### 6.3 テンプレート例

```tsx
function ProductFeature({ regions }: CardBlock) {
  return (
    <article className="card card--product-feature">
      <header className="card__header"><RegionRenderer blocks={regions.header} /></header>
      <div    className="card__media"> <RegionRenderer blocks={regions.media}  /></div>
      <div    className="card__meta">  <RegionRenderer blocks={regions.meta}   /></div>
      <div    className="card__body">  <RegionRenderer blocks={regions.body}   /></div>
      <footer className="card__footer"><RegionRenderer blocks={regions.footer} /></footer>
    </article>
  );
}
```

レイアウト・余白・グリッド・レスポンシブはすべて TSX と CSS の責任。DB は中身しか触れない。

## 7. バックエンド (Rust) の型表現

`#[serde(tag = "type")]` でタグ付き enum にすれば、TypeScript と同じ網羅性をコンパイル時に強制できる。

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Text {
        role: TextRole,
        #[serde(skip_serializing_if = "Option::is_none")]
        level: Option<u8>,
        value: String,
    },
    Cta {
        intent: CtaIntent,
        label: String,
        href: String,
    },
    Media { /* ... */ },
    Badge { /* ... */ },
    MetricList { items: Vec<MetricItem> },
    MetaLine   { items: Vec<MetaItem> },
    Price      { amount: u64, currency: Currency, tax_included: bool },
    Forecast   { /* ... */ },
    Divider,
}

#[derive(Serialize, Deserialize)]
pub struct CardBlock {
    pub id: String,
    pub template: TemplateName,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<VariantName>,
    pub regions: BTreeMap<RegionName, Vec<Block>>,
}
```

## 8. 命名規則

- **テンプレート名**: `snake_case` の名詞 + 用途。`hero_intro`, `product_feature`, `promise_step`
- **リージョン名**: 場所を表す共通名。固有用途 (例: `eclosion_banner`) はリージョンではなくブロック型として持つ
- **ブロック型**: `snake_case`、内容の型を表す。レイアウト的な名前 (`top_block` など) は禁止
- **ロール名**: 組版・出版業界の語彙を借用。`description` のような曖昧語は不可
- **テンプレートのバージョニング**: 破壊的変更が必要な時は `product_feature.v2` のように suffix を付け、レジストリに両方登録して段階移行する

## 9. 多重度の扱い

- **配列の長さで自然に表現する**。`eyebrow` を 2 つ並べたければ `header` に同じブロックを 2 つ入れる
- **位置で命名しない**。`leftButton` / `rightButton` のような名前は禁止 (モバイルで縦積みになる瞬間に意味が崩壊する)
- **役割で区別したい場合は属性で**。CTA なら `intent: "primary"` のように属性で示す
- 「ちょうど 1 つしか取り得ない」リージョンも、配列で持つ (将来の柔軟性のため)。ただしテンプレート側は `blocks[0]` のみ描画する選択肢もあり

## 10. fallback / 縮退戦略

- 未知の `template` → `FallbackCard` を描画してログ通知
- 未知の `block.type` → 無視 (描画しない)
- 既知 type だが未知の `role` → デフォルトロールにフォールバック (text なら `body`、cta なら `tertiary`)
- 必須リージョンが空 → テンプレートが個別に「最低限の見た目」を担保
- 画像 src が解決できない → `placeholder` kind に置換

これらは **「フロントが古く、バックが先行した」状態でも UI が壊れない** ことを保証する生命線。

## 11. 段階導入プラン

KOCHU の現状 (テンプレート 3-5 個) なら、いきなり全部やらなくても良い。次の順で導入する。

### Phase 0: 現状認識
ヒーロー・約束カード・商品カードはハードコード。動的化の必要性が低いので保留。

### Phase 1: 商品カードのみ三層で型を切る
- 既に DB 駆動なので一番費用対効果が高い
- `product_feature` テンプレート + ブロック型 5-6 個から開始
- フロントはまだハードコードで、API 形だけ揃える「Strangler Fig」アプローチ

### Phase 2: ヒーローセクション
- 運営側からの入稿頻度を見て判断
- 必要なら `hero_intro` をスキーマ化し、CMS / 管理画面接続

### Phase 3: 約束カード・他セクション
- パターンが固まってきた段階で、ページ全体をブロックツリーで持つかを判断
- ここで初めて「ページ = セクション配列、セクション = カード配列」の二段抽象を入れる

## 12. やらないこと (Non-Goals)

- **任意の CSS/style を DB に保存しない**。アクセサーカラーや余白は CSS 変数 + 限定 enum で表現
- **生の HTML を DB に保存しない**。リッチテキストが必要なら `text` ブロックの拡張で限定的にサポート
- **位置・座標を DB に保存しない**。レスポンシブで破綻するため
- **Notion レベルの自由ブロックツリーは目指さない**。KOCHU は構造化されたコンテンツの方が価値が高い

## 13. 参考にした設計

- Sanity CMS Portable Text — ブロック配列の考え方
- Airbnb DLS / Server-Driven UI — テンプレート + データ分離
- Shopify Polaris — クローズドな語彙統制
- Material Design Tokens — テーマトークンの限定列挙
- 新聞組版用語 (eyebrow / headline / lead / byline) — テキストロール命名
