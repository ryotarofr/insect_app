// OrderSummary.test.tsx — `Block.type === "order_summary"` レンダラの単体テスト (Phase 7)
//
// **狙い**:
//   - 各行 (小計 / 配送料 / 消費税 / 合計) が正しい数値で出る
//   - shippingAmount / taxAmount の undefined / 0 / 正の数の表示分岐
//   - 合計行が emphasized (border-top + serif) で描画される
//
// **戦略**:
//   コンポーネントが純粋なので fetch / context は不要。
//   block を直接食わせて DOM をスキャンする。

import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import type { Block } from "../branded";
import { OrderSummaryBlockView } from "./OrderSummary";

type OrderSummaryBlock = Extract<Block, { type: "order_summary" }>;

describe("OrderSummaryBlockView", () => {
  it("subtotal / total / totalQty が JPY 3 桁区切りで描画される", () => {
    const block: OrderSummaryBlock = {
      type: "order_summary",
      key: "os1",
      lineCount: 2,
      totalQty: 3,
      subtotalAmount: 48000,
      totalAmount: 48000,
      currency: "JPY",
    };
    const { container } = render(() => <OrderSummaryBlockView block={block} />);
    const root = container.querySelector("[data-block-type='order_summary']");
    expect(root).not.toBeNull();
    // 行のテキストを連結 (jsdom の textContent はスペース無し連結)
    const text = root!.textContent ?? "";
    expect(text).toContain("小計 (3 点)");
    expect(text).toContain("¥48,000");
    expect(text).toContain("合計");
  });

  it("shippingAmount === 0 → '送料無料' と出る", () => {
    const block: OrderSummaryBlock = {
      type: "order_summary",
      key: "os1",
      lineCount: 1,
      totalQty: 1,
      subtotalAmount: 10000,
      shippingAmount: 0,
      totalAmount: 10000,
      currency: "JPY",
    };
    const { container } = render(() => <OrderSummaryBlockView block={block} />);
    expect(container.textContent).toContain("配送料");
    expect(container.textContent).toContain("送料無料");
  });

  it("shippingAmount > 0 → ¥1,200 のように出る", () => {
    const block: OrderSummaryBlock = {
      type: "order_summary",
      key: "os1",
      lineCount: 1,
      totalQty: 1,
      subtotalAmount: 10000,
      shippingAmount: 1200,
      totalAmount: 11200,
      currency: "JPY",
    };
    const { container } = render(() => <OrderSummaryBlockView block={block} />);
    expect(container.textContent).toContain("配送料");
    expect(container.textContent).toContain("¥1,200");
    expect(container.textContent).not.toContain("送料無料");
  });

  it("shippingAmount === undefined → 配送料 行ごと出ない", () => {
    const block: OrderSummaryBlock = {
      type: "order_summary",
      key: "os1",
      lineCount: 1,
      totalQty: 1,
      subtotalAmount: 10000,
      totalAmount: 10000,
      currency: "JPY",
    };
    const { container } = render(() => <OrderSummaryBlockView block={block} />);
    expect(container.textContent ?? "").not.toContain("配送料");
  });

  it("taxAmount が定義されていれば '(うち消費税)' 行が出る", () => {
    const block: OrderSummaryBlock = {
      type: "order_summary",
      key: "os1",
      lineCount: 1,
      totalQty: 2,
      subtotalAmount: 22000,
      taxAmount: 2000,
      totalAmount: 22000,
      currency: "JPY",
    };
    const { container } = render(() => <OrderSummaryBlockView block={block} />);
    expect(container.textContent).toContain("(うち消費税)");
    expect(container.textContent).toContain("¥2,000");
  });

  it("taxAmount === undefined → 消費税行は出ない", () => {
    const block: OrderSummaryBlock = {
      type: "order_summary",
      key: "os1",
      lineCount: 1,
      totalQty: 1,
      subtotalAmount: 1000,
      totalAmount: 1000,
      currency: "JPY",
    };
    const { container } = render(() => <OrderSummaryBlockView block={block} />);
    expect(container.textContent ?? "").not.toContain("消費税");
  });

  it("subtotal と total が違う (送料込み) も正しく描画", () => {
    const block: OrderSummaryBlock = {
      type: "order_summary",
      key: "os1",
      lineCount: 3,
      totalQty: 4,
      subtotalAmount: 100000,
      shippingAmount: 1500,
      taxAmount: 9091,
      totalAmount: 101500,
      currency: "JPY",
    };
    const { container } = render(() => <OrderSummaryBlockView block={block} />);
    const text = container.textContent ?? "";
    expect(text).toContain("¥100,000"); // subtotal
    expect(text).toContain("¥1,500"); // shipping
    expect(text).toContain("¥9,091"); // tax
    expect(text).toContain("¥101,500"); // total
  });
});
