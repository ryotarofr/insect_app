//! テンプレートごとの Regions 専用 struct。
//!
//! - `deny_unknown_fields` で「テンプレートが許容しないリージョン」を deserialize 時に弾く
//! - 各リージョンは `Vec<Block>` で多重度を表現 (§9: 配列の長さで自然に表現)
//! - 現状は `ProductFeatureRegions` のみ実装
//!
//! 各リージョンは **常に配列としてシリアライズ** する (空配列でも `[]` を出力)。
//! `skip_serializing_if = "Vec::is_empty"` を付けると JSON で undefined になり、
//! TS 型 `Block[]` との不整合 (`undefined.length` でクラッシュ) を起こすため避ける。
//!
//! 詳細: `docs/sdui-three-layer-model-v6.md` §5.1 / §7.3

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::blocks::Block;

/// `product_feature` テンプレートの許容リージョン: header / media / meta / body / footer。
///
/// 例: `headline` / `actions` を含めようとすると deserialize で 400。
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[ts(export, rename_all = "camelCase")]
pub struct ProductFeatureRegions {
    #[serde(default)]
    pub header: Vec<Block>,
    #[serde(default)]
    pub media: Vec<Block>,
    #[serde(default)]
    pub meta: Vec<Block>,
    #[serde(default)]
    pub body: Vec<Block>,
    #[serde(default)]
    pub footer: Vec<Block>,
}

impl ProductFeatureRegions {
    /// 描画順 (header → media → meta → body → footer) に全ブロックを返す。
    pub fn iter_blocks(&self) -> impl Iterator<Item = &Block> + '_ {
        self.header
            .iter()
            .chain(self.media.iter())
            .chain(self.meta.iter())
            .chain(self.body.iter())
            .chain(self.footer.iter())
    }
}

/// `product_detail` テンプレートの許容リージョン:
///   gallery / hero / spec / pricing / cta / promise。
///
/// **product_feature との違い**:
///   一覧カードは「画像 + 名前 + 価格」の濃縮表示だが、詳細ページは
///   - gallery : 大画像 + サムネ列 (複数 Media 対応 / 動画埋め込みは将来)
///   - hero    : 店舗 byline / タイトル / 学名 / chip 群
///   - spec    : 個体スペック (サイズ / 性別 / 羽化日 / 累代 / 産地 / ブリーダー)
///   - pricing : 価格 (税込 / 配送料注記)
///   - cta     : カートに追加 / カートを見る / ウォッチ など複数アクション
///   - promise : 安心保証カード (死着補償・温度制御便など `text` + 末尾 `cta`)
///
/// **promise を独立 region にした理由**:
///   - 視覚的には「囲み card」として hero/cta とは別レイアウトで描画される
///   - 用品カードでは存在しない / 生体カードのみ表示する、という出し分けがしやすい
///   - 将来、保証種別が増えた時に block primitive を増やす前に「区画ごと省略」できる
///
/// 空配列の region は client renderer 側 (`<Show when={...length > 0}>`) で section ごと
/// 省略する。サーバから明示的に omit したい場合も `[]` で送る (deserialize 時に default で
/// `Vec::new()` になるため、JSON 側で省略しても OK)。
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[ts(export, rename_all = "camelCase")]
pub struct ProductDetailRegions {
    #[serde(default)]
    pub gallery: Vec<Block>,
    #[serde(default)]
    pub hero: Vec<Block>,
    #[serde(default)]
    pub spec: Vec<Block>,
    #[serde(default)]
    pub pricing: Vec<Block>,
    #[serde(default)]
    pub cta: Vec<Block>,
    /// 安心保証など「保証・補償」を訴求する小さな card 領域。
    /// 一般的に `text` (eyebrow / caption) を 3 〜 4 件並べ、末尾に `cta` を 1 件置く。
    #[serde(default)]
    pub promise: Vec<Block>,
}

impl ProductDetailRegions {
    /// 描画順 (gallery → hero → spec → pricing → promise → cta) に全ブロックを返す。
    /// validate_keys 用なので「論理的な走査順」=「画面上の Z 順」と一致させる。
    /// promise は cta の **直前** に並べる: 「安心保証 → カートに追加」の自然な視線誘導順。
    pub fn iter_blocks(&self) -> impl Iterator<Item = &Block> + '_ {
        self.gallery
            .iter()
            .chain(self.hero.iter())
            .chain(self.spec.iter())
            .chain(self.pricing.iter())
            .chain(self.promise.iter())
            .chain(self.cta.iter())
    }
}

/// `cart` テンプレートの許容リージョン: header / items / shipping /
/// shipping_method / summary / cta。
///
///   - header          : "あなたのカート (3 件)" などの見出し (= Text 1 件想定、空 OK)
///   - items           : LineItem の列 (空 = カート空)
///   - shipping        : 配送先入力フォーム (= FormField の列)
///   - shipping_method : 配送方法ピッカー (= ShippingMethodPicker 1 件)
///   - summary         : OrderSummary 1 件 (空カート時は [])
///   - cta             : "Stripe で決済" / "買い物を続ける" などの CTA
///
/// **空カート時の表現**:
///   `items` / `shipping` / `shipping_method` / `summary` を全て [] にし、
///   `cta` には「買い物を続ける」だけ入れる。
///   client 側は `Show when={items.length > 0}` で empty state を切り替える。
///   Variant を Empty で分けない理由は blocks.rs の CartVariant コメント参照。
///
/// **header に Text 以外を入れない**:
///   今は Text 1 件想定だが、将来「カートはあと N 円で送料無料です」のような
///   Promo Badge を増やす余地を残して `Vec<Block>` のまま。
///
/// **shipping の順序**:
///   FormField を 5 件 (氏名 / 電話 / 郵便番号 / 都道府県 / 住所) の順で並べる。
///   グリッド配置 (2 カラム + 住所が full width) は client renderer 側 CSS で実現。
///   block 単位で reorder したければサーバが Vec の順序を入れ替えるだけ。
///
/// **shipping_method を別 region にする理由**:
///   shipping (= 入力フォーム) と shipping_method (= radio ピッカー) で
///   - section 見出し (§02 お届け先 / §03 配送方法) が違う
///   - empty state の出し分けが独立 (= 配送方法だけ全部 sold out というケースは無いが
///     将来 "配送先確定後に方法を表示" のような二段構成にする余地)
///   をきれいに分離するため。1 region に詰めると section 跨ぎでルーティング順を再構築する
///   必要が出る。
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[ts(export, rename_all = "camelCase")]
pub struct CartRegions {
    #[serde(default)]
    pub header: Vec<Block>,
    #[serde(default)]
    pub items: Vec<Block>,
    /// 配送先入力フォーム (= FormField の列)。空配列なら section 省略。
    #[serde(default)]
    pub shipping: Vec<Block>,
    /// 配送方法ピッカー (= ShippingMethodPicker 1 件)。空配列なら section 省略。
    #[serde(default)]
    pub shipping_method: Vec<Block>,
    #[serde(default)]
    pub summary: Vec<Block>,
    #[serde(default)]
    pub cta: Vec<Block>,
}

impl CartRegions {
    /// 描画順 (header → items → shipping → shipping_method → summary → cta) に
    /// 全ブロックを返す。validate_keys 用なので「論理的な走査順」=「画面上の Z 順」。
    pub fn iter_blocks(&self) -> impl Iterator<Item = &Block> + '_ {
        self.header
            .iter()
            .chain(self.items.iter())
            .chain(self.shipping.iter())
            .chain(self.shipping_method.iter())
            .chain(self.summary.iter())
            .chain(self.cta.iter())
    }
}
