// SortBar.test.tsx — Phase 5 server-driven sort dropdown のテスト
//
// **戦略**:
//   - useNavigate を使うので Router で wrap (FilterBar.test.tsx と同じパターン)
//   - option click → analytics buffer に積まれること (sortFrom / sortTo を含む)
//   - selected option は data-selected=true / aria-pressed=true / aria-checked=true
//   - href がそのまま <a> の属性に出る (置換 URL は server から渡る)
//   - modifier-click (Cmd / middle / Shift) はブラウザに委ねる = preventDefault しない
//
// **navigate のモック**:
//   FilterBar.test.tsx と同じ理由で「preventDefault されたか」を見る方に倒す。

import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, Route } from "@solidjs/router";
import type { JSX } from "solid-js";

import type { SortBar as SortBarType } from "./branded";
import { asHref } from "./branded";
import { SortBarView } from "./SortBar";
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

// テスト用 fixture: 4 つの sort key (name = selected, 他 = not selected)
const sampleBar = (): SortBarType => ({
  current: "name",
  options: [
    {
      key: "name",
      label: raw("名前順"),
      selected: true,
      href: asHref("/products"), // default は ?sort= を出さない
      analyticsId: "sort.name",
    },
    {
      key: "price_asc",
      label: raw("価格(安い順)"),
      selected: false,
      href: asHref("/products?sort=price_asc"),
      analyticsId: "sort.price_asc",
    },
    {
      key: "price_desc",
      label: raw("価格(高い順)"),
      selected: false,
      href: asHref("/products?sort=price_desc"),
      analyticsId: "sort.price_desc",
    },
    {
      key: "new",
      label: raw("新着順"),
      selected: false,
      href: asHref("/products?sort=new"),
      // analyticsId 無しのケースも 1 件混ぜておく (no-op になる)
    },
  ],
});

beforeEach(() => {
  __resetAnalyticsForTest();
  window.history.replaceState({}, "", "/products");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SortBarView (rendering)", () => {
  it("4 つの option が DOM に出る (data-* で抽出可能)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    expect(container.querySelector('[data-sdui="sort-bar"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-sort-option]").length).toBe(4);
  });

  it("data-current が SortBar.current を反映する", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    const root = container.querySelector('[data-sdui="sort-bar"]');
    expect(root?.getAttribute("data-current")).toBe("name");
  });

  it("selected option は data-selected=true / aria-pressed=true / aria-checked=true", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    const name = container.querySelector(
      '[data-sort-option="name"]',
    ) as HTMLAnchorElement;
    expect(name).not.toBeNull();
    expect(name.getAttribute("data-selected")).toBe("true");
    expect(name.getAttribute("aria-pressed")).toBe("true");
    expect(name.getAttribute("aria-checked")).toBe("true");

    const priceAsc = container.querySelector(
      '[data-sort-option="price_asc"]',
    ) as HTMLAnchorElement;
    expect(priceAsc.getAttribute("data-selected")).toBe("false");
    expect(priceAsc.getAttribute("aria-pressed")).toBe("false");
    expect(priceAsc.getAttribute("aria-checked")).toBe("false");
  });

  it("option.href がそのまま <a href> に出る (置換 URL は server 由来)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    // default を選ぶ option は ?sort= を含まない URL
    const name = container.querySelector(
      '[data-sort-option="name"]',
    ) as HTMLAnchorElement;
    expect(name.getAttribute("href")).toBe("/products");

    const priceAsc = container.querySelector(
      '[data-sort-option="price_asc"]',
    ) as HTMLAnchorElement;
    expect(priceAsc.getAttribute("href")).toBe("/products?sort=price_asc");
  });

  it("option ラベルテキストが表示される (Localizable raw)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    expect(container.textContent).toContain("名前順");
    expect(container.textContent).toContain("価格(安い順)");
    expect(container.textContent).toContain("新着順");
  });

  it("radiogroup role を持つ", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    const root = container.querySelector('[data-sdui="sort-bar"]');
    expect(root?.getAttribute("role")).toBe("radiogroup");
  });
});

describe("SortBarView (click → analytics)", () => {
  it("option click → analytics buffer に 1 件積まれる (sortFrom + sortTo)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    const priceAsc = container.querySelector(
      '[data-sort-option="price_asc"]',
    ) as HTMLAnchorElement;

    fireEvent.click(priceAsc, { button: 0 });

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.analyticsId).toBe("sort.price_asc");
    expect(buf[0]!.eventType).toBe("click");
    // sortFrom = 現在の current (= name), sortTo = この option の key
    expect(buf[0]!.context).toMatchObject({
      sortFrom: "name",
      sortTo: "price_asc",
    });
  });

  it("analyticsId 無し option の click → buffer に積まれない (no-op)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    const newOpt = container.querySelector(
      '[data-sort-option="new"]',
    ) as HTMLAnchorElement;

    fireEvent.click(newOpt, { button: 0 });

    const buf = __getBufferForTest();
    expect(buf.length).toBe(0);
  });

  it("Cmd-click (modifier 付き) は preventDefault しない (= ブラウザに委ねる)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    const priceAsc = container.querySelector(
      '[data-sort-option="price_asc"]',
    ) as HTMLAnchorElement;

    const evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    priceAsc.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);

    // analytics は記録される (= 新タブで開いてもクリック計測したい)
    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
  });

  it("plain left-click は preventDefault される (= SPA navigate にフックされる)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <SortBarView bar={sampleBar()} />),
    );
    const priceAsc = container.querySelector(
      '[data-sort-option="price_asc"]',
    ) as HTMLAnchorElement;

    const evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    priceAsc.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });
});
