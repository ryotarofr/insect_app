// CartCard.test.tsx — `template === "cart"` テンプレートの単体テスト (Phase 7)
//
// **検証ポイント (MVP)**:
//   - 4 リージョン (header / items / summary / cta) が描画される
//   - data-template="cart" / data-card-id 属性が付く
//   - items が空 → "カートは空です" プレースホルダ + summary は出ない
//   - items 1 件以上 → LineItem 縦リスト + OrderSummary が出る
//   - cta region は空カート時も出る (= "買い物を続ける" の存在)
//
// **戦略**:
//   実 LineItem / OrderSummary が描画されることまで検証 (= 統合テスト寄り)。
//   CartReloadProvider なしで描画 → no-op fallback で壊れないこと自体を保証。

import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import type { CardBlock } from "../branded";
import { asHref } from "../branded";
import { CartCard } from "./CartCard";

type CartCardBlock = Extract<CardBlock, { template: "cart" }>;

const raw = (text: string) => ({ source: "raw" as const, text });

const emptyCart = (): CartCardBlock => ({
  template: "cart",
  id: "cart",
  variant: "default",
  regions: {
    header: [
      {
        type: "text",
        key: "header-title",
        role: "headline",
        content: raw("あなたのカート (0 件)"),
      },
    ],
    items: [],
    shipping: [],
    shippingMethod: [],
    summary: [],
    cta: [
      {
        type: "cta",
        key: "cta-keep",
        intent: "secondary",
        href: asHref("/products"),
        label: raw("買い物を続ける"),
      },
    ],
  },
});

const filledCart = (): CartCardBlock => ({
  template: "cart",
  id: "cart",
  variant: "default",
  regions: {
    header: [
      {
        type: "text",
        key: "header-title",
        role: "headline",
        content: raw("あなたのカート (2 件)"),
      },
    ],
    items: [
      {
        type: "line_item",
        key: "li-tok-a",
        productId: "p-a",
        title: raw("ヘラクレス"),
        unitPriceAmount: 48000,
        currency: "JPY",
        qty: 2,
        subtotalAmount: 96000,
        detailHref: asHref("/products/p-a"),
        decrementAction: { type: "set_qty", token: "tok-a", qty: 1 },
        incrementAction: { type: "set_qty", token: "tok-a", qty: 3 },
        removeAction: { type: "remove", token: "tok-a" },
      },
      {
        type: "line_item",
        key: "li-tok-b",
        productId: "p-b",
        title: raw("コーカサス"),
        unitPriceAmount: 12000,
        currency: "JPY",
        qty: 1,
        subtotalAmount: 12000,
        detailHref: asHref("/products/p-b"),
        // qty == 1 → decrement disabled
        incrementAction: { type: "set_qty", token: "tok-b", qty: 2 },
        removeAction: { type: "remove", token: "tok-b" },
      },
    ],
    shipping: [],
    shippingMethod: [],
    summary: [
      {
        type: "order_summary",
        key: "summary",
        lineCount: 2,
        totalQty: 3,
        subtotalAmount: 108000,
        totalAmount: 108000,
        currency: "JPY",
      },
    ],
    cta: [
      {
        type: "cta",
        key: "cta-checkout",
        intent: "primary",
        href: asHref("/cart"),
        label: raw("レジへ進む"),
      },
      {
        type: "cta",
        key: "cta-keep",
        intent: "secondary",
        href: asHref("/products"),
        label: raw("買い物を続ける"),
      },
    ],
  },
});

describe("CartCard (rendering)", () => {
  it("data-template / data-card-id / data-variant 属性が付く", () => {
    const { container } = render(() => <CartCard card={filledCart()} />);
    const root = container.querySelector("[data-template='cart']");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-card-id")).toBe("cart");
    expect(root?.getAttribute("data-variant")).toBe("default");
  });

  it("変種 (variant) 未指定なら default にフォールバックする", () => {
    const card = { ...filledCart(), variant: undefined } as CartCardBlock;
    const { container } = render(() => <CartCard card={card} />);
    expect(
      container
        .querySelector("[data-template='cart']")
        ?.getAttribute("data-variant"),
    ).toBe("default");
  });

  it("header の text block が出る", () => {
    const { container } = render(() => <CartCard card={filledCart()} />);
    expect(container.textContent).toContain("あなたのカート (2 件)");
  });
});

describe("CartCard (filled)", () => {
  it("各 LineItem が data-block-type='line_item' として出る", () => {
    const { container } = render(() => <CartCard card={filledCart()} />);
    const items = container.querySelectorAll(
      "[data-block-type='line_item']",
    );
    expect(items.length).toBe(2);
    expect(items[0]?.getAttribute("data-product-id")).toBe("p-a");
    expect(items[1]?.getAttribute("data-product-id")).toBe("p-b");
  });

  it("OrderSummary が出て合計が描画される", () => {
    const { container } = render(() => <CartCard card={filledCart()} />);
    expect(
      container.querySelector("[data-block-type='order_summary']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("¥108,000");
  });

  it("CTA region に Primary / Secondary CTA が両方出る", () => {
    const { container } = render(() => <CartCard card={filledCart()} />);
    expect(container.textContent).toContain("レジへ進む");
    expect(container.textContent).toContain("買い物を続ける");
  });

  it("空 state (data-cart-empty) は出ない", () => {
    const { container } = render(() => <CartCard card={filledCart()} />);
    expect(container.querySelector("[data-cart-empty='true']")).toBeNull();
  });
});

describe("CartCard (empty)", () => {
  it("items === [] のとき 'カートは空です' プレースホルダが出る", () => {
    const { container } = render(() => <CartCard card={emptyCart()} />);
    const empty = container.querySelector("[data-cart-empty='true']");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("カートは空です");
  });

  it("items === [] のとき LineItem は描画されない", () => {
    const { container } = render(() => <CartCard card={emptyCart()} />);
    expect(
      container.querySelector("[data-block-type='line_item']"),
    ).toBeNull();
  });

  it("空カートでも cta region は出る ('買い物を続ける' のみ)", () => {
    const { container } = render(() => <CartCard card={emptyCart()} />);
    expect(container.textContent).toContain("買い物を続ける");
    expect(container.textContent ?? "").not.toContain("レジへ進む");
  });

  it("summary region が空配列なら OrderSummary は出ない", () => {
    const { container } = render(() => <CartCard card={emptyCart()} />);
    expect(
      container.querySelector("[data-block-type='order_summary']"),
    ).toBeNull();
  });
});
