// OrderSummary.tsx — Block.type === "order_summary" のレンダラ (Phase 7)
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.11 (OrderSummary)
//
// **責務**:
//   - 小計 / 配送料 / 消費税 / 合計を縦並びで表示
//   - 配送料 (shippingAmount) と消費税 (taxAmount) は undefined なら行ごと省略
//     (= 「未計算」「内税で内訳出さない」を意味する)
//
// **shippingAmount の表現**:
//   - undefined  → 行を出さない (= 配送料はサーバ未確定 / 後続フェーズで計算)
//   - 0          → "送料無料" と表示 (= 0 円を視覚的に強調)
//   - 正の数     → 通常通り "¥1,200"
//
// total_amount は subtotal + shipping を server 側で確定済み。クライアント計算しない。

import { Show } from "solid-js";

import type { Block } from "../branded";

type OrderSummaryBlock = Extract<Block, { type: "order_summary" }>;

/** Number → "¥48,000" 形式。MVP は JPY 固定。 */
const formatJpy = (amount: number): string =>
  amount.toLocaleString("ja-JP");

const Row = (props: {
  label: string;
  value: string;
  emphasized?: boolean;
}) => (
  <div
    style={{
      display: "flex",
      "justify-content": "space-between",
      "align-items": "baseline",
      padding: props.emphasized ? "8px 0" : "4px 0",
      "font-size": props.emphasized ? "16px" : "13px",
      "font-weight": props.emphasized ? "600" : "400",
      color: props.emphasized ? "var(--ink)" : "var(--ink-mute)",
      "border-top": props.emphasized ? "1px solid var(--line-strong)" : "none",
      "margin-top": props.emphasized ? "8px" : "0",
    }}
  >
    <span>{props.label}</span>
    <span class={props.emphasized ? "serif" : ""}>{props.value}</span>
  </div>
);

export const OrderSummaryBlockView = (props: { block: OrderSummaryBlock }) => {
  return (
    <div
      data-block-type="order_summary"
      style={{
        display: "flex",
        "flex-direction": "column",
        padding: "12px 0",
      }}
    >
      <Row
        label={`小計 (${props.block.totalQty} 点)`}
        value={`¥${formatJpy(props.block.subtotalAmount)}`}
      />
      <Show when={props.block.shippingAmount != null}>
        <Row
          label="配送料"
          value={
            props.block.shippingAmount === 0
              ? "送料無料"
              : `¥${formatJpy(props.block.shippingAmount as number)}`
          }
        />
      </Show>
      <Show when={props.block.taxAmount != null}>
        <Row
          label="(うち消費税)"
          value={`¥${formatJpy(props.block.taxAmount as number)}`}
        />
      </Show>
      <Row
        label="合計"
        value={`¥${formatJpy(props.block.totalAmount)}`}
        emphasized
      />
    </div>
  );
};
