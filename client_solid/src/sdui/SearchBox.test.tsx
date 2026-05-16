// SearchBox.test.tsx — Phase 6 server-driven 検索 box のテスト
//
// **戦略**:
//   - useNavigate を使うので Router で wrap
//   - 初期 query 表示 / placeholder / hidden input (= filter/sort/perPage 維持) を assert
//   - submit 時に q=入力値 が URL に乗ること、空入力なら q が消えることを観測
//   - submit 時 analytics.click が積まれることを buffer 経由で assert
//   - splitHref 純関数も path / params 分離を直接テスト
//
// **navigate 観測戦略**:
//   FilterBar.test.tsx と同じく、navigate そのものを spy するのは Solid Router の
//   context 越しで難しいので、代わりに submit イベントの defaultPrevented と
//   buffer に積まれた analytics の context を観察する。

import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, Route } from "@solidjs/router";
import type { JSX } from "solid-js";

import type { SearchBox as SearchBoxType } from "./branded";
import { asHref } from "./branded";
import { SearchBoxView, splitHref } from "./SearchBox";
import {
  __getBufferForTest,
  __resetAnalyticsForTest,
} from "./analytics";

const raw = (text: string) => ({ source: "raw" as const, text });

const wrapWithRouter = (child: () => JSX.Element) => (
  <Router>
    <Route path="*" component={child as () => JSX.Element} />
  </Router>
);

const sampleBox = (
  override: Partial<SearchBoxType> = {},
): SearchBoxType => ({
  query: undefined,
  placeholder: raw("商品名で検索"),
  submitHref: asHref("/products"),
  paramName: "q",
  analyticsId: "search.submit",
  ...override,
});

beforeEach(() => {
  __resetAnalyticsForTest();
  window.history.replaceState({}, "", "/products");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splitHref", () => {
  it("query 無しなら path だけ返し params は空", () => {
    expect(splitHref("/products")).toEqual({ path: "/products", params: [] });
  });

  it("単一 query を 1 ペアに分解", () => {
    expect(splitHref("/products?category=live")).toEqual({
      path: "/products",
      params: [["category", "live"]],
    });
  });

  it("複数 query を順序保ったまま分解", () => {
    expect(
      splitHref("/products?category=live&difficulty=easy&sort=name"),
    ).toEqual({
      path: "/products",
      params: [
        ["category", "live"],
        ["difficulty", "easy"],
        ["sort", "name"],
      ],
    });
  });

  it("percent-encoded value を decode する", () => {
    // %E3%83%98 = ヘ
    expect(splitHref("/products?q=%E3%83%98")).toEqual({
      path: "/products",
      params: [["q", "ヘ"]],
    });
  });

  it("'+' を space に変換 (form url-encoded 互換)", () => {
    expect(splitHref("/products?q=foo+bar")).toEqual({
      path: "/products",
      params: [["q", "foo bar"]],
    });
  });

  it("値無し (= 'k=' / 'k' の形) は空文字 value で残す", () => {
    expect(splitHref("/products?empty=&bare")).toEqual({
      path: "/products",
      params: [
        ["empty", ""],
        ["bare", ""],
      ],
    });
  });
});

describe("SearchBoxView (rendering)", () => {
  it("data-sdui='search-box' / input / submit ボタンが描画される", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SearchBoxView box={sampleBox()} />),
    );
    expect(container.querySelector('[data-sdui="search-box"]')).not.toBeNull();
    expect(container.querySelector("[data-search-input]")).not.toBeNull();
    expect(container.querySelector("[data-search-submit]")).not.toBeNull();
  });

  it("query が undefined の時 input の value は空文字", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SearchBoxView box={sampleBox()} />),
    );
    const input = container.querySelector(
      "[data-search-input]",
    ) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("query が Some のとき input value が初期値として埋まる", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <SearchBoxView box={sampleBox({ query: "ヘラクレス" })} />
      )),
    );
    const input = container.querySelector(
      "[data-search-input]",
    ) as HTMLInputElement;
    expect(input.value).toBe("ヘラクレス");
  });

  it("placeholder に Localizable raw text が表示される", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SearchBoxView box={sampleBox()} />),
    );
    const input = container.querySelector(
      "[data-search-input]",
    ) as HTMLInputElement;
    expect(input.getAttribute("placeholder")).toBe("商品名で検索");
  });

  it("submitHref の既存 query が hidden input として埋め込まれる", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <SearchBoxView
          box={sampleBox({
            submitHref: asHref(
              "/products?category=live&sort=price_asc&perPage=50",
            ),
          })}
        />
      )),
    );
    // form の action は path 部のみ
    const form = container.querySelector(
      '[data-sdui="search-box"]',
    ) as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/products");
    expect(form.getAttribute("method")).toBe("get");

    // hidden input が 3 つ (category / sort / perPage)
    const hCategory = container.querySelector(
      '[data-search-hidden="category"]',
    ) as HTMLInputElement;
    expect(hCategory).not.toBeNull();
    expect(hCategory.getAttribute("type")).toBe("hidden");
    expect(hCategory.getAttribute("value")).toBe("live");

    const hSort = container.querySelector(
      '[data-search-hidden="sort"]',
    ) as HTMLInputElement;
    expect(hSort.getAttribute("value")).toBe("price_asc");

    const hPer = container.querySelector(
      '[data-search-hidden="perPage"]',
    ) as HTMLInputElement;
    expect(hPer.getAttribute("value")).toBe("50");
  });

  it("submitHref に query が無いときは hidden input ゼロ", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SearchBoxView box={sampleBox()} />),
    );
    expect(container.querySelectorAll("[data-search-hidden]").length).toBe(0);
  });

  it("input の name は paramName (default 'q')", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SearchBoxView box={sampleBox()} />),
    );
    const input = container.querySelector(
      "[data-search-input]",
    ) as HTMLInputElement;
    expect(input.getAttribute("name")).toBe("q");
  });

  it("paramName を override できる (将来の rename を server 側で完結)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <SearchBoxView box={sampleBox({ paramName: "keyword" })} />
      )),
    );
    const input = container.querySelector(
      "[data-search-input]",
    ) as HTMLInputElement;
    expect(input.getAttribute("name")).toBe("keyword");
  });
});

describe("SearchBoxView (submit)", () => {
  it("submit で preventDefault される (= SPA navigate にフックされる)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <SearchBoxView box={sampleBox({ query: "アクタエオン" })} />
      )),
    );
    const form = container.querySelector(
      '[data-sdui="search-box"]',
    ) as HTMLFormElement;
    const evt = new SubmitEvent("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("submit で analytics.click が 1 件積まれる (with-query)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <SearchBoxView box={sampleBox({ query: "ヘラクレス" })} />
      )),
    );
    const form = container.querySelector(
      '[data-sdui="search-box"]',
    ) as HTMLFormElement;
    fireEvent.submit(form);

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.analyticsId).toBe("search.submit");
    expect(buf[0]!.eventType).toBe("click");
    expect(buf[0]!.context?.searchHasQuery).toBe("true");
    // "ヘラクレス" は BMP 文字 5 つ → JS の string.length === 5
    expect(buf[0]!.context?.searchLength).toBe("5");
  });

  it("空入力で submit すると searchHasQuery=false / length=0", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SearchBoxView box={sampleBox()} />),
    );
    const form = container.querySelector(
      '[data-sdui="search-box"]',
    ) as HTMLFormElement;
    fireEvent.submit(form);

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.context?.searchHasQuery).toBe("false");
    expect(buf[0]!.context?.searchLength).toBe("0");
  });

  it("入力が前後空白を含むとき trim 後の長さが context に乗る", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <SearchBoxView box={sampleBox({ query: "   abc   " })} />
      )),
    );
    const form = container.querySelector(
      '[data-sdui="search-box"]',
    ) as HTMLFormElement;
    fireEvent.submit(form);

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    // trim("   abc   ") = "abc" → length=3
    expect(buf[0]!.context?.searchLength).toBe("3");
    expect(buf[0]!.context?.searchHasQuery).toBe("true");
  });

  it("入力が空白のみのとき has-query=false (trim で消えるため)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <SearchBoxView box={sampleBox({ query: "    " })} />
      )),
    );
    const form = container.querySelector(
      '[data-sdui="search-box"]',
    ) as HTMLFormElement;
    fireEvent.submit(form);

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.context?.searchHasQuery).toBe("false");
    expect(buf[0]!.context?.searchLength).toBe("0");
  });

  it("analyticsId 無しなら submit しても buffer に積まれない (no-op)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <SearchBoxView
          box={sampleBox({ analyticsId: undefined, query: "abc" })}
        />
      )),
    );
    const form = container.querySelector(
      '[data-sdui="search-box"]',
    ) as HTMLFormElement;
    fireEvent.submit(form);

    expect(__getBufferForTest().length).toBe(0);
  });

  it("input 編集後の value が submit 時に反映される (controlled input)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SearchBoxView box={sampleBox()} />),
    );
    const input = container.querySelector(
      "[data-search-input]",
    ) as HTMLInputElement;

    // ユーザ入力をシミュレート
    fireEvent.input(input, { target: { value: "ネプチューン" } });
    expect(input.value).toBe("ネプチューン");

    const form = container.querySelector(
      '[data-sdui="search-box"]',
    ) as HTMLFormElement;
    fireEvent.submit(form);

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.context?.searchHasQuery).toBe("true");
    // "ネプチューン".length === 6
    expect(buf[0]!.context?.searchLength).toBe("6");
  });
});
