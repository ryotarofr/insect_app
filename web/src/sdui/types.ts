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

/**
 * ユーザ定義グループ(タブ1枚)。ラベルはドメインデータ(虫かご等、自由作成)。
 * 【非推奨】specimen_list(旧ブロック)専用。分割後は GroupTabItem / SpecimenItem を使う。
 */
export interface SpecimenGroup {
  groupId: string;
  label: string;
  count: number;
  items: SpecimenItem[];
}

/** タブ1枚ぶん(グループ+件数のみ)。行は specimen_rows が選択グループ分だけ持つ */
export interface GroupTabItem {
  groupId: string;
  label: string;
  count: number;
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

/** 個人TODO 1件(todo_list 用) */
export interface TodoItem {
  todoId: string;
  body: string;
  done: boolean;
}

/** アプリ内通知の警告1件(care_alerts 用)。reason はサーバ生成の理由ラベル */
export interface AlertItem {
  specimenId: string;
  /** 行クリックでタブ切替+展開するためのグループ */
  groupId: string;
  code: string;
  name: string;
  reason: string;
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
  // action はサーバ側では閉じた動詞 enum。寛容な読み手として string で受け、
  // 未知動詞は actions provider 側で no-op にする(進化規約4の精神)
  | { type: "action_button"; content: { key: string; intent: CtaIntent; label: string; action: string } }
  | { type: "listing_grid"; content: { key: string; items: ListingItem[]; emptyText?: string } }
  | { type: "specimen_list"; content: { key: string; groups: SpecimenGroup[] } }
  // specimen_list の分割後継(Phase 2)。選択タブは ?group= = ページコンテキスト
  | { type: "group_tabs"; content: { key: string; activeGroupId?: string; groups: GroupTabItem[] } }
  | {
      type: "specimen_rows";
      content: { key: string; groupId?: string; items: SpecimenItem[]; emptyText?: string };
    }
  | { type: "specimen_profile"; content: SpecimenProfileContent }
  | {
      type: "care_log_list";
      content: { key: string; specimenId: string; entries: CareLogEntry[]; emptyText?: string };
    }
  | { type: "species_note"; content: { key: string; speciesName: string; note: string } }
  | { type: "listing_hero"; content: ListingHeroContent }
  | { type: "listing_spec"; content: { key: string; attrs: SpecAttr[]; emptyText?: string } }
  | { type: "listing_settings"; content: ListingSettingsContent }
  // ユーザウィジェット(配置は定義、中身と設定はユーザ毎のドメインデータ)
  | { type: "todo_list"; content: { key: string; items: TodoItem[]; emptyText?: string } }
  | {
      type: "care_alerts";
      content: {
        key: string;
        enabled: boolean;
        staleDays: number;
        items: AlertItem[];
        emptyText?: string;
      };
    };

/** 構造層のカード。「画面はカードの組み合わせでできている」の実体 */
export interface Card {
  key: string;
  size: CardSize;
  /** 色調トークン。未知値・未指定は default 扱い(進化規約4) */
  tone?: "default" | "accent";
  /** カード内レイアウトトークン。未知値・未指定は stack(縦積み)扱い(進化規約4) */
  layout?: string;
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
