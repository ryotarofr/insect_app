// shell.test.tsx — Shell コンポーネントのレンダリングテスト
//
// P2-2 以降、Shell / BottomTabBar は @solidjs/router の <A> を使うため、
// 各テストで Router で包む必要がある。
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Router, Route } from "@solidjs/router";
import type { JSX } from "solid-js";
import { Shell } from "./Shell";
import { resetAuthForTest, setAuthForTest } from "../store/auth";

const wrapWithRouter = (child: () => JSX.Element) => (
  <Router>
    <Route path="*" component={child as () => JSX.Element} />
  </Router>
);

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  // sidebar-footer は currentUser() に依存。テスト用フィクスチャを仕込む。
  setAuthForTest({
    userId: "a0a0a0a0-0000-4000-8000-00000000a0a0",
    publicId: "t_yamada",
    name: "山田 徹",
    role: "breeder",
    avatarInitial: "山",
    joinedAt: "2024-03-15T00:00:00Z",
  });
});

afterEach(() => {
  resetAuthForTest();
});

describe("Shell", () => {
  it("renders brand name, user info, and nav groups", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <Shell current="mypage" setRoute={() => {}} crumbs={[{ label: "dummy" }]}>
          <div data-testid="child">child content</div>
        </Shell>
      )),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("KOCHŪ");
    expect(text).toContain("山田 徹"); // from currentUser() fixture
    expect(text).toContain("EC");
    expect(text).toContain("飼育");
    // C2C pivot (migration 0021) で旧「取引 / 運営」セクションは廃止。
    // 現在のサイドバーは「マーケット」と「飼育」の 2 セクション構成。
    expect(text).toContain("マーケット");
  });

  it("marks the current route's nav item as active with aria-current", () => {
    // @solidjs/router's <A> 自身が URL に基づき aria-current="page" を付与する。
    // そのため現在 pathname をテスト対象の route に合わせる必要がある。
    // Cohort Phase 1: /log を廃止して /cohorts に統合済。アクティブ検証はそちらで行う。
    window.history.replaceState({}, "", "/cohorts");
    const { container } = render(() =>
      wrapWithRouter(() => (
        <Shell current="cohort" setRoute={() => {}} crumbs={[{ label: "test" }]}>
          <div />
        </Shell>
      )),
    );
    const actives = container.querySelectorAll('.nav-item[aria-current="page"]');
    expect(actives.length).toBeGreaterThan(0);
    const cohortActive = Array.from(actives).find((el) =>
      el.textContent?.includes("飼育"),
    );
    expect(cohortActive).toBeTruthy();
  });

  it("does not list 個体カルテ in the sidebar (UX-1)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <Shell current="mypage" setRoute={() => {}} crumbs={[{ label: "test" }]}>
          <div />
        </Shell>
      )),
    );
    const navItems = container.querySelectorAll(".nav-item");
    const specimenNav = Array.from(navItems).find((el) =>
      el.textContent?.includes("個体カルテ"),
    );
    expect(specimenNav).toBeUndefined();
  });

  it("highlights マイページ in sidebar when current is specimen (UX-1: child page)", () => {
    // 個体カルテ (specimen) はマイページの子ページなので、
    // /specimen 表示中でもサイドバーは「マイページ」が active のまま。
    window.history.replaceState({}, "", "/specimen/%23DHH-0271");
    const { container } = render(() =>
      wrapWithRouter(() => (
        <Shell current="specimen" setRoute={() => {}} crumbs={[{ label: "test" }]}>
          <div />
        </Shell>
      )),
    );
    const navItems = container.querySelectorAll(".nav-item");
    const mypageNav = Array.from(navItems).find((el) =>
      el.textContent?.includes("マイページ"),
    );
    expect(mypageNav).toBeTruthy();
    expect(mypageNav?.classList.contains("active")).toBe(true);
  });

  it("nav-items are anchor tags with correct href (middle-click-safe)", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <Shell current="mypage" setRoute={() => {}} crumbs={[{ label: "test" }]}>
          <div />
        </Shell>
      )),
    );
    const anchors = Array.from(container.querySelectorAll("a.nav-item"));
    // C2C pivot 後: 旧「生体・用品」は「出品中の生体」にリネーム。
    const productsAnchor = anchors.find((a) =>
      a.textContent?.includes("出品中の生体"),
    ) as HTMLAnchorElement | undefined;
    expect(productsAnchor).toBeTruthy();
    expect(productsAnchor!.tagName).toBe("A");
    expect(productsAnchor!.getAttribute("href")).toBe("/products");
  });

  it("shows cart badge when cartCount > 0", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <Shell
          current="mypage"
          setRoute={() => {}}
          crumbs={[{ label: "test" }]}
          cartCount={() => 3}
        >
          <div />
        </Shell>
      )),
    );
    const badges = container.querySelectorAll(".nav-badge");
    const badgeTexts = Array.from(badges).map((b) => b.textContent);
    expect(badgeTexts).toContain("3");
  });

  it("hides cart badge when cartCount is 0", () => {
    const { container } = render(() =>
      wrapWithRouter(() => (
        <Shell
          current="mypage"
          setRoute={() => {}}
          crumbs={[{ label: "test" }]}
          cartCount={() => 0}
        >
          <div />
        </Shell>
      )),
    );
    const navItems = container.querySelectorAll(".nav-item");
    const cartItem = Array.from(navItems).find((el) =>
      el.textContent?.includes("カート"),
    );
    expect(cartItem).toBeTruthy();
    expect(cartItem?.querySelector(".nav-badge")).toBeNull();
  });

  it("renders children into the main area", () => {
    const { getByTestId } = render(() =>
      wrapWithRouter(() => (
        <Shell current="mypage" setRoute={() => {}} crumbs={[{ label: "test" }]}>
          <p data-testid="child-content">Hello test</p>
        </Shell>
      )),
    );
    expect(getByTestId("child-content").textContent).toBe("Hello test");
  });
});
