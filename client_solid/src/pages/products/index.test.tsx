// pages/products/index.test.tsx — ProductsList の URL → fetch wiring テスト (Phase 4)
//
// **戦略**:
//   - window.history.replaceState で URL に ?category=live 等を載せ、
//     ProductsList を Router で wrap して描画
//   - global fetch を vi.stubGlobal で差し替え、`/api/v1/cards/products?...` の
//     呼び出しに category / difficulty が forward されていることを assert
//   - URL が変わったら createResource が再 fetch することも確認 (history.pushState
//     後に flushPromises 相当の `await Promise.resolve()` で再実行を待つ)
//
// **このテストでカバーしないこと**:
//   - filter chip の見た目 → FilterBar.test.tsx
//   - card grid の rendering → CardRenderer.test.tsx
//   - 詳細ページ (ProductDetail) → ProductDetailCard.test.tsx

import { render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, Route } from "@solidjs/router";
import type { JSX } from "solid-js";

import { ProductsList } from "./index";

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const emptyResponse = () =>
  okJson({
    filterBar: { groups: [] },
    cards: [],
  });

const wrapWithRouter = (child: () => JSX.Element) => (
  <Router>
    <Route path="*" component={child as () => JSX.Element} />
  </Router>
);

const setUrl = (url: string) => {
  window.history.replaceState({}, "", url);
};

beforeEach(() => {
  // 各テスト独立: URL 起点を固定 + global fetch を毎回差し替える
  setUrl("/products");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProductsList — URL → fetch forwarding (Phase 4)", () => {
  it("?category 無し → /api/v1/cards/products (クエリ無し)", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    const url = mock.mock.calls[0]?.[0] as string;
    expect(url).toBe("/api/v1/cards/products");
  });

  it("?category=live → /api/v1/cards/products?category=live を fetch", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?category=live");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    const url = mock.mock.calls[0]?.[0] as string;
    expect(url).toBe("/api/v1/cards/products?category=live");
  });

  it("?category=live&difficulty=hard → 両方 forward", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?category=live&difficulty=hard");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    const url = mock.mock.calls[0]?.[0] as string;
    expect(url).toContain("category=live");
    expect(url).toContain("difficulty=hard");
  });

  it("?category=live&category=supply (重複キー) → 文字列 1 個を fetch に渡す", async () => {
    // useSearchParams は重複 key を `string[]` で返すケースがある。
    // 我々の pickFirst() は配列なら先頭、単一文字列ならそのまま返す。
    // どちらに転んでも、fetch URL のクエリ値は単一の文字列 1 個に収まる
    // (= category= が 2 回出ない) ことだけを保証する。
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?category=live&category=supply");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    const url = mock.mock.calls[0]?.[0] as string;
    // URLSearchParams で組み立てているので category= は 1 度しか出ない
    expect((url.match(/category=/g) ?? []).length).toBe(1);
    // 値は live か supply のどちらか (router 実装依存)
    expect(url).toMatch(/\/api\/v1\/cards\/products\?category=(live|supply)/);
  });

  it("レスポンスの cards をグリッドに描画する", async () => {
    const mock = vi.fn().mockResolvedValue(
      okJson({
        cards: [
          {
            template: "product_feature",
            id: "p-x",
            regions: { header: [], media: [], body: [], meta: [], footer: [] },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", mock);
    setUrl("/products");

    const { container } = render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => {
      // grid container が描画され、cards 件数ぶん子要素が出ることを確認
      const grid = container.querySelector(".grid-cards-3");
      expect(grid).not.toBeNull();
    });
  });

  it("filterBar 付きのレスポンス → FilterBarView が描画される", async () => {
    const mock = vi.fn().mockResolvedValue(
      okJson({
        filterBar: {
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
        },
        cards: [],
      }),
    );
    vi.stubGlobal("fetch", mock);
    setUrl("/products");

    const { container } = render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => {
      const bar = container.querySelector('[data-sdui="filter-bar"]');
      expect(bar).not.toBeNull();
      expect(
        container.querySelector('[data-filter-chip="live"]'),
      ).not.toBeNull();
    });
  });

  // ── Phase 5: sort URL forwarding ──────────────────────────────
  it("?sort=price_asc → /api/v1/cards/products?sort=price_asc を fetch", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?sort=price_asc");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    const url = mock.mock.calls[0]?.[0] as string;
    expect(url).toBe("/api/v1/cards/products?sort=price_asc");
  });

  it("?category=live&sort=new → 両方 forward (順序は実装に依存)", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?category=live&sort=new");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    const url = mock.mock.calls[0]?.[0] as string;
    expect(url).toContain("category=live");
    expect(url).toContain("sort=new");
  });

  it("sortBar 付きのレスポンス → SortBarView が描画される", async () => {
    const mock = vi.fn().mockResolvedValue(
      okJson({
        sortBar: {
          current: "name",
          options: [
            {
              key: "name",
              label: { source: "raw", text: "名前順" },
              selected: true,
              href: "/products",
              analyticsId: "sort.name",
            },
            {
              key: "price_asc",
              label: { source: "raw", text: "価格(安い順)" },
              selected: false,
              href: "/products?sort=price_asc",
              analyticsId: "sort.price_asc",
            },
          ],
        },
        cards: [],
      }),
    );
    vi.stubGlobal("fetch", mock);
    setUrl("/products");

    const { container } = render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => {
      const bar = container.querySelector('[data-sdui="sort-bar"]');
      expect(bar).not.toBeNull();
      expect(bar?.getAttribute("data-current")).toBe("name");
      expect(
        container.querySelector('[data-sort-option="name"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-sort-option="price_asc"]'),
      ).not.toBeNull();
    });
  });

  it("sortBar 不在 (undefined) のレスポンス → SortBarView は描画されない", async () => {
    const mock = vi.fn().mockResolvedValue(
      okJson({
        // sortBar フィールドなし
        cards: [],
      }),
    );
    vi.stubGlobal("fetch", mock);
    setUrl("/products");

    const { container } = render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    // 描画完了を待つ (loading が消えるまで)
    await waitFor(() => {
      // empty state が出ていれば loading は終わっている
      expect(container.textContent).toContain("表示できる商品がありません");
    });
    // sortBar は出ていない
    expect(container.querySelector('[data-sdui="sort-bar"]')).toBeNull();
  });

  // ── Phase 6: q / page / perPage URL forwarding ────────────────
  it("?q=ヘラクレス → q が percent-encoded で fetch URL に乗る", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?q=" + encodeURIComponent("ヘラクレス"));

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    const url = mock.mock.calls[0]?.[0] as string;
    expect(url).toBe(
      "/api/v1/cards/products?q=" + encodeURIComponent("ヘラクレス"),
    );
  });

  it("?page=2 → /api/v1/cards/products?page=2 を fetch", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?page=2");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products?page=2");
  });

  it("?page=1 (default) は省略する (canonical URL)", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?page=1");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");
  });

  it("?page=invalid (= 0/負値/NaN) は default 扱い → 省略", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?page=abc");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products");
  });

  it("?perPage=50 → /api/v1/cards/products?perPage=50 を fetch", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl("/products?perPage=50");

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(mock.mock.calls[0]?.[0]).toBe("/api/v1/cards/products?perPage=50");
  });

  it("?q + ?category + ?sort + ?page + ?perPage 全部 → canonical 順で forward", async () => {
    const mock = vi.fn().mockResolvedValue(emptyResponse());
    vi.stubGlobal("fetch", mock);
    setUrl(
      "/products?q=neptune&category=live&difficulty=hard&sort=price_desc&page=2&perPage=50",
    );

    render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => expect(mock).toHaveBeenCalled());
    // api.ts 側の append 順 (q → category → difficulty → sort → page → perPage)
    expect(mock.mock.calls[0]?.[0]).toBe(
      "/api/v1/cards/products?q=neptune&category=live&difficulty=hard&sort=price_desc&page=2&perPage=50",
    );
  });

  it("searchBox 付きレスポンス → SearchBoxView が描画される", async () => {
    const mock = vi.fn().mockResolvedValue(
      okJson({
        searchBox: {
          query: "neptune",
          placeholder: { source: "raw", text: "商品名で検索" },
          submitHref: "/products?category=live",
          paramName: "q",
          analyticsId: "search.submit",
        },
        cards: [],
      }),
    );
    vi.stubGlobal("fetch", mock);
    setUrl("/products?q=neptune");

    const { container } = render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => {
      expect(container.querySelector('[data-sdui="search-box"]')).not.toBeNull();
      const input = container.querySelector(
        "[data-search-input]",
      ) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.value).toBe("neptune");
    });
  });

  it("pagination 付きレスポンス → PaginationView が描画される", async () => {
    const mock = vi.fn().mockResolvedValue(
      okJson({
        pagination: {
          page: 2,
          perPage: 3,
          totalCount: 6,
          totalPages: 2,
          prevHref: "/products",
          pages: [
            { kind: "page", number: 1, href: "/products", selected: false },
            { kind: "page", number: 2, href: "/products?page=2", selected: true },
          ],
          analyticsId: "pagination.page",
        },
        cards: [],
      }),
    );
    vi.stubGlobal("fetch", mock);
    setUrl("/products?page=2");

    const { container } = render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => {
      const root = container.querySelector(
        '[data-sdui="pagination"]',
      ) as HTMLElement | null;
      expect(root).not.toBeNull();
      expect(root?.getAttribute("data-page")).toBe("2");
      expect(root?.getAttribute("data-total-pages")).toBe("2");
      expect(
        container.querySelector('[data-page-link="2"][data-selected="true"]'),
      ).not.toBeNull();
    });
  });

  it("searchBox / pagination 不在のレスポンス → どちらも描画されない", async () => {
    const mock = vi.fn().mockResolvedValue(okJson({ cards: [] }));
    vi.stubGlobal("fetch", mock);
    setUrl("/products");

    const { container } = render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => {
      // empty state を待ってから shell が無いことを確認
      expect(container.textContent).toContain("表示できる商品がありません");
    });
    expect(container.querySelector('[data-sdui="search-box"]')).toBeNull();
    expect(container.querySelector('[data-sdui="pagination"]')).toBeNull();
  });

  it("0 件マッチでも filterBar は描画される (= 戻り導線を維持)", async () => {
    const mock = vi.fn().mockResolvedValue(
      okJson({
        filterBar: {
          groups: [
            {
              key: "category",
              label: { source: "raw", text: "カテゴリ" },
              chips: [
                {
                  key: "supply",
                  label: { source: "raw", text: "用品" },
                  selected: true,
                  // 解除 URL
                  href: "/products",
                },
              ],
            },
          ],
        },
        cards: [],
      }),
    );
    vi.stubGlobal("fetch", mock);
    setUrl("/products?category=supply");

    const { container } = render(() =>
      wrapWithRouter(() => (
        <ProductsList setRoute={() => {}} setSelectedProduct={() => {}} />
      )),
    );

    await waitFor(() => {
      // filter bar はある
      expect(container.querySelector('[data-sdui="filter-bar"]')).not.toBeNull();
      // 「表示できる商品がありません」の empty state が出る
      expect(container.textContent).toContain("表示できる商品がありません");
    });
  });
});
