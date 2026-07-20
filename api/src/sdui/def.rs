//! 定義側スキーマ — DB(page_definitions.definition)に保存され、エージェントが書く語彙。
//!
//! - データバインドは「クエリ」(`ListingQuery`)であって「データ」ではない。
//!   価格・商品情報はこの語彙に存在しない = エージェントは商品データを書けない
//! - fieldless enum は素の文字列 enum としてのみ使う(タグ付きunionに混ぜない)
//! - `Card` は構造層: Region は Card の列を持ち、Card は Block の列を持つ。
//!   Card は Card を含めない(型レベルで再帰禁止)

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::brand::{BlockKey, SitePath};

// ──────────────────────────────────────────────────────────────
// 語彙 enum(文字列 enum)
// ──────────────────────────────────────────────────────────────

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TextRole {
    Headline,
    Lead,
    Body,
    Caption,
}

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CtaIntent {
    Primary,
    Secondary,
}

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ListingSort {
    Newest,
    PriceAsc,
    PriceDesc,
}

/// カードのサイズ(セマンティックトークン)。px・CSS値は決して入れない。
/// クライアントは未知の値を `Full` として扱う(進化規約4)。
#[typeshare]
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CardSize {
    #[default]
    Full,
    Half,
}

/// カードの色調(セマンティックトークン)。`accent` は反転(深緑)カード。
/// 未指定/未知値はクライアントで default 扱い(進化規約1・4に沿った additive 追加)。
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CardTone {
    Default,
    Accent,
}

/// カード内レイアウト(セマンティックトークン)。CSS値は決して入れない(原則4)。
/// `sidebar` = カード内の最初の「側柱対応ブロック」(現状 group_tabs)を側柱に、
/// それより前のブロックを全幅の前置行、残りを本体として横並びに描く。
/// 対応ブロックが無い場合・未指定・未知値はクライアントで `stack`(縦積み)扱い(進化規約4)。
/// 汎用Box再帰コンテナは導入しない(docs/REFACTOR.md §3 案ロの不採用)。
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CardLayout {
    Stack,
    Sidebar,
}

/// 出品者の絞り込み(additive)。`mine` = ログインユーザの出品のみ(未ログインは401)。
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ListingSeller {
    Mine,
}

/// UIアクションの閉じた動詞(action_button 用)。
/// 押下時の振る舞いはクライアント固定実装(actions provider)が持ち、定義側は
/// 「どの動詞を起動するか」だけを選ぶ(docs/REFACTOR.md §2: 構成は定義、振る舞いは閉じた語彙)。
/// 対象IDは持たせない(定義は全ユーザ共有物。IDはコンテキスト = URL/ログインユーザから解決)。
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UiAction {
    AddSpecimen,
    /// カードビルダーを開く(care ページの actions provider が実装)
    AddCard,
}

// ──────────────────────────────────────────────────────────────
// Block(定義側)
// ──────────────────────────────────────────────────────────────

/// 出品フィードへのデータバインド。ID直指定ではなくクエリにすることで
/// 参照整合性の問題を構造的に回避する。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListingQuery {
    pub sort: ListingSort,
    /// 1..=24(意味検証 L2 で強制)
    pub limit: u8,
    /// 未指定 = 市場全体(取り下げ済みは常に除外)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seller: Option<ListingSeller>,
}

/// 定義側ブロック。adjacently-tagged: `{ "type": "text", "content": { ... } }`
///
/// 全 variant は構造体 variant(ユニット variant 禁止 — serde #2294)。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(
    tag = "type",
    content = "content",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DefBlock {
    Text {
        key: BlockKey,
        role: TextRole,
        text: String,
        /// 人間向けの編集UI(定義書込)をこのブロックに出すか。
        /// UIアフォーダンスの宣言であり、認可(誰がPUTできるか)ではない。
        /// default false・falseは出力に乗せない(additive変更 = 進化規約1)。
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        editable: bool,
    },
    /// Markdown 文章(複数段落・リスト・リンク等のリッチ文章)。
    /// - 原文のままビューへ配信し、描画・サニタイズは各クライアントが行う
    ///   (Webは marked + DOMPurify、モバイルはネイティブレンダラを想定)
    /// - 文中見出しは h3 以下として描画する規約(カード見出しは text.role=headline の専権
    ///   = headline≦1/card の a11y 不変条件を保つ)
    /// - 長さは L2 検証で上限あり(MAX_MARKDOWN_CHARS)
    Markdown {
        key: BlockKey,
        markdown: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        editable: bool,
    },
    Media {
        key: BlockKey,
        src: SitePath,
        alt: String,
    },
    Cta {
        key: BlockKey,
        intent: CtaIntent,
        label: String,
        href: SitePath,
    },
    /// 押下でクライアント固定実装の動詞を起動するボタン。
    /// 存在・位置・文言(構成)は定義が持ち、振る舞いは `UiAction` の閉じた動詞から選ぶ。
    /// 対応する actions provider が無いページに置かれた場合、クライアントは無効表示にする。
    ActionButton {
        key: BlockKey,
        intent: CtaIntent,
        label: String,
        action: UiAction,
    },
    ListingGrid {
        key: BlockKey,
        query: ListingQuery,
        /// 空状態(該当0件)の表示文言。未指定はクライアント既定文言(additive・進化規約1)。
        /// プレーンテキストのみ(式・補間は §5 のとおり導入しない)。長さは L2 で上限あり。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    // ── 飼育管理ドメインのデータバインド(いずれもパラメータなし) ──
    // エージェントが操作できるのは「どのカードに置くか / 並び順」だけ。
    /// 全個体のグループ別一覧(タブUI)。
    /// 【非推奨 / Phase 2 で分割済み】新しい定義は `group_tabs` + `specimen_rows` を使うこと。
    /// 既存定義の後方互換のためにのみ残す(語彙からの削除は schemaVersion++ の破壊的変更で行う)。
    SpecimenList { key: BlockKey },
    /// グループタブ帯(タブ+件数のみ)。選択タブはページコンテキスト
    /// (`?group=` → HydrateCtx.group)であり、定義にもブロックにも持たせない
    /// = ブロック同士を直接結合させない(REFACTOR §Phase2)。
    /// タブの追加/改名/削除のインラインフォームはクライアント固定コード(§2 の線引き)。
    GroupTabs { key: BlockKey },
    /// 選択グループ(ctx.group、未指定/無効はサーバが既定選択)の個体行リスト。
    /// 行直下の詳細展開はクライアント(`?open=` + renderSpecimenDetail 注入)。
    SpecimenRows {
        key: BlockKey,
        /// 空状態の表示文言(未指定はクライアント既定)。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    /// コンテキスト個体のプロフィール。specimen コンテキスト必須。
    SpecimenProfile { key: BlockKey },
    /// コンテキスト個体の飼育記録(新しい順)。specimen コンテキスト必須。
    CareLogList {
        key: BlockKey,
        /// 空状態の表示文言(未指定はクライアント既定)。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    /// コンテキスト個体の種に紐づく飼育メモ。specimen コンテキスト必須。
    SpeciesNote { key: BlockKey },
    // ── 出品詳細のデータバインド ──
    /// コンテキスト出品のヒーロー(写真・価格・状態・出品者コメント)。listing コンテキスト必須。
    ListingHero { key: BlockKey },
    /// コンテキスト出品の個体スペック(チップ列)。listing コンテキスト必須。
    ListingSpec {
        key: BlockKey,
        /// 空状態の表示文言(未指定はクライアント既定)。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    /// コンテキスト個体の出品設定(未出品/出品中の状態と操作)。specimen コンテキスト必須。
    ListingSettings { key: BlockKey },
    // ── ユーザウィジェット(カードビルダーで配置できる個人データバインド)──
    /// 個人TODOリスト。中身はユーザ毎のドメインデータ(user_todos)。
    /// 追加/チェック/削除のフォームはクライアント固定コード(REFACTOR §2 の線引き)。
    TodoList {
        key: BlockKey,
        /// 空状態の表示文言(未指定はクライアント既定)。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    /// アプリ内通知: 飼育データ由来の警告リスト+しきい値設定。
    /// 設定値(有効/日数)は定義ではなくユーザ毎のドメインデータ(notification_prefs)。
    /// 外部チャネル(メール等)は将来の拡張(docs/CARD_BUILDER.md §4.2)。
    CareAlerts {
        key: BlockKey,
        /// 警告0件時の表示文言(未指定はクライアント既定)。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
}

impl DefBlock {
    pub fn key(&self) -> &BlockKey {
        match self {
            DefBlock::Text { key, .. }
            | DefBlock::Media { key, .. }
            | DefBlock::Cta { key, .. }
            | DefBlock::ActionButton { key, .. }
            | DefBlock::Markdown { key, .. }
            | DefBlock::ListingGrid { key, .. }
            | DefBlock::SpecimenList { key }
            | DefBlock::GroupTabs { key }
            | DefBlock::SpecimenRows { key, .. }
            | DefBlock::SpecimenProfile { key }
            | DefBlock::CareLogList { key, .. }
            | DefBlock::SpeciesNote { key }
            | DefBlock::ListingHero { key }
            | DefBlock::ListingSpec { key, .. }
            | DefBlock::ListingSettings { key }
            | DefBlock::TodoList { key, .. }
            | DefBlock::CareAlerts { key, .. } => key,
        }
    }
}

// ──────────────────────────────────────────────────────────────
// Card / Region / Page / PageDefinition
// ──────────────────────────────────────────────────────────────

/// 構造層のカード。「画面はカードの組み合わせでできている」の実体。
/// Def / View で共用するためブロック型 `B` をジェネリクスにする。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Card<B> {
    pub key: BlockKey,
    #[serde(default)]
    pub size: CardSize,
    /// 色調。None = default(additive フィールドのため Option で保持)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tone: Option<CardTone>,
    /// カード内レイアウト。None = stack(additive フィールドのため Option で保持)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<CardLayout>,
    pub blocks: Vec<B>,
}

/// `feed` テンプレートの許容リージョン(固定フィールド = 閉じたリージョン語彙)。
///
/// 3リージョンとも必須(空でも `[]` を明示する)。
/// `#[serde(default)]` を使わない理由: ジェネリクス入りフィールドに付けると
/// serde derive が `B: Default` 境界を推論してコンパイルエラーになるため。
/// 定義を書く側(エージェント)にとっても「全リージョンを必ず書く」方が明確。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FeedRegions<B> {
    pub header: Vec<Card<B>>,
    pub body: Vec<Card<B>>,
    pub footer: Vec<Card<B>>,
}

impl<B> Default for FeedRegions<B> {
    fn default() -> Self {
        Self {
            header: Vec::new(),
            body: Vec::new(),
            footer: Vec::new(),
        }
    }
}

/// 画面テンプレート。adjacently-tagged: `{ "template": "feed", "content": { ... } }`
/// テンプレート追加はここへの variant 追加(+ Regions struct 追加)で行う。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(
    tag = "template",
    content = "content",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Page<B> {
    Feed { regions: FeedRegions<B> },
}

/// DBに保存される全体(= エージェントが PUT する単位 = 画面1枚)。
/// メタデータ(updated_at 等)は JSONB ではなく DB カラムに置く。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PageDefinition {
    /// 定義はコードより長生きする。破壊的変更時のみインクリメント(進化規約3)。
    pub schema_version: u32,
    pub page: Page<DefBlock>,
}
