// branded.ts — ts-rs 生成物 (`generated/sdui.ts`) を branded 型で上書きする overlay。
//
// 詳細: docs/sdui-three-layer-model-v5.md §7.5
//
// アプリコードはこのファイルから import すること。
// `generated/sdui.ts` の **直接 import は禁止** (将来 lint で検出予定)。
//
// **前提**: 先に `npm run gen:sdui` を実行して
// `client_solid/src/generated/sdui.ts` を生成しておく必要がある。

import type * as G from "../generated/sdui";

// ── ブランド型 ─────────────────────────────────────────────────────────
declare const __brand: unique symbol;

export type Href = string & { readonly [__brand]: "Href" };
export type I18nKey = string & { readonly [__brand]: "I18nKey" };

// ── Localizable: i18n キーを branded I18nKey に置換 ────────────────────
export type Localizable =
  | {
      source: "i18n";
      key: I18nKey;
      params?: Record<string, string | number>;
    }
  | { source: "raw"; text: string };

// ── Block: cta.href を Href に、各 Localizable を branded 版に置換 ─────
export type Block =
  | (Extract<G.Block, { type: "text" }> & { content: Localizable })
  | (Omit<Extract<G.Block, { type: "cta" }>, "href" | "label"> & {
      href: Href;
      label: Localizable;
    })
  | (Omit<Extract<G.Block, { type: "media" }>, "alt"> & {
      alt?: Localizable;
    })
  | (Omit<Extract<G.Block, { type: "badge" }>, "label"> & {
      label: Localizable;
    })
  | (Omit<Extract<G.Block, { type: "metric_list" }>, "items"> & {
      items: Array<{
        key: string;
        label: Localizable;
        value: Localizable;
      }>;
    })
  | Extract<G.Block, { type: "meta_line" }>
  | Extract<G.Block, { type: "price" }>
  | Extract<G.Block, { type: "eclosion_forecast" }>
  | Extract<G.Block, { type: "divider" }>
  // ── Phase 7: cart 専用 block ─────────────────────────────────
  // LineItem は detailHref を Href に、title / imageAlt を branded Localizable に置換。
  // LineItemAction は token しか持たないため (string) branded 化不要 → そのまま流用。
  | (Omit<Extract<G.Block, { type: "line_item" }>, "detailHref" | "title" | "imageAlt"> & {
      detailHref: Href;
      title: Localizable;
      imageAlt?: Localizable;
    })
  // OrderSummary は branded すべき外向き値が無い (= 全て number / Currency)。
  | Extract<G.Block, { type: "order_summary" }>
  // ── Phase 8: checkout (shipping form / shipping method) 専用 block ─
  // FormField は label / placeholder / validationError を branded Localizable に置換。
  // kind が select の時は options 内の label も branded 化する (FormFieldKind 参照)。
  // patchAction (CheckoutFieldAction) は fieldName: string のみなので branded 化不要。
  | (Omit<
      Extract<G.Block, { type: "form_field" }>,
      "label" | "placeholder" | "validationError" | "kind"
    > & {
      label: Localizable;
      placeholder?: Localizable;
      validationError?: Localizable;
      kind: FormFieldKind;
    })
  // ShippingMethodPicker は options 内の name / description を branded 化する。
  // patchAction (CheckoutMethodAction) は payload を持たないので branded 化不要。
  | (Omit<Extract<G.Block, { type: "shipping_method_picker" }>, "options"> & {
      options: ShippingMethodOption[];
    });

// ── Phase 8: SelectOption (= form_field/select の選択肢 1 件) を branded 化 ─
// label を branded Localizable に置換。
export type SelectOption = Omit<G.SelectOption, "label"> & {
  label: Localizable;
};

// ── Phase 8: FormFieldKind を branded 化 (select variant の options を branded SelectOption[] に) ─
// text / tel / postal_code variant は payload を持たないので G から流用。
export type FormFieldKind =
  | Extract<G.FormFieldKind, { inputType: "text" }>
  | Extract<G.FormFieldKind, { inputType: "tel" }>
  | Extract<G.FormFieldKind, { inputType: "postal_code" }>
  | (Omit<Extract<G.FormFieldKind, { inputType: "select" }>, "options"> & {
      options: SelectOption[];
    });

// ── Phase 8: ShippingMethodOption (= shipping_method_picker の選択肢 1 件) を branded 化 ─
// name / description を branded Localizable に置換。amount / currency はそのまま。
export type ShippingMethodOption = Omit<G.ShippingMethodOption, "name" | "description"> & {
  name: Localizable;
  description: Localizable;
};

// ── Phase 8: CheckoutFieldAction / CheckoutMethodAction を re-export ─
// どちらも payload は string / 空なので branded 化不要 (G から流用)。
// FormFieldView / ShippingMethodPickerView 側から型として直接掴めるようにする。
export type CheckoutFieldAction = G.CheckoutFieldAction;
export type CheckoutMethodAction = G.CheckoutMethodAction;

// ── LineItemAction を re-export (LineItemView から型として直接掴むため) ─
// content 自体は branded 化不要 (token: string / qty: number のみ) なので G から流用。
export type LineItemAction = G.LineItemAction;

// ── Regions: 内部の Block を branded 版に置換 ─────────────────────────
//
// **設計上の不変条件**: region は「空配列はあっても undefined ではない」(§5.1)。
//   Rust 側 ProductFeatureRegions は `#[serde(default)]` で missing フィールドを
//   `Vec::new()` に倒すので、JSON で undefined / 欠落していても deserialize 後は
//   必ず `[]` になる。したがって TS 側でも `Block[]` (required) で扱う。
//
// **distributive conditional type への配慮**:
//   `R[K] extends G.Block[] | undefined ? ... : ...` のような書き方だと、
//   `R[K]` が naked type parameter として分配され、`undefined` 部分が消えない。
//   `-?` で optional modifier を外し、`NonNullable<R[K]>` で undefined を剥がして
//   から判定することで、generated 側が optional でも required な Block[] に統一する。
type ReplaceBlock<R> = {
  [K in keyof R]-?: NonNullable<R[K]> extends G.Block[] ? Block[] : R[K];
};

// ── CardBlock: regions の中の Block を branded 版に置換 ──────────────
//
// 各 template ごとに `regions` の中身は branded Block[] に差し替える。
// 新しい template を足す時はここに union メンバを追加する。
export type CardBlock =
  | (Omit<Extract<G.CardBlock, { template: "product_feature" }>, "regions"> & {
      regions: ReplaceBlock<G.ProductFeatureRegions>;
    })
  | (Omit<Extract<G.CardBlock, { template: "product_detail" }>, "regions"> & {
      regions: ReplaceBlock<G.ProductDetailRegions>;
    })
  // ── Phase 7: cart テンプレート ───────────────────────────────
  | (Omit<Extract<G.CardBlock, { template: "cart" }>, "regions"> & {
      regions: ReplaceBlock<G.CartRegions>;
    });

export type TemplateName = CardBlock["template"];

// ── FilterChipItem: href を Href に、label を Localizable に置換 ──────
//
// Phase 4 (Search / Filter SDUI)。
// `href` は **toggle 後の URL** を表す (selected → 自分を抜いた URL、
// not selected → 自分を追加した URL)。フロントは `<a href>` するだけ。
export type FilterChipItem = Omit<G.FilterChipItem, "href" | "label"> & {
  href: Href;
  label: Localizable;
};

// ── FilterGroup: label を Localizable、chips を branded FilterChipItem に置換 ─
export type FilterGroup = Omit<G.FilterGroup, "label" | "chips"> & {
  label: Localizable;
  chips: FilterChipItem[];
};

// ── FilterBar: groups を branded FilterGroup[] に置換 ────────────────
export type FilterBar = Omit<G.FilterBar, "groups"> & {
  groups: FilterGroup[];
};

// ── SortOption: href を Href、label を Localizable に置換 (Phase 5) ───
//
// 1 つの並び順候補。filter chip と似ているが、selected 切替時に
// 「自分を抜く / 自分を追加する」のではなく「自分に置き換える」のが違い。
export type SortOption = Omit<G.SortOption, "href" | "label"> & {
  href: Href;
  label: Localizable;
};

// ── SortBar: options を branded SortOption[] に置換 (Phase 5) ─────────
//
// `current` はクエリ未指定時のデフォルトを含めた現在適用中の sort key。
export type SortBar = Omit<G.SortBar, "options"> & {
  options: SortOption[];
};

// ── SearchBox: submitHref を Href、placeholder を Localizable に置換 (Phase 6) ─
//
// JS 無し fallback: `<form action={submitHref} method="get">` + input name={paramName}
// で素朴に submit すれば動く。submitHref は filter / sort を維持しつつ q を抜いた URL。
// JS 有り: input を debounce → submitHref の query を parse → q を上書きして navigate。
export type SearchBox = Omit<G.SearchBox, "submitHref" | "placeholder"> & {
  submitHref: Href;
  placeholder: Localizable;
};

// ── PageLink: page variant の href を Href に置換 (Phase 6) ──────────
//
// kind discriminator はそのまま流用。ellipsis variant にはペイロード無しなのでそのまま。
export type PageLink =
  | (Omit<Extract<G.PageLink, { kind: "page" }>, "href"> & { href: Href })
  | Extract<G.PageLink, { kind: "ellipsis" }>;

// ── Pagination: prevHref / nextHref / pages を branded 版に置換 (Phase 6) ─
//
// `prevHref` / `nextHref` は first/last page で undefined (= disabled)。
// `pages` は server 側で collapse 済み (1 / current±2 / last + ellipsis)。
export type Pagination = Omit<G.Pagination, "prevHref" | "nextHref" | "pages"> & {
  prevHref?: Href;
  nextHref?: Href;
  pages: PageLink[];
};

// ── ProductListResponse: filterBar / sortBar / searchBox / pagination / cards を branded 版に置換 ─
//
// 一覧 endpoint (`GET /api/v1/cards/products?...`) のレスポンス shell。
// `filterBar` / `sortBar` / `searchBox` / `pagination` 不在 (undefined) なら該当機能 OFF。
export type ProductListResponse = {
  filterBar?: FilterBar;
  sortBar?: SortBar;
  searchBox?: SearchBox;
  pagination?: Pagination;
  cards: CardBlock[];
};

// ── 共通 enum を re-export (アプリコードから参照しやすく) ───────────
export type {
  BadgeRole,
  CtaIntent,
  Currency,
  Experiment,
  MediaKind,
  MetaLineItemRole,
  RegionName,
  TextRole,
} from "../generated/sdui";

// ── 構築ヘルパ (テスト・フィクスチャ用) ─────────────────────────────
export const asHref = (s: string): Href => s as Href;
export const asI18nKey = (s: string): I18nKey => s as I18nKey;
