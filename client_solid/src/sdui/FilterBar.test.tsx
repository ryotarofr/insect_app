// FilterBar.test.tsx — Phase 4 server-driven filter chip 列のテスト
//
// **戦略**:
//   - useNavigate を使うので Router で wrap (shell.test.tsx と同じパターン)
//   - chip click → analytics buffer に積まれることを assert (analytics.ts の
//     __getBufferForTest を覗く)
//   - chip の selected / not-selected 切替で aria-pressed / data-selected が変わる
//   - href がそのまま <a> の属性に出る (toggle URL は server から渡る)
//   - modifier-click (Cmd / middle / Shift) はブラウザに委ねる = preventDefault しない
//
// **navigate のモック**:
//   useNavigate の戻り値は Router context に閉じている。テスト中で「navigate
//   が呼ばれたか」を直接 spy するより、URL 遷移後の location.pathname を観測
//   する方が単純だが、jsdom + @solidjs/router では navigate 時に
//   window.location が同期更新されないことがあるので、ここでは
//   window.history.pushState ではなく "preventDefault されたか" を見る方に倒す。
//   (= chip クリック時の `e.preventDefault()` が走ったかで SPA 化を測る)

import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, Route } from "@solidjs/router";
import type { JSX } from "solid-js";

import type { FilterBar as FilterBarType } from "./branded";
import { asHref } from "./branded";
import { FilterBarView } from "./FilterBar";
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

// テスト用 fixture: 「カテゴリ」軸 1 つ (live 選択中 / supply 未選択) と
// 「飼育難度」軸 1 つ (どれも未選択) を持つ。chip.href は server が toggle 後
// の URL を込めて返す前提。
//
// **Phase 5**: count を一部 chip に付けて faceted count の表示テストも兼ねる。
// `live` (selected) は「toggle off 後の件数」= 6, `supply` は「切替後の件数」= 2。
// `easy` は count を付けず、count 無し chip では `(n)` が出ないことを確認。
const sampleBar = (): FilterBarType => ({
  groups: [
    {
      key: "category",
      label: raw("カテゴリ"),
      chips: [
        {
          key: "live",
          label: raw("生体"),
          selected: true,
          href: asHref("/products"), // 解除 URL
          count: 6,
          analyticsId: "filter.category.live",
        },
        {
          key: "supply",
          label: raw("用品"),
          selected: false,
          href: asHref("/products?category=supply"),
          count: 2,
          analyticsId: "filter.category.supply",
        },
      ],
    },
    {
      key: "difficulty",
      label: raw("飼育難度"),
      chips: [
        {
          key: "easy",
          label: raw("初心者向け"),
          selected: false,
          href: asHref("/products?category=live&difficulty=easy"),
          // count / analyticsId 無し: badge も出ず、analytics buffer にも積まれない
        },
      ],
    },
  ],
});

beforeEach(() => {
  __resetAnalyticsForTest();
  // Router の起点 URL を固定 (前のテストからのリーク防止)
  window.history.replaceState({}, "", "/products?category=live");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FilterBarView (rendering)", () => {
  it("groups と chips が DOM に出る (data-* で抽出可能)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    expect(container.querySelector('[data-filter-group="category"]')).not.toBeNull();
    expect(container.querySelector('[data-filter-group="difficulty"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-filter-chip]").length).toBe(3);
  });

  it("selected chip は data-selected=true / aria-pressed=true", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    const live = container.querySelector(
      '[data-filter-chip="live"]',
    ) as HTMLAnchorElement;
    expect(live).not.toBeNull();
    expect(live.getAttribute("data-selected")).toBe("true");
    expect(live.getAttribute("aria-pressed")).toBe("true");

    const supply = container.querySelector(
      '[data-filter-chip="supply"]',
    ) as HTMLAnchorElement;
    expect(supply.getAttribute("data-selected")).toBe("false");
    expect(supply.getAttribute("aria-pressed")).toBe("false");
  });

  it("chip.href がそのまま <a href> に出る (toggle URL は server 由来)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    const live = container.querySelector(
      '[data-filter-chip="live"]',
    ) as HTMLAnchorElement;
    // selected chip の href は「自分を抜いた URL」 → /products
    expect(live.getAttribute("href")).toBe("/products");

    const supply = container.querySelector(
      '[data-filter-chip="supply"]',
    ) as HTMLAnchorElement;
    expect(supply.getAttribute("href")).toBe("/products?category=supply");
  });

  it("group の label テキストが表示される (Localizable raw)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    expect(container.textContent).toContain("カテゴリ");
    expect(container.textContent).toContain("飼育難度");
  });

  // ── Phase 5: faceted count badge ─────────────────────────────
  it("count 付き chip は data-count 属性 + (n) ラベルが出る", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    const live = container.querySelector(
      '[data-filter-chip="live"]',
    ) as HTMLAnchorElement;
    expect(live.getAttribute("data-count")).toBe("6");
    expect(live.textContent).toContain("(6)");

    const supply = container.querySelector(
      '[data-filter-chip="supply"]',
    ) as HTMLAnchorElement;
    expect(supply.getAttribute("data-count")).toBe("2");
    expect(supply.textContent).toContain("(2)");
  });

  it("count 無し chip は data-count 属性も (n) ラベルも出ない", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    const easy = container.querySelector(
      '[data-filter-chip="easy"]',
    ) as HTMLAnchorElement;
    expect(easy.getAttribute("data-count")).toBeNull();
    // chip 内に count 用 span が存在しない
    expect(easy.querySelector("[data-filter-chip-count]")).toBeNull();
  });

  it("count=0 でも non-null として描画される (= 0 件チップを消さない)", () => {
    // ローカル fixture: count=0 chip を 1 件持たせる
    const barWithZero: FilterBarType = {
      groups: [
        {
          key: "difficulty",
          label: raw("飼育難度"),
          chips: [
            {
              key: "hard",
              label: raw("上級者"),
              selected: false,
              href: asHref("/products?difficulty=hard"),
              count: 0,
              analyticsId: "filter.difficulty.hard",
            },
          ],
        },
      ],
    };
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={barWithZero} />),
    );
    const hard = container.querySelector(
      '[data-filter-chip="hard"]',
    ) as HTMLAnchorElement;
    expect(hard).not.toBeNull();
    expect(hard.getAttribute("data-count")).toBe("0");
    expect(hard.textContent).toContain("(0)");
  });
});

describe("FilterBarView (click → analytics)", () => {
  it("chip click → analytics buffer に 1 件積まれる", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    const supply = container.querySelector(
      '[data-filter-chip="supply"]',
    ) as HTMLAnchorElement;

    fireEvent.click(supply, { button: 0 });

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.analyticsId).toBe("filter.category.supply");
    expect(buf[0]!.eventType).toBe("click");
    // toggle 方向 (off → on) と group/chip key が context に入る
    expect(buf[0]!.context).toMatchObject({
      filterGroup: "category",
      filterChip: "supply",
      toggleTo: "on",
    });
  });

  it("selected chip を click すると toggleTo: 'off' になる", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    const live = container.querySelector(
      '[data-filter-chip="live"]',
    ) as HTMLAnchorElement;

    fireEvent.click(live, { button: 0 });

    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
    expect(buf[0]!.context?.toggleTo).toBe("off");
  });

  it("analyticsId 無し chip の click → buffer に積まれない (no-op)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    const easy = container.querySelector(
      '[data-filter-chip="easy"]',
    ) as HTMLAnchorElement;

    fireEvent.click(easy, { button: 0 });

    const buf = __getBufferForTest();
    expect(buf.length).toBe(0);
  });

  it("Cmd-click (modifier 付き) は preventDefault しない (= ブラウザに委ねる)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    const supply = container.querySelector(
      '[data-filter-chip="supply"]',
    ) as HTMLAnchorElement;

    // metaKey 付き click イベントを直接 dispatch して preventDefault を観測
    const evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    supply.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);

    // ただし analytics は記録される (= 新タブで開いてもクリック計測したい)
    const buf = __getBufferForTest();
    expect(buf.length).toBe(1);
  });

  it("plain left-click は preventDefault される (= SPA navigate にフックされる)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => <FilterBarView bar={sampleBar()} />),
    );
    const supply = container.querySelector(
      '[data-filter-chip="supply"]',
    ) as HTMLAnchorElement;

    const evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    supply.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });
});
