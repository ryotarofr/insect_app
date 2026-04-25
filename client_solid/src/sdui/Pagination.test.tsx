// Pagination.test.tsx — Phase 6 server-driven ページャのテスト
//
// **戦略**:
//   - useNavigate を使うので Router で wrap (FilterBar.test.tsx と同じ)
//   - prev/next の disabled (= span fallback) と enabled (= a tag) を分岐
//   - ellipsis の描画と aria-hidden を assert
//   - selected ページは aria-current="page" + click しても navigate しない (preventDefault のみ)
//   - 数字 link click → analytics に paginationToPage / paginationFromPage が積まれる
//   - prev / next click → analytics に paginationDirection が積まれる
//   - modifier-click はブラウザに委ねる (= preventDefault しない)
//   - data-page / data-per-page / data-total-count / data-total-pages がルートに付く

import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, Route } from "@solidjs/router";
import type { JSX } from "solid-js";

import type {
  PageLink,
  Pagination as PaginationType,
} from "./branded";
import { asHref } from "./branded";
import { PaginationView } from "./Pagination";
import {
  __getBufferForTest,
  __resetAnalyticsForTest,
} from "./analytics";

const wrapWithRouter = (child: () => JSX.Element) => (
  <Router>
    <Route path="*" component={child as () => JSX.Element} />
  </Router>
);

const pageLink = (
  number: number,
  href: string,
  selected: boolean,
): PageLink => ({
  kind: "page",
  number,
  href: asHref(href),
  selected,
});

const ellipsis = (): PageLink => ({ kind: "ellipsis" });

/** 中間ページ (page=3 / total=10) のサンプル: 1 ... 2 3 4 ... 10 */
const middlePagination = (): PaginationType => ({
  page: 3,
  perPage: 20,
  totalCount: 200,
  totalPages: 10,
  prevHref: asHref("/products?page=2"),
  nextHref: asHref("/products?page=4"),
  pages: [
    pageLink(1, "/products", false),
    ellipsis(),
    pageLink(2, "/products?page=2", false),
    pageLink(3, "/products?page=3", true),
    pageLink(4, "/products?page=4", false),
    ellipsis(),
    pageLink(10, "/products?page=10", false),
  ],
  analyticsId: "pagination.page",
});

/** 1 ページしかない場合のサンプル (= 結果が perPage 以下)。
 *  prev/next 両方 None、pages は [1] のみ selected。 */
const singlePagination = (): PaginationType => ({
  page: 1,
  perPage: 20,
  totalCount: 6,
  totalPages: 1,
  prevHref: undefined,
  nextHref: undefined,
  pages: [pageLink(1, "/products", true)],
  analyticsId: "pagination.page",
});

beforeEach(() => {
  __resetAnalyticsForTest();
  window.history.replaceState({}, "", "/products");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaginationView (rendering)", () => {
  it("data-sdui='pagination' とメタ data-* がルート要素に付く", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const root = container.querySelector(
      '[data-sdui="pagination"]',
    ) as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute("data-page")).toBe("3");
    expect(root.getAttribute("data-per-page")).toBe("20");
    expect(root.getAttribute("data-total-count")).toBe("200");
    expect(root.getAttribute("data-total-pages")).toBe("10");
  });

  it("数字リンク 5 件 + ellipsis 2 件が描画される", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    expect(container.querySelectorAll("[data-page-link]").length).toBe(5);
    expect(container.querySelectorAll("[data-page-ellipsis]").length).toBe(2);
  });

  it("selected page に data-selected=true / aria-current='page'", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const p3 = container.querySelector(
      '[data-page-link="3"]',
    ) as HTMLAnchorElement;
    expect(p3.getAttribute("data-selected")).toBe("true");
    expect(p3.getAttribute("aria-current")).toBe("page");

    const p2 = container.querySelector(
      '[data-page-link="2"]',
    ) as HTMLAnchorElement;
    expect(p2.getAttribute("data-selected")).toBe("false");
    expect(p2.getAttribute("aria-current")).toBeNull();
  });

  it("数字リンクの href がそのまま <a href> に出る", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const p4 = container.querySelector(
      '[data-page-link="4"]',
    ) as HTMLAnchorElement;
    expect(p4.getAttribute("href")).toBe("/products?page=4");
  });

  it("prev / next ともに href が <a href> に出る", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const prev = container.querySelector(
      "[data-page-prev]",
    ) as HTMLAnchorElement;
    expect(prev.tagName).toBe("A");
    expect(prev.getAttribute("href")).toBe("/products?page=2");
    expect(prev.getAttribute("data-disabled")).toBe("false");

    const next = container.querySelector(
      "[data-page-next]",
    ) as HTMLAnchorElement;
    expect(next.tagName).toBe("A");
    expect(next.getAttribute("href")).toBe("/products?page=4");
    expect(next.getAttribute("data-disabled")).toBe("false");
  });

  it("first page では prev が disabled span として描画される", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={singlePagination()} />),
    );
    const prev = container.querySelector("[data-page-prev]") as HTMLElement;
    expect(prev.tagName).toBe("SPAN");
    expect(prev.getAttribute("data-disabled")).toBe("true");
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    // href 属性自体が無い (= リンク化されない)
    expect(prev.getAttribute("href")).toBeNull();
  });

  it("last page では next が disabled span として描画される", () => {
    // page=10 / total=10 を作る
    const lastPage: PaginationType = {
      ...middlePagination(),
      page: 10,
      prevHref: asHref("/products?page=9"),
      nextHref: undefined,
      pages: [
        pageLink(1, "/products", false),
        ellipsis(),
        pageLink(8, "/products?page=8", false),
        pageLink(9, "/products?page=9", false),
        pageLink(10, "/products?page=10", true),
      ],
    };
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={lastPage} />),
    );
    const next = container.querySelector("[data-page-next]") as HTMLElement;
    expect(next.tagName).toBe("SPAN");
    expect(next.getAttribute("data-disabled")).toBe("true");
    expect(next.getAttribute("aria-disabled")).toBe("true");
  });

  it("ellipsis は span + aria-hidden=true で表示テキスト '…'", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const eList = container.querySelectorAll("[data-page-ellipsis]");
    expect(eList.length).toBe(2);
    eList.forEach((el) => {
      expect(el.tagName).toBe("SPAN");
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(el.textContent).toBe("…");
    });
  });
});

describe("PaginationView (click → navigate / analytics)", () => {
  it("数字リンク click → preventDefault され analytics に積まれる", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const p4 = container.querySelector(
      '[data-page-link="4"]',
    ) as HTMLAnchorElement;
    const evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    p4.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.analyticsId).toBe("pagination.page");
    expect(buf[0]!.eventType).toBe("click");
    expect(buf[0]!.context).toMatchObject({
      paginationToPage: "4",
      paginationFromPage: "3",
    });
  });

  it("selected page (現在ページ) を click しても navigate も analytics も無し", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const p3 = container.querySelector(
      '[data-page-link="3"]',
    ) as HTMLAnchorElement;
    const evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    p3.dispatchEvent(evt);
    // preventDefault は走るが analytics は積まれない
    expect(evt.defaultPrevented).toBe(true);
    expect(__getBufferForTest().length).toBe(0);
  });

  it("prev click → paginationDirection='prev' / fromPage が context に乗る", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const prev = container.querySelector(
      "[data-page-prev]",
    ) as HTMLAnchorElement;
    fireEvent.click(prev, { button: 0 });

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.context).toMatchObject({
      paginationDirection: "prev",
      paginationFromPage: "3",
    });
  });

  it("next click → paginationDirection='next'", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const next = container.querySelector(
      "[data-page-next]",
    ) as HTMLAnchorElement;
    fireEvent.click(next, { button: 0 });

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.context).toMatchObject({
      paginationDirection: "next",
      paginationFromPage: "3",
    });
  });

  it("disabled prev/next (span) を click しても何も起きない", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={singlePagination()} />),
    );
    const prev = container.querySelector("[data-page-prev]") as HTMLElement;
    const next = container.querySelector("[data-page-next]") as HTMLElement;

    fireEvent.click(prev);
    fireEvent.click(next);

    expect(__getBufferForTest().length).toBe(0);
  });

  it("Cmd-click は preventDefault されない (新タブ / window で開く)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={middlePagination()} />),
    );
    const p4 = container.querySelector(
      '[data-page-link="4"]',
    ) as HTMLAnchorElement;
    const evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    p4.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
    // ただし analytics は積まれる (= 新タブ click でも計測したい)
    expect(__getBufferForTest().length).toBe(1);
  });

  it("analyticsId 無しの Pagination は click しても buffer に積まれない", () => {
    const noAnalytics: PaginationType = {
      ...middlePagination(),
      analyticsId: undefined,
    };
    const { container } = render(() =>
      wrapWithRouter(() => <PaginationView pagination={noAnalytics} />),
    );
    const p4 = container.querySelector(
      '[data-page-link="4"]',
    ) as HTMLAnchorElement;
    fireEvent.click(p4, { button: 0 });
    expect(__getBufferForTest().length).toBe(0);
  });
});
