// store/myListings.ts — login user の自分の出品 (= /api/v1/listings/me) の reactive cache
//
// **責務** (= store/myLogs.ts と同じパターン):
//   - login user の自分の出品を 1 fetch で取得し signal に詰める
//   - `serverMyListings()` で sync 読み
//   - `refreshMyListings()` で再取得 (= 出品作成 / 取消後の cache 同期)
//
// **設計判断**:
//   - status filter はサーバ側 (`?status=...`) で行う設計だが、MVP の規模なら
//     **「全 status を 1 度に取得 → クライアント派生で分類」** のほうが画面遷移が軽い。
//     - サーバ往復が 1 回になり、タブ切替で再 fetch しない
//     - `cancel_listing` 後のような「active → canceled」の遷移を 1 cache で完結
//   - 401 は静かに [] にして toast を出さない (= anonymous)
//   - 5xx / network は error signal に詰めて、UI 側で警告バナー余地

import { createMemo, createSignal } from "solid-js";

import {
  type ListingViewWithCounts,
  SduiFetchError,
  fetchMyListings,
} from "../sdui/api";

const [listings, setListings] = createSignal<ListingViewWithCounts[]>([]);
const [error, setError] = createSignal<string | null>(null);
const [isLoading, setIsLoading] = createSignal<boolean>(false);

/** login user の自分の出品 (= 全 status / id 降順)。anonymous / 未取得は空配列。 */
export const serverMyListings = listings;

/** 最終 fetch エラー (= 401 は除く)。 */
export const serverMyListingsError = error;

/** `refreshMyListings()` 進行中フラグ。 */
export const isMyListingsLoading = isLoading;

/** `GET /api/v1/listings/me` (= 全 status) を 1 回叩いて signal に詰める。
 *  - 401 → cache を空配列にして静かに終了 (= anonymous)
 *  - 200 → 配列を signal に詰める
 *  - 5xx / network → error に詰めて throw */
export const refreshMyListings = async (): Promise<ListingViewWithCounts[]> => {
  setError(null);
  setIsLoading(true);
  try {
    const list = await fetchMyListings("all");
    setListings(list);
    return list;
  } catch (e) {
    if (e instanceof SduiFetchError && e.status === 401) {
      setListings([]);
      return [];
    }
    const msg = e instanceof Error ? e.message : String(e);
    setError(msg);
    throw e;
  } finally {
    setIsLoading(false);
  }
};

/** fire-and-forget で再取得。出品作成 / cancel 直後の cache 同期に使う。 */
export const triggerMyListingsRefresh = (): void => {
  refreshMyListings().catch((e) => {
    console.warn("triggerMyListingsRefresh failed:", e);
  });
};

/** logout / anonymous 遷移で cache を空に戻す。 */
export const clearMyListings = (): void => {
  setListings([]);
  setError(null);
};

// ──────────────────────────────────────────────────────────────────────
// 派生 selector (= MyPage / MyListings の KPI / タブで使う)
// ──────────────────────────────────────────────────────────────────────

/** status 別の集計 (= 出品中 / 入札あり / 売却済 / 取消・期限切れ)。
 *
 *  「入札あり」は status='active' && bid_count > 0 で派生 (= "入札中" タブ用)。
 *  cache はそのまま全件持っているので、タブ切替で再 fetch せずに済む。 */
export const myListingsByStatus = createMemo(() => {
  const all = listings();
  return {
    active: all.filter((l) => l.status === "active"),
    bidding: all.filter((l) => l.status === "active" && l.bidCount > 0),
    sold: all.filter((l) => l.status === "sold"),
    canceledOrExpired: all.filter(
      (l) => l.status === "canceled" || l.status === "expired",
    ),
    /** 全件 (= タブ件数表示の既定 = active.length 等で参照) */
    all,
  };
});

/** トップ KPI 用の集計値。 */
export const myListingsKpi = createMemo(() => {
  const grp = myListingsByStatus();
  // ウォッチ合計 (= active 出品の watcher_count 合計)
  const watcherTotal = grp.active.reduce((acc, l) => acc + l.watcherCount, 0);
  // 入札あり件数 (= bidding.length と同義だが KPI 表示で別名にする)
  const biddingCount = grp.bidding.length;
  return {
    activeCount: grp.active.length,
    biddingCount,
    watcherTotal,
    soldCount: grp.sold.length,
    auctionActiveCount: grp.active.filter((l) => l.isAuction).length,
  };
});

// ──────────────────────────────────────────────────────────────────────
// テスト用 helper
// ──────────────────────────────────────────────────────────────────────

/** テスト専用: signal にフィクスチャを直接セットする。 */
export const setMyListingsForTest = (list: ListingViewWithCounts[]): void => {
  setListings(list);
};

/** テスト専用: signal をリセット。 */
export const resetMyListingsForTest = (): void => {
  setListings([]);
  setError(null);
  setIsLoading(false);
};
