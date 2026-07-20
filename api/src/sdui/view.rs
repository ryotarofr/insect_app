//! ビュー側スキーマ — `GET /api/pages/{key}` が返す形。サーバ(hydrate)だけが作る。
//!
//! 定義側との差分はデータバインドブロックのみ(query/宣言 → 解決済みデータ)。
//! クライアントは読み取りに寛容であること(未知 type は fallback、未知フィールドは無視)。
//! JsonSchema は導出しない(LLM が対象にするのは定義側スキーマのみ)。

use serde::{Deserialize, Serialize};
use typeshare::typeshare;
use uuid::Uuid;

use super::brand::{BlockKey, SitePath};
use super::def::{CtaIntent, Page, TextRole, UiAction};

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Currency {
    Jpy,
}

/// hydrate 済みの出品1件。エージェントはこの型を書けない(定義側語彙に存在しない)。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListingItem {
    #[typeshare(serialized_as = "String")]
    pub listing_id: Uuid,
    pub title: String,
    /// 学名(イタリック表示用)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scientific_name: Option<String>,
    /// 税込・円。JPY のみの間は i64 で十分
    pub price_amount: i64,
    pub currency: Currency,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_src: Option<SitePath>,
    pub href: SitePath,
}

/// 一覧の1行(飼育一覧タブ内)。hint はサーバ生成(次のアクション>出品中>最新記録)。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpecimenItem {
    #[typeshare(serialized_as = "String")]
    pub specimen_id: Uuid,
    pub code: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    pub alert: bool,
}

/// ユーザ定義グループ1つぶん(タブ1枚)。ラベルはドメインデータ(虫かご等、自由作成)。
/// 空グループも count=0 で必ず返す(タブUIの前提)。
/// 【非推奨】specimen_list(旧ブロック)専用。分割後は GroupTabItem / SpecimenItem を使う。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpecimenGroup {
    #[typeshare(serialized_as = "String")]
    pub group_id: Uuid,
    pub label: String,
    pub count: u32,
    pub items: Vec<SpecimenItem>,
}

/// タブ1枚ぶん(グループ+件数のみ)。行は specimen_rows が選択グループ分だけ持つ。
/// 空グループも count=0 で必ず返す(タブUIの前提)。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GroupTabItem {
    #[typeshare(serialized_as = "String")]
    pub group_id: Uuid,
    pub label: String,
    pub count: u32,
}

/// ラベル+値の1属性(出品スペック等)。項目構成はサーバが決める。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpecAttr {
    pub label: String,
    pub value: String,
}

/// 飼育記録1件。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CareLogEntry {
    #[typeshare(serialized_as = "String")]
    pub log_id: Uuid,
    /// 表示用 "MM/DD"
    pub at: String,
    pub kind: String,
    pub body: String,
}

/// 出品中の状態(listing_settings 用)。サーバだけが作る。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListingState {
    #[typeshare(serialized_as = "String")]
    pub listing_id: Uuid,
    pub title: String,
    pub price_amount: i64,
    pub currency: Currency,
    /// 表示ラベル(出品中/取引中 等)
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seller_comment: Option<String>,
}

/// ビュー側ブロック。定義側と同じ adjacently-tagged。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    content = "content",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ViewBlock {
    Text {
        key: BlockKey,
        role: TextRole,
        text: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        editable: bool,
    },
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
    /// 定義からのパススルー(hydrate で解決するデータは無い)。
    ActionButton {
        key: BlockKey,
        intent: CtaIntent,
        label: String,
        action: UiAction,
    },
    ListingGrid {
        key: BlockKey,
        items: Vec<ListingItem>,
        /// 空状態の表示文言(定義からのパススルー。未指定はクライアント既定)
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    SpecimenList {
        key: BlockKey,
        groups: Vec<SpecimenGroup>,
    },
    /// グループタブ帯(specimen_list の分割後継・タブのみ)。
    GroupTabs {
        key: BlockKey,
        /// サーバが解決した選択グループ(?group= が無効/未指定なら既定選択。
        /// タブが1つも無い場合のみ None)
        #[typeshare(serialized_as = "Option<String>")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        active_group_id: Option<Uuid>,
        groups: Vec<GroupTabItem>,
    },
    /// 選択グループの個体行(specimen_list の分割後継・行のみ)。
    SpecimenRows {
        key: BlockKey,
        /// 解決に使ったグループ(group_tabs と同じ規則で解決するため表示は一致する)
        #[typeshare(serialized_as = "Option<String>")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        group_id: Option<Uuid>,
        items: Vec<SpecimenItem>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    SpecimenProfile {
        key: BlockKey,
        #[typeshare(serialized_as = "String")]
        specimen_id: Uuid,
        code: String,
        name: String,
        species_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scientific_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sex: Option<String>,
        /// 所属グループ(ユーザ定義)
        #[typeshare(serialized_as = "String")]
        group_id: Uuid,
        group_label: String,
        /// 累代 (例: "CB F2")
        #[serde(default, skip_serializing_if = "Option::is_none")]
        line: Option<String>,
        /// 最終計測 (例: "98g(3令時)")
        #[serde(default, skip_serializing_if = "Option::is_none")]
        measure: Option<String>,
        /// 表示用 "YYYY/MM/DD"
        #[serde(default, skip_serializing_if = "Option::is_none")]
        egg_date: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        next_action: Option<String>,
    },
    CareLogList {
        key: BlockKey,
        #[typeshare(serialized_as = "String")]
        specimen_id: Uuid,
        entries: Vec<CareLogEntry>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    SpeciesNote {
        key: BlockKey,
        species_name: String,
        note: String,
    },
    ListingHero {
        key: BlockKey,
        #[typeshare(serialized_as = "String")]
        listing_id: Uuid,
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scientific_name: Option<String>,
        price_amount: i64,
        currency: Currency,
        /// 表示ラベル(出品中/取引中/売却済 等)。サーバが決める
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        seller_comment: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        image_src: Option<SitePath>,
    },
    ListingSpec {
        key: BlockKey,
        attrs: Vec<SpecAttr>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    /// コンテキスト個体の出品状態。listing が None なら未出品。
    ListingSettings {
        key: BlockKey,
        #[typeshare(serialized_as = "String")]
        specimen_id: Uuid,
        /// 個体情報から自動生成したタイトル案(フォーム初期値)
        suggested_title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        listing: Option<ListingState>,
    },
    /// 個人TODO(未完了 → 完了の順)。
    TodoList {
        key: BlockKey,
        items: Vec<TodoItem>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
    /// アプリ内通知。enabled=false のとき items は常に空。
    CareAlerts {
        key: BlockKey,
        enabled: bool,
        stale_days: u32,
        items: Vec<AlertItem>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        empty_text: Option<String>,
    },
}

/// 個人TODO 1件(todo_list 用)。サーバだけが作る。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TodoItem {
    #[typeshare(serialized_as = "String")]
    pub todo_id: Uuid,
    pub body: String,
    pub done: bool,
}

/// アプリ内通知の警告1件(care_alerts 用)。reason はサーバ生成の理由ラベル。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AlertItem {
    #[typeshare(serialized_as = "String")]
    pub specimen_id: Uuid,
    /// 行クリックでタブ切替+展開するためのグループ
    #[typeshare(serialized_as = "String")]
    pub group_id: Uuid,
    pub code: String,
    pub name: String,
    /// 例: 「要注意フラグ」「最終記録から9日」
    pub reason: String,
}

/// `GET /api/pages/{key}` のレスポンス全体。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PageView {
    pub schema_version: u32,
    pub page: Page<ViewBlock>,
}
