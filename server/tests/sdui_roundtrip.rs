//! property-based ラウンドトリップ等価性テスト (M8 / 設計書 §13.6)
//!
//! `proptest` で任意の SDUI 値を生成 → JSON serialize → deserialize した結果が
//! 元と等価 (= bit-identical) であることを assert する。
//!
//! **狙い**:
//! - discriminator 名衝突 (§4.2.1) の検出
//! - `Option<T>` の `null` vs missing 揺れの検出
//! - camelCase / snake_case 変換漏れの検出
//! - `#[serde(default)]` / `skip_serializing_if` の片側忘れの検出
//! - Localizable (i18n / raw) の untagged 揺れの検出
//!
//! **戦略**:
//! - 各 SDUI primitive 用の `Strategy` を定義
//! - validate_keys / validate_a11y を通る生成のみ採用 (= invariant 違反は除外)
//! - 1024 件 * 16 cases = 16k iter で flaky なら strategy を狭める
//!
//! このテストは Rust 側 source of truth の不変性を保証するもので、TS 側
//! roundtrip (= fast-check + ajv) は別途 client_solid 側で整備する。

use insect_app_server::sdui::{
    BadgeRole, Block, CardBlock, CartRegions, CartVariant, CheckoutFieldAction,
    CheckoutMethodAction, CtaAction, CtaIntent, Currency, FormFieldKind, Href, LineItemAction,
    Localizable, MediaKind, MetaItem, MetaLineItemRole, MetricItem, ProductFeatureRegions,
    SelectOption, ShippingMethodOption, TextRole, ValidateA11y, ValidateKeys,
};
use insect_app_server::sdui::analytics::{
    AnalyticsEvent, AnalyticsEventBatch, AnalyticsEventType,
};
use insect_app_server::sdui::blocks::{ParamValue, ProductFeatureVariant};
use insect_app_server::sdui::regions::ProductDetailRegions;
use proptest::collection::{btree_map, vec};
use proptest::option;
use proptest::prelude::*;
use std::collections::BTreeMap;

// ──────────────────────────────────────────────────────────────────────
// 共通 Strategy
// ──────────────────────────────────────────────────────────────────────

/// 既存 i18n key 規則 (`<scope>.<key>`) に従う非空 ASCII 文字列。
fn i18n_key_str() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_]{0,8}\\.[a-z][a-z0-9_]{0,8}".prop_map(String::from)
}

/// raw text。空文字を避ける (= 設計書 §10.4 + L コンポーネントの不変条件)。
fn raw_text_str() -> impl Strategy<Value = String> {
    "[ -~]{1,32}".prop_map(String::from)
}

/// block.key として有効な「空でないカード内一意候補」を作る。
/// 一意性はカード組み立て側で確保 (= 連番 prefix を付けて衝突回避)。
fn key_token() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_-]{0,12}".prop_map(String::from)
}

/// Href: 内部相対パスのみ生成 (= deny scheme 対象を踏まない)。
fn arb_href() -> impl Strategy<Value = Href> {
    "/[a-z][a-z0-9/_-]{0,30}"
        .prop_filter_map("Href parse", |s| Href::parse(&s).ok())
}

/// Localizable: i18n / raw の両方を出して discriminator 揺れを攻める。
/// 各 branch は別 concrete Strategy 型なので `.boxed()` で型を揃える。
fn arb_localizable() -> impl Strategy<Value = Localizable> {
    prop_oneof![
        i18n_key_str()
            .prop_map(|k| Localizable::I18n {
                key: insect_app_server::sdui::I18nKey::new(&k),
                params: None,
            })
            .boxed(),
        raw_text_str()
            .prop_map(|t| Localizable::Raw { text: t })
            .boxed(),
        // i18n + params を持つケース (ParamValue 揺れ)
        (i18n_key_str(), btree_map("[a-z]{1,4}", arb_param_value(), 0..3))
            .prop_map(|(k, params)| Localizable::I18n {
                key: insect_app_server::sdui::I18nKey::new(&k),
                params: if params.is_empty() { None } else { Some(params) },
            })
            .boxed(),
    ]
}

fn arb_param_value() -> impl Strategy<Value = ParamValue> {
    prop_oneof![
        raw_text_str().prop_map(ParamValue::Str).boxed(),
        any::<i64>().prop_map(ParamValue::Int).boxed(),
    ]
}

// ──────────────────────────────────────────────────────────────────────
// Block strategies (代表的な variant のみ)
// ──────────────────────────────────────────────────────────────────────

fn arb_text_block(role: TextRole, key: String) -> impl Strategy<Value = Block> {
    arb_localizable().prop_map(move |content| Block::Text {
        key: key.clone(),
        role,
        content,
        analytics_id: None,
    })
}

fn arb_cta_block(key: String) -> impl Strategy<Value = Block> {
    (
        prop_oneof![
            Just(CtaIntent::Primary),
            Just(CtaIntent::Secondary),
            Just(CtaIntent::Tertiary),
            Just(CtaIntent::Destructive),
        ],
        arb_localizable(),
        arb_href(),
        option::weighted(0.5, arb_cta_action()),
    )
        .prop_map(move |(intent, label, href, action)| Block::Cta {
            key: key.clone(),
            intent,
            label,
            href,
            action,
            analytics_id: None,
        })
}

fn arb_cta_action() -> impl Strategy<Value = CtaAction> {
    prop_oneof![
        ("[a-z][a-z0-9-]{0,8}", 1u32..5)
            .prop_map(|(pid, qty)| CtaAction::AddToCart {
                product_id: pid.to_string(),
                qty,
            })
            .boxed(),
        "[a-z][a-z0-9-]{0,8}"
            .prop_map(|pid| CtaAction::ToggleWatch {
                product_id: pid.to_string(),
            })
            .boxed(),
    ]
}

fn arb_badge_block(key: String) -> impl Strategy<Value = Block> {
    (
        prop_oneof![
            Just(BadgeRole::Status),
            Just(BadgeRole::Evidence),
            Just(BadgeRole::Warning),
            Just(BadgeRole::Promo),
        ],
        arb_localizable(),
    )
        .prop_map(move |(role, label)| Block::Badge {
            key: key.clone(),
            role,
            label,
            analytics_id: None,
        })
}

fn arb_media_block(key: String) -> impl Strategy<Value = Block> {
    prop_oneof![
        Just(MediaKind::Image),
        Just(MediaKind::Video),
        Just(MediaKind::Icon),
        Just(MediaKind::Placeholder),
    ]
    .prop_flat_map(move |kind| {
        let key = key.clone();
        (option::of(raw_text_str()), option::of(arb_localizable())).prop_map(
            move |(src, alt)| Block::Media {
                key: key.clone(),
                kind,
                src,
                alt,
                icon_name: None,
                analytics_id: None,
            },
        )
    })
}

fn arb_price_block(key: String) -> impl Strategy<Value = Block> {
    (0i64..100_000_000, any::<bool>()).prop_map(move |(amount, tax_included)| Block::Price {
        key: key.clone(),
        amount,
        currency: Currency::JPY,
        tax_included,
        analytics_id: None,
    })
}

fn arb_metric_list_block(key: String) -> impl Strategy<Value = Block> {
    let key_outer = key.clone();
    vec(
        (key_token(), arb_localizable(), arb_localizable()).prop_map(|(k, label, value)| {
            MetricItem {
                key: k,
                label,
                value,
            }
        }),
        1..4,
    )
    .prop_map(move |items| {
        // items[].key を一意化 (= 同 items 配列内一意 §4.3)
        let mut seen = std::collections::HashSet::new();
        let unique_items: Vec<MetricItem> = items
            .into_iter()
            .enumerate()
            .map(|(i, mut item)| {
                let mut k = item.key.clone();
                while !seen.insert(k.clone()) {
                    k = format!("{}-{}", item.key, i);
                }
                item.key = k;
                item
            })
            .collect();
        Block::MetricList {
            key: key_outer.clone(),
            items: unique_items,
            analytics_id: None,
        }
    })
}

fn arb_meta_line_block(key: String) -> impl Strategy<Value = Block> {
    let key_outer = key.clone();
    vec(
        (
            key_token(),
            prop_oneof![
                Just(MetaLineItemRole::Id),
                Just(MetaLineItemRole::Shop),
                Just(MetaLineItemRole::Code),
                Just(MetaLineItemRole::Lot),
                Just(MetaLineItemRole::Breeder),
            ],
            raw_text_str(),
        )
            .prop_map(|(k, role, value)| MetaItem {
                key: k,
                role,
                value,
                align: None,
            }),
        1..4,
    )
    .prop_map(move |items| {
        let mut seen = std::collections::HashSet::new();
        let unique_items: Vec<MetaItem> = items
            .into_iter()
            .enumerate()
            .map(|(i, mut item)| {
                let mut k = item.key.clone();
                while !seen.insert(k.clone()) {
                    k = format!("{}-{}", item.key, i);
                }
                item.key = k;
                item
            })
            .collect();
        Block::MetaLine {
            key: key_outer.clone(),
            items: unique_items,
            analytics_id: None,
        }
    })
}

/// 上記 6 種類から 1 つを生成。Block::Divider / EclosionForecast / cart 専用 fat block /
/// FormField / ShippingMethodPicker は別 strategy で追加可能だが、ProductFeature 用の
/// roundtrip としてはこの 6 種類で discriminator / camelCase / Option 揺れを十分網羅する。
///
/// 各 branch を `.boxed()` で `BoxedStrategy<Block>` に揃えてから prop_oneof! に
/// 通す (= concrete Strategy 型が異なるため型統合が必要)。
fn arb_simple_block(key: String) -> impl Strategy<Value = Block> {
    let k = key;
    prop_oneof![
        arb_text_block(TextRole::Eyebrow, k.clone()).boxed(),
        arb_text_block(TextRole::Subhead, k.clone()).boxed(),
        arb_text_block(TextRole::Body, k.clone()).boxed(),
        arb_cta_block(k.clone()).boxed(),
        arb_badge_block(k.clone()).boxed(),
        arb_media_block(k.clone()).boxed(),
        arb_price_block(k.clone()).boxed(),
        arb_metric_list_block(k.clone()).boxed(),
        arb_meta_line_block(k).boxed(),
    ]
}

// ──────────────────────────────────────────────────────────────────────
// CardBlock strategies
// ──────────────────────────────────────────────────────────────────────

/// ProductFeature カード: header / media / meta / body / footer。
/// headline は 0 or 1 個に絞り、key の一意性は連番 prefix で確保。
fn arb_product_feature_card() -> impl Strategy<Value = CardBlock> {
    (
        "[A-Z]{2,4}-[0-9]{3,5}",
        vec(any::<u8>().prop_map(|_| ()), 0..3), // 適当な長さ ジェネレータ for region size
        option::of(Just(true)),                  // headline 有無
    )
        .prop_flat_map(|(id, sizes, has_headline)| {
            let n_blocks = (sizes.len() + 1).min(5);
            (
                Just(id),
                vec(
                    (key_token(), 0u8..6).prop_flat_map(|(k, choice)| {
                        let key = k.clone();
                        match choice {
                            0 => arb_text_block(TextRole::Body, key).boxed(),
                            1 => arb_cta_block(key).boxed(),
                            2 => arb_badge_block(key).boxed(),
                            3 => arb_media_block(key).boxed(),
                            4 => arb_price_block(key).boxed(),
                            _ => arb_metric_list_block(key).boxed(),
                        }
                    }),
                    n_blocks..=n_blocks,
                ),
                if has_headline.is_some() {
                    arb_text_block(TextRole::Headline, "body-hl".to_string()).boxed()
                } else {
                    // 同じ Strategy 型を返すため Just で wrap 必要 → Option で表現するために
                    // 「ダミー divider」を生成して後段で丸める手もあるが、今は素朴に
                    // 必ず headline を入れる単純化版に倒す
                    arb_text_block(TextRole::Headline, "body-hl".to_string()).boxed()
                },
            )
        })
        .prop_map(|(id, mut blocks, headline)| {
            // key 一意化: 連番 prefix を強制付与
            let mut seen = std::collections::HashSet::new();
            for (i, b) in blocks.iter_mut().enumerate() {
                let new_key = format!("blk-{i}");
                seen.insert(new_key.clone());
                set_block_key(b, new_key);
            }

            let mut header: Vec<Block> = Vec::new();
            let mut body: Vec<Block> = vec![headline]; // 1 headline
            let mut footer: Vec<Block> = Vec::new();

            // blocks を header/body/footer に分配
            for (i, b) in blocks.into_iter().enumerate() {
                match i % 3 {
                    0 => header.push(b),
                    1 => body.push(b),
                    _ => footer.push(b),
                }
            }

            CardBlock::ProductFeature {
                id,
                variant: Some(ProductFeatureVariant::Featured),
                experiment: None,
                analytics_id: None,
                regions: ProductFeatureRegions {
                    header,
                    media: Vec::new(),
                    meta: Vec::new(),
                    body,
                    footer,
                },
            }
        })
}

/// Block の key フィールドを書き換える (proptest で生成した key を一意化するため)。
fn set_block_key(b: &mut Block, new_key: String) {
    match b {
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
        | Block::OrderSummary { key, .. }
        | Block::FormField { key, .. }
        | Block::ShippingMethodPicker { key, .. } => *key = new_key,
    }
}

// ──────────────────────────────────────────────────────────────────────
// Roundtrip property tests
// ──────────────────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 4096,
        ..ProptestConfig::default()
    })]

    /// Localizable の JSON ラウンドトリップ等価性。
    /// 主に i18n / raw discriminator + ParamValue (string | i64) untagged の安定性を見る。
    #[test]
    fn localizable_roundtrip(value in arb_localizable()) {
        let json = serde_json::to_string(&value).expect("serialize");
        let parsed: Localizable = serde_json::from_str(&json).expect("deserialize");
        prop_assert_eq!(parsed, value);
    }

    /// CtaAction の JSON ラウンドトリップ。
    /// `tag = "type"` discriminator + camelCase rename の整合性。
    #[test]
    fn cta_action_roundtrip(action in arb_cta_action()) {
        let json = serde_json::to_string(&action).expect("serialize");
        let parsed: CtaAction = serde_json::from_str(&json).expect("deserialize");
        prop_assert_eq!(parsed, action);
    }

    /// 単独 Block の JSON ラウンドトリップ。
    /// `tag = "type"` discriminator が変なフィールド名と衝突しないことの確認。
    #[test]
    fn block_roundtrip(block in arb_simple_block("blk".to_string())) {
        let json = serde_json::to_string(&block).expect("serialize");
        let parsed: Block = serde_json::from_str(&json).expect("deserialize");
        prop_assert_eq!(parsed, block);
    }

    /// AnalyticsEvent の JSON ラウンドトリップ。
    /// `serverReceivedAtMs` の skip_deserializing 規律が回ること、
    /// `context` の Option<BTreeMap> の null vs missing 揺れが起きないことを確認。
    #[test]
    fn analytics_event_roundtrip(
        analytics_id in "[a-z][a-z0-9._-]{0,32}",
        event_type in prop_oneof![Just(AnalyticsEventType::Impression), Just(AnalyticsEventType::Click)],
        timestamp_ms in 0i64..1_900_000_000_000,
        ctx in option::of(btree_map("[a-z]{1,4}", "[a-z]{1,8}", 0..3)),
    ) {
        let event = AnalyticsEvent {
            analytics_id,
            event_type,
            timestamp_ms,
            context: ctx,
            // skip_deserializing なので生成時に Some を入れても受信側は None になる前提
            server_received_at_ms: None,
        };
        let json = serde_json::to_string(&event).expect("serialize");
        let parsed: AnalyticsEvent = serde_json::from_str(&json).expect("deserialize");
        prop_assert_eq!(parsed, event);
    }

    /// CardBlock (ProductFeature) の JSON ラウンドトリップ + invariant 検証。
    /// validate_keys / validate_a11y を通る生成のみを assert 対象とする (= 生成側で
    /// 1 headline 縛りを入れているので invariant 違反は理論上発生しない)。
    #[test]
    fn product_feature_card_roundtrip(card in arb_product_feature_card()) {
        // 不変条件は事前に必ず通す
        prop_assert!(card.validate_keys().is_ok(), "validate_keys failed: {:?}", card);
        prop_assert!(card.validate_a11y().is_ok(), "validate_a11y failed: {:?}", card);

        let json = serde_json::to_string(&card).expect("serialize");
        let parsed: CardBlock = serde_json::from_str(&json).expect("deserialize");
        prop_assert_eq!(parsed, card);
    }
}

// ──────────────────────────────────────────────────────────────────────
// 静的 sanity check (proptest 外): すべての enum variant が round-trip 可能
// ──────────────────────────────────────────────────────────────────────

#[test]
fn all_text_role_variants_roundtrip() {
    for role in [
        TextRole::Eyebrow,
        TextRole::Headline,
        TextRole::Subhead,
        TextRole::Lead,
        TextRole::Body,
        TextRole::Caption,
        TextRole::Byline,
    ] {
        let json = serde_json::to_string(&role).expect("serialize");
        let parsed: TextRole = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, role);
    }
}

#[test]
fn empty_card_roundtrip() {
    // 最小カード (region 全部空 + headline 無し) も round-trip 可能なこと
    let card = CardBlock::ProductFeature {
        id: "X-001".to_string(),
        variant: None,
        experiment: None,
        analytics_id: None,
        regions: ProductFeatureRegions::default(),
    };
    let json = serde_json::to_string(&card).expect("serialize");
    let parsed: CardBlock = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(parsed, card);
}

#[test]
fn analytics_batch_roundtrip_with_skip_deserializing() {
    // serverReceivedAtMs=Some で send → JSON に乗る → 受信側で None に倒れる
    // (= skip_deserializing の挙動が「serialize 出力にはあるが deserialize で読まない」を確認)
    let event = AnalyticsEvent {
        analytics_id: "a.b".to_string(),
        event_type: AnalyticsEventType::Click,
        timestamp_ms: 1,
        context: None,
        server_received_at_ms: Some(99999),
    };
    let json = serde_json::to_string(&event).expect("serialize");
    assert!(
        json.contains("99999"),
        "serialize should include serverReceivedAtMs: {json}"
    );
    let parsed: AnalyticsEvent = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(
        parsed.server_received_at_ms, None,
        "deserialize should drop serverReceivedAtMs (skip_deserializing)"
    );

    // batch でも同様
    let batch = AnalyticsEventBatch {
        events: vec![event],
    };
    let json = serde_json::to_string(&batch).expect("serialize");
    let parsed: AnalyticsEventBatch = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(parsed.events[0].server_received_at_ms, None);
}

// review fix (major): SDUI v6 §10.1。Block enum の deny_unknown_fields が effective に
// 効いていることを最低 1 件確認する。生成パイプライン (ts-rs) のドリフトで
// `tag = "type"` を伴う enum で属性が落ちると、未知フィールドが silent に通って
// 型契約が壊れるため、この regression は専用 test で固める。
#[test]
fn block_rejects_unknown_field_at_top_level() {
    let json = r#"{
        "type": "divider",
        "key": "div-1",
        "rogueField": 42
    }"#;
    let result: Result<Block, _> = serde_json::from_str(json);
    assert!(
        result.is_err(),
        "Block must reject unknown fields (deny_unknown_fields)"
    );
}

#[test]
fn block_text_rejects_unknown_field_in_variant() {
    let json = r#"{
        "type": "text",
        "key": "t-1",
        "role": "headline",
        "content": { "source": "raw", "text": "hello" },
        "extraField": "should be rejected"
    }"#;
    let result: Result<Block, _> = serde_json::from_str(json);
    assert!(
        result.is_err(),
        "Block::Text must reject unknown fields (deny_unknown_fields)"
    );
}

// ──────────────────────────────────────────────────────────────────────
// 未使用 import 警告抑制 (将来 strategy 拡張時に活きる)
// ──────────────────────────────────────────────────────────────────────

#[allow(dead_code)]
fn _unused_imports_suppression() -> (
    CartRegions,
    CartVariant,
    CheckoutFieldAction,
    CheckoutMethodAction,
    FormFieldKind,
    LineItemAction,
    SelectOption,
    ShippingMethodOption,
    ProductDetailRegions,
    BTreeMap<String, String>,
) {
    unimplemented!()
}
