// store/products.ts — 商品マスタ (= server /api/v1/products) の reactive cache
//
// **責務**:
//   - アプリ起動時に `loadProducts()` を 1 度呼んで `Product[]` を signal に詰める
//   - `serverProducts()` で同期的に最新値を読めるようにする (= 既存 sync API 互換)
//   - api/products.ts の `listProducts()` / `getProduct()` / `productExists()` から
//     参照される唯一の真実
//
// **設計判断**:
//   - **store/auth.ts と同じパターン**: 起動時 1 回 fetch + module-scope signal。
//     adapter は signal を読むだけで sync 互換を保つ。
//   - **fetch 失敗時は空配列**: 商品ページ自体は SDUI で別経路 fetch するので、
//     本 store の cache が空でも壊滅的な UX 失敗にはならない (= breadcrumb / palette が
//     空になるのみ)。エラー toast は出さず warn ログに留める。
//   - **cache 更新は loadProducts() の都度上書き**: 在庫変動時の自動再 fetch は
//     入れない (= MVP は商品データが安定的な master と仮定)。

import { createSignal } from "solid-js";

import type { Product } from "../data";
import { fetchProducts } from "../sdui/api";

const [products, setProducts] = createSignal<Product[]>([]);

/** 商品マスタの reactive accessor。loadProducts() 前は空配列。 */
export const serverProducts = products;

/** `GET /api/v1/products?locale=ja` を叩いて signal に詰める。
 *  失敗時は warn ログを残し、cache は前回値のまま (= 起動初回なら空配列のまま)。 */
export const loadProducts = async (locale = "ja"): Promise<Product[]> => {
  try {
    const list = await fetchProducts(locale);
    // server レスポンス (ProductSummary) を data.ts の Product 型へ正規化:
    //   - sci / badge / generation の undefined → null (= mock の shape と揃える)
    //   - kind の文字列が想定外でもとりあえずそのまま入れる (= 実装上 "生体" / "用品" 確定)
    const normalized: Product[] = list.map((p) => ({
      id: p.id,
      kind: p.kind as Product["kind"],
      title: p.title,
      sci: p.sci ?? null,
      price: p.price,
      badge: p.badge ?? "",
      generation: p.generation ?? null,
      shop: p.shop,
      tone: p.tone as Product["tone"],
      phLabel: p.phLabel,
    }));
    setProducts(normalized);
    return normalized;
  } catch (e) {
    console.warn("[store/products] fetch failed:", e);
    return products();
  }
};

/** テスト専用: signal にフィクスチャを直接セットする。 */
export const setProductsForTest = (list: Product[]): void => {
  setProducts(list);
};

/** テスト専用: signal をリセット (= 空配列に戻す)。 */
export const resetProductsForTest = (): void => {
  setProducts([]);
};
