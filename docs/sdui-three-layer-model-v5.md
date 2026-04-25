# SDUI 三層モデル 設計方針 v5

> KOCHU のカード／セクションを動的にデータ駆動で表示するための、Server-Driven UI (SDUI) スキーマ設計。
>
> v4 のレビュー結果 (中 6〜12) を反映。**`id` / `analyticsId` の関係**、**`updated_at` のレスポンス構造**、**`Experiment` のバリデーション**、**フロント側 branded 型復元レイヤ**、**ツールチェーン正当化**、**`Currency` の現実主義縮小**を確定したバージョン。

## 0. v4 からの変更点 (Changelog)

| 区分 | 変更点 | 対応指摘 |
|---|---|---|
| 中 | **`CardBlock.id` の意味論を「不変・一意の識別子」に統一**。三つの源泉 (データ主キー / 構造化 ID / 複合 ID) を許容。`analyticsId` 未指定時は `id` を流用 (§4.5, §8, §11.4) | 中 6 |
| 中 | **`updated_at` は SDUI スキーマに含めず、HTTP ヘッダ + レスポンスエンベロープで返す** ことを §14 / §16 で明示 | 中 7 |
| 中 | **`Experiment::new` で正規表現バリデーション**を導入 (`key` は snake_case、`bucket` は alphanumeric/_/-)。`serde::Deserialize` も同経路を通す | 中 8 |
| 中 | **`client_solid/src/sdui/branded.ts`** レイヤを §7.5 に新設。ts-rs 生成物の `string` を branded 型に上書きしてフロント側でも型安全を保つ | 中 9 |
| 中 | §7.1 に **schemars と ts-rs の役割分担**を 1 段落で明示 (コンパイル時 TS / 実行時 JSON Schema の二段防御) | 中 10 |
| 中 | **`Currency` enum を `JPY` のみに縮小**。多通貨対応は §17 Future Work に移動 | 中 12 |

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
11. **`block.key` 等の識別子は同一カード内で一意**。並び替え時の再マウントと計測識別子の整合の両方に効く。
12. **存在しないものは予約しない**。enum / 型の variant は「いま使う」ものだけを定義し、将来予定は §17 Future Work に書く。

## 3. 三層モデル

> **命名注意**: `headline` という単語は本ドキュメント中で **2 つの異なる層** で使われる:
> - **Region 名としての `headline`** — カード内の主見出しを置く論理的な場所
> - **Text role としての `headline`** — テキストブロックの意味的サブ分類 (主見出し)
>
> 文脈で区別する。region 名で参照する場合は「`headline` リージョン」、role の場合は「role:headline」と書き分ける。

| 層 | 役割 | 個数 | 実体 |
|---|---|---|---|
| **Region (リージョン)** | カード内の論理的な「場所」。テンプレートが定義する | 数個に固定 | テンプレートごとの専用 struct |
| **Block (ブロック)** | リージョン内に並ぶ要素。型を持つ | 各リージョン 0..N | Array |
| **Role (ロール)** | ブロック型の中での意味的サブ分類 | ブロックの属性 | enum |

### 3.1 Region (リージョン)

カード横断で共通の論理的配置場所。テンプレートが「どのリージョンを持ち、それをどう描画するか」を決める。**Rust 側ではテンプレートごとに専用の struct で定義する** ため、テンプレートが許容しないリージョン名は deserialize で reject される (§7.3)。

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

### 3.3 Role (ロール)

ブロックの `type` ごとに **異なる closed enum** を持つ。

#### `text` のロール

| ロール | 用途 | 例 | 既定の HTML タグ ※ |
|---|---|---|---|
| `eyebrow` | 主見出しの上に置く小さなラベル | `── ようこそ KOCHU へ` | `<p class="eyebrow">` |
| `headline` | 主見出し | `買う、育てる、継ぐ。` | テンプレート依存 (h1〜h3) |
| `subhead` | 副見出し | `Dynastes hercules hercules` | `<p class="subhead">` |
| `lead` | 本文より太めのリード文 | ヒーロー説明 | `<p class="lead">` |
| `body` | 本文 | 約束カードの説明 | `<p>` |
| `caption` | 補助テキスト | 画像キャプション | `<figcaption>` |
| `byline` | 出典・著者 | ブリーダー名表示 | `<p class="byline">` |

> ※ **見出しレベル (h1-h6) はデータに含めない**。`role: headline` のときの具体的な h レベルは、テンプレート × リージョン位置で決定する (§5 のテンプレート定義表で明示)。

#### `cta` の intent: `primary` / `secondary` / `tertiary` / `destructive`

#### `media` の kind: `image` / `video` / `icon` / `placeholder`

#### `badge` の role: `status` / `evidence` / `warning` / `promo`

#### `meta_line.items[]` の role: `id` / `shop` / `code` / `lot` / `breeder`

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

/** 当面 JPY のみ運用。多通貨対応は §17 Future Work で variant 追加 */
export type Currency = "JPY";

// ── ブランド型 (フロント側で branded.ts により強化される §7.5) ──
export type Href    = string & { readonly __brand: "Href" };
export type I18nKey = string & { readonly __brand: "I18nKey" };

// ── Localizable: 静的 i18n と動的 raw を型レベルで分離 ──
export type Localizable =
  | { source: "i18n"; key: I18nKey;
      params?: Record<string, string | number> }
  | { source: "raw";  text: string };
```

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

### 4.3 `key` の一意性スコープと命名

| 対象 | 一意性スコープ | 推奨形式 |
|---|---|---|
| `Block.key` | **同一 `CardBlock` 内で一意** | `<region短縮>-<purpose>` 例: `header-eb`, `body-hl`, `body-sh`, `footer-pr` |
| `MetricItem.key` / `MetaItem.key` | **同一 `items` 配列内で一意** | 短い意味語または連番 例: `karte`, `breeders`, `m1`, `m2` |

検証は **Rust 側の deserialize 後に必須** (§7.6)。重複は 400 エラーで弾く。

### 4.4 Experiment

```typescript
export type Experiment = {
  /** 実験のキー (snake_case 必須、例: "hero_cta_2026q2") */
  key: string;
  /** A/B バケット (alphanumeric/_/- のみ、例: "A" | "B" | "control")。
   *  CardBlock.variant (マーチャンダイジング) とは独立 */
  bucket: string;
};
```

`key` / `bucket` は Rust 側 `Experiment::new` で **正規表現バリデーション** を経由する (§7.4)。

### 4.5 CardBlock (テンプレートで判別される共用体)

```typescript
export type CardBlock =
  | {
      template: "hero_intro";
      id: string;                    // ← §4.6 の規約に従う
      variant?: "default";
      experiment?: Experiment;
      analyticsId?: string;          // ← 未指定時は id を流用 (§11.4)
      regions: HeroIntroRegions;
    }
  | {
      template: "product_feature";
      id: string;
      variant?: "default" | "featured" | "compact";
      experiment?: Experiment;
      analyticsId?: string;
      regions: ProductFeatureRegions;
    }
  | {
      template: "promise_step";
      id: string;
      variant?: "default";
      experiment?: Experiment;
      analyticsId?: string;
      regions: PromiseStepRegions;
    };

export type HeroIntroRegions = {
  header?: Block[]; headline?: Block[]; body?: Block[];
  actions?: Block[]; footer?: Block[];
};
export type ProductFeatureRegions = {
  header?: Block[]; media?: Block[]; meta?: Block[];
  body?: Block[]; footer?: Block[];
};
export type PromiseStepRegions = {
  header?: Block[]; media?: Block[]; body?: Block[]; actions?: Block[];
};

export type TemplateName = CardBlock["template"];
```

### 4.6 `CardBlock.id` の規約

`CardBlock.id` は **「この SDUI レスポンスを一意に識別するための不変の文字列」**。次の三つの源泉のいずれかに従って付与する。

| 源泉 | 形式 | 使う場面 | 例 |
|---|---|---|---|
| **データ主キー** | データソースの ID をそのまま流用 | データ実体とカードが 1:1 で対応 | `DHH-0271` (商品マスタ) |
| **構造化 ID** | `<scope>-<purpose>` の固定命名 | データソースを持たず、コード／管理画面で配置 | `hero-main`, `promise-01` |
| **複合 ID** | `<scope>.<key>.<context>` のドット区切り | 同じデータ実体が複数の SDUI 配置で再利用される | `product.DHH-0271.related` |

**不変性**: 一度割り当てた `id` は **キャッシュキー / 計測 ID** として参照されるため、変更しない。表示位置や variant が変わっても `id` は据え置く。

**`analyticsId` との関係**: §11.4 のフォールバック規約により、`analyticsId` が省略された場合は `id` を計測 ID として流用する。`analyticsId` を別途指定する動機は、`id` がデータソース由来 (`DHH-0271`) で計測の意味的階層 (`product.DHH-0271`) を別途付けたいケースなどに限定する。

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

> **不変条件**: 同一テンプレート内に `text.role: headline` のブロックは **0 または 1 個**。複数置きたい場合はテンプレートを分割する。

### 5.3 ヒーロー紹介カード `hero_intro`

`id: "hero-main"` は **構造化 ID** (§4.6)。

```jsonc
{
  "id": "hero-main",
  "template": "hero_intro",
  "experiment": { "key": "hero_copy_2026q2", "bucket": "B" },
  "analyticsId": "hero.main",
  "regions": {
    "header": [
      { "key": "header-eb", "type": "text", "role": "eyebrow",
        "content": { "source": "i18n", "key": "hero.intro.eyebrow" } }
    ],
    "headline": [
      { "key": "headline-hl", "type": "text", "role": "headline",
        "content": { "source": "i18n", "key": "hero.intro.headline" } }
    ],
    "body": [
      { "key": "body-ld", "type": "text", "role": "lead",
        "content": { "source": "i18n", "key": "hero.intro.lead" } }
    ],
    "actions": [
      { "key": "actions-find", "type": "cta", "intent": "primary",
        "label": { "source": "i18n", "key": "hero.intro.cta.find_specimens" },
        "href": "/products",
        "analyticsId": "hero.main.cta.find_specimens" },
      { "key": "actions-about", "type": "cta", "intent": "secondary",
        "label": { "source": "i18n", "key": "hero.intro.cta.about" },
        "href": "/about",
        "analyticsId": "hero.main.cta.about" }
    ],
    "footer": [
      { "key": "footer-ml", "type": "metric_list", "items": [
          { "key": "karte",
            "label": { "source": "i18n", "key": "hero.metric.karte.label" },
            "value": { "source": "raw",  "text": "12,480 件" } },
          { "key": "breeders",
            "label": { "source": "i18n", "key": "hero.metric.breeders.label" },
            "value": { "source": "raw",  "text": "86 名" } },
          { "key": "compensation",
            "label": { "source": "i18n", "key": "hero.metric.compensation.label" },
            "value": { "source": "raw",  "text": "99.2%" } }
      ]}
    ]
  }
}
```

### 5.4 商品ハイライトカード `product_feature`

`id: "DHH-0271"` は **データ主キー** (§4.6)。`analyticsId: "product.DHH-0271"` は計測の意味的階層を別途付与した例。

```jsonc
{
  "id": "DHH-0271",
  "template": "product_feature",
  "variant": "featured",
  "analyticsId": "product.DHH-0271",
  "regions": {
    "header": [
      { "key": "header-b1", "type": "badge", "role": "status",
        "label": { "source": "i18n", "key": "badge.featured" } },
      { "key": "header-b2", "type": "badge", "role": "evidence",
        "label": { "source": "i18n", "key": "badge.pedigreed" } }
    ],
    "media": [
      { "key": "media-img", "type": "media", "kind": "image",
        "src": "https://cdn.kochu.example/specimens/DHH-0271.jpg",
        "alt": { "source": "raw", "text": "ヘラクレス 個体写真" } }
    ],
    "meta": [
      { "key": "meta-ml", "type": "meta_line", "items": [
          { "key": "id",   "role": "id",   "value": "#DHH-0271" },
          { "key": "shop", "role": "shop", "value": "ANCHOR BEETLE CO." },
          { "key": "code", "role": "code", "value": "CBF2", "align": "end" }
      ]}
    ],
    "body": [
      { "key": "body-hl", "type": "text", "role": "headline",
        "content": { "source": "raw", "text": "ヘラクレスオオカブト ♂ 142mm" } },
      { "key": "body-sh", "type": "text", "role": "subhead",
        "content": { "source": "raw", "text": "Dynastes hercules hercules" } }
    ],
    "footer": [
      { "key": "footer-pr", "type": "price",
        "amount": 48000, "currency": "JPY", "taxIncluded": true },
      { "key": "footer-ef", "type": "eclosion_forecast",
        "daysAhead": 15, "date": "2026-05-04", "tolerance": 5 }
    ]
  }
}
```

### 5.5 約束カード `promise_step`

`id: "promise-01"` は **構造化 ID** (§4.6)。eyebrow は **per-step の専用キー**にし、`params` に翻訳対象文字列を埋めない (§12.5 方針)。

```jsonc
{
  "id": "promise-01",
  "template": "promise_step",
  "analyticsId": "promise.01",
  "regions": {
    "header": [
      { "key": "header-eb", "type": "text", "role": "eyebrow",
        "content": { "source": "i18n", "key": "promise.01.eyebrow" } }
    ],
    "media": [
      { "key": "media-ic", "type": "media", "kind": "icon", "iconName": "clipboard" }
    ],
    "body": [
      { "key": "body-hl", "type": "text", "role": "headline",
        "content": { "source": "i18n", "key": "promise.01.headline" } },
      { "key": "body-bd", "type": "text", "role": "body",
        "content": { "source": "i18n", "key": "promise.01.body" } }
    ],
    "actions": [
      { "key": "actions-cta", "type": "cta", "intent": "tertiary",
        "label": { "source": "i18n", "key": "promise.01.cta.example" },
        "href": "/karte/example",
        "analyticsId": "promise.01.cta.example" }
    ]
  }
}
```

辞書 (`client_solid/src/i18n/ja.json`) 抜粋:

```json
{
  "promise.01.eyebrow": "01 — 買う",
  "promise.02.eyebrow": "02 — 育てる",
  "promise.03.eyebrow": "03 — 継ぐ"
}
```

## 6. フロントエンド (Solid) の実装パターン

> **Solid の前提**: コンポーネント本体は一度しか走らない。リアクティビティは signals / `createMemo` / props プロキシが担う。**props は分割代入せず `props.foo` でアクセスする**。フック呼出制約はない (普通の関数からも `useContext()` を呼べる) が、**リアクティブな再評価は tracked scope (JSX 式 / `createMemo`) でのみ**起きる点に注意。

### 6.1 i18n と Localizable レンダラー

```tsx
// src/sdui/i18n.ts
import {
  createContext, useContext, createMemo,
  type Accessor, type ParentComponent,
} from "solid-js";
import type { Localizable } from "./branded";    // §7.5 の branded 型を import

export type Translator = (key: string, params?: Record<string, string | number>) => string;

const I18nCtx = createContext<Translator>();

export const I18nProvider: ParentComponent<{ value: Translator }> = (props) =>
  <I18nCtx.Provider value={props.value}>{props.children}</I18nCtx.Provider>;

export const useI18n = (): Translator => {
  const t = useContext(I18nCtx);
  if (!t) throw new Error("I18nProvider が必要です");
  return t;
};

export function localizable(value: () => Localizable | undefined): Accessor<string | undefined> {
  const t = useI18n();
  return createMemo(() => {
    const v = value();
    if (!v) return undefined;
    return v.source === "raw" ? v.text : t(v.key, v.params);
  });
}
```

```tsx
// src/sdui/components/L.tsx
import type { Localizable } from "../branded";
import { localizable } from "../i18n";

export function L(props: { value: Localizable }) {
  const text = localizable(() => props.value);
  return <>{text()}</>;
}
```

### 6.2 テンプレートレジストリと CardRenderer

```tsx
// src/sdui/registry.ts
import type { CardBlock } from "./branded";    // ← branded 型を使う (§7.5)
import { HeroIntro } from "./templates/HeroIntro";
import { ProductFeature } from "./templates/ProductFeature";
import { PromiseStep } from "./templates/PromiseStep";
import { FallbackCard } from "./templates/FallbackCard";
import { Match, Switch } from "solid-js";
import { useImpression } from "./useImpression";

export function CardRenderer(props: { block: CardBlock }) {
  useImpression(() => props.block);

  return (
    <Switch fallback={<FallbackCard id={props.block.id} />}>
      <Match when={props.block.template === "hero_intro" && props.block}>
        {(b) => <HeroIntro {...b()} />}
      </Match>
      <Match when={props.block.template === "product_feature" && props.block}>
        {(b) => <ProductFeature {...b()} />}
      </Match>
      <Match when={props.block.template === "promise_step" && props.block}>
        {(b) => <PromiseStep {...b()} />}
      </Match>
    </Switch>
  );
}
```

### 6.3 リージョン / ブロックレンダラー

```tsx
// src/sdui/RegionRenderer.tsx
import { For, Switch, Match } from "solid-js";
import type { Block } from "./branded";

export function RegionRenderer(props: { blocks?: Block[] }) {
  return (
    <For each={props.blocks ?? []}>
      {(block) => <BlockRenderer block={block} />}
    </For>
  );
}

export function BlockRenderer(props: { block: Block }) {
  return (
    <Switch>
      <Match when={props.block.type === "text" && props.block}>
        {(b) => <TextBlock block={b()} />}
      </Match>
      <Match when={props.block.type === "cta" && props.block}>
        {(b) => <CtaButton block={b()} />}
      </Match>
      <Match when={props.block.type === "media" && props.block}>
        {(b) => <MediaBlock block={b()} />}
      </Match>
      <Match when={props.block.type === "badge" && props.block}>
        {(b) => <BadgeBlock block={b()} />}
      </Match>
      <Match when={props.block.type === "metric_list" && props.block}>
        {(b) => <MetricList block={b()} />}
      </Match>
      <Match when={props.block.type === "meta_line" && props.block}>
        {(b) => <MetaLine block={b()} />}
      </Match>
      <Match when={props.block.type === "price" && props.block}>
        {(b) => <PriceBlock block={b()} />}
      </Match>
      <Match when={props.block.type === "eclosion_forecast" && props.block}>
        {(b) => <EclosionForecastBanner block={b()} />}
      </Match>
      <Match when={props.block.type === "divider" && props.block}>
        <hr class="card__divider" />
      </Match>
    </Switch>
  );
}
```

### 6.4 テンプレート例 (見出しレベルは Context で解決)

```tsx
// src/sdui/templates/ProductFeature.tsx
import type { CardBlock } from "../branded";
import { RegionRenderer } from "../RegionRenderer";
import { HeadingLevelProvider } from "../headingLevel";

type ProductFeatureCard = Extract<CardBlock, { template: "product_feature" }>;

export function ProductFeature(props: ProductFeatureCard) {
  return (
    <article class="card card--product-feature">
      <header class="card__header"><RegionRenderer blocks={props.regions.header} /></header>
      <div    class="card__media"> <RegionRenderer blocks={props.regions.media}  /></div>
      <div    class="card__meta">  <RegionRenderer blocks={props.regions.meta}   /></div>
      <HeadingLevelProvider level={3}>
        <div class="card__body">   <RegionRenderer blocks={props.regions.body}   /></div>
      </HeadingLevelProvider>
      <footer class="card__footer"><RegionRenderer blocks={props.regions.footer} /></footer>
    </article>
  );
}
```

### 6.5 統一フォールバック (Solid + a11y 厳格)

```tsx
// src/sdui/components/MediaFallback.tsx
import { Show } from "solid-js";
import type { Localizable } from "../branded";
import { localizable } from "../i18n";
import { Icon } from "./Icon";

/**
 * a11y 規約 (どちらかに必ず分岐する。中間状態は禁止):
 *   alt あり → role="img" + aria-label を付与 (意味のある画像扱い)
 *   alt なし → role="presentation" + aria-hidden="true" (装飾扱い)
 */
export function MediaFallback(props: { alt?: Localizable; iconName?: string }) {
  const altText = localizable(() => props.alt);
  return (
    <Show
      when={props.alt}
      fallback={
        <div class="media-fallback" role="presentation" aria-hidden="true">
          <Icon name={props.iconName ?? "image"} />
        </div>
      }
    >
      <div class="media-fallback" role="img" aria-label={altText()}>
        <Icon name={props.iconName ?? "image"} />
      </div>
    </Show>
  );
}
```

## 7. バックエンド (Rust) の型表現 — Source of Truth

**型の単一ソース・オブ・トゥルースは Rust 側 (`server/src/sdui/`)**。TypeScript 型は `ts-rs` で生成し、`client_solid/src/generated/sdui.ts` に出力する。手書きで TS を編集することは禁止。

### 7.1 ワークフロー

1. Rust 側で型を編集 (`server/src/sdui/blocks.rs` など)
2. `cargo test` 実行 → `ts-rs` が `ts-rs/bindings/` 以下に `.ts` を出力
3. ビルドスクリプトが `bindings/` を `client_solid/src/generated/sdui.ts` に集約してコミット
4. **ローカルは pre-commit hook**、**リモートは CI** で「`cargo test` 後に diff が出ない」ことを二重に検証
5. **JSON Schema** も併せて生成 (`schemars` クレート) し、フィクスチャ検証 (§13.2) に利用
6. フロント側は `generated/sdui.ts` を **直接 import せず** 、`sdui/branded.ts` (§7.5) 経由で参照する

#### なぜ `schemars` と `ts-rs` の両方を使うか

`ts-rs` は **TypeScript 型** を生成し、フロント開発時のコンパイルエラーで誤用を防ぐ。`schemars` は **JSON Schema** を生成し、フロント側 CI で `ajv` 等によるフィクスチャ検証を可能にする (TypeScript 型は実行時には消えるためフィクスチャ検証ができない)。両者は **コンパイル時 (TS) と実行時 (JSON Schema) の二段防御**を構成する。

将来 ts-rs が JSON Schema 出力に対応した場合は schemars を廃止できる可能性がある (現状の ts-rs は型のみ生成)。

### 7.2 Cargo.toml 抜粋

```toml
[dependencies]
serde     = { version = "1", features = ["derive"] }
serde_json = "1"
schemars  = "0.8"
chrono    = { version = "0.4", features = ["serde"] }
thiserror = "1"
once_cell = "1"
regex     = "1"

[dev-dependencies]
ts-rs = "9"
```

### 7.3 Regions 専用 struct

```rust
// server/src/sdui/regions.rs

use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use ts_rs::TS;
use super::blocks::Block;

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct HeroIntroRegions {
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub header: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub headline: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub body: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub actions: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub footer: Vec<Block>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct ProductFeatureRegions {
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub header: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub media: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub meta: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub body: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub footer: Vec<Block>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct PromiseStepRegions {
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub header: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub media: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub body: Vec<Block>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub actions: Vec<Block>,
}
```

### 7.4 Experiment のバリデーション

```rust
// server/src/sdui/experiment.rs

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use thiserror::Error;
use ts_rs::TS;

static KEY_RE:    Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-z][a-z0-9_]*$").unwrap());
static BUCKET_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9_-]+$").unwrap());

#[derive(Debug, Error)]
pub enum ExperimentError {
    #[error("invalid experiment key (snake_case required): {0}")] InvalidKey(String),
    #[error("invalid bucket (alphanumeric/_/- only): {0}")]       InvalidBucket(String),
}

/// JSON deserialize 用の中間表現。`try_from` で Experiment に昇格させる。
#[derive(Deserialize)]
struct ExperimentRaw {
    key: String,
    bucket: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema, TS)]
#[serde(try_from = "ExperimentRaw")]
#[ts(export)]
pub struct Experiment {
    pub key: String,
    /// A/B バケット。CardBlock.variant とは独立。
    pub bucket: String,
}

impl Experiment {
    pub fn new(key: impl Into<String>, bucket: impl Into<String>) -> Result<Self, ExperimentError> {
        let key = key.into();
        let bucket = bucket.into();
        if !KEY_RE.is_match(&key)       { return Err(ExperimentError::InvalidKey(key)); }
        if !BUCKET_RE.is_match(&bucket) { return Err(ExperimentError::InvalidBucket(bucket)); }
        Ok(Self { key, bucket })
    }
}

impl TryFrom<ExperimentRaw> for Experiment {
    type Error = ExperimentError;
    fn try_from(r: ExperimentRaw) -> Result<Self, Self::Error> {
        Experiment::new(r.key, r.bucket)
    }
}
```

これにより JSON 経由で `bucket: " B "` のような不正値が来ると **deserialize で 400** になる。Rust 内部の `Experiment::new` 経由でも同じ規約が適用される。

### 7.5 フロント側 branded 型レイヤ

ts-rs は `Href` / `I18nKey` を素の `string` として TS 出力するため、**フロント側で別ファイルに branded 型を 1 度だけ手書き**して上書きする。

```typescript
// client_solid/src/sdui/branded.ts
//
// ts-rs 生成物 (`generated/sdui.ts`) の string 型フィールドを branded 型に
// 差し替えるためのレイヤ。アプリコードはこのファイルから import すること。
// generated/sdui.ts を直接 import するのは禁止 (lint で検出)。

import type * as G from "../generated/sdui";

declare const __brand: unique symbol;

export type Href    = string & { readonly [__brand]: "Href" };
export type I18nKey = string & { readonly [__brand]: "I18nKey" };

// ── Localizable: i18n キーを branded I18nKey に置換 ──
export type Localizable =
  | { source: "i18n"; key: I18nKey;
      params?: Record<string, string | number> }
  | { source: "raw";  text: string };

// ── Block: cta.href を Href に、各 Localizable を branded 版に ──
export type Block =
  | (Extract<G.Block, { type: "text" }>             & { content: Localizable })
  | (Omit<Extract<G.Block, { type: "cta" }>, "href" | "label">
                                                    & { href: Href; label: Localizable })
  | (Omit<Extract<G.Block, { type: "media" }>, "alt">
                                                    & { alt?: Localizable })
  | (Omit<Extract<G.Block, { type: "badge" }>, "label">
                                                    & { label: Localizable })
  | (Omit<Extract<G.Block, { type: "metric_list" }>, "items">
                                                    & { items: Array<{
                                                        key: string;
                                                        label: Localizable;
                                                        value: Localizable;
                                                      }> })
  | Extract<G.Block, { type: "meta_line" }>
  | Extract<G.Block, { type: "price" }>
  | Extract<G.Block, { type: "eclosion_forecast" }>
  | Extract<G.Block, { type: "divider" }>;

// ── CardBlock: regions の中の Block を branded 版に ──
type ReplaceBlock<R> = { [K in keyof R]: R[K] extends G.Block[] | undefined ? Block[] | undefined : R[K] };

export type CardBlock =
  | (Omit<Extract<G.CardBlock, { template: "hero_intro" }>, "regions">
       & { regions: ReplaceBlock<G.HeroIntroRegions> })
  | (Omit<Extract<G.CardBlock, { template: "product_feature" }>, "regions">
       & { regions: ReplaceBlock<G.ProductFeatureRegions> })
  | (Omit<Extract<G.CardBlock, { template: "promise_step" }>, "regions">
       & { regions: ReplaceBlock<G.PromiseStepRegions> });

export type TemplateName = CardBlock["template"];

// ── 構築ヘルパ (テスト/フィクスチャ用) ──
export const asHref    = (s: string): Href    => s as Href;
export const asI18nKey = (s: string): I18nKey => s as I18nKey;
```

**運用ルール**:

- アプリコードは `import { Block, CardBlock } from "@/sdui/branded"` で参照する
- `generated/sdui.ts` の直接 import は eslint ルール (`no-restricted-imports`) で禁止
- `asHref` / `asI18nKey` はテスト・フィクスチャでのみ使用 (本番コードでの使用は code review で禁止)
- ランタイムには影響しない (型レベルのみの差し替え)

### 7.6 Block / CardBlock / key 一意性バリデータ

```rust
// server/src/sdui/blocks.rs (抜粋)

use chrono::NaiveDate;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
use super::regions::*;
use super::experiment::Experiment;

// ── ブランド型 ──
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(transparent)]
#[ts(export, type = "string")]
pub struct Href(String);

impl Href {
    pub fn parse(raw: &str) -> Result<Self, HrefError> { /* §10.2 のルール */ todo!() }
    pub fn as_str(&self) -> &str { &self.0 }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq, Hash)]
#[serde(transparent)]
#[ts(export, type = "string")]
pub struct I18nKey(String);

// ── Currency: Phase 1 は JPY のみ (§17 で多通貨対応を予約) ──
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[ts(export)]
pub enum Currency { JPY }

// ── Localizable / ParamValue / MetricItem / MetaItem / Block / CardBlock ──
// (v4 と同じ定義。regions: <Template>Regions、Currency は JPY のみ)

// ── key 一意性バリデータ ──
#[derive(Debug, thiserror::Error)]
#[error("duplicate key in card: {key}")]
pub struct KeyConflict { pub key: String }

pub trait ValidateKeys {
    fn validate_keys(&self) -> Result<(), KeyConflict>;
}

impl ValidateKeys for CardBlock {
    fn validate_keys(&self) -> Result<(), KeyConflict> {
        use std::collections::HashSet;
        let mut seen = HashSet::new();
        for block in self.iter_blocks() {
            check(&mut seen, block.key())?;
            for item_key in block.iter_item_keys() {
                let composite = format!("{}::{}", block.key(), item_key);
                check(&mut seen, &composite)?;
            }
        }
        Ok(())
    }
}

fn check(seen: &mut std::collections::HashSet<String>, k: &str) -> Result<(), KeyConflict> {
    if !seen.insert(k.to_string()) {
        return Err(KeyConflict { key: k.to_string() });
    }
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum HrefError    { #[error("disallowed scheme or host")] Disallowed }
#[derive(Debug, thiserror::Error)]
pub enum I18nKeyError { #[error("invalid format")] InvalidFormat }
```

API ハンドラは `serde_json::from_str::<CardBlock>(body)` 後に必ず `card.validate_keys()` を呼ぶ。失敗は 400 を返す。

## 8. 命名規則

- **テンプレート名**: `snake_case` の名詞 + 用途。`hero_intro`, `product_feature`, `promise_step`
- **リージョン名**: 場所を表す共通名
- **ブロック型**: `snake_case`、内容の型を表す。レイアウト的な名前 (`top_block` など) は禁止
- **ロール名**: 組版・出版業界の語彙を借用。`description` のような曖昧語は不可
- **`CardBlock.id`**: §4.6 の三源泉 (データ主キー / 構造化 ID / 複合 ID) のいずれか。**不変**
- **`Block.key`**: `<region短縮>-<purpose>` のドット区切り。例: `header-eb`, `body-hl`, `footer-pr`。**カード内一意**
- **`MetricItem.key` / `MetaItem.key`**: 短い意味語または連番。**同 items 配列内一意**
- **`analytics_id`**: `<scope>.<id>.<element>` のドット区切り階層。例: `product.DHH-0271.cta.add_to_cart`。**未指定時は `id` を流用** (§11.4)
- **`I18nKey`**: `<scope>.<key>` のドット区切り。バージョンサフィックスは §12.4 のルールに従う場合のみ
- **`experiment.key`**: `^[a-z][a-z0-9_]*$` (snake_case)。例: `hero_cta_2026q2`
- **`experiment.bucket`**: `^[A-Za-z0-9_-]+$`。例: `A`, `B`, `control`
- **テンプレートのバージョニング**: 破壊的変更が必要な時は `product_feature__v2` のように suffix。Rust enum variant としては `ProductFeatureV2` で別 variant

## 9. 多重度の扱い

- **配列の長さで自然に表現する**
- **位置で命名しない** (`leftButton` / `rightButton` 禁止)
- **役割で区別したい場合は属性で**
- 「ちょうど 1 つしか取り得ない」リージョンも、配列で持つ

## 10. fallback / 縮退戦略 + セキュリティ規約

### 10.1 縮退ルール

- 未知の `template` → `FallbackCard` を描画しログ通知
- 未知の `block.type` → 描画スキップ + ログ通知
- 既知 type だが未知の `role` → デフォルトロールにフォールバック
- 必須リージョンが空 → テンプレートが個別に「最低限の見た目」を担保
- 画像 `src` が解決不能 → §6.5 の `MediaFallback` に置換
- `MediaFallback` の a11y は **`alt` 有無で `role="img"` / `role="presentation"` を必ず分岐**
- `Localizable.i18n` のキー解決失敗 → 開発: キー名を表示。本番: 空文字 + エラーログ
- key 重複 / 不正 region キー / 不正 experiment / 不正 href → Rust 側で 400

### 10.2 Href の許容ルール

| 種別 | 許容 | 例 |
|---|---|---|
| 内部相対パス | ✅ | `/products`, `/karte/example` |
| KOCHU 自社ドメイン | ✅ | `https://kochu.example/...`, `https://*.kochu.example/...` |
| 既知の外部ホスト | ✅ | `KNOWN_EXTERNAL_HOSTS` 定数で管理 |
| `mailto:` / `tel:` | ✅ | `mailto:support@kochu.example` |
| 任意のサードパーティ https | ❌ | 申請ベースで `KNOWN_EXTERNAL_HOSTS` に追加 |
| `javascript:` / `data:` / `file:` / `vbscript:` | ❌ | 構築時 reject (XSS) |

### 10.3 utm パラメータ

`Href` には utm を入れない。トラッキングパラメータは **フロントの遷移直前に `analytics_id` を元に付与** する。

### 10.4 文字列描画の安全規約

- すべての user-facing 文字列は **textContent でのみ描画**
- 唯一の例外は `<L>` コンポーネント内の i18n 解決後文字列 (これも textContent 経由)
- リッチテキストが必要になった場合は、専用ブロック型 (`rich_text` 等) を新設し **限定タグの allowlist** で許容
- Solid 側の lint ルール: `props.value.text` / `props.value.key` を JSX に直接展開する記述を検出
- `generated/sdui.ts` の直接 import は eslint ルール (`no-restricted-imports`) で禁止

## 11. 計測・実験 (Analytics & Experiments)

### 11.1 二段階の粒度

- **カード単位**: `CardBlock.analytics_id` + `experiment` で impression / 全体クリックを集計
- **ブロック単位**: 各 `Block.analytics_id` で個別 CTA / badge を集計

### 11.2 イベントスキーマ

```ts
type AnalyticsEvent = {
  type: "card_impression" | "block_click";
  card: { id: string; template: TemplateName; analyticsId: string };  // 解決済み (§11.4)
  block?: { key: string; type: BlockType; analyticsId: string };       // 解決済み
  experiment?: Experiment;
  timestamp: string;
};
```

### 11.3 variant と experiment.bucket は独立

- `CardBlock.variant` = マーチャンダイジング上の見栄え
- `Experiment.bucket` = 実験基盤が割り当てる A/B バケット

両者は **直交**。バック側は次の順で決定する:

1. 商品担当が指定した `variant` を使う (なければデフォルト)
2. 実験基盤が `experiment.bucket` を割り当て、レスポンスに同梱
3. フロントは届いた `experiment` を **そのまま記録** するだけ

### 11.4 `analytics_id` 未指定時のフォールバック

`analytics_id` が optional のため、未指定時のフォールバック ID を **フロントが機械的に組み立てる**:

- カード: `analyticsId ?? card.id`
- ブロック: `block.analyticsId ?? \`${cardAnalyticsId}.${block.key}\``

これにより最小構成 (`analytics_id` 全省略) でもイベントが識別可能。`block.key` がカード内一意 (§4.3) であること、`CardBlock.id` が不変 (§4.6) であることが前提。

### 11.5 重複発火対策 (Solid)

```tsx
// src/sdui/useImpression.ts
import { createEffect } from "solid-js";
import type { CardBlock } from "./branded";

const fired = new Set<string>();   // session-wide dedup

export function useImpression(card: () => CardBlock) {
  createEffect(() => {
    const c = card();
    const id = `${c.id}:${c.experiment?.key ?? ""}:${c.experiment?.bucket ?? ""}`;
    if (fired.has(id)) return;
    fired.add(id);
    sendImpression(c);
  });
}
```

## 12. i18n

### 12.1 値は Localizable に統一

§4.1 の `Localizable` を全 user-facing テキストに使う。

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

通常の翻訳更新ではサフィックスを切らず、in-place で辞書を書き換える。サフィックスを切るのは **意味が変わる差し替え** または **コピー A/B テスト**の 2 ケースに限る。

### 12.5 `params` の使い方ルール

`params` には **動的な値 (数値、ID、ユーザー名など) のみ**を渡す。**それ自身が翻訳対象になる文字列 (UI コピー、ラベル) は params に渡さない**。

複数バリエーションがある場合は **バリエーションごとの専用キー**を切る (KOCHU の標準)。ICU `select` 構文は翻訳者が ICU を理解している前提が必要なので避ける。

### 12.6 例外: `meta_line.items[].value`

ID やショップ名は固有名詞 / 商号で **翻訳対象外** なので、Localizable ではなく `string` を直接持つ。

## 13. テスト戦略

### 13.1 フィクスチャ駆動の Storybook

`fixtures/cards/*.json` に各テンプレート × 全 variant のサンプル `CardBlock` を置き、Storybook で全パターンを描画する。

### 13.2 スキーマ契約テスト

- Rust 側で `schemars` を使い JSON Schema を出力 (`fixtures/schema/cardblock.schema.json`)
- フロント側 CI で **フィクスチャが Schema を満たすことを検証** (`ajv` 等)
- Rust 側でも `cargo test` でフィクスチャを `serde_json::from_str::<CardBlock>` できることを検証
- ts-rs 生成物の差分が無いことを CI で検証
- フィクスチャを `validate_keys()` に通し、key 重複が無いことを確認
- Storybook + `axe-core` で「同一カード内に複数 h タグが出ない」を assertion

### 13.3 縮退テスト

`fixtures/cards/broken/` に異常系を置き、縮退動作を検証:

- `unknown_template.json` / `unknown_block_type.json` / `missing_i18n_key.json`
- `invalid_href.json` — `javascript:` 等が Rust の deserialize で reject されること
- `invalid_region.json` — `hero_intro` に `meta` を入れた状態 → `deny_unknown_fields` で reject
- `duplicate_key.json` — カード内 key 重複 → `validate_keys()` で reject
- `invalid_experiment.json` — `bucket: " B "` 等が `Experiment::try_from` で reject

## 14. キャッシュ戦略 + レスポンス構造

### 14.1 `CardBlock` 単体のレスポンス

単一カードを返す API (例: `GET /api/cards/hero/main`) は、`updated_at` を **HTTP ヘッダ**で返す:

```
HTTP/1.1 200 OK
ETag: "kochu-hero-main-20260420T1230Z"
Last-Modified: Mon, 20 Apr 2026 12:30:00 GMT
Cache-Control: public, max-age=60
Content-Type: application/json

{ "id": "hero-main", "template": "hero_intro", ... }
```

`CardBlock` 自体は `updated_at` フィールドを **持たない** (UI 描画に不要なため、Non-Goals §16)。

### 14.2 カードコレクションのレスポンス

複数カードを返す API (例: `GET /api/cards/products?page=1`) は、各カードの `updated_at` をエンベロープの `meta` に集約する:

```jsonc
{
  "data": [
    { "id": "DHH-0271", "template": "product_feature", ... },
    { "id": "DHH-0341", "template": "product_feature", ... }
  ],
  "meta": {
    "items": {
      "DHH-0271": { "updatedAt": "2026-04-20T12:30:00Z" },
      "DHH-0341": { "updatedAt": "2026-04-19T08:15:00Z" }
    },
    "page": { "current": 1, "total": 12 }
  }
}
```

ETag はコレクション全体に対して 1 つ発行する。

### 14.3 キャッシュキー

- experiment が絡むレスポンスは **bucket をキャッシュキーに含める** (`/api/cards/hero?bucket=B`)
- ユーザー固有データ (パーソナライズ、ログイン状態) は **別 API に分離** して `CardBlock` には混ぜない
- experiment の bucket は `hash(session_id, experiment.key)` で決定論的に算出
- i18n 辞書は locale 単位で長期キャッシュ (1 時間〜)、辞書ファイル自体のハッシュで cache-bust

## 15. 段階導入プラン

### Phase 0: 現状認識
ヒーロー・約束カード・商品カードはハードコード。動的化の必要性が低いので保留。

### Phase 1: 商品カード `product_feature` のみ三層で型を切る
- 既に DB 駆動なので一番費用対効果が高い
- ブロック型 5-6 個から開始
- フロントは段階的に移行 (Strangler Fig)
- **`analytics_id` / `experiment` / `Localizable` / `Href` ブランド型 / `Block.key` 一意性 / `<Template>Regions` 専用 struct / `branded.ts` レイヤは最初から導入する**
- ts-rs + schemars パイプラインを Phase 1 で構築する

### Phase 2: ヒーローセクション
- 運営側からの入稿頻度を見て判断
- A/B テスト基盤 (バック側 bucket 解決) をここで本格稼働

### Phase 3: 約束カード・他セクション
- パターンが固まってきた段階で、ページ全体をブロックツリーで持つかを判断

## 16. やらないこと (Non-Goals)

- 任意の CSS/style を DB に保存しない
- 生の HTML を DB に保存しない
- 位置・座標を DB に保存しない
- 見出しレベル (h1-h6) を DB に保存しない
- 生のローカライズ済み文字列を静的コピーとして DB に保存しない
- 任意の `href` を許容しない
- utm パラメータを `Href` に焼き込まない
- `MediaFallback` の中間 a11y 状態 (`role="img"` で aria-label 無し) を許容しない
- `params` に翻訳対象文字列を入れない
- テンプレートが許容しないリージョン名のデータを通さない
- `block.key` 等を空文字 / 非一意で許容しない
- パーソナライズ / 条件出し分けを SDUI スキーマに入れない
- A/B テストのフラグ評価をフロントでしない
- 画像最適化 (srcset / picture / AVIF) を DB に持たせない
- エラー / ローディング状態を SDUI スキーマに持たせない
- TypeScript 型を手書きしない
- Solid のテキスト描画で `<L>` / `localizable()` を経由しない直接展開を許容しない
- `generated/sdui.ts` を直接 import しない (`branded.ts` 経由必須)
- **`updated_at` などの運用メタを `CardBlock` フィールドに含めない** (HTTP ヘッダ / レスポンスエンベロープで返す)
- **使う予定のない enum variant / 型を予約しない** (Future Work に書く)
- Notion レベルの自由ブロックツリーは目指さない

## 17. Future Work

- **多通貨対応** — `Currency` enum に `USD` / `EUR` を追加 (Rust enum variant 追加は後方互換)
- **ブロック単位の experiment** — 同じカード内の CTA ラベル A/B など。`Block` のタグ付き union に各バリアント `experiment?: Experiment` を追加する余地あり
- **ページレベルの構造化** — `{ page: ..., sections: [{ type, items: [{ $ref: cardId }] }] }` の二段階抽象。Phase 3 で評価
- **リッチテキストブロック** — 限定タグ allowlist 付きの `rich_text` ブロック型
- **`Localizable.value` (動的 i18n データ)** — 商品マスタが locale 別文字列を持つようになった時、第 3 バリアント追加
- **`MetaItem.value` の Localizable 化 + `NonLocalizableString` ブランド型化** — 翻訳対象外を型で表明
- **ts-rs の JSON Schema 出力対応** — 対応次第 schemars を廃止できる可能性

## 18. 参考にした設計

- Sanity CMS Portable Text — ブロック配列の考え方
- Airbnb DLS / Server-Driven UI — テンプレート + データ分離
- Shopify Polaris — クローズドな語彙統制
- Material Design Tokens — テーマトークンの限定列挙
- 新聞組版用語 (eyebrow / headline / lead / byline) — テキストロール命名
- ICU MessageFormat / FormatJS — i18n キー方式と params
- GrowthBook / Optimizely — サーバ側 A/B 解決パターン
- ts-rs / schemars — Rust source of truth からの型生成
- Solid `<For>` / `<Show>` / `createMemo` / Context — リアクティブ UI パターン
- Branded types in TypeScript (Effect-TS / fp-ts) — ts-rs 生成物上のブランド型レイヤ
