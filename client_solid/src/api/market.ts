// api/market.ts — C2C マーケットの出品一覧
import { APP_DATA, type Listing } from "../data";

export const listMarketListings = (): Listing[] => APP_DATA.listings;
