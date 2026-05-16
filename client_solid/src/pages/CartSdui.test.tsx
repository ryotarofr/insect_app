// CartSdui.test.tsx — /cart-sdui ページの統合テスト (Phase 7)
//
// **狙い**:
//   - mount で `GET /api/v1/cards/cart` が走る
//   - 200 OK で CartCard 描画 (LineItem / OrderSummary / CTA)
//   - LineItem の '+' ボタン click で PATCH → 再 fetch (refetch via CartReloadProvider)
//   - 5xx → ErrorView (data-cart-error="true") に倒れる
//   - network failure → ErrorView (status === 0 で文言切替)
//
// **戦略**:
//   global fetch を vi.stubGlobal で stub。
//   1 回目は cart card を返し、2 回目以降は PATCH/再 fetch をパスごとに分岐。

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CartSduiPage } from "./CartSdui";

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const emptyCartCardJson = () => ({
  template: "cart",
  id: "cart",
  variant: "default",
  regions: {
    header: [
      {
        type: "text",
        key: "header-title",
        role: "headline",
        content: { source: "raw", text: "あなたのカート (0 件)" },
      },
    ],
    items: [],
    summary: [],
    cta: [
      {
        type: "cta",
        key: "cta-keep",
        intent: "secondary",
        href: "/products",
        label: { source: "raw", text: "買い物を続ける" },
      },
    ],
  },
});

const filledCartCardJson = (qty = 2) => ({
  template: "cart",
  id: "cart",
  variant: "default",
  regions: {
    header: [
      {
        type: "text",
        key: "header-title",
        role: "headline",
        content: {
          source: "raw",
          text: `あなたのカート (${qty} 件)`,
        },
      },
    ],
    items: [
      {
        type: "line_item",
        key: "li-tok-a",
        productId: "p-a",
        title: { source: "raw", text: "ヘラクレス" },
        unitPriceAmount: 48000,
        currency: "JPY",
        qty,
        subtotalAmount: 48000 * qty,
        detailHref: "/products/p-a",
        decrementAction:
          qty <= 1
            ? undefined
            : { type: "set_qty", token: "tok-a", qty: qty - 1 },
        incrementAction: { type: "set_qty", token: "tok-a", qty: qty + 1 },
        removeAction: { type: "remove", token: "tok-a" },
      },
    ],
    summary: [
      {
        type: "order_summary",
        key: "summary",
        lineCount: 1,
        totalQty: qty,
        subtotalAmount: 48000 * qty,
        totalAmount: 48000 * qty,
        currency: "JPY",
      },
    ],
    cta: [
      {
        type: "cta",
        key: "cta-checkout",
        intent: "primary",
        href: "/cart",
        label: { source: "raw", text: "レジへ進む" },
      },
    ],
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CartSduiPage (load)", () => {
  it("mount で GET /api/v1/cards/cart を叩く", async () => {
    const mock = vi.fn().mockResolvedValue(okJson(emptyCartCardJson()));
    vi.stubGlobal("fetch", mock);

    render(() => <CartSduiPage />);

    await waitFor(() => {
      expect(mock).toHaveBeenCalled();
    });
    const url = mock.mock.calls[0]?.[0] as string;
    expect(url).toBe("/api/v1/cards/cart");
  });

  it("空カート → 'カートは空です' プレースホルダ + '買い物を続ける' CTA", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson(emptyCartCardJson())),
    );

    const { container } = render(() => <CartSduiPage />);

    await waitFor(() => {
      expect(
        container.querySelector("[data-cart-empty='true']"),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain("買い物を続ける");
  });

  it("filled カート → LineItem + OrderSummary + Primary CTA が出る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson(filledCartCardJson(2))),
    );

    const { container } = render(() => <CartSduiPage />);

    await waitFor(() => {
      expect(
        container.querySelector("[data-block-type='line_item']"),
      ).not.toBeNull();
    });
    expect(
      container.querySelector("[data-block-type='order_summary']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("レジへ進む");
    expect(container.textContent).toContain("¥96,000");
  });
});

describe("CartSduiPage (errors)", () => {
  it("500 → ErrorView (data-cart-error='true') に倒れる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );

    const { container } = render(() => <CartSduiPage />);

    await waitFor(() => {
      expect(
        container.querySelector("[data-cart-error='true']"),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain("カート情報を取得できませんでした");
    expect(container.textContent).toContain("500");
  });

  it("network failure (status=0) → 'ネットワーク接続を確認してください'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const { container } = render(() => <CartSduiPage />);

    await waitFor(() => {
      expect(
        container.querySelector("[data-cart-error='true']"),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain("ネットワーク");
  });
});

describe("CartSduiPage (refetch on mutation)", () => {
  it("LineItem '+' click で PATCH を叩いた後、GET /cards/cart を再 fetch する", async () => {
    // 1: GET /cards/cart (qty=2)
    // 2: PATCH /cart/items/tok-a (qty=3) → { cartCount: 3 }
    // 3: GET /cards/cart (qty=3) — refetch 後の真値
    let getCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(okJson({ cartCount: 3 }));
      }
      if (typeof url === "string" && url.startsWith("/api/v1/cards/cart")) {
        getCalls += 1;
        const qty = getCalls === 1 ? 2 : 3;
        return Promise.resolve(okJson(filledCartCardJson(qty)));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(() => <CartSduiPage />);
    await waitFor(() => {
      expect(
        container.querySelector("[data-block-type='line_item']"),
      ).not.toBeNull();
    });

    // 1 回目の GET の後で qty=2 が表示されている
    expect(container.textContent).toContain("(2 件)");

    fireEvent.click(
      container.querySelector(
        "button[data-action-type='increment']",
      ) as HTMLButtonElement,
    );

    // PATCH 後 reload が走り、2 回目の GET で qty=3 になる
    await waitFor(() => {
      expect(container.textContent).toContain("(3 件)");
    });

    // 呼び出し履歴: GET, PATCH, GET (順序は ↑ の implementation で保証)
    const calls = fetchMock.mock.calls.map(
      ([url, init]) =>
        `${(init as RequestInit | undefined)?.method ?? "GET"} ${url}`,
    );
    expect(calls).toEqual([
      "GET /api/v1/cards/cart",
      "PATCH /api/v1/cart/items/tok-a",
      "GET /api/v1/cards/cart",
    ]);
  });
});
