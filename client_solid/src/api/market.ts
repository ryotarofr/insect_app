// api/market.ts — C2C マーケットの出品一覧
//
// **責務**:
//   - `store/listings.ts` の `serverListings()` から正規化した legacy `Listing[]` を
//     sync で公開する
//   - `endsIn` 表示文字列 (= "2日 14h" / "即決のみ" / "終了") は server の `endsAt`
//     から **client side で derived** する (= 表示形式を server に焼き付けない)
//
// **shape 正規化** (= server `ListingViewWithCounts` → legacy `Listing`):
//   id        ← publicId               ("L-0421")
//   seller    ← sellerName             ("山田 徹")
//   price     ← currentPriceJpy ?? startingPriceJpy
//   bids      ← isAuction ? bidCount : null   (= 即決出品は入札概念なし)
//   watchers  ← watcherCount
//   endsIn    ← formatEndsIn(endsAt, isAuction)
//   auction   ← isAuction
//   verified  ← isVerified

import type { Listing } from "../data";
import type { ListingViewWithCounts } from "../sdui/api";
import { serverListings } from "../store/listings";

/** 残時間を「2日 14h」「14h 32m」「32m」「終了」形式で整形。
 *  即決出品 (auction=false) は "即決のみ" 固定。 */
const formatEndsIn = (endsAt: string | null, isAuction: boolean): string => {
  if (!isAuction) return "即決のみ";
  if (!endsAt) return "—";
  const end = new Date(endsAt).getTime();
  const now = Date.now();
  const diffMs = end - now;
  if (diffMs <= 0) return "終了";
  const totalMin = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return `${days}日 ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const normalize = (v: ListingViewWithCounts): Listing => ({
  id: v.publicId,
  title: v.title,
  seller: v.sellerName,
  price: v.currentPriceJpy ?? v.startingPriceJpy,
  bids: v.isAuction ? v.bidCount : null,
  watchers: v.watcherCount,
  endsIn: formatEndsIn(v.endsAt, v.isAuction),
  auction: v.isAuction,
  verified: v.isVerified,
});

export const listMarketListings = (): Listing[] =>
  serverListings().map(normalize);
