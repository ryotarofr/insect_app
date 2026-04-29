// api/products.ts — 商品 (生体 / 用品) の取得
//
// **責務**:
//   - `store/products.ts` が server から fetch して signal に詰めた商品リストを
//     既存 sync API (= `listProducts()` / `getProduct()` / `productExists()`) で
//     公開する。本ファイル自体は fetch しない。
//
// **起動時の load**:
//   App.tsx で `loadProducts()` が 1 回呼ばれる前提。それ以前にこの adapter を
//   叩くと空配列が返る (= 画面はプレースホルダ表示)。

import type { Product } from "../data";
import { serverProducts } from "../store/products";

export const listProducts = (): Product[] => serverProducts();

export const getProduct = (id: string): Product | undefined =>
  serverProducts().find((p) => p.id === id);

export const productExists = (id: string): boolean =>
  serverProducts().some((p) => p.id === id);
