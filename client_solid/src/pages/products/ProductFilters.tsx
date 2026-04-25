// TOMBSTONE — このファイルは廃止されました (Strangler Fig 完了 / cleanup task #34)。
//
// 旧 `<TabSwitcher>` / `<SpeciesFilterBar>` / `SPECIES_FILTERS` / `ATTRIBUTE_FILTERS`
// は `/products` の静的フィルタ UI でした。SDUI 化に伴いフィルタ UI は一旦撤去
// (サーバ side に query param が入った段階で再設計予定)。
//
// 詳細: docs/sdui-three-layer-model-v5.md §11 (移行戦略)
//
// **次の手順 (ローカルで実行してください)**:
//   git rm client_solid/src/pages/products/ProductFilters.tsx
//
// このプレースホルダはサンドボックスからファイル削除ができないため残しています。
// import している場所はもうありません (確認済み)。
//
// **将来再設計時の参考**:
//   - SPECIES (単一選択 / radio): ヘラクレス系 / コーカサス系 / ネプチューン系 / 国産
//   - ATTRIBUTE (多選択 / toggle): ♂ / ♀ / 成虫 / 幼虫 / CBF以上 / 血統書付
//   復活する際は git history (旧版) を参照すること。

export {};
