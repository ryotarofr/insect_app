// components/market/ListingCard.tsx — C2C 出品 1 件のカード表示
//
// 旧 pages/Market.tsx::MarketBrowse からカード JSX を抽出。
// /products (= 統合一覧) と他ページから再利用する。
//
// **データ源**:
//   `Listing` (= api/market.ts で server `ListingViewWithCounts` を正規化したもの)。
//   将来 SDUI 化したら branded.ts の Card 型に置き換える予定。
//
// **状態色分け** (= 旧 deriveListingState を内蔵):
//   - ending-soon: オークションで残時間が "日" を含まない (= 24h 以内、rose)
//   - auction    : オークションで "日" を含む (= 1 日以上あり、amber)
//   - buynow     : 即決のみ (forest)

import { Show } from "solid-js";
import type { Listing } from "../../data";

type ListingState = "ending-soon" | "auction" | "buynow";

const deriveListingState = (l: Listing): ListingState => {
  if (!l.auction) return "buynow";
  return l.endsIn.includes("日") ? "auction" : "ending-soon";
};

interface Props {
  listing: Listing;
  /** 入札 / 購入 / ウォッチ ボタンのクリック (現状は未配線、後続 PR で wire up)。 */
  onBid?: (l: Listing) => void;
  onBuy?: (l: Listing) => void;
  onWatch?: (l: Listing) => void;
}

export const ListingCard = (props: Props) => {
  const l = () => props.listing;
  return (
    <div
      class="card market-card"
      data-state={deriveListingState(l())}
      style={{ display: "flex", gap: 0, overflow: "hidden", cursor: "pointer" }}
    >
      <div
        class="ph forest"
        style={{
          width: "180px",
          "min-height": "180px",
          "border-radius": 0,
          "flex-shrink": 0,
          border: "none",
          "border-right": "1px solid var(--line)",
        }}
        role="img"
        aria-label={`${l().title} 出品画像 (プレースホルダ)`}
      >
        <span class="ph-label">出品画像</span>
      </div>
      <div style={{ padding: "16px", flex: 1, display: "flex", "flex-direction": "column" }}>
        <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "4px" }}>
          <span class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
            {l().id}
          </span>
          <span class={`chip ${l().auction ? "amber" : "forest"}`}>
            {l().auction ? `オークション · 残 ${l().endsIn}` : "即決のみ"}
          </span>
        </div>
        <div style={{ "font-weight": 600, "font-size": "14px" }}>{l().title}</div>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            "margin-top": "6px",
            "font-size": "12px",
            color: "var(--ink-mute)",
          }}
        >
          <span>
            出品者: <b style={{ color: "var(--ink)" }}>{l().seller}</b>
          </span>
          <Show when={l().verified}>
            <span class="chip indigo" style={{ padding: "1px 6px", "font-size": "10px" }}>
              ✓ 認証ブリーダー
            </span>
          </Show>
        </div>

        <div
          style={{
            display: "flex",
            "align-items": "baseline",
            gap: "4px",
            "margin-top": "auto",
            "padding-top": "14px",
          }}
        >
          <span class="serif price" style={{ "font-size": "24px", "font-weight": 600 }}>
            <span class="price-yen">¥</span>
            {l().price.toLocaleString()}
          </span>
          <span style={{ "font-size": "11px", color: "var(--ink-mute)", "margin-left": "4px" }}>
            {l().auction ? "現在価格" : "即決"}
          </span>
          <div
            style={{
              "margin-left": "auto",
              display: "flex",
              gap: "12px",
              "font-size": "11px",
              color: "var(--ink-mute)",
            }}
          >
            <Show when={l().bids !== null}>
              <span>
                入札{" "}
                <b class="mono" style={{ color: "var(--ink)" }}>
                  {l().bids}
                </b>
              </span>
            </Show>
            <span>👁 {l().watchers}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px", "margin-top": "12px" }}>
          <Show when={l().auction}>
            <button class="btn sm" style={{ flex: 1 }} onClick={() => props.onBid?.(l())}>
              入札
            </button>
          </Show>
          <button class="btn sm primary" style={{ flex: 1 }} onClick={() => props.onBuy?.(l())}>
            {l().auction ? "即決購入" : "購入する"}
          </button>
          <button class="btn sm ghost" onClick={() => props.onWatch?.(l())}>
            ♡
          </button>
        </div>
      </div>
    </div>
  );
};
