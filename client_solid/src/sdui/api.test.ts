// api.test.ts — fetchProductCard / fetchProductCardList の単体テスト
//
// **戦略**:
//   global fetch を vi.stubGlobal で差し替え、HTTP レイヤを完全コントロールする。
//   - 200 + JSON ✅ → 値を返す
//   - 404 → SduiFetchError(status=404, body 入り)
//   - 500 → SduiFetchError(status=500, body 入り)
//   - 200 だが invalid JSON → SduiFetchError(status=200) on json parse
//   - fetch 自体が throw (network) → SduiFetchError(status=0)
//
// Response stub は `Response` クラスを直接使う (jsdom が globalThis.Response を提供)。

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SduiFetchError,
  deleteCartItem,
  fetchCartCard,
  fetchProductCard,
  fetchProductCardList,
  fetchProductDetailCard,
  fetchProductList,
  patchCartItemQty,
  postCartAdd,
  postWatchToggle,
} from "./api";

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Response は body が一度しか読めない (Body has already been read) ので、
 * 同じ Response インスタンスを `mockResolvedValue` で使い回すと、
 * 同一テスト内で fetch を 2 回以上呼んだ瞬間に invalid JSON で落ちる。
 *
 * このファクトリを `mockImplementation` に渡せば、call ごとに新しい
 * Response が生成されるため、何回呼んでも安全。
 *
 * 使い方:
 *   vi.fn().mockImplementation(okJsonFactory({ cards: [] }))
 */
const okJsonFactory =
  (body: unknown, status = 200): (() => Response) =>
  () =>
    okJson(body, status);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProductCard", () => {
  it("200 OK → JSON を CardBlock として返す", async () => {
    const mock = vi.fn().mockImplementation(
      okJsonFactory({
        template: "product_feature",
        id: "p-x",
        regions: { header: [], media: [], body: [], meta: [], footer: [] },
      }),
    );
    vi.stubGlobal("fetch", mock);

    const card = await fetchProductCard("p-x");
    expect(card.id).toBe("p-x");
    // URL に正しい path が組まれている
    const calledUrl = mock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe("/api/v1/cards/products/p-x");
  });

  it("id を encodeURIComponent する (記号入りでも壊れない)", async () => {
    const mock = vi.fn().mockImplementation(
      okJsonFactory({
        template: "product_feature",
        id: "p/danger?x=1",
        regions: { header: [], media: [], body: [], meta: [], footer: [] },
      }),
    );
    vi.stubGlobal("fetch", mock);

    await fetchProductCard("p/danger?x=1");
    const calledUrl = mock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe("/api/v1/cards/products/p%2Fdanger%3Fx%3D1");
  });

  it("404 → SduiFetchError(status=404, body)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not found", { status: 404 }),
      ),
    );
    await expect(fetchProductCard("missing")).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 404,
      body: "not found",
    });
  });

  it("500 → SduiFetchError(status=500)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("boom", { status: 500 }),
      ),
    );
    await expect(fetchProductCard("any")).rejects.toBeInstanceOf(SduiFetchError);
  });

  it("network throw → SduiFetchError(status=0)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(fetchProductCard("any")).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 0,
    });
  });

  it("200 だが invalid JSON → SduiFetchError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not json {{{", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(fetchProductCard("any")).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 200,
    });
  });
});

describe("fetchProductList (Phase 4)", () => {
  // Phase 4 で `GET /cards/products` のレスポンスが
  //   `CardBlock[]`  →  `{ filterBar, cards }` (= `ProductListResponse`)
  // に変わった。filter UI の wire-up と一緒に、契約変更を一気にやる。
  const cardA = {
    template: "product_feature",
    id: "a",
    regions: { header: [], media: [], body: [], meta: [], footer: [] },
  } as const;
  const cardB = {
    template: "product_feature",
    id: "b",
    regions: { header: [], media: [], body: [], meta: [], footer: [] },
  } as const;
  const filterBarStub = {
    groups: [
      {
        key: "category",
        label: { source: "raw", text: "カテゴリ" },
        chips: [
          {
            key: "live",
            label: { source: "raw", text: "生体" },
            selected: false,
            href: "/products?category=live",
          },
        ],
      },
    ],
  };

  it("200 OK + ProductListResponse → そのまま返す", async () => {
    const mock = vi.fn().mockImplementation(
      okJsonFactory({ filterBar: filterBarStub, cards: [cardA, cardB] }),
    );
    vi.stubGlobal("fetch", mock);

    const resp = await fetchProductList();
    expect(resp.cards).toHaveLength(2);
    expect(resp.cards[0]?.id).toBe("a");
    expect(resp.filterBar?.groups[0]?.key).toBe("category");
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");
  });

  it("query 無し → クエリ文字列を付けない", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList();
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");
  });

  it("category のみ指定 → ?category=live を付ける", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ category: "live" });
    expect(mock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cards/products?category=live",
    );
  });

  it("category + difficulty 両方 → 両方付ける", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ category: "live", difficulty: "hard" });
    // URLSearchParams は sort しないので登録順 (category → difficulty)
    expect(mock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cards/products?category=live&difficulty=hard",
    );
  });

  // ── Phase 5: sort param forwarding ─────────────────────────
  it("sort のみ → ?sort=price_asc を付ける", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ sort: "price_asc" });
    expect(mock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cards/products?sort=price_asc",
    );
  });

  it("category + difficulty + sort 全部 → 順 (category → difficulty → sort) で付ける", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({
      category: "live",
      difficulty: "hard",
      sort: "new",
    });
    expect(mock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cards/products?category=live&difficulty=hard&sort=new",
    );
  });

  it("sort = '' (空文字) はクエリに付けない", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ sort: "" });
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");
  });

  it("sortBar 付きのレスポンス → そのまま返す (Phase 5)", async () => {
    const sortBar = {
      current: "price_asc",
      options: [
        {
          key: "name",
          label: { source: "raw", text: "名前順" },
          selected: false,
          href: "/products",
        },
        {
          key: "price_asc",
          label: { source: "raw", text: "価格(安い順)" },
          selected: true,
          href: "/products?sort=price_asc",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(okJsonFactory({ sortBar, cards: [] })),
    );

    const resp = await fetchProductList({ sort: "price_asc" });
    expect(resp.sortBar?.current).toBe("price_asc");
    expect(resp.sortBar?.options).toHaveLength(2);
    expect(resp.sortBar?.options[1]?.selected).toBe(true);
  });

  it("空文字 (= 「未指定」) はクエリに付けない", async () => {
    // `?category=` のような空キーはサーバ側 unknown 値扱いで 0 件マッチを
    // 引き起こしうるので、敢えて付けない仕様。
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ category: "", difficulty: undefined });
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");
  });

  it("filterBar 不在のレスポンスでも cards だけで成立する", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [cardA] }));
    vi.stubGlobal("fetch", mock);

    const resp = await fetchProductList();
    expect(resp.filterBar).toBeUndefined();
    expect(resp.cards[0]?.id).toBe("a");
  });

  // ── Phase 6: q / page / perPage forwarding ─────────────────
  it("q のみ → ?q=ヘラクレス を付ける (URLSearchParams が percent-encode する)", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ q: "ヘラクレス" });
    // URLSearchParams は UTF-8 で percent-encode する
    const calledUrl = mock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(
      "/api/v1/cards/products?q=" + encodeURIComponent("ヘラクレス"),
    );
  });

  it("q が空文字なら q= を付けない (= 「未指定」と同じ扱い)", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ q: "" });
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");
  });

  it("page=1 (default) は省略する (canonical URL)", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ page: 1 });
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");
  });

  it("page=2 → ?page=2 を付ける", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ page: 2 });
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products?page=2");
  });

  it("page=0 / 負値は default 扱いで省略 (= サーバ側 fallback)", async () => {
    // 同一 it 内で fetch を 2 回叩くので okJsonFactory で都度新しい Response を生成
    // (Response.body は 1 回しか読めないので mockResolvedValue は使えない)
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ page: 0 });
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");

    await fetchProductList({ page: -3 });
    expect(mock.mock.calls[1]?.[0]).toBe("/api/v1/cards/products");
  });

  it("perPage=20 (default) は省略する", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ perPage: 20 });
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");
  });

  it("perPage=50 → ?perPage=50 を付ける", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ perPage: 50 });
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products?perPage=50");
  });

  it("page / perPage は floor (小数 / NaN への耐性)", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({ page: 3.7, perPage: 50.9 });
    expect(mock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cards/products?page=3&perPage=50",
    );
  });

  it("全パラメータ複合 → canonical 順 (q → category → difficulty → sort → page → perPage)", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ cards: [] }));
    vi.stubGlobal("fetch", mock);

    await fetchProductList({
      q: "neptune",
      category: "live",
      difficulty: "hard",
      sort: "price_desc",
      page: 3,
      perPage: 50,
    });
    // URLSearchParams は append 順を保つ。api.ts 実装の付与順と一致すること。
    expect(mock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cards/products?q=neptune&category=live&difficulty=hard&sort=price_desc&page=3&perPage=50",
    );
  });

  it("searchBox / pagination 付きレスポンスを そのまま返す (Phase 6)", async () => {
    const searchBox = {
      query: "ヘラクレス",
      placeholder: { source: "raw", text: "商品名で検索" },
      submitHref: "/products?category=live",
      paramName: "q",
      analyticsId: "search.submit",
    };
    const pagination = {
      page: 2,
      perPage: 3,
      totalCount: 6,
      totalPages: 2,
      prevHref: "/products?q=%E3%83%98%E3%83%A9%E3%82%AF%E3%83%AC%E3%82%B9",
      pages: [
        {
          kind: "page",
          number: 1,
          href: "/products?q=%E3%83%98%E3%83%A9%E3%82%AF%E3%83%AC%E3%82%B9",
          selected: false,
        },
        {
          kind: "page",
          number: 2,
          href: "/products?q=%E3%83%98%E3%83%A9%E3%82%AF%E3%83%AC%E3%82%B9&page=2",
          selected: true,
        },
      ],
      analyticsId: "pagination.page",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(okJsonFactory({ searchBox, pagination, cards: [] })),
    );

    const resp = await fetchProductList({ q: "ヘラクレス", page: 2 });
    expect(resp.searchBox?.query).toBe("ヘラクレス");
    expect(resp.searchBox?.paramName).toBe("q");
    expect(resp.pagination?.page).toBe(2);
    expect(resp.pagination?.totalPages).toBe(2);
    expect(resp.pagination?.pages).toHaveLength(2);
    // PageLink 識別子 (kind) も branded 越しに残ること
    expect(resp.pagination?.pages[1]?.kind).toBe("page");
  });

  it("404 → SduiFetchError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 404 })),
    );
    await expect(fetchProductList()).rejects.toBeInstanceOf(SduiFetchError);
  });
});

describe("fetchProductCardList (deprecated wrapper)", () => {
  // 後方互換ラッパ。中身は `fetchProductList().cards` を返す。
  it("ProductListResponse から cards を取り出して返す", async () => {
    const cards = [
      {
        template: "product_feature",
        id: "a",
        regions: { header: [], media: [], body: [], meta: [], footer: [] },
      },
      {
        template: "product_feature",
        id: "b",
        regions: { header: [], media: [], body: [], meta: [], footer: [] },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(okJsonFactory({ cards })),
    );

    const result = await fetchProductCardList();
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("a");
  });

  it("空 cards → [] を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(okJsonFactory({ cards: [] })),
    );
    await expect(fetchProductCardList()).resolves.toEqual([]);
  });
});

describe("fetchProductDetailCard", () => {
  it("200 OK → /detail パスに GET し、CardBlock を返す", async () => {
    const detail = {
      template: "product_detail",
      id: "p-x",
      regions: { gallery: [], hero: [], spec: [], pricing: [], cta: [], promise: [] },
    };
    const mock = vi.fn().mockImplementation(okJsonFactory(detail));
    vi.stubGlobal("fetch", mock);

    const card = await fetchProductDetailCard("p-x");
    expect(card.id).toBe("p-x");
    expect(card.template).toBe("product_detail");
    const calledUrl = mock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe("/api/v1/cards/products/p-x/detail");
  });

  it("id を encodeURIComponent する", async () => {
    const mock = vi.fn().mockImplementation(
      okJsonFactory({
        template: "product_detail",
        id: "weird/id",
        regions: { gallery: [], hero: [], spec: [], pricing: [], cta: [], promise: [] },
      }),
    );
    vi.stubGlobal("fetch", mock);

    await fetchProductDetailCard("weird/id");
    const calledUrl = mock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe("/api/v1/cards/products/weird%2Fid/detail");
  });

  it("404 → SduiFetchError(status=404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 404 })),
    );
    await expect(fetchProductDetailCard("missing")).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 404,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Phase 2.5 — SDUI Action endpoints
// ──────────────────────────────────────────────────────────────────────

describe("postCartAdd", () => {
  it("POST /api/v1/cart に productId/qty を camelCase で送る", async () => {
    const mock = vi.fn().mockImplementation(
      okJsonFactory({ cartCount: 3, undoToken: "undo_42" }),
    );
    vi.stubGlobal("fetch", mock);

    const res = await postCartAdd("p-x", 2);
    expect(res.cartCount).toBe(3);
    expect(res.undoToken).toBe("undo_42");

    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/v1/cart");
    expect(init.method).toBe("POST");
    // body は camelCase
    expect(init.body).toBe(JSON.stringify({ productId: "p-x", qty: 2 }));
    // Content-Type が JSON
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("qty 省略時は 1 が送られる", async () => {
    const mock = vi.fn().mockImplementation(
      okJsonFactory({ cartCount: 1, undoToken: "undo_1" }),
    );
    vi.stubGlobal("fetch", mock);

    await postCartAdd("p-x");
    const [, init] = mock.mock.calls[0]!;
    expect(init.body).toBe(JSON.stringify({ productId: "p-x", qty: 1 }));
  });

  it("400 → SduiFetchError(status=400, body)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "qty must be >= 1" }), {
          status: 400,
        }),
      ),
    );
    await expect(postCartAdd("p-x", 0)).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 400,
    });
  });

  it("network throw → SduiFetchError(status=0)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(postCartAdd("p-x")).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 0,
    });
  });
});

describe("deleteCartItem", () => {
  it("DELETE /api/v1/cart/items/:token を叩いて 204 を待つ", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mock);

    await expect(deleteCartItem("undo_42")).resolves.toBeUndefined();
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/v1/cart/items/undo_42");
    expect(init.method).toBe("DELETE");
  });

  it("token を encodeURIComponent する", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mock);
    await deleteCartItem("undo/x?y");
    const [url] = mock.mock.calls[0]!;
    expect(url).toBe("/api/v1/cart/items/undo%2Fx%3Fy");
  });

  it("404 (二重 Undo) → SduiFetchError(status=404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
    );
    await expect(deleteCartItem("undo_gone")).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 404,
    });
  });
});

describe("postWatchToggle", () => {
  it("POST /api/v1/watch/:productId を叩いて { watching } を返す", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ watching: true }));
    vi.stubGlobal("fetch", mock);

    const res = await postWatchToggle("p-x");
    expect(res.watching).toBe(true);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/v1/watch/p-x");
    expect(init.method).toBe("POST");
  });

  it("productId を encodeURIComponent する", async () => {
    const mock = vi.fn().mockImplementation(okJsonFactory({ watching: false }));
    vi.stubGlobal("fetch", mock);
    await postWatchToggle("weird/id");
    const [url] = mock.mock.calls[0]!;
    expect(url).toBe("/api/v1/watch/weird%2Fid");
  });

  it("400 → SduiFetchError(status=400)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("empty id", { status: 400 })),
    );
    await expect(postWatchToggle("")).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 400,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Phase 7 — cart card endpoints
//
// 仕様: docs/sdui-three-layer-model-v5.md §14.7
// ──────────────────────────────────────────────────────────────────────

describe("fetchCartCard", () => {
  it("GET /api/v1/cards/cart を叩いて CardBlock を返す (id 引数なし)", async () => {
    const cartCard = {
      template: "cart",
      id: "cart",
      regions: { header: [], items: [], summary: [], cta: [] },
    };
    const mock = vi.fn().mockImplementation(okJsonFactory(cartCard));
    vi.stubGlobal("fetch", mock);

    const card = await fetchCartCard();
    expect(card.template).toBe("cart");
    expect(card.id).toBe("cart");
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/v1/cards/cart");
    // GET なので method は省略可 (= undefined)。明示的に POST 等にはしないこと。
    expect(init?.method).toBeUndefined();
  });

  it("空カート (regions.items = []) でも 200 として正常に返す", async () => {
    const empty = {
      template: "cart",
      id: "cart",
      regions: { header: [], items: [], summary: [], cta: [] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(okJsonFactory(empty)),
    );
    const card = await fetchCartCard();
    expect(card.template).toBe("cart");
    // type narrowing: cart テンプレならカート用 regions が来る
    if (card.template === "cart") {
      expect(card.regions.items).toEqual([]);
      expect(card.regions.summary).toEqual([]);
    }
  });

  it("500 → SduiFetchError(status=500)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );
    await expect(fetchCartCard()).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 500,
    });
  });

  it("network throw → SduiFetchError(status=0)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(fetchCartCard()).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 0,
    });
  });
});

describe("patchCartItemQty", () => {
  it("PATCH /api/v1/cart/items/:token に { qty } を送り、cartCount を返す", async () => {
    const mock = vi
      .fn()
      .mockImplementation(okJsonFactory({ cartCount: 4 }));
    vi.stubGlobal("fetch", mock);

    const res = await patchCartItemQty("tok_42", 3);
    expect(res.cartCount).toBe(4);

    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/v1/cart/items/tok_42");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ qty: 3 }));
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("token を encodeURIComponent する (記号入りでも壊れない)", async () => {
    const mock = vi
      .fn()
      .mockImplementation(okJsonFactory({ cartCount: 1 }));
    vi.stubGlobal("fetch", mock);

    await patchCartItemQty("weird/tok?x=1", 2);
    const [url] = mock.mock.calls[0]!;
    expect(url).toBe("/api/v1/cart/items/weird%2Ftok%3Fx%3D1");
  });

  it("400 (qty 範囲外) → SduiFetchError(status=400)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("qty out of range", { status: 400 }),
      ),
    );
    await expect(patchCartItemQty("tok_x", 0)).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 400,
    });
  });

  it("404 (token 不在) → SduiFetchError(status=404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
    );
    await expect(patchCartItemQty("tok_gone", 5)).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 404,
    });
  });

  it("network throw → SduiFetchError(status=0)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(patchCartItemQty("tok_x", 1)).rejects.toMatchObject({
      name: "SduiFetchError",
      status: 0,
    });
  });
});
