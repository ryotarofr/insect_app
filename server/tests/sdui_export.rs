//! ts-rs 経由の TypeScript 型エクスポートを検証する integration test。
//!
//! `cargo test` 実行時に ts-rs が生成する `bindings/<TypeName>.ts` が
//! 期待される型を一通り含むことを sanity-check する。
//!
//! 集約は `client_solid/scripts/gen-sdui-types.mjs` 側で行う:
//!   1. `cargo test` で `server/bindings/` 配下に per-type `.ts` ファイルが出力される
//!   2. `npm run gen:sdui` (client_solid/) が `bindings/*.ts` を読んで
//!      `client_solid/src/generated/sdui.ts` に barrel として集約する
//!
//! このテストは ts-rs の生成テスト (各 `#[derive(TS)]` ごとに自動生成) が
//! 1 つでも欠けないように、明示的にエクスポート対象を列挙する役目を持つ。

use insect_app_server::sdui::{
    BadgeRole, Block, CardBlock, CtaIntent, Currency, Experiment, Href, I18nKey, Localizable,
    MediaKind, MetaItem, MetaLineItemRole, MetricItem, ProductFeatureRegions, RegionName,
    TextRole,
};
use ts_rs::TS;

#[test]
fn all_sdui_types_export_to_bindings() {
    // ts-rs の `#[ts(export)]` 自体が cargo test で各型を `bindings/<TypeName>.ts` に
    // 書き出す。ここでは export() を明示的に呼んで、もし silently skip された場合に
    // 検出できるようにしておく (failure はテスト失敗で表面化する)。
    let exports: Vec<(&str, Result<(), ts_rs::ExportError>)> = vec![
        // Common enums
        ("RegionName", RegionName::export_all()),
        ("TextRole", TextRole::export_all()),
        ("CtaIntent", CtaIntent::export_all()),
        ("MediaKind", MediaKind::export_all()),
        ("BadgeRole", BadgeRole::export_all()),
        ("MetaLineItemRole", MetaLineItemRole::export_all()),
        ("Currency", Currency::export_all()),
        // Branded types
        ("Href", Href::export_all()),
        ("I18nKey", I18nKey::export_all()),
        // Localizable + items
        ("Localizable", Localizable::export_all()),
        ("MetricItem", MetricItem::export_all()),
        ("MetaItem", MetaItem::export_all()),
        // Block / CardBlock / Regions / Experiment
        ("Block", Block::export_all()),
        ("CardBlock", CardBlock::export_all()),
        ("ProductFeatureRegions", ProductFeatureRegions::export_all()),
        ("Experiment", Experiment::export_all()),
    ];

    let failures: Vec<String> = exports
        .into_iter()
        .filter_map(|(name, result)| result.err().map(|e| format!("{name}: {e}")))
        .collect();

    assert!(
        failures.is_empty(),
        "ts-rs export failed for: {failures:?}"
    );
}
