// SDUI ビュー型定義(api/src/sdui と 1:1、adjacently-tagged)
//
// ⚠ 暫定の手書き。typeshare 導入後は生成物に置き換える(docs/PLAN.md チェックリスト)。
//
// クライアントは「寛容な読み手」であること(進化規約):
// - 未知の block type / template → fallback 表示(renderer の default 分岐)
// - 未知の enum 値(CardSize / tone 等)→ 既定値扱い
// - 未知のフィールド → 無視

export type TextRole = "headline" | "lead" | "body" | "caption";
export type CtaIntent = "primary" | "secondary";
export type CardSize = "full" | "half";
export type Currency = "JPY";

export interface ListingItem {
  listingId: string;
  title: string;
  scientificName?: string;
  priceAmount: number;
  currency: Currency;
  imageSrc?: string;
  href: string;
}

export interface SpecimenItem {
  specimenId: string;
  code: string;
  name: string;
  hint?: string;
  alert: boolean;
}

/** ユーザ定義グループ(タブ1枚)。ラベルはドメインデータ(虫かご等、自由作成) */
export interface SpecimenGroup {
  groupId: string;
  label: string;
  count: number;
  items: SpecimenItem[];
}

export interface CareLogEntry {
  logId: string;
  at: string; // "MM/DD"
  kind: string;
  body: string;
}

export interface SpecimenProfileContent {
  key: string;
  specimenId: string;
  code: string;
  name: string;
  speciesName: string;
  scientificName?: string;
  sex?: string;
  groupId: string;
  groupLabel: string;
  line?: string;
  measure?: string;
  eggDate?: string; // "YYYY/MM/DD"
  nextAction?: string;
}

export interface ListingHeroContent {
  key: string;
  listingId: string;
  title: string;
  scientificName?: string;
  priceAmount: number;
  currency: Currency;
  status: string;
  sellerComment?: string;
  imageSrc?: string;
}

/** ラベル+値の1属性(項目構成はサーバが決める) */
export interface SpecAttr {
  label: string;
  value: string;
}

export interface ListingSettingsContent {
  key: string;
  specimenId: string;
  /** 個体情報から自動生成したタイトル案(フォーム初期値) */
  suggestedTitle: string;
  /** 未出品なら undefined */
  listing?: ListingState;
}

export interface ListingState {
  listingId: string;
  title: string;
  priceAmount: number;
  currency: Currency;
  status: string;
  sellerComment?: string;
}

/** adjacently-tagged: `{ "type": ..., "content": ... }` */
export type ViewBlock =
  | { type: "text"; content: { key: string; role: TextRole; text: string; editable?: boolean } }
  | { type: "markdown"; content: { key: string; markdown: string; editable?: boolean } }
  | { type: "media"; content: { key: string; src: string; alt: string } }
  | { type: "cta"; content: { key: string; intent: CtaIntent; label: string; href: string } }
  | { type: "listing_grid"; content: { key: string; items: ListingItem[] } }
  | { type: "specimen_list"; content: { key: string; groups: SpecimenGroup[] } }
  | { type: "specimen_profile"; content: SpecimenProfileContent }
  | { type: "care_log_list"; content: { key: string; specimenId: string; entries: CareLogEntry[] } }
  | { type: "species_note"; content: { key: string; speciesName: string; note: string } }
  | { type: "listing_hero"; content: ListingHeroContent }
  | { type: "listing_spec"; content: { key: string; attrs: SpecAttr[] } }
  | { type: "listing_settings"; content: ListingSettingsContent };

/** 構造層のカード。「画面はカードの組み合わせでできている」の実体 */
export interface Card {
  key: string;
  size: CardSize;
  /** 色調トークン。未知値・未指定は default 扱い(進化規約4) */
  tone?: "default" | "accent";
  blocks: ViewBlock[];
}

export interface FeedRegions {
  header: Card[];
  body: Card[];
  footer: Card[];
}

export type Page = { template: "feed"; content: { regions: FeedRegions } };

export interface PageView {
  schemaVersion: number;
  page: Page;
}

// ── 定義側(編集UI用の最小型。閉じた検証はサーバが持つのでここは緩くてよい)──

export type DefBlockAny = { type: string; content: Record<string, unknown> & { key: string } };

export interface DefCard {
  key: string;
  size?: string;
  tone?: string;
  blocks: DefBlockAny[];
}

export interface DefinitionDoc {
  schemaVersion: number;
  page: { template: string; content: { regions: Record<string, DefCard[]> } };
}
