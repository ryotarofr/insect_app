//! ブロック（最小単位の意味的部品）と、テンプレートで判別される `CardBlock`。
//!
//! 詳細は `docs/sdui-three-layer-model-v6.md` §4 / §5 / §7 参照。
//!
//! Phase 1 では `CardBlock::ProductFeature` のみ実装。
//! ブロック型 (`Block`) は将来のテンプレートでも共通利用するため全種類を定義する。

use chrono::NaiveDate;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use super::experiment::Experiment;
use super::regions::{CartRegions, ProductDetailRegions, ProductFeatureRegions};

// ──────────────────────────────────────────────────────────────────────
// 共通 enum (RegionName / TextRole / CtaIntent / MediaKind / BadgeRole / MetaLineItemRole)
// ──────────────────────────────────────────────────────────────────────

/// リージョン名。テンプレートが許容する集合は `<Template>Regions` 側で表現する。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RegionName {
    Header,
    Media,
    Meta,
    Headline,
    Body,
    Actions,
    Footer,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TextRole {
    Eyebrow,
    Headline,
    Subhead,
    Lead,
    Body,
    Caption,
    Byline,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CtaIntent {
    Primary,
    Secondary,
    Tertiary,
    Destructive,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MediaKind {
    Image,
    Video,
    Icon,
    Placeholder,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BadgeRole {
    Status,
    Evidence,
    Warning,
    Promo,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MetaLineItemRole {
    Id,
    Shop,
    Code,
    Lot,
    Breeder,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MetaItemAlign {
    Start,
    End,
}

// ──────────────────────────────────────────────────────────────────────
// Currency: Phase 1 は JPY のみ (§17 で多通貨対応を予約)
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[ts(export)]
pub enum Currency {
    JPY,
}

// ──────────────────────────────────────────────────────────────────────
// ブランド型: Href / I18nKey
// ──────────────────────────────────────────────────────────────────────

/// ハイパーリンクの URL / パス。許容スキーマ・ホストのルールは §10.2。
///
/// `serde(transparent)` により JSON では普通の文字列として表現される。
/// フロント側では `branded.ts` レイヤで branded 型に持ち上げる (§7.5)。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq, Hash)]
#[serde(transparent)]
#[ts(export, type = "string")]
pub struct Href(String);

#[derive(Debug, Error)]
pub enum HrefError {
    #[error("disallowed scheme or host: {0}")]
    Disallowed(String),
}

impl Href {
    /// Phase 1 簡易版: 内部パス (`/...`) と https のみ許容。
    /// 詳細ルール (utm 禁止 / トラッキングパラメータ排除 等) は §10.2 で別途実装予定。
    pub fn parse(raw: &str) -> Result<Self, HrefError> {
        if raw.is_empty() {
            return Err(HrefError::Disallowed(raw.to_string()));
        }
        if raw.starts_with('/') || raw.starts_with("https://") {
            Ok(Self(raw.to_string()))
        } else {
            Err(HrefError::Disallowed(raw.to_string()))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// i18n キー。`<scope>.<key>` のドット区切り。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq, Hash)]
#[serde(transparent)]
#[ts(export, type = "string")]
pub struct I18nKey(String);

impl I18nKey {
    pub fn new(raw: impl Into<String>) -> Self {
        // Phase 1 ではフォーマット検証は行わない（§12.4 で別途）。
        Self(raw.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

// ──────────────────────────────────────────────────────────────────────
// Localizable: i18n と raw を型レベルで分離
// ──────────────────────────────────────────────────────────────────────

/// 翻訳対象テキスト (`i18n`) と動的生成テキスト (`raw`) の両方を許容する union。
///
/// - `i18n`: フロントで辞書を引いて描画する想定。`params` で補完文字列を渡す
/// - `raw` : サーバ側で組み立て済みの最終文字列。商品名・人名など翻訳しない値
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(tag = "source", rename_all = "snake_case")]
#[ts(export)]
pub enum Localizable {
    I18n {
        key: I18nKey,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        params: Option<std::collections::BTreeMap<String, ParamValue>>,
    },
    Raw {
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(untagged)]
#[ts(export)]
pub enum ParamValue {
    Str(String),
    Int(i64),
}

// ──────────────────────────────────────────────────────────────────────
// MetricItem / MetaItem
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct MetricItem {
    pub key: String,
    pub label: Localizable,
    pub value: Localizable,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct MetaItem {
    pub key: String,
    pub role: MetaLineItemRole,
    /// §12.6 の例外: `value` は `Localizable` ではなく素の文字列。
    /// 商品 ID / 店舗名 / SKU など、翻訳対象でないラベル用。
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub align: Option<MetaItemAlign>,
}

// ──────────────────────────────────────────────────────────────────────
// CtaAction: CTA をクリックした時のサーバ反映アクション (Phase 2.5)
//
// 既存の `Block::Cta.href` だけでは「ページ遷移」しか表現できなかったため、
// 「ページ遷移はせずサーバ状態を更新したい」(カート追加 / ウォッチ切替) を
// SDUI 契約に乗せる。クライアントは:
//   - `action` が None       → href へ通常の <a> リンク (既存挙動)
//   - `action` が Some(...)  → <button> としてレンダ + アクション実行 + Toast
// ……と分岐する。
//
// **`action` が Some の時も `href` は必須**:
//   JS が無効な環境でも CTA がリンクとして機能する progressive enhancement。
//   例: AddToCart の href は `/cart?add=...` を指し続ける (= no-JS フォールバック)。
//
// **enum を `tag = "type"` で discriminate する理由**:
//   フロントの TS 側で `if (action.type === "add_to_cart")` で素直に narrow できる。
//   serde の rename_all = "snake_case" で JSON では `add_to_cart` / `toggle_watch`。
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum CtaAction {
    /// 商品をカートに追加。`/api/v1/cart` に POST する想定。
    /// `qty` は MVP では常に 1 で送られるが、将来 +/- ピッカーから渡せるよう外に出す。
    AddToCart { product_id: String, qty: u32 },
    /// ウォッチリストへの追加 / 削除トグル。`/api/v1/watch/:productId` に POST する想定。
    ToggleWatch { product_id: String },
    /// Stripe Checkout を開始 (Phase 9.1)。
    /// `/api/v1/checkout/submit` に POST し、レスポンスの `sessionUrl` に redirect する。
    /// payload-less (= server 側 cart_store + checkout_store の snapshot を使う)。
    /// `STRIPE_PROVIDER=mock` の時は `/checkout/mock/{order_id}` を返す。
    StripeCheckout,
}

// ──────────────────────────────────────────────────────────────────────
// LineItemAction: cart 内 LineItem の +/- / 削除 (Phase 7)
//
// CtaAction と同じ tag = "type" 方式で discriminate。クライアント側 LineItemView は:
//   - SetQty       → POST /api/v1/cart/items/{token}/qty?qty=<n>
//                    (もしくは PATCH /api/v1/cart/items/{token} body { qty })。
//                    成功後はカードを再 fetch (= server-driven 状態を信用)。
//   - Remove       → DELETE /api/v1/cart/items/{token}。
//                    成功後はカードを再 fetch。
// と挙動を分岐する。
//
// **LineItemAction を CtaAction に混ぜない理由**:
//   CtaAction は「Cta block が起こすサーバ反映」、LineItemAction は「LineItem block 内の
//   +/- ボタンが起こすサーバ反映」で、対象 (token vs product_id) も意味も違う。
//   分けて持つと、TS narrow が type で絞り込みやすく、Cta renderer と
//   LineItem renderer が互いの action を知らずに済む。
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum LineItemAction {
    /// このトークンが指す cart line の qty を `qty` に置き換える。
    /// `qty = 0` を投げるなら Remove を使う (= UI 側で自然に分岐できる)。
    SetQty {
        token: String,
        #[ts(type = "number")]
        qty: u32,
    },
    /// このトークンが指す cart line を完全に削除。
    Remove { token: String },
}

// ──────────────────────────────────────────────────────────────────────
// CheckoutFieldAction / CheckoutMethodAction: チェックアウトの配送先 / 配送方法 (Phase 8)
//
// **設計方針**:
//   - Cart は `LineItemAction` (token + qty/remove) で server 側 cart_store を更新する。
//     Phase 8 で同じ思想を「配送先フォーム」「配送方法ピッカー」に持ち込む:
//     入力 (debounce) / radio 切替 → server に PATCH → server がカード再 build → client
//     が再 fetch して画面に反映。client 側にフォーム state を握らせない (= server-driven)。
//   - フィールド名 (name = "addressName" / "addressTel" / ...) は Block::FormField.name
//     と PATCH URL `/checkout/shipping_field/{name}` で同期。Action にも `field_name` を
//     入れる (= LineItemAction で token を action に持たせるのと同じ自包含設計)。
//   - 配送方法は 1 リソース (= 単一値) なので path に id を取らず固定 endpoint。
//     Action は payload を持たず `Patch` だけ。
//
// **なぜ CtaAction / LineItemAction と分けるか**:
//   関心が違う (Cta = 商品操作、LineItem = cart 行操作、Checkout = 配送先 / 配送方法)。
//   discriminator (`tag = "type"`) を共有すると client 側 narrow が混線するし、
//   将来 endpoint 構造が分岐した時に enum ごと差し替えできる柔軟性が要る。
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum CheckoutFieldAction {
    /// この field の値を `value` に置き換える。
    /// PATCH `/api/v1/checkout/shipping_field/{field_name}` body `{ value }`。
    /// `field_name` は Block::FormField.name と一致 (= 自包含で client は URL を組める)。
    PatchField { field_name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum CheckoutMethodAction {
    /// 配送方法を選択した option の `id` に置き換える。
    /// PATCH `/api/v1/checkout/shipping_method` body `{ id }`。
    /// 単一リソースなので path にキーを取らない (= シンプル)。
    PatchMethod,
}

// ──────────────────────────────────────────────────────────────────────
// FormFieldKind / SelectOption: フォーム入力欄の入力種別 (Phase 8)
//
// **HTML <input type=...> との対応**:
//   - Text       → <input type="text">
//   - Tel        → <input type="tel" inputmode="tel">
//   - PostalCode → <input type="text" inputmode="numeric"> (郵便番号: ハイフン込み)
//   - Select     → <select> + <option>
// 個別 enum variant にする理由は client renderer 側で「Tel と PostalCode で
// inputmode を変える / Select で option を <For> で展開する」を型で安全に分岐させるため。
//
// **将来 (Phase 8+)**:
//   - Email / Number / Date variant
//   - クライアント側 validation (regex, min/max length) を server から下ろす
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct SelectOption {
    /// 一意な値 (= <option value=>)。Select の現在値はこれと比較される。
    pub id: String,
    /// 表示ラベル (i18n 対応)。
    pub label: Localizable,
}

/// FormField の入力種別。`tag = "inputType"` で discriminate する。
///
/// **なぜ tag を "kind" にしないか**: 親 `Block::FormField` の名前付きフィールドが
/// `kind: FormFieldKind` なので、内側でも `kind` を tag に使うと
/// `"kind": { "kind": "text" }` と冗長になる。`inputType` にすれば
/// `"kind": { "inputType": "text" }` となり、TS でも `block.kind.inputType === "text"`
/// が読みやすい。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(
    tag = "inputType",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum FormFieldKind {
    /// 通常テキスト入力 (氏名、住所など)。
    Text,
    /// 電話番号入力 (inputmode=tel)。
    Tel,
    /// 郵便番号入力 (inputmode=numeric, ハイフン込みの string)。
    PostalCode,
    /// 選択肢から 1 つ選ぶ。`options` は server が提供する全候補。
    Select { options: Vec<SelectOption> },
}

// ──────────────────────────────────────────────────────────────────────
// ShippingMethodOption: 配送方法ピッカーの 1 候補 (Phase 8)
//
// 価格表示は client 側で `amount` を locale formatter に通す (`¥1,800` 等)。
// `description` は「生体含むため必須設定 · 15〜25℃」のような補足文 (= 1 行想定)。
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[ts(export)]
pub struct ShippingMethodOption {
    /// 一意な ID (= radio の value)。例: "cold" / "normal"。
    pub id: String,
    /// 表示名 (= "温度制御便（推奨）")。i18n 対応。
    pub name: Localizable,
    /// 補足説明 (= "生体含むため必須設定 · 15〜25℃")。i18n 対応。
    pub description: Localizable,
    /// 配送料 (税込, 円)。MVP は JPY のみ。
    #[ts(type = "number")]
    pub amount: i64,
    pub currency: Currency,
}

// ──────────────────────────────────────────────────────────────────────
// Block: 9 種類の判別共用体 (tag = "type")
// ──────────────────────────────────────────────────────────────────────

// review fix (major): SDUI v6 §10.1 / CODE_REVIEW_PROMPT §2.1 の規約として、
// 各 variant の余計なフィールドを reject するため `deny_unknown_fields` を enum レベルで
// 付ける。個別 struct (MetricItem / MetaItem 等) には既に付いているが、外側の enum で
// 抜けていると、tag-union ごとに tag + 既知フィールド以外を拒否する保険が効かない。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[ts(export)]
pub enum Block {
    Text {
        key: String,
        role: TextRole,
        content: Localizable,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    Cta {
        key: String,
        intent: CtaIntent,
        label: Localizable,
        href: Href,
        /// サーバ反映アクション (Phase 2.5)。None なら href への純粋なナビゲート。
        /// 詳細は `CtaAction` のドキュメントを参照。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        action: Option<CtaAction>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    Media {
        key: String,
        kind: MediaKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        src: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        alt: Option<Localizable>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        icon_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    Badge {
        key: String,
        role: BadgeRole,
        label: Localizable,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    MetricList {
        key: String,
        items: Vec<MetricItem>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    MetaLine {
        key: String,
        items: Vec<MetaItem>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    Price {
        key: String,
        // ts-rs は `i64` をデフォルトで `bigint` にマップするが、
        //   - JSON.parse の結果は常に JS の `number` (JSON に bigint は無い)
        //   - JPY の最大金額は MAX_SAFE_INTEGER 内で十分 (~9 兆円)
        // のため `number` に明示的に倒す。多通貨対応で精度が必要になった時は §17 で見直す。
        #[ts(type = "number")]
        amount: i64,
        currency: Currency,
        tax_included: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    EclosionForecast {
        key: String,
        days_ahead: i32,
        #[ts(type = "string")]
        date: NaiveDate,
        tolerance: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    Divider {
        key: String,
    },
    // ── Phase 7: cart 専用 block ─────────────────────────────────
    /// カート 1 行ぶん (= 1 商品)。画像 + 商品名 + 単価 + qty + 小計 + +/- + 削除を
    /// まとめて持つ "fat block"。複数の小 primitive (Media + Text + QtyStepper + Cta) に
    /// 分けず 1 ブロックにした理由:
    ///   - 行内の各要素 (画像 / 価格 / qty / 削除) が密結合で、別々に並べ替える需要が無い
    ///   - "1 行 = 1 商品" の意味的単位として TS 側でも narrow しやすい
    ///   - LineItemAction を 3 つ (decrement / increment / remove) フラットに持てる
    /// 将来 "ギフトラッピング" のような行内追加要素が出たら sub-block を内包する形に
    /// リファクタする (= 今は YAGNI)。
    LineItem {
        key: String,
        /// 表示テキスト用 product id。クライアント側で「商品ページに飛ぶ」リンク等に使う。
        product_id: String,
        /// 商品名 (= cart card では Localizable::Raw、商品マスタから流す)。
        title: Localizable,
        /// サムネ画像 (なければ placeholder)。サイズ・aspect は renderer 側 CSS。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        image_src: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        image_alt: Option<Localizable>,
        /// 単価 (税込, 円)。MVP は JPY のみなので i64 で OK (§17 で多通貨対応)。
        /// `tax_included` は OrderSummary 側でまとめて表現するためここでは持たない。
        #[ts(type = "number")]
        unit_price_amount: i64,
        currency: Currency,
        /// この行の数量 (>= 1; 0 になる時は Remove で消す前提)。
        #[ts(type = "number")]
        qty: u32,
        /// 小計 (= unit_price_amount * qty)。サーバ側で確定値を持つ理由は、
        /// クライアント計算と表示金額を絶対にずらさないため。
        #[ts(type = "number")]
        subtotal_amount: i64,
        /// 商品ページへの遷移リンク (= 画像 / タイトルクリック先)。
        detail_href: Href,
        /// "−" ボタンの action。`qty == 1` の時は None (= UI で disabled に)。
        /// Some の時は LineItemAction::SetQty { qty: qty - 1 }。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        decrement_action: Option<LineItemAction>,
        /// "+" ボタンの action。常に Some (= LineItemAction::SetQty { qty: qty + 1 })。
        /// 上限がある場合は server 側で None にして disabled にする (将来)。
        increment_action: LineItemAction,
        /// "削除" ボタンの action (= LineItemAction::Remove { token })。
        remove_action: LineItemAction,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    // ── Phase 8: checkout 用 block (FormField / ShippingMethodPicker) ──
    /// チェックアウトの配送先入力 1 フィールド分。input + label + 任意の
    /// validation_error をひとまとめにする "fat block"。
    ///
    /// **なぜ 1 行 = 1 block にするか**:
    ///   - 1 フィールドが server 側 checkout state の 1 reducer cell に対応 (= URL 上の
    ///     `/checkout/shipping_field/{name}` PATCH と 1:1 マップ)。
    ///   - validation_error を Localizable で持つことで、サーバ判定の文言を i18n に乗せたまま
    ///     当該フィールド直下に出せる (= 「フィールド ↔ エラー」の対応を server 契約で表現)。
    ///   - グリッド配置 (氏名 / 電話 / 郵便番号 / 都道府県 / 住所) は region 側の Vec<Block>
    ///     順序で表現し、CSS Grid で 2 カラム化する。block 単位で reorder できる。
    ///
    /// **`name` (= server 側 field 名) と `key` (= block 識別子) の使い分け**:
    ///   - `key`  : ValidateKeys 用 ("ff-name" / "ff-tel" など)。block の identity。
    ///   - `name` : URL path に乗る field 名 (= "addressName" / "addressTel")。
    ///     PatchAction.field_name と 1 文字も違わず一致させる契約。
    FormField {
        key: String,
        /// PATCH URL `/checkout/shipping_field/{name}` の最後のセグメントになる識別子。
        /// camelCase 推奨 (= JSON 全体の rename_all と揃う)。
        name: String,
        /// 入力欄の上に表示するラベル (= "氏名" / "電話" 等)。i18n 対応。
        label: Localizable,
        /// 現在値 (= server 側 checkout store の現状)。未入力なら None。
        /// 空文字 ("") と None を区別できるよう Option で持つ (= 「未入力」と「空に編集中」を
        /// 混同しない)。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        value: Option<String>,
        /// 必須かどうか。client 側 disabled / aria-required の判定にも使う。
        required: bool,
        /// HTML autocomplete attribute (= "name" / "tel" / "postal-code" / "address-level1" / "street-address")。
        /// 未指定なら autocomplete を出さない。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        autocomplete: Option<String>,
        /// プレースホルダ (= "150-0001" など)。i18n 対応。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        placeholder: Option<Localizable>,
        /// このフィールドに対する validation エラー文 (= "未入力です" など)。
        /// None なら何も出さない。Some なら field 直下に赤字で表示。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        validation_error: Option<Localizable>,
        /// 入力種別 (Text / Tel / PostalCode / Select)。Select の時は options を持つ。
        kind: FormFieldKind,
        /// この field を更新する action。client 側は debounce 後に invoke する。
        patch_action: CheckoutFieldAction,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    /// 配送方法ピッカー (= radio group)。1 cart に 1 件想定。
    ///
    /// **なぜ FormField::Select で代用しないか**:
    ///   配送方法は「料金 + 説明文」を含む rich option で、単なる「id + label」では
    ///   表現できない。さらに UI 上は radio + price 行のレイアウトで、`<select>` ではなく
    ///   `<label>` の縦並びで描画したい (= a11y / 見やすさ)。
    ///   渡される PATCH endpoint も `/checkout/shipping_method` (単一値) で、
    ///   `/checkout/shipping_field/{name}` とは別系統。block と endpoint を 1:1 で揃える。
    ShippingMethodPicker {
        key: String,
        /// 全候補 (空配列なら client 側で「配送方法が登録されていません」を出す)。
        /// 1 件しかない場合も radio で出す (= 将来 2 件目が追加された時に UI が壊れない)。
        options: Vec<ShippingMethodOption>,
        /// 現在選択中の option id。`options[].id` のいずれかに含まれる前提
        /// (= server 側で必ず default を指すよう構築する)。
        selected_id: String,
        /// この picker を更新する action。client 側は radio change 即 invoke。
        patch_action: CheckoutMethodAction,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
    /// カート集計行 (= subtotal / shipping / tax / total)。1 cart に 1 件想定。
    ///
    /// **なぜ MetricList で代用しないか**:
    ///   MetricList は「k/v ラベル+値」の汎用部品で、合計行の階層 (subtotal は明細、
    ///   total は強調) を表現できない。OrderSummary は専用 block にして renderer 側で
    ///   total 行を太字 / 大きめに描く意味的契約を作る。
    OrderSummary {
        key: String,
        /// 行数 (= LineItem の件数)。
        #[ts(type = "number")]
        line_count: u32,
        /// 数量合計 (= 全 LineItem の qty 合計)。
        #[ts(type = "number")]
        total_qty: u32,
        #[ts(type = "number")]
        subtotal_amount: i64,
        /// 配送料 (= None なら配送料行を出さない / `Some(0)` なら "送料無料" 表示)。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "number")]
        shipping_amount: Option<i64>,
        /// 消費税 (= None なら税行を出さない / `Some(n)` なら "(うち消費税 n 円)")。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional, type = "number")]
        tax_amount: Option<i64>,
        /// 最終合計 (= subtotal + shipping; tax は subtotal に含む想定)。
        #[ts(type = "number")]
        total_amount: i64,
        currency: Currency,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
    },
}

impl Block {
    /// 全 variant に共通する `key` フィールドを返す。
    pub fn key(&self) -> &str {
        match self {
            Block::Text { key, .. }
            | Block::Cta { key, .. }
            | Block::Media { key, .. }
            | Block::Badge { key, .. }
            | Block::MetricList { key, .. }
            | Block::MetaLine { key, .. }
            | Block::Price { key, .. }
            | Block::EclosionForecast { key, .. }
            | Block::Divider { key }
            | Block::LineItem { key, .. }
            | Block::FormField { key, .. }
            | Block::ShippingMethodPicker { key, .. }
            | Block::OrderSummary { key, .. } => key,
        }
    }

    /// `items[].key` を持つ variant のみ列挙。それ以外は空イテレータ。
    /// `ValidateKeys` で `block.key + "::" + item.key` の合成キーを一意性検証する。
    pub fn iter_item_keys(&self) -> Box<dyn Iterator<Item = &str> + '_> {
        match self {
            Block::MetricList { items, .. } => Box::new(items.iter().map(|i| i.key.as_str())),
            Block::MetaLine { items, .. } => Box::new(items.iter().map(|i| i.key.as_str())),
            _ => Box::new(std::iter::empty()),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// CardBlock: テンプレートで判別される共用体 (Phase 1 は ProductFeature のみ)
// ──────────────────────────────────────────────────────────────────────

/// `product_feature` テンプレートの variant (マーチャンダイジング用)。
/// `Experiment.bucket` (A/B テスト) とは独立 (§11.3)。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ProductFeatureVariant {
    Default,
    Featured,
    Compact,
}

/// `product_detail` テンプレートの variant。
/// MVP では Default のみ。Phase 2 で「ペア販売」「予約商品」等の表示差を
/// バリアントで切り替える可能性に備えて enum で型を切っておく。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ProductDetailVariant {
    Default,
}

/// `cart` テンプレートの variant (Phase 7)。
///
/// **Default vs Empty を分けない理由**:
///   "0 件" の判定は `regions.items.len() == 0` で renderer 側が決められる。
///   別 variant にすると「items が空でも Default を返す → 矛盾」を server が壁打ちする
///   コストが増える。empty state の見た目分岐は client 側で 1 行 (= Show when=) で完結。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CartVariant {
    Default,
}

// review fix (major): SDUI v6 §10.1 / CODE_REVIEW_PROMPT §2.1 — `Block` 同様に
// `CardBlock` 外側でも `deny_unknown_fields` を付ける。tag-union 全体としての
// 「未知フィールドはサイレントに通さない」契約を、テンプレート判別側でも維持する。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(
    tag = "template",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[ts(export)]
pub enum CardBlock {
    /// Phase 1: 商品ハイライトカード。
    ProductFeature {
        /// §4.6 の規約に従う不変 ID (データ主キー / 構造化 ID / 複合 ID のいずれか)。
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        variant: Option<ProductFeatureVariant>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        experiment: Option<Experiment>,
        /// 未指定時は §11.4 のフォールバックにより `id` を流用する。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
        regions: ProductFeatureRegions,
    },
    /// Phase 2 (MVP): 商品詳細ページ。一覧カード (`product_feature`) と同じ商品でも、
    /// 詳細はリージョン構成が違う (gallery / hero / spec / pricing / cta) ため別 variant。
    /// 1 つの id に対して `product_feature` と `product_detail` が並立しうる。
    ProductDetail {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        variant: Option<ProductDetailVariant>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        experiment: Option<Experiment>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
        regions: ProductDetailRegions,
    },
    /// Phase 7: カート画面。1 ユーザにつき 1 枚 (server 側 cart store の現状を
    /// snapshot して返す)。`id` は固定で "cart" (= 単一カートしかないので一意)。
    /// 将来 multi-cart (= ギフトリスト等) を持つなら id を分ける。
    Cart {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        variant: Option<CartVariant>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        experiment: Option<Experiment>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        analytics_id: Option<String>,
        regions: CartRegions,
    },
    // Phase 3: HeroIntro { ... }
    // Phase 4: PromiseStep { ... }
}

impl CardBlock {
    pub fn id(&self) -> &str {
        match self {
            CardBlock::ProductFeature { id, .. }
            | CardBlock::ProductDetail { id, .. }
            | CardBlock::Cart { id, .. } => id,
        }
    }

    /// `analytics_id` が未指定なら `id` を流用 (§11.4)。
    pub fn effective_analytics_id(&self) -> &str {
        match self {
            CardBlock::ProductFeature {
                id, analytics_id, ..
            }
            | CardBlock::ProductDetail {
                id, analytics_id, ..
            }
            | CardBlock::Cart {
                id, analytics_id, ..
            } => analytics_id.as_deref().unwrap_or(id),
        }
    }

    /// このカード内の全ブロックを順次返すイテレータ。
    /// `ValidateKeys` で `Block.key` の一意性検証に利用する。
    pub fn iter_blocks(&self) -> Box<dyn Iterator<Item = &Block> + '_> {
        match self {
            CardBlock::ProductFeature { regions, .. } => Box::new(regions.iter_blocks()),
            CardBlock::ProductDetail { regions, .. } => Box::new(regions.iter_blocks()),
            CardBlock::Cart { regions, .. } => Box::new(regions.iter_blocks()),
        }
    }

    /// テンプレート名 (= `template` discriminator の値)。
    /// `ValidateA11y` のエラー文に template を含めて debug 容易にする用途。
    pub fn template_name(&self) -> &'static str {
        match self {
            CardBlock::ProductFeature { .. } => "product_feature",
            CardBlock::ProductDetail { .. } => "product_detail",
            CardBlock::Cart { .. } => "cart",
        }
    }
}
