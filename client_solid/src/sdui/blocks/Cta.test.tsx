// Cta.test.tsx — CtaBlockView の action 分岐テスト (Phase 2.5)
//
// **戦略**:
//   - global fetch を vi.stubGlobal で差し替えて API 呼び出しを観測
//   - clearCart / clearToasts で各 it 間の state 分離
//   - action 無し → <a href> (既存 BlockRenderer.test.tsx 側でカバー済みだが、
//     ここでも 1 件だけ smoke 的に確認しておくと regression に強い)
//   - 失敗ケースは Response(status=500) と TypeError 両方をなぞる

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block } from "../branded";
import { asHref } from "../branded";
import { CtaBlockView } from "./Cta";
import { cartItems, clearCart } from "../../store/cart";
import { clearToasts, toastList } from "../../store/toast";
import {
  __getBufferForTest,
  __resetAnalyticsForTest,
} from "../analytics";
import { AnalyticsCardProvider } from "../AnalyticsContext";

const raw = (text: string) => ({ source: "raw" as const, text });

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  clearCart();
  clearToasts();
  __resetAnalyticsForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ──────────────────────────────────────────────────────────────────────
// action 無し → 既存の <a> 動作
// ──────────────────────────────────────────────────────────────────────

describe("CtaBlockView (no action)", () => {
  it("action 無しなら <a href> を描画 (progressive enhancement)", () => {
    const block: Extract<Block, { type: "cta" }> = {
      type: "cta",
      key: "c1",
      intent: "primary",
      href: asHref("/products/x"),
      label: raw("詳細を見る"),
    };
    const { container } = render(() => <CtaBlockView block={block} />);
    const a = container.querySelector("a") as HTMLAnchorElement | null;
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("/products/x");
    expect(a?.getAttribute("data-intent")).toBe("primary");
    // <button> ではない
    expect(container.querySelector("button")).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// add_to_cart action
// ──────────────────────────────────────────────────────────────────────

describe("CtaBlockView (add_to_cart)", () => {
  const makeBlock = (
    productId = "p-x",
    qty = 1,
  ): Extract<Block, { type: "cta" }> => ({
    type: "cta",
    key: "cta-add",
    intent: "primary",
    href: asHref("/cart"),
    label: raw("カートに追加"),
    action: { type: "add_to_cart", productId, qty },
  });

  it("button として描画され、data-action-type が add_to_cart", () => {
    const { container } = render(() => <CtaBlockView block={makeBlock()} />);
    const btn = container.querySelector("button") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("data-action-type")).toBe("add_to_cart");
    // <a> は出ない
    expect(container.querySelector("a")).toBeNull();
  });

  it("クリックで POST /api/v1/cart に productId/qty を送り、成功 Toast を出す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson({ cartCount: 1, undoToken: "undo_42" }));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(() => (
      <CtaBlockView block={makeBlock("p-x", 2)} />
    ));
    const btn = container.querySelector("button")!;
    fireEvent.click(btn);

    await waitFor(() => {
      expect(toastList().some((t) => t.message === "カートに追加しました")).toBe(
        true,
      );
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/cart");
    expect(init.method).toBe("POST");
    // C2C pivot (migration 0021): cart_items.product_id → listing_id に変更。
    // request body のキーも productId → listingId。
    expect(init.body).toBe(JSON.stringify({ listingId: "p-x", qty: 2 }));

    // local store にも mirror されている
    expect(cartItems().some((i) => i.id === "p-x")).toBe(true);

    // Toast に Undo アクションが付いている (success tone)
    const t = toastList().find((x) => x.message === "カートに追加しました")!;
    expect(t.tone).toBe("success");
    expect(t.action?.label).toBe("Undo");
  });

  it("Undo クリックで local revert + DELETE /cart/items/:token が叩かれる", async () => {
    const fetchMock = vi
      .fn()
      // 1 回目: POST /cart
      .mockResolvedValueOnce(okJson({ cartCount: 1, undoToken: "undo_42" }))
      // 2 回目: DELETE /cart/items/undo_42
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(() => <CtaBlockView block={makeBlock("p-x", 1)} />);
    fireEvent.click(container.querySelector("button")!);

    await waitFor(() => {
      expect(cartItems().some((i) => i.id === "p-x")).toBe(true);
    });
    const t = toastList().find((x) => x.message === "カートに追加しました")!;
    expect(t.action).toBeDefined();

    // Undo を発火
    t.action!.onClick();

    // local 即座に revert
    expect(cartItems().some((i) => i.id === "p-x")).toBe(false);

    // 非同期 DELETE が走るのを待つ
    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([u, init]) => init?.method === "DELETE",
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[0]).toBe("/api/v1/cart/items/undo_42");
    });
  });

  it("500 エラー時は error tone toast を出し、cart には足さない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("oops", { status: 500 })),
    );

    const { container } = render(() => <CtaBlockView block={makeBlock("p-x", 1)} />);
    fireEvent.click(container.querySelector("button")!);

    await waitFor(() => {
      expect(toastList().some((t) => t.tone === "error")).toBe(true);
    });
    expect(cartItems().some((i) => i.id === "p-x")).toBe(false);
  });

  it("network 失敗時は 'ネットワーク接続を確認してください' を出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const { container } = render(() => <CtaBlockView block={makeBlock("p-x", 1)} />);
    fireEvent.click(container.querySelector("button")!);

    await waitFor(() => {
      expect(
        toastList().some(
          (t) => t.tone === "error" && t.message.includes("ネットワーク"),
        ),
      ).toBe(true);
    });
  });

  it("in-flight 中は disabled になり、二重 POST されない", async () => {
    let resolve: ((res: Response) => void) | null = null;
    const slow = new Promise<Response>((r) => {
      resolve = r;
    });
    const fetchMock = vi.fn().mockImplementation(() => slow);
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(() => <CtaBlockView block={makeBlock("p-x", 1)} />);
    const btn = container.querySelector("button") as HTMLButtonElement;

    fireEvent.click(btn);
    // 1 度目の click 直後は pending state で disabled
    await waitFor(() => {
      expect(btn.disabled).toBe(true);
    });

    // 2 度目の click は無視される (pending guard)
    fireEvent.click(btn);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 解放してクリーンアップ
    resolve!(okJson({ cartCount: 1, undoToken: "undo_99" }));
    await waitFor(() => {
      expect(btn.disabled).toBe(false);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// toggle_watch action
// ──────────────────────────────────────────────────────────────────────

describe("CtaBlockView (toggle_watch)", () => {
  const makeBlock = (
    productId = "p-x",
  ): Extract<Block, { type: "cta" }> => ({
    type: "cta",
    key: "cta-watch",
    intent: "secondary",
    href: asHref("/watch"),
    label: raw("ウォッチ"),
    action: { type: "toggle_watch", productId },
  });

  it("data-action-type は toggle_watch", () => {
    const { container } = render(() => <CtaBlockView block={makeBlock()} />);
    expect(
      container.querySelector("button")?.getAttribute("data-action-type"),
    ).toBe("toggle_watch");
  });

  it("watching: true なら 'ウォッチに追加しました' (success)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ watching: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(() => <CtaBlockView block={makeBlock("p-x")} />);
    fireEvent.click(container.querySelector("button")!);

    await waitFor(() => {
      expect(
        toastList().some(
          (t) => t.message === "ウォッチに追加しました" && t.tone === "success",
        ),
      ).toBe(true);
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/watch/p-x");
    expect(init.method).toBe("POST");
  });

  it("watching: false なら 'ウォッチを解除しました' (info)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson({ watching: false })),
    );

    const { container } = render(() => <CtaBlockView block={makeBlock("p-x")} />);
    fireEvent.click(container.querySelector("button")!);

    await waitFor(() => {
      expect(
        toastList().some(
          (t) => t.message === "ウォッチを解除しました" && t.tone === "info",
        ),
      ).toBe(true);
    });
  });

  it("400 エラー時は error toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("bad", { status: 400 })),
    );

    const { container } = render(() => <CtaBlockView block={makeBlock("")} />);
    fireEvent.click(container.querySelector("button")!);

    await waitFor(() => {
      expect(toastList().some((t) => t.tone === "error")).toBe(true);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Phase 3: click analytics
//
// **方針**: analyticsId が CTA Block に存在する時だけ click event を 1 件
//   buffer に積む。analyticsId が無ければ何も積まない (= 既存テスト互換)。
//   <a> 純ナビ / <button> action どちらの分岐でも同様に発火する。
// ──────────────────────────────────────────────────────────────────────

describe("CtaBlockView (analytics click)", () => {
  it("<a> の click で analyticsId 付きなら 1 件 click が積まれる", () => {
    const block: Extract<Block, { type: "cta" }> = {
      type: "cta",
      key: "c-link",
      intent: "tertiary",
      href: asHref("/products/x"),
      label: raw("詳細を見る"),
      analyticsId: "block.cta.detail",
    };
    const { container } = render(() => <CtaBlockView block={block} />);
    fireEvent.click(container.querySelector("a")!);

    const buf = __getBufferForTest();
    expect(buf).toHaveLength(1);
    expect(buf[0]!.analyticsId).toBe("block.cta.detail");
    expect(buf[0]!.eventType).toBe("click");
    // <a> 純ナビ (action 無し) なので actionType / productId は context に乗らない。
    // recordEvent は空 context を `undefined` として保持する (server 側 skip_serializing_if と一致)。
    expect(buf[0]!.context).toBeUndefined();
  });

  it("analyticsId 不在の <a> click では何も積まれない", () => {
    const block: Extract<Block, { type: "cta" }> = {
      type: "cta",
      key: "c-link",
      intent: "tertiary",
      href: asHref("/products/x"),
      label: raw("詳細を見る"),
      // analyticsId なし
    };
    const { container } = render(() => <CtaBlockView block={block} />);
    fireEvent.click(container.querySelector("a")!);
    expect(__getBufferForTest()).toHaveLength(0);
  });

  it("<button> add_to_cart click で actionType / productId が context に乗る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ cartCount: 1, undoToken: "u_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const block: Extract<Block, { type: "cta" }> = {
      type: "cta",
      key: "c-add",
      intent: "primary",
      href: asHref("/cart"),
      label: raw("カートに追加"),
      action: { type: "add_to_cart", productId: "p-x", qty: 1 },
      analyticsId: "block.cta.add",
    };
    const { container } = render(() => <CtaBlockView block={block} />);
    fireEvent.click(container.querySelector("button")!);

    // recordClick は同期的に積まれるので await 不要だが、副作用 (fetch) のクリーンを待つ
    const buf = __getBufferForTest();
    expect(buf).toHaveLength(1);
    expect(buf[0]!.analyticsId).toBe("block.cta.add");
    expect(buf[0]!.eventType).toBe("click");
    expect(buf[0]!.context).toEqual({
      actionType: "add_to_cart",
      productId: "p-x",
    });

    // 念のため pending → 解除されるのを待つ (toast 後始末)
    await waitFor(() => {
      expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });

  it("<button> toggle_watch click で actionType / productId が context に乗る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ watching: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const block: Extract<Block, { type: "cta" }> = {
      type: "cta",
      key: "c-watch",
      intent: "secondary",
      href: asHref("/watch"),
      label: raw("ウォッチ"),
      action: { type: "toggle_watch", productId: "p-y" },
      analyticsId: "block.cta.watch",
    };
    const { container } = render(() => <CtaBlockView block={block} />);
    fireEvent.click(container.querySelector("button")!);

    const buf = __getBufferForTest();
    expect(buf).toHaveLength(1);
    expect(buf[0]!.context).toEqual({
      actionType: "toggle_watch",
      productId: "p-y",
    });

    await waitFor(() => {
      expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });

  it("AnalyticsCardProvider 配下なら ambient context (cardId/variant/experiment) も乗る", () => {
    const block: Extract<Block, { type: "cta" }> = {
      type: "cta",
      key: "c-link",
      intent: "tertiary",
      href: asHref("/products/x"),
      label: raw("詳細を見る"),
      analyticsId: "block.cta.detail",
    };
    const { container } = render(() => (
      <AnalyticsCardProvider
        value={{
          cardId: "p-x",
          variant: "featured",
          experiment: { key: "hero_2026q2", bucket: "B" },
        }}
      >
        <CtaBlockView block={block} />
      </AnalyticsCardProvider>
    ));
    fireEvent.click(container.querySelector("a")!);

    const ev = __getBufferForTest()[0]!;
    expect(ev.context).toEqual({
      cardId: "p-x",
      variant: "featured",
      experimentKey: "hero_2026q2",
      experimentBucket: "B",
    });
  });

  it("二重クリック (pending 中) は 1 件しか積まれない", async () => {
    let resolveFetch: ((res: Response) => void) | null = null;
    const slow = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => slow));

    const block: Extract<Block, { type: "cta" }> = {
      type: "cta",
      key: "c-add",
      intent: "primary",
      href: asHref("/cart"),
      label: raw("カートに追加"),
      action: { type: "add_to_cart", productId: "p-x", qty: 1 },
      analyticsId: "block.cta.add",
    };
    const { container } = render(() => <CtaBlockView block={block} />);
    const btn = container.querySelector("button") as HTMLButtonElement;

    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.disabled).toBe(true);
    });
    // 2 度目: pending guard に弾かれる → click event も追加されない
    fireEvent.click(btn);
    expect(__getBufferForTest()).toHaveLength(1);

    // クリーンアップ
    resolveFetch!(
      new Response(JSON.stringify({ cartCount: 1, undoToken: "u_2" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await waitFor(() => {
      expect(btn.disabled).toBe(false);
    });
  });
});
