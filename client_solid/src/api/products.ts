// api/products.ts — 商品 (= 出品) 取得 adapter
//
// **C2C pivot 後の役割**:
//   旧 B2C「商品マスタ」(= store/products.ts) は廃止。
//   `Product` shape を要求する既存 caller (= App.tsx の breadcrumb,
//   CommandPalette の検索) のために、`serverListings()` から最小フィールドだけ
//   `Product` 形に正規化して返す薄い adapter として残す。
//
// **shape 正規化** (= ListingViewWithCounts → Product):
//   - id           ← publicId
//   - kind         ← "生体" 固定 (= C2C pivot 後の出品は全て生体)
//   - title        ← title
//   - sci          ← null (= server には学名フィールド無し)
//   - price        ← currentPriceJpy ?? startingPriceJpy
//   - badge        ← isVerified ? "認証ブリーダー" : ""
//   - generation   ← null
//   - shop         ← sellerName
//   - tone         ← "forest" 固定
//   - phLabel      ← title

import type { Product } from "../data";
import { serverListings } from "../store/listings";

const toProduct = (l: ReturnType<typeof serverListings>[number]): Product => ({
  id: l.publicId,
  kind: "生体",
  title: l.title,
  sci: null,
  price: l.currentPriceJpy ?? l.startingPriceJpy,
  badge: l.isVerified ? "認証ブリーダー" : "",
  generation: null,
  shop: l.sellerName,
  tone: "forest",
  phLabel: l.title,
});

export const listProducts = (): Product[] => serverListings().map(toProduct);

export const getProduct = (id: string): Product | undefined => {
  const l = serverListings().find((x) => x.publicId === id);
  return l ? toProduct(l) : undefined;
};

export const productExists = (id: string): boolean =>
  serverListings().some((x) => x.publicId === id);
