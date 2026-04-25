# SDUI 三層モデル 設計方針 v3

> KOCHU のカード／セクションを動的にデータ駆動で表示するための、Server-Driven UI (SDUI) スキーマ設計。
>
> v2 のレビュー結果 (C1〜C5 / I1〜I5 / P1〜P4) を反映し、**型の単一ソース・オブ・トゥルースを Rust に確定**、**i18n と動的データの分離**、**Localizable 抽象の導入**、**HTML タグ・ホスト許容ルールの明文化** を行ったバージョン。

## 0. v2 からの変更点 (Changelog)

| 区分 | 変更点 | 対応指摘 |
|---|---|---|
| 高 | **`Localizable` タグ付き union を導入**。テキスト系フィールドは「i18n 解決」と「raw 文字列」を明示的に切り替え | C1, C2 |
| 高 | `metric_list.items[].value` などの **動的データは `Localizable.raw`** に統一 (i18n キー化を強制しない) | C1 |
| 高 | `i18nParams` を `Localizable.i18n` 内に組み込み、**部分的に動的なテキスト** (「{days} 日後に羽化予測」) を表現可能に | C2 |
| 高 | **ネストされた items[]** (metric_list / meta_line) にも `key` を必須化 | C3 |
| 高 | テンプレート定義表に **HTML タグ列** を追加し、`subhead` などのタグを明示 | C4 |
| 高 | `experiment.variant` を `experiment.bucket` に **リネーム**。CardBlock の `variant` (マーチャンダイジング) と区別 | C5 |
| 高 | **型の source of truth は Rust** に確定。`ts-rs` で TypeScript を生成。手書き同期は禁止 | I3 |
| 中 | `Href` の **許容ホスト・スキーム表** を §10 に追加。utm パラメータ付与責任を明示 | I1 |
| 中 | `I18nKey` の **バージョンサフィックス運用ルールを緩和**。通常の翻訳更新は `.v2` を切らない | I2 |
| 中 | **ブロック単位の experiment は将来課題** (§17 Future Work) として明示 | I4 |
| 中 | **`MediaFallback` を全テンプレート共通**として規定 | I5 |
| 低 | `headline` が region 名と text role 名で **重複** することを §3 冒頭で注記 | P1 |
| 低 | Rust 例を **省略なしで完成** | P2 |
| 低 | **すべての string 値は textContent で描画** (innerHTML 禁止) を §10 に明記 | P3 |
| 低 | エラー / ローディング状態は **アプリケーション層の責務** で SDUI スキーマ外と Non-Goals に明記 | P4 |

## 1. 目的

ヒーロー、商品ハイライト、約束カードなどの UI を **DB 駆動** で出し分けたい。一方で **デザインシステム・アクセシビリティ・パフォーマンス** は壊したくない。将来的に、運営／ブリーダーが管理画面から内容を編集できる土台を作る。

「データを動的に」「スタイルは破綻させない」を両立させるために、**レイアウトはコード／コンテンツは DB** という分離を、三層の抽象で表現する。

## 2. 設計原則

1. **位置情報そのものを DB に持たせない**。座標・余白・レスポンシブ規則はすべてコード側 (TSX) の責務。
2. **DB が決めるのは「どのテンプレートを使うか」「各リージョンに何を入れるか」だけ**。
3. **語彙は閉じた enum で統制**する。新規追加は設計レビューを通す。`role` / `kind` / `intent` のように外見が string 型に見えるフィールドも、必ず enum で閉じる。
4. **多重度 (同じ役割の繰り返し) は配列で表現**する。`primaryCta` / `secondaryCta` のような ad-hoc 命名は禁止。
5. **フロント・バックで型定義を共有**し、CI で網羅性を保証する。**Rust が source of truth**。
6. **未知のテンプレート・ブロックは安全に縮退**する fallback を必ず実装する。
7. **a11y を壊し得るプロパティはデータ側に持たせない**。見出しレベル・読み順・タブ順序はテンプレートが決定する。
8. **計測 ID は最初から仕込む**。`analyticsId` / `experiment` は optional でも Phase 1 から含める。
9. **静的 UI コピーは i18n キー、動的データ値は raw 文字列**。両者は `Localizable` タグ付き union で型レベルに分離する。
10. **すべての文字列値は textContent としてのみ描画**。innerHTML / dangerouslySetInnerHTML は禁止。

## 3. 三層モデル

> **命名注意**: `headline` という単語は本ドキュメント中で **2 つの異なる層** で使われる:
> - **Region 名としての `headline`** — カード内の主見出しを置く論理的な場所
> - **Text role としての `headline`** — テキストブロックの意味的サブ分類 (主見出し)
>
> 文脈で区別する。region 名で参照する場合は「`headline` リージョン」、role の場合は「role:headline」と書き分ける。

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
- `headline` — 主見出し領域。テンプレートごとに「持つ／持たない」を §5 のテンプレート定義表で明示する
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
- `eclosion_forecast` — 羽化予測バナー (羽化に特化したドメイン型)
- `divider` — 区切り線

> 将来「発送予測」「次回入荷予測」などが必要になった場合は、汎用 `forecast` を作るのではなく `shipping_forecast` / `restock_forecast` のように **ドメイン特化型ブロックを追加**する。

### 3.3 Role (ロール)

ブロックの `type` ごとに **異なる closed enum** を持つ。

#### `text` のロール

新聞・雑誌の組版用語を借用する。`description` のような曖昧な名前は避ける。

| ロール | 用途 | 例 | 既定の HTML タグ ※ |
|---|---|---|---|
| `eyebrow` | 主見出しの上に置く小さなラベル | `── ようこそ KOCHU へ` | `<p class="eyebrow">` |
| `headline` | 主見出し | `買う、育てる、継ぐ。` | テンプレート依存 (h1〜h3) |
| `subhead` | 副見出し | `Dynastes hercules hercules` | `<p class="subhead">` |
| `lead` | 本文より太めのリード文 | ヒーロー説明 | `<p class="lead">` |
| `body` | 本文 | 約束カードの説明 | `<p>` |
| `caption` | 補助テキスト | 画像キャプション | `<figcaption>` |
| `byline` | 出典・著者 | ブリーダー名表示 | `<p class="byline">` |

> ※ **見出しレベル (h1-h6) はデータに含めない**。`role: headline` のときの具体的な h レベルは、テンプレート × リージョン位置で決定する (§5 のテンプレート定義表で明示)。`subhead` は意図的に heading にしない (a11y 上、見出し階層を 1 段だけにすることでアウトラインを健全に保つ)。

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

### 4.1 共通の値オブジェクト

```typescript
// shared/types — Rust から ts-rs で生成される (§7 参照)
// 手書きで編集しないこと

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
export type Currency          = "JPY" | "USD" | "EUR";   // 当面 JPY のみ運用

// ── ブランド型 ────────────────────────────────────────
/** 許容: https / 内部パス / 既知外部ドメイン / mailto / tel (§10 参照) */
export type Href    = string & { readonly __brand: "Href" };
/** 形式: <scope>.<key> (例: hero.intro.headline)。バージョン規則は §12 */
export type I18nKey = string & { readonly __brand: "I18nKey" };

// ── Localizable: 静的 i18n と動的 raw を型レベルで分離 ──
export type Localizable =
  | { source: "i18n"; key: I18nKey;
      params?: Record<string, string | number> }
  | { source: "raw";  text: string };
```

`Localizable` を **すべての user-facing 文字列フィールド** に使うことが、本バージョンの最重要設計判断。

- 静的 UI コピー (「生体を探す」「KOCHU について」) → `{ source: "i18n", key: "..." }`
- 動的データ値 (「12,480 件」「#DHH-0271」「ANCHOR BEETLE CO.」) → `{ source: "raw", text: "..." }`
- 部分的に動的 (「15 日後に羽化予測」) → `{ source: "i18n", key: "...", params: { days: 15 } }`

### 4.2 ブロック

```typescript
export type Block =
  | { key: string; type: "text";        role: TextRole; content: Localizable;
      analyticsId?: string }
  | { key: string; type: "cta";         intent: CtaIntent; label: Localizable; href: Href;
      analyticsId?: string }
  | { key: string; type: "media";       kind: MediaKind;
      src?: string; alt?: Localizable; iconName?: string;
      analyticsId?: string }
  | { key: string; type: "badge";       role: BadgeRole; label: Localizable;
      analyticsId?: string }
  | { key: string; type: "metric_list";
      items: { key: string; label: Localizable; value: Localizable }[];
      analyticsId?: string }
  | { key: string; type: "meta_line";
      items: { key: string; role: MetaLineItemRole; value: string;
               align?: "start" | "end" }[];
      analyticsId?: string }
  | { key: string; type: "price";       amount: number; currency: Currency; taxIncluded: boolean;
      analyticsId?: string }
  | { key: string; type: "eclosion_forecast";
      daysAhead: number; date: string; tolerance: number;
      analyticsId?: string }
  | { key: string; type: "divider" };
```

> `meta_line.items[].value` だけは `string` のままにしている。ID やショップ名は固有名詞・商号で **翻訳対象外** であり、Localizable 化するとノイズになるため。多言語化が必要になった時のみ Localizable へ昇格させる。

### 4.3 Experiment

```typescript
export type Experiment = {
  /** 実験のキー (例: "hero_cta_2026q2") */
  key: string;
  /** A/B バケット (例: "A" | "B" | "control")。
   *  CardBlock.variant (マーチャンダイジング) とは独立 */
  bucket: string;
};
```

### 4.4 CardBlock (テンプレートで判別される共用体)

```typescript
export type CardBlock =
  | {
      template: "hero_intro";
      id: string;
      variant?: "default";                  // マーチャンダイジング上の見栄え
      experiment?: Experiment;              // A/B 実験 (bucket は variant と独立)
      analyticsId?: string;
      regions: Partial<Record<
        "header" | "headline" | "body" | "actions" | "footer", Block[]
      >>;
    }
  | {
      template: "product_feature";
      id: string;
      variant?: "default" | "featured" | "compact";
      experiment?: Experiment;
      analyticsId?: string;
      regions: Partial<Record<
        "header" | "media" | "meta" | "body" | "footer", Block[]
      >>;
    }
  | {
      template: "promise_step";
      id: string;
      variant?: "default";
      experiment?: Experiment;
      analyticsId?: string;
      regions: Partial<Record<
        "header" | "media" | "body" | "actions", Block[]
      >>;
    };

export type TemplateName = CardBlock["template"];
```

## 5. テンプレート定義

各テンプレートが持つリージョン・許容ブロック・**HTML タグ** を明示する。

### 5.1 リージョン構成

| Template | header | media | meta | headline | body | actions | footer |
|---|---|---|---|---|---|---|---|
| `hero_intro` | text(eyebrow) | — | — | text(headline) | text(lead/body) | cta×N | metric_list |
| `product_feature` | badge×N | media×1 | meta_line | — | text(headline, subhead) | — | price, eclosion_forecast |
| `promise_step` | text(eyebrow) | media(icon) | — | — | text(headline, body) | cta×N | — |

### 5.2 見出しレベル (text.role:headline) のタグ解決表

| Template | 該当リージョン | 既定タグ |
|---|---|---|
| `hero_intro` | `headline` | `<h1>` |
| `product_feature` | `body` | `<h3>` |
| `promise_step` | `body` | `<h3>` |

`text.role: subhead` は **どのテンプレートでも `<p class="subhead">`** に固定 (§3.3 注記参照)。

### 5.3 ヒーロー紹介カード `hero_intro`

```jsonc
{
  "id": "hero-main",
  "template": "hero_intro",
  "experiment": { "key": "hero_copy_2026q2", "bucket": "B" },
  "analyticsId": "hero.main",
  "regions": {
    "header": [
      { "key": "eb", "type": "text", "role": "eyebrow",
        "content": { "source": "i18n", "key": "hero.intro.eyebrow" } }
    ],
    "headline": [
      { "key": "hl", "type": "text", "role": "headline",
        "content": { "source": "i18n", "key": "hero.intro.headline" } }
    ],
    "body": [
      { "key": "ld", "type": "text", "role": "lead",
        "content": { "source": "i18n", "key": "hero.intro.lead" } }
    ],
    "actions": [
      { "key": "cta1", "type": "cta", "intent": "primary",
        "label": { "source": "i18n", "key": "hero.intro.cta.find_specimens" },
        "href": "/products",
        "analyticsId": "hero.main.cta.find_specimens" },
      { "key": "cta2", "type": "cta", "intent": "secondary",
        "label": { "source": "i18n", "key": "hero.intro.cta.about" },
        "href": "/about",
        "analyticsId": "hero.main.cta.about" }
    ],
    "footer": [
      { "key": "ml", "type": "metric_list", "items": [
          { "key": "m1",
            "label": { "source": "i18n", "key": "hero.metric.karte.label" },
            "value": { "source": "raw",  "text": "12,480 件" } },
          { "key": "m2",
            "label": { "source": "i18n", "key": "hero.metric.breeders.label" },
            "value": { "source": "raw",  "text": "86 名" } },
          { "key": "m3",
            "label": { "source": "i18n", "key": "hero.metric.compensation.label" },
            "value": { "source": "raw",  "text": "99.2%" } }
      ]}
    ]
  }
}
```

### 5.4 商品ハイライトカード `product_feature`

商品名・学名・ショップ名は商品マスタから引いた **動的データ** なので `Localizable.raw`。バッジラベルは静的 UI コピーなので `i18n`。

```jsonc
{
  "id": "DHH-0271",
  "template": "product_feature",
  "variant": "featured",
  "analyticsId": "product.DHH-0271",
  "regions": {
    "header": [
      { "key": "b1", "type": "badge", "role": "status",
        "label": { "source": "i18n", "key": "badge.featured" } },
      { "key": "b2", "type": "badge", "role": "evidence",
        "label": { "source": "i18n", "key": "badge.pedigreed" } }
    ],
    "media": [
      { "key": "img", "type": "media", "kind": "image",
        "src": "https://cdn.kochu.example/specimens/DHH-0271.jpg",
        "alt": { "source": "raw", "text": "ヘラクレス 個体写真" } }
    ],
    "meta": [
      { "key": "ml", "type": "meta_line", "items": [
          { "key": "i1", "role": "id",   "value": "#DHH-0271" },
          { "key": "i2", "role": "shop", "value": "ANCHOR BEETLE CO." },
          { "key": "i3", "role": "code", "value": "CBF2", "align": "end" }
      ]}
    ],
    "body": [
      { "key": "hl", "type": "text", "role": "headline",
        "content": { "source": "raw", "text": "ヘラクレスオオカブト ♂ 142mm" } },
      { "key": "sh", "type": "text", "role": "subhead",
        "content": { "source": "raw", "text": "Dynastes hercules hercules" } }
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

### 5.5 約束カード `promise_step`

「01 — 買う」のように **数字 (動的) + 区切り + 静的ラベル** を組み合わせる典型例。`i18nParams` を活用する。

```jsonc
{
  "id": "promise-01",
  "template": "promise_step",
  "analyticsId": "promise.01",
  "regions": {
    "header": [
      { "key": "eb", "type": "text", "role": "eyebrow",
        "content": { "source": "i18n",
                     "key": "promise.eyebrow",
                     "params": { "step": "01", "label": "買う" } } }
    ],
    "media": [
      { "key": "ic", "type": "media", "kind": "icon", "iconName": "clipboard" }
    ],
    "body": [
      { "key": "hl", "type": "text", "role": "headline",
        "content": { "source": "i18n", "key": "promise.01.headline" } },
      { "key": "bd", "type": "text", "role": "body",
        "content": { "source": "i18n", "key": "promise.01.body" } }
    ],
    "actions": [
      { "key": "cta", "type": "cta", "intent": "tertiary",
        "label": { "source": "i18n", "key": "promise.01.cta.example" },
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
  useImpression(block);  // analyticsId / experiment が付いていれば送る
  return <Component {...block} />;
}
```

### 6.2 Localizable レンダラー

```tsx
function L({ value }: { value: Localizable }) {
  if (value.source === "raw") return <>{value.text}</>;        // textContent のみ
  return <>{useI18n().t(value.key, value.params)}</>;          // 解決失敗時は §10 参照
}
```

`L` コンポーネントは **すべての user-facing テキストの唯一の出口**。これを通さない直接描画は禁止 (lint で検出する)。

### 6.3 リージョンレンダラー

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
      const _exhaustive: never = block;  // 網羅性検査
      return null;
    }
  }
}
```

### 6.4 テンプレート例 (見出しレベルは Context で解決)

```tsx
function ProductFeature(card: Extract<CardBlock, { template: "product_feature" }>) {
  const { regions } = card;
  return (
    <article className="card card--product-feature">
      <header className="card__header"><RegionRenderer blocks={regions.header} /></header>
      <div    className="card__media"> <RegionRenderer blocks={regions.media}  /></div>
      <div    className="card__meta">  <RegionRenderer blocks={regions.meta}   /></div>
      <HeadingLevelProvider level={3}>
        <div className="card__body">   <RegionRenderer blocks={regions.body}   /></div>
      </HeadingLevelProvider>
      <footer className="card__footer"><RegionRenderer blocks={regions.footer} /></footer>
    </article>
  );
}
```

`TextBlock` の中で `role === "headline"` の時、`HeadingLevelProvider` の Context から取得したレベルで `<h1>`〜`<h6>` を選択する。データは見出しレベルを持たない。

### 6.5 統一フォールバック

```tsx
// templates/MediaFallback.tsx — 全テンプレートで共有
export function MediaFallback({ alt, iconName = "image" }: { alt?: Localizable; iconName?: string }) {
  return (
    <div className="media-fallback" role="img"
         aria-label={alt ? renderLocalizableToString(alt) : undefined}>
      <Icon name={iconName} />
    </div>
  );
}
```

`MediaBlock` 内で `src` の解決失敗 / `kind === "placeholder"` の場合に **必ずこの 1 つを使う**。テンプレートごとの個別フォールバックは禁止。

## 7. バックエンド (Rust) の型表現 — Source of Truth

**型の単一ソース・オブ・トゥルースは Rust 側 (`server/src/sdui/`)**。TypeScript 型は `ts-rs` で生成し、`client_solid/src/generated/sdui.ts` に出力する。手書きで TS を編集することは禁止。

### 7.1 ワークフロー

1. Rust 側で型を編集 (`server/src/sdui/blocks.rs` など)
2. `cargo test` 実行 → `ts-rs` が `ts-rs/bindings/` 以下に `.ts` を出力
3. 出力ファイルを `client_solid/src/generated/sdui.ts` にコミット (生成物もリポジトリに入れる)
4. CI で「`cargo test` 後に diff が出ない」ことを検証する (pre-commit hook 推奨)
5. **JSON Schema** も併せて生成 (`schemars` クレート) し、フィクスチャ検証 (§13.2) に利用

### 7.2 Cargo.toml 抜粋

```toml
[dependencies]
serde     = { version = "1", features = ["derive"] }
serde_json = "1"
schemars  = "0.8"
chrono    = { version = "0.4", features = ["serde"] }

[dev-dependencies]
ts-rs = "9"
```

### 7.3 完成した Rust 定義

```rust
// server/src/sdui/blocks.rs

use chrono::NaiveDate;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

// ── 基本 enum ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RegionName {
    Header, Media, Meta, Headline, Body, Actions, Footer,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TextRole {
    Eyebrow, Headline, Subhead, Lead, Body, Caption, Byline,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CtaIntent { Primary, Secondary, Tertiary, Destructive }

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MediaKind { Image, Video, Icon, Placeholder }

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BadgeRole { Status, Evidence, Warning, Promo }

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MetaLineItemRole { Id, Shop, Code, Lot, Breeder }

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[ts(export)]
pub enum Currency { JPY, USD, EUR }

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Align { Start, End }

// ── ブランド型 ──────────────────────────────────────────

/// 許容: https / 内部パス (`/...`) / KOCHU 自社サブドメイン /
/// 既知の外部ホスト (許容リスト) / mailto / tel
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(transparent)]
#[ts(export, type = "string")]
pub struct Href(String);

impl Href {
    pub fn parse(raw: &str) -> Result<Self, HrefError> { /* §10 のルールで実装 */ todo!() }
    pub fn as_str(&self) -> &str { &self.0 }
}

/// 形式: <scope>.<key> (例: "hero.intro.headline")。
/// バージョンサフィックスは §12 のルールに従う場合のみ。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq, Hash)]
#[serde(transparent)]
#[ts(export, type = "string")]
pub struct I18nKey(String);

impl I18nKey {
    pub fn parse(raw: &str) -> Result<Self, I18nKeyError> { /* dot-case 検証 */ todo!() }
}

// ── Localizable ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "source", rename_all = "snake_case")]
#[ts(export)]
pub enum Localizable {
    I18n {
        key: I18nKey,
        #[serde(skip_serializing_if = "Option::is_none")]
        params: Option<BTreeMap<String, ParamValue>>,
    },
    Raw { text: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum ParamValue {
    Str(String),
    Num(f64),
}

// ── ネスト要素 ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[ts(export)]
pub struct MetricItem {
    pub key: String,
    pub label: Localizable,
    pub value: Localizable,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[ts(export)]
pub struct MetaItem {
    pub key: String,
    pub role: MetaLineItemRole,
    pub value: String,             // 固有名詞・ID は raw 固定 (§4.2 注記)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
}

// ── ブロック ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum Block {
    Text {
        key: String,
        role: TextRole,
        content: Localizable,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
    Cta {
        key: String,
        intent: CtaIntent,
        label: Localizable,
        href: Href,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
    Media {
        key: String,
        kind: MediaKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        src: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        alt: Option<Localizable>,
        #[serde(skip_serializing_if = "Option::is_none")]
        icon_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
    Badge {
        key: String,
        role: BadgeRole,
        label: Localizable,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
    MetricList {
        key: String,
        items: Vec<MetricItem>,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
    MetaLine {
        key: String,
        items: Vec<MetaItem>,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
    Price {
        key: String,
        amount: u64,
        currency: Currency,
        tax_included: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
    },
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

// ── Experiment ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[ts(export)]
pub struct Experiment {
    pub key: String,
    /// A/B バケット。CardBlock.variant とは独立。
    pub bucket: String,
}

// ── テンプレートごとの variant ──────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HeroIntroVariant { Default }

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ProductFeatureVariant { Default, Featured, Compact }

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PromiseStepVariant { Default }

// ── CardBlock ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "template", rename_all = "snake_case")]
#[ts(export)]
pub enum CardBlock {
    HeroIntro {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        variant: Option<HeroIntroVariant>,
        #[serde(skip_serializing_if = "Option::is_none")]
        experiment: Option<Experiment>,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
        regions: BTreeMap<RegionName, Vec<Block>>,
    },
    ProductFeature {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        variant: Option<ProductFeatureVariant>,
        #[serde(skip_serializing_if = "Option::is_none")]
        experiment: Option<Experiment>,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
        regions: BTreeMap<RegionName, Vec<Block>>,
    },
    PromiseStep {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        variant: Option<PromiseStepVariant>,
        #[serde(skip_serializing_if = "Option::is_none")]
        experiment: Option<Experiment>,
        #[serde(skip_serializing_if = "Option::is_none")]
        analytics_id: Option<String>,
        regions: BTreeMap<RegionName, Vec<Block>>,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum HrefError    { #[error("disallowed scheme or host")] Disallowed }
#[derive(Debug, thiserror::Error)]
pub enum I18nKeyError { #[error("invalid format")] InvalidFormat }
```

### 7.4 ts-rs 出力例 (生成物・編集禁止)

```typescript
// client_solid/src/generated/sdui.ts (auto-generated, do not edit)
export type Block =
  | { type: "text"; key: string; role: TextRole; content: Localizable; analytics_id?: string }
  | /* ... */;
```

> snake_case → camelCase の変換が必要なら `ts-rs` の `rename_all` を併用するか、フロント側で薄いマッピング層を 1 つ用意する。本ドキュメントでは **JSON は snake_case を正** とする (Rust 側のセルフドキュメンテーションを優先)。

## 8. 命名規則

- **テンプレート名**: `snake_case` の名詞 + 用途。`hero_intro`, `product_feature`, `promise_step`
- **リージョン名**: 場所を表す共通名。固有用途 (例: `eclosion_banner`) はリージョンではなくブロック型として持つ
- **ブロック型**: `snake_case`、内容の型を表す。レイアウト的な名前 (`top_block` など) は禁止
- **ロール名**: 組版・出版業界の語彙を借用。`description` のような曖昧語は不可
- **`analytics_id` の命名**: `<scope>.<id>.<element>` のドット区切り階層。例: `product.DHH-0271.cta.add_to_cart`
- **`I18nKey` の命名**: `<scope>.<key>` のドット区切り。バージョンサフィックスは §12 のルールに従う場合のみ
- **`experiment.key` の命名**: `<feature>_<purpose>_<period>`。例: `hero_cta_2026q2`
- **テンプレートのバージョニング**: 破壊的変更が必要な時は `product_feature__v2` のように suffix を付け、レジストリに両方登録して段階移行する (Rust enum variant としては `ProductFeatureV2` で別 variant)

## 9. 多重度の扱い

- **配列の長さで自然に表現する**。`eyebrow` を 2 つ並べたければ `header` に同じブロックを 2 つ入れる
- **位置で命名しない**。`leftButton` / `rightButton` のような名前は禁止
- **役割で区別したい場合は属性で**。CTA なら `intent: "primary"` で示す
- 「ちょうど 1 つしか取り得ない」リージョンも、配列で持つ。テンプレート側で `blocks[0]` のみ描画する選択肢もあり

## 10. fallback / 縮退戦略 + セキュリティ規約

### 10.1 縮退ルール

- 未知の `template` → `FallbackCard` を描画しログ通知
- 未知の `block.type` → 描画スキップ + ログ通知
- 既知 type だが未知の `role` → デフォルトロールにフォールバック (text なら `body`、cta なら `tertiary`)
- 必須リージョンが空 → テンプレートが個別に「最低限の見た目」を担保
- 画像 `src` が解決不能 → §6.5 の `MediaFallback` に置換 (`alt` / `iconName` が引き継がれる)
- `Localizable.i18n` のキー解決失敗 → 開発: キー名を表示。本番: 空文字 + エラーログ
- `Href.parse` 失敗 → バック側で 400 を返してデータ投入を拒否 (フロントには到達させない)

### 10.2 Href の許容ルール

| 種別 | 許容 | 例 |
|---|---|---|
| 内部相対パス | ✅ | `/products`, `/karte/example` |
| KOCHU 自社ドメイン | ✅ | `https://kochu.example/...`, `https://*.kochu.example/...` |
| 既知の外部ホスト | ✅ | `https://www.instagram.com/...` 他、`KNOWN_EXTERNAL_HOSTS` 定数で管理 |
| `mailto:` / `tel:` | ✅ | `mailto:support@kochu.example` |
| 任意のサードパーティ https | ❌ | 申請ベースで `KNOWN_EXTERNAL_HOSTS` に追加 |
| `javascript:` / `data:` / `file:` / `vbscript:` 等 | ❌ | 構築時 reject (XSS) |

`KNOWN_EXTERNAL_HOSTS` は Rust 側の定数として一元管理し、変更は PR レビューを必須とする。

### 10.3 utm パラメータ

`Href` には utm を入れない。トラッキングパラメータは **フロントの遷移直前に `analytics_id` を元に付与** する責務。これにより:

- DB のリンク値が乱雑にならない
- A/B のラベル違いで utm が変わるような場面でも、Href は同一値を保てる
- utm 仕様変更時にデータマイグレーションが不要

### 10.4 文字列描画の安全規約

- **すべての user-facing 文字列は textContent でのみ描画**。`innerHTML` / `dangerouslySetInnerHTML` 禁止
- 唯一の例外は `<L>` コンポーネント内の i18n 解決後文字列 (これも textContent 経由)
- リッチテキストが必要になった場合は、専用ブロック型 (`rich_text` 等) を新設し **限定タグの allowlist** で許容する。生 HTML は決して許容しない

## 11. 計測・実験 (Analytics & Experiments)

### 11.1 二段階の粒度

- **カード単位**: `CardBlock.analytics_id` + `experiment` で impression / 全体クリックを集計
- **ブロック単位**: 各 `Block.analytics_id` で個別 CTA / badge を集計

### 11.2 イベントスキーマ

```ts
type AnalyticsEvent = {
  type: "card_impression" | "block_click";
  card: { id: string; template: TemplateName; analyticsId?: string };
  block?: { key: string; type: BlockType; analyticsId?: string };
  experiment?: Experiment;
  timestamp: string;  // ISO 8601
};
```

### 11.3 variant と experiment.bucket は独立

- `CardBlock.variant` = 商品担当者・運営が選ぶ **マーチャンダイジング上の見栄え** (`featured`, `compact`)
- `Experiment.bucket` = 実験基盤が割り当てる **A/B バケット** (`A`, `B`, `control`)

両者は **直交** する。`featured` 商品を `bucket: "B"` で配信する状況は普通に起こる。バック側は次の順で決定する:

1. 商品担当が指定した `variant` を使う (なければデフォルト)
2. 実験基盤が `experiment.bucket` を割り当て、レスポンスに同梱
3. フロントは届いた `experiment` を **そのまま記録** するだけ。フラグ評価・上書きは禁止

これにより SDK 不要・キャッシュ整合・分析の信頼性をすべて担保できる。

## 12. i18n

### 12.1 値は Localizable に統一

§4.1 の `Localizable` を全 user-facing テキストに使う。生のローカライズ済み文字列を直接フィールドに置かない。

### 12.2 静的 vs 動的の判別

| 判定基準 | 種別 | 表現 |
|---|---|---|
| デザイナー / 運営が編集する固定コピー | 静的 | `{ source: "i18n", key: "..." }` |
| 商品マスタ・カウンタなどデータソースから来る | 動的 | `{ source: "raw", text: "..." }` |
| 一部のみデータ駆動 (「{n} 日後に羽化予測」など) | 部分動的 | `{ source: "i18n", key: "...", params: {...} }` |

### 12.3 辞書の所在

- 静的 UI コピー → フロントリポジトリ内の JSON (`client_solid/src/i18n/<locale>.json`)
- 動的データ (商品名・説明) → 商品マスタが locale 別カラム or 翻訳テーブルを持ち、API レスポンスに raw で含める

### 12.4 `I18nKey` のバージョンサフィックス運用ルール

**通常の翻訳更新 (タイポ修正、表現磨き) では `.v2` を切らない**。in-place で辞書を書き換える。

サフィックスを切るのは次の **2 ケースに限る**:

1. **意味が変わる差し替え** (旧キーを deprecate して移行期間が必要な時)
2. **コピー A/B テスト** で同時に複数バージョンを保持したい時

これにより辞書の線形肥大を防ぐ。新規キーは無印で開始し、必要が生じてから `.v2` を切る。

### 12.5 例外: `meta_line.items[].value`

ID やショップ名は固有名詞 / 商号で **翻訳対象外** なので、Localizable ではなく `string` を直接持つ (§4.2)。多言語化が必要になった時のみ Localizable へ昇格させる。

## 13. テスト戦略

### 13.1 フィクスチャ駆動の Storybook

`fixtures/cards/*.json` に各テンプレート × 全 variant のサンプル `CardBlock` を置き、Storybook で全パターンを描画する。これがビジュアル契約のゴールデン。

```
fixtures/cards/
  hero_intro.default.json
  product_feature.default.json
  product_feature.featured.json
  product_feature.compact.json
  promise_step.default.json
```

### 13.2 スキーマ契約テスト

- Rust 側で `schemars` を使い JSON Schema を出力 (`fixtures/schema/cardblock.schema.json`)
- フロント側 CI で **フィクスチャが Schema を満たすことを検証** (`ajv` 等)
- Rust 側でも `cargo test` でフィクスチャを `serde_json::from_str::<CardBlock>` できることを検証
- ts-rs 生成物の差分が無いことを CI で検証

### 13.3 縮退テスト

`fixtures/cards/broken/` に異常系を置き、`FallbackCard` / `MediaFallback` / プレースホルダ置換を検証:

- `unknown_template.json` — 未知 template
- `unknown_block_type.json` — 未知 block.type
- `missing_i18n_key.json` — 解決失敗
- `invalid_href.json` — `javascript:` 等が **Rust の deserialize で reject されること**を確認

## 14. キャッシュ戦略

- `CardBlock` は `id + updated_at` で **ETag** を発行し、CDN で短期キャッシュ (60 秒程度)
- experiment が絡むレスポンスは **bucket をキャッシュキーに含める** (`/api/cards/hero?bucket=B`)
- ユーザー固有データ (パーソナライズ、ログイン状態) は **別 API に分離**して `CardBlock` には混ぜない
- experiment の bucket は `hash(session_id, experiment.key)` で決定論的に算出し、ログイン前後で揺れない設計
- i18n 辞書は locale 単位で長期キャッシュ (1 時間〜)、辞書ファイル自体のハッシュで cache-bust

## 15. 段階導入プラン

### Phase 0: 現状認識
ヒーロー・約束カード・商品カードはハードコード。動的化の必要性が低いので保留。

### Phase 1: 商品カード `product_feature` のみ三層で型を切る
- 既に DB 駆動なので一番費用対効果が高い
- ブロック型 5-6 個から開始 (`text` / `cta` / `media` / `badge` / `meta_line` / `price` / `eclosion_forecast`)
- フロントは段階的に移行 (Strangler Fig)
- **`analytics_id` / `experiment` / `Localizable` / `Href` ブランド型は最初から導入する** (後付けは破壊的変更)
- ts-rs パイプラインを Phase 1 で構築する

### Phase 2: ヒーローセクション
- 運営側からの入稿頻度を見て判断
- 必要なら `hero_intro` をスキーマ化し、CMS / 管理画面接続
- A/B テスト基盤 (バック側 bucket 解決) をここで本格稼働

### Phase 3: 約束カード・他セクション
- パターンが固まってきた段階で、ページ全体をブロックツリーで持つかを判断
- ここで初めて「ページ = セクション配列、セクション = カード配列」の二段抽象を入れる

## 16. やらないこと (Non-Goals)

- **任意の CSS/style を DB に保存しない**。アクセサーカラー・余白は CSS 変数 + 限定 enum で表現
- **生の HTML を DB に保存しない**。リッチテキストは新規ブロック型 + allowlist
- **位置・座標を DB に保存しない**
- **見出しレベル (h1-h6) を DB に保存しない**。テンプレート + リージョン位置で決定
- **生のローカライズ済み文字列を静的コピーとして DB に保存しない**。`Localizable.i18n` 経由
- **任意の `href` を許容しない**。`Href` ブランド型 + 許容ホストリストで制限
- **utm パラメータを `Href` に焼き込まない**。フロントが遷移直前に付与
- **パーソナライズ / 条件出し分けを SDUI スキーマに入れない**。`visibleWhen` のような評価式は持たない。バック側でリクエストコンテキストを見て、出すべき `CardBlock` を選別済みで返す
- **A/B テストのフラグ評価をフロントでしない**。バックが bucket を解決し、フロントは `experiment` をそのまま記録
- **画像最適化 (srcset / picture / AVIF) を DB に持たせない**。フロント / 画像配信側で解決
- **エラー / ローディング状態を SDUI スキーマに持たせない**。アプリケーション層 (Suspense / Error Boundary / Skeleton) の責務
- **TypeScript 型を手書きしない**。Rust が source of truth、ts-rs で生成
- **Notion レベルの自由ブロックツリーは目指さない**。KOCHU は構造化されたコンテンツの方が価値が高い

## 17. Future Work

将来の拡張余地として **予約済み** にしておく項目。今は実装しないが、設計上ブロックされていないことを記録しておく。

- **ブロック単位の experiment** — 同じカード内の CTA ラベル A/B などを実現したい場合、`Block` のタグ付き union に各バリアント `experiment?: Experiment` を追加する余地がある (現状 `Block` がタグ付き union のため後方互換に追加可能)
- **ページレベルの構造化** — `{ page: ..., sections: [{ type, items: [{ $ref: cardId }] }] }` の二段階抽象。Phase 3 で評価
- **リッチテキストブロック** — 限定タグ allowlist 付きの `rich_text` ブロック型
- **多通貨対応** — `Currency` enum はすでに `USD` / `EUR` を予約済み
- **`Localizable.value` (動的 i18n データ)** — 商品マスタが locale 別文字列を持つようになった時、`{ source: "i18n_data", key: "product.DHH-0271.name" }` のような第 3 バリアントを追加する余地がある

## 18. 参考にした設計

- Sanity CMS Portable Text — ブロック配列の考え方
- Airbnb DLS / Server-Driven UI — テンプレート + データ分離
- Shopify Polaris — クローズドな語彙統制
- Material Design Tokens — テーマトークンの限定列挙
- 新聞組版用語 (eyebrow / headline / lead / byline) — テキストロール命名
- ICU MessageFormat / FormatJS — i18n キー方式と params
- GrowthBook / Optimizely — サーバ側 A/B 解決パターン
- ts-rs / schemars — Rust source of truth からの型生成
