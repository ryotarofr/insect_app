// store/listings.ts — C2C marketplace の出品一覧 (= /api/v1/listings) の reactive cache
//
// **責務**:
//   - アプリ起動時に `loadListings()` を 1 度呼んで `ListingViewWithCounts[]` を signal に詰める
//   - `serverListings()` で同期的に最新値を読めるようにする
//
// **設計判断**:
//   - store/products.ts と同じパターン: 起動時 1 回 fetch + module-scope signal
//   - **公開 API**: `/listings` は anonymous でも 200 で返るので login 状態に依存しない
//   - 失敗時は空配列 (= UI 側は「読込中 / 出品なし」表示)

import { createSignal } from "solid-js";

import { type ListingViewWithCounts, fetchListings } from "../sdui/api";

const [listings, setListings] = createSignal<ListingViewWithCounts[]>([]);

/** marketplace の出品一覧 reactive accessor。loadListings() 前は空配列。 */
export const serverListings = listings;

/** `GET /api/v1/listings` を叩いて signal に詰める。失敗時は warn ログ + 前回値維持。 */
export const loadListings = async (): Promise<ListingViewWithCounts[]> => {
  try {
    const list = await fetchListings();
    setListings(list);
    return list;
  } catch (e) {
    console.warn("[store/listings] fetch failed:", e);
    return listings();
  }
};

/** テスト専用: signal にフィクスチャを直接セットする。 */
export const setListingsForTest = (list: ListingViewWithCounts[]): void => {
  setListings(list);
};

/** テスト専用: signal をリセット。 */
export const resetListingsForTest = (): void => {
  setListings([]);
};
