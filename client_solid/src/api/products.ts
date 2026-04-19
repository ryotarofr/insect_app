// api/products.ts — 商品 (生体 / 用品) の取得
import { APP_DATA, type Product } from "../data";

export const listProducts = (): Product[] => APP_DATA.products;

export const getProduct = (id: string): Product | undefined =>
  APP_DATA.products.find((p) => p.id === id);

export const productExists = (id: string): boolean =>
  APP_DATA.products.some((p) => p.id === id);
