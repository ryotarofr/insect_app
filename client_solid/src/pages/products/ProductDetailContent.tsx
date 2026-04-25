// TOMBSTONE — このファイルは廃止されました (Strangler Fig 完了 / cleanup task #34)。
//
// 旧 `<ProductDetailContent>` は商品詳細ページの右ペイン (タイトル / chip / 価格 / CTA / 個体スペック)
// でした。SDUI 移行により詳細ページは以下に置換されました:
//
//   /products/:id → fetchProductDetailCard() → CardRenderer (template: product_detail)
//                   → ProductDetailCard.tsx (regions: gallery / hero / spec / pricing / cta)
//
// 詳細: docs/sdui-three-layer-model-v5.md §11 (移行戦略)
//        client_solid/src/sdui/templates/ProductDetailCard.tsx
//
// **次の手順 (ローカルで実行してください)**:
//   git rm client_solid/src/pages/products/ProductDetailContent.tsx
//
// このプレースホルダはサンドボックスからファイル削除ができないため残しています。
// import している場所はもうありません (確認済み)。
//
// **Phase 2 で取り戻す要素 (現 SDUI 詳細にはまだ無い)**:
//   - カート追加時の Toast + Undo (旧 addItemWithUndo + showToast 連携)
//   - ウォッチボタン (badge: watch)
//   - 安心保証カード (warranty page への内部リンク card)
//   設計時は git history (旧版) を参照。

export {};
