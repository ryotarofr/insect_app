// LineItem.test.tsx — `Block.type === "line_item"` レンダラの単体テスト (Phase 7)
//
// **狙い**:
//   - 基本描画 (タイトル / 単価 / qty / 小計 / detailHref / image)
//   - decrementAction === undefined のとき "−" ボタンが disabled
//   - +/- / 削除ボタンの click が API を叩いて reload を呼ぶ
//   - reload の no-op fallback (Provider 不在で例外吐かない)
//   - 失敗時は toast に流れる
//   - 多重 click (pending) は API 1 回しか呼ばない
//
// **戦略**:
//   - global fetch を vi.stubGlobal で stub
//   - reload は vi.fn() を CartReloadProvider 経由で渡す
//   - clearToasts で副作用を分離

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block } from "../branded";
import { asHref } from "../branded";
import { LineItemBlockView } from "./LineItem";
import { CartReloadProvider } from "../CartContext";
import { clearToasts, toastList } from "../../store/toast";

const raw = (text: string) => ({ source: "raw" as const, text });

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type LineItemBlock = Extract<Block, { type: "line_item" }>;

const makeBlock = (
  overrides: Partial<LineItemBlock> = {},
): LineItemBlock => ({
  type: "line_item",
  key: "li-tok42",
  productId: "p-x",
  title: raw("ヘラクレスオオカブト"),
  imageAlt: raw("ヘラクレスオオカブト"),
  unitPriceAmount: 48000,
  currency: "JPY",
  qty: 2,
  subtotalAmount: 96000,
  detailHref: asHref("/products/p-x"),
  decrementAction: { type: "set_qty", token: "tok42", qty: 1 },
  incrementAction: { type: "set_qty", token: "tok42", qty: 3 },
  removeAction: { type: "remove", token: "tok42" },
  ...overrides,
});

beforeEach(() => {
  clearToasts();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LineItemBlockView (rendering)", () => {
  it("タイトル / 単価 / qty / 小計 / detailHref を出す", () => {
    const { container } = render(() => (
      <LineItemBlockView block={makeBlock()} />
    ));
    const root = container.querySelector("[data-block-type='line_item']");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-product-id")).toBe("p-x");
    const text = root!.textContent ?? "";
    expect(text).toContain("ヘラクレスオオカブト");
    expect(text).toContain("¥48,000"); // unit price
    expect(text).toContain("¥96,000"); // subtotal
    expect(text).toContain("2"); // qty
    // 詳細リンク
    const links = container.querySelectorAll("a[href='/products/p-x']");
    expect(links.length).toBeGreaterThan(0);
  });

  it("decrementAction === undefined のとき '−' ボタンが disabled", () => {
    const block = makeBlock({ decrementAction: undefined, qty: 1 });
    const { container } = render(() => <LineItemBlockView block={block} />);
    const dec = container.querySelector(
      "button[data-action-type='decrement']",
    ) as HTMLButtonElement;
    expect(dec).not.toBeNull();
    expect(dec.disabled).toBe(true);
  });

  it("imageSrc 不在なら <img> は出ない (placeholder セルだけ)", () => {
    const { container } = render(() => (
      <LineItemBlockView block={makeBlock({ imageSrc: undefined })} />
    ));
    expect(container.querySelector("img")).toBeNull();
  });

  it("imageSrc あり → <img alt> が描画される", () => {
    const block = makeBlock({
      imageSrc: "https://example.com/x.jpg",
      imageAlt: raw("ヘラクレス標本"),
    });
    const { container } = render(() => <LineItemBlockView block={block} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/x.jpg");
    expect(img?.getAttribute("alt")).toBe("ヘラクレス標本");
  });
});

describe("LineItemBlockView (actions)", () => {
  it("'+' click で PATCH /cart/items/:token に新 qty を送り、reload を呼ぶ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ cartCount: 3 }));
    vi.stubGlobal("fetch", fetchMock);
    const reload = vi.fn().mockResolvedValue(undefined);

    const { container } = render(() => (
      <CartReloadProvider value={reload}>
        <LineItemBlockView block={makeBlock()} />
      </CartReloadProvider>
    ));
    const inc = container.querySelector(
      "button[data-action-type='increment']",
    ) as HTMLButtonElement;
    fireEvent.click(inc);

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/cart/items/tok42");
    expect(init.method).toBe("PATCH");
    // 増加: qty 2 → 3
    expect(init.body).toBe(JSON.stringify({ qty: 3 }));
  });

  it("'−' click で PATCH に新 qty (qty - 1) を送り、reload を呼ぶ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ cartCount: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const reload = vi.fn().mockResolvedValue(undefined);

    const { container } = render(() => (
      <CartReloadProvider value={reload}>
        <LineItemBlockView block={makeBlock()} />
      </CartReloadProvider>
    ));
    const dec = container.querySelector(
      "button[data-action-type='decrement']",
    ) as HTMLButtonElement;
    fireEvent.click(dec);

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0]!;
    // 減少: 2 → 1
    expect(init.body).toBe(JSON.stringify({ qty: 1 }));
  });

  it("'削除' click で DELETE /cart/items/:token を叩いて reload を呼ぶ", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const reload = vi.fn().mockResolvedValue(undefined);

    const { container } = render(() => (
      <CartReloadProvider value={reload}>
        <LineItemBlockView block={makeBlock()} />
      </CartReloadProvider>
    ));
    const remove = container.querySelector(
      "button[data-action-type='remove']",
    ) as HTMLButtonElement;
    fireEvent.click(remove);

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/cart/items/tok42");
    expect(init.method).toBe("DELETE");
  });

  it("CartReloadProvider 不在 (no-op fallback) でも click は壊れない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ cartCount: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(() => (
      <LineItemBlockView block={makeBlock()} />
    ));
    const inc = container.querySelector(
      "button[data-action-type='increment']",
    ) as HTMLButtonElement;

    // throw しないことを確認 (= no-op reload が呼ばれるだけ)
    fireEvent.click(inc);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("disabled な '−' button (decrementAction undefined) は click しても fetch しない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const reload = vi.fn();

    const { container } = render(() => (
      <CartReloadProvider value={reload}>
        <LineItemBlockView
          block={makeBlock({ decrementAction: undefined, qty: 1 })}
        />
      </CartReloadProvider>
    ));
    const dec = container.querySelector(
      "button[data-action-type='decrement']",
    ) as HTMLButtonElement;
    // disabled なので jsdom 上 onClick は起動しない (firefox 等と挙動一致)。
    fireEvent.click(dec);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("API 失敗 (500) → error tone toast を出し、reload は呼ばれない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );
    const reload = vi.fn();

    const { container } = render(() => (
      <CartReloadProvider value={reload}>
        <LineItemBlockView block={makeBlock()} />
      </CartReloadProvider>
    ));
    fireEvent.click(
      container.querySelector(
        "button[data-action-type='increment']",
      ) as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(toastList().some((t) => t.tone === "error")).toBe(true);
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("network 失敗時 → 'ネットワーク接続を確認してください' を出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const { container } = render(() => (
      <LineItemBlockView block={makeBlock()} />
    ));
    fireEvent.click(
      container.querySelector(
        "button[data-action-type='remove']",
      ) as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(
        toastList().some(
          (t) => t.tone === "error" && t.message.includes("ネットワーク"),
        ),
      ).toBe(true);
    });
  });

  it("削除失敗時の toast は '商品を削除できませんでした' (qty 更新と区別)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );

    const { container } = render(() => (
      <LineItemBlockView block={makeBlock()} />
    ));
    fireEvent.click(
      container.querySelector(
        "button[data-action-type='remove']",
      ) as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(
        toastList().some((t) =>
          t.message.includes("商品を削除できませんでした"),
        ),
      ).toBe(true);
    });
  });

  it("pending 中 (in-flight) は全ボタン disabled で 2 度目の click は無視", async () => {
    let resolve: ((res: Response) => void) | null = null;
    const slow = new Promise<Response>((r) => {
      resolve = r;
    });
    const fetchMock = vi.fn().mockImplementation(() => slow);
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(() => (
      <LineItemBlockView block={makeBlock()} />
    ));
    const inc = container.querySelector(
      "button[data-action-type='increment']",
    ) as HTMLButtonElement;

    fireEvent.click(inc);
    await waitFor(() => {
      expect(inc.disabled).toBe(true);
    });
    // 2 度目: pending guard で弾かれる
    fireEvent.click(inc);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // クリーンアップ
    resolve!(okJson({ cartCount: 3 }));
    await waitFor(() => {
      expect(inc.disabled).toBe(false);
    });
  });
});
