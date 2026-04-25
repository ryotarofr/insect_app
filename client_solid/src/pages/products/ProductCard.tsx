// TOMBSTONE — このファイルは廃止されました (Strangler Fig 完了 / cleanup task #34)。
//
// 旧 `<ProductCard>` は `/products` ページで `data.ts` の Product 型を直接描画する
// 静的グリッドカードでした。SDUI 移行により以下に置換されました:
//
//   /products → fetchProductCardList() → CardRenderer (template: product_feature)
//
// 詳細: docs/sdui-three-layer-model-v5.md §11 (移行戦略)
//
// **次の手順 (ローカルで実行してください)**:
//   git rm client_solid/src/pages/products/ProductCard.tsx
//
// このプレースホルダはサンドボックスからファイル削除ができないため残しています。
// import している場所はもうありません (確認済み)。

export {};
