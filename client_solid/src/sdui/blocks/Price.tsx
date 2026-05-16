// Price.tsx — Block.type === "price" のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.8 (Price)
//
// **MVP の通貨**: JPY のみ (Currency enum に JPY しかない)。
//   - 円表記 ¥ は 全角 ￥ ではなく半角 ¥ を採用 (既存 .price-yen と整合)
//   - amount は i64 (税込/抜きどちらでも同じ整数)。toLocaleString("ja-JP") で 3 桁区切り
//   - tax_included が true なら "税込" / false なら "税別" を末尾に小さく付ける
//
// 既存 .serif / .price / .price-yen を流用 (tokens.css)。

import type { Block } from "../branded";

type PriceBlock = Extract<Block, { type: "price" }>;

/** Number → "¥48,000" 形式。MVP は JPY 固定。 */
const formatJpy = (amount: number): string =>
  amount.toLocaleString("ja-JP");

export const PriceBlockView = (props: { block: PriceBlock }) => {
  return (
    <div style={{ display: "flex", "align-items": "baseline", gap: "4px" }}>
      <span class="serif price" style={{ "font-size": "22px", "font-weight": "600" }}>
        <span class="price-yen">¥</span>
        {formatJpy(props.block.amount)}
      </span>
      <span style={{ "font-size": "11px", color: "var(--ink-mute)" }}>
        {props.block.taxIncluded ? "税込" : "税別"}
      </span>
    </div>
  );
};
