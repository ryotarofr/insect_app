// TOMBSTONE — このファイルは廃止されました (Strangler Fig 完了 / cleanup task #34)。
//
// 旧 `<ProductMediaGallery>` は商品詳細ページの左ペイン (大画像 + 4 サムネ + 動画枠) でした。
// SDUI 移行により詳細ページは以下に置換されました:
//
//   /products/:id → fetchProductDetailCard() → CardRenderer (template: product_detail)
//
// MVP では gallery region は <Media> 1 枚 (大画像) のみ。
// サムネ列・開封動画は Phase 2 で gallery region に追加予定。
//
// 詳細: docs/sdui-three-layer-model-v5.md §11 (移行戦略)
//        ProductDetailRegions 設計 (server/src/sdui/regions.rs)
//
// **次の手順 (ローカルで実行してください)**:
//   git rm client_solid/src/pages/products/ProductMediaGallery.tsx
//
// このプレースホルダはサンドボックスからファイル削除ができないため残しています。
// import している場所はもうありません (確認済み)。

export {};
