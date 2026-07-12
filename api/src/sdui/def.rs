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

/// 出品者の絞り込み(additive)。`mine` = ログインユーザの出品のみ(未ログインは401)。
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ListingSeller {
    Mine,
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
    ListingGrid {
        key: BlockKey,
        query: ListingQuery,
    },
    // ── 飼育管理ドメインのデータバインド(いずれもパラメータなし) ──
    // エージェントが操作できるのは「どのカードに置くか / 並び順」だけ。
    /// 全個体のグループ別一覧(タブUI)。
    SpecimenList {
        key: BlockKey,
    },
    /// コンテキスト個体のプロフィール。specimen コンテキスト必須。
    SpecimenProfile {
        key: BlockKey,
    },
    /// コンテキスト個体の飼育記録(新しい順)。specimen コンテキスト必須。
    CareLogList {
        key: BlockKey,
    },
    /// コンテキスト個体の種に紐づく飼育メモ。specimen コンテキスト必須。
    SpeciesNote {
        key: BlockKey,
    },
    // ── 出品詳細のデータバインド ──
    /// コンテキスト出品のヒーロー(写真・価格・状態・出品者コメント)。listing コンテキスト必須。
    ListingHero {
        key: BlockKey,
    },
    /// コンテキスト出品の個体スペック(チップ列)。listing コンテキスト必須。
    ListingSpec {
        key: BlockKey,
    },
    /// コンテキスト個体の出品設定(未出品/出品中の状態と操作)。specimen コンテキスト必須。
    ListingSettings {
        key: BlockKey,
    },
}

impl DefBlock {
    pub fn key(&self) -> &BlockKey {
        match self {
            DefBlock::Text { key, .. }
            | DefBlock::Media { key, .. }
            | DefBlock::Cta { key, .. }
            | DefBlock::Markdown { key, .. }
            | DefBlock::ListingGrid { key, .. }
            | DefBlock::SpecimenList { key }
            | DefBlock::SpecimenProfile { key }
            | DefBlock::CareLogList { key }
            | DefBlock::SpeciesNote { key }
            | DefBlock::ListingHero { key }
            | DefBlock::ListingSpec { key }
            | DefBlock::ListingSettings { key } => key,
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
