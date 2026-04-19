// shell.test.tsx — Shell コンポーネントのレンダリングテスト
import { render, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { Shell } from "./Shell";

describe("Shell", () => {
  it("renders brand name, user info, and nav groups", () => {
    const { container } = render(() => (
      <Shell
        current="mypage"
        setRoute={() => {}}
        crumb={<span>dummy</span>}
      >
        <div data-testid="child">child content</div>
      </Shell>
    ));
    const text = container.textContent ?? "";
    expect(text).toContain("KOCHŪ");
    expect(text).toContain("山田 徹"); // from getCurrentUser()
    expect(text).toContain("EC");
    expect(text).toContain("飼育");
    expect(text).toContain("取引");
    expect(text).toContain("運営");
  });

  it("marks the current route's nav item as active with aria-current", () => {
    const { container } = render(() => (
      <Shell current="specimen" setRoute={() => {}} crumb={<span />}>
        <div />
      </Shell>
    ));
    const active = container.querySelector('[aria-current="page"]');
    expect(active).not.toBeNull();
    expect(active?.textContent).toContain("個体カルテ");
  });

  it("calls setRoute with the clicked item's key", () => {
    const setRoute = vi.fn();
    const { getAllByRole } = render(() => (
      <Shell current="mypage" setRoute={setRoute} crumb={<span />}>
        <div />
      </Shell>
    ));
    const navItems = getAllByRole("button");
    // Find the "マイページ" nav item and click a different one
    const productsItem = navItems.find((el) => el.textContent?.includes("生体・用品"));
    expect(productsItem).toBeTruthy();
    fireEvent.click(productsItem!);
    expect(setRoute).toHaveBeenCalledWith("products");
  });

  it("shows cart badge when cartCount > 0", () => {
    const { container } = render(() => (
      <Shell
        current="mypage"
        setRoute={() => {}}
        crumb={<span />}
        cartCount={() => 3}
      >
        <div />
      </Shell>
    ));
    const badges = container.querySelectorAll(".nav-badge");
    // At least the cart badge should appear
    const badgeTexts = Array.from(badges).map((b) => b.textContent);
    expect(badgeTexts).toContain("3");
  });

  it("hides cart badge when cartCount is 0", () => {
    const { container } = render(() => (
      <Shell
        current="mypage"
        setRoute={() => {}}
        crumb={<span />}
        cartCount={() => 0}
      >
        <div />
      </Shell>
    ));
    // No badge should render inside the cart nav item
    const navItems = container.querySelectorAll(".nav-item");
    const cartItem = Array.from(navItems).find((el) =>
      el.textContent?.includes("カート"),
    );
    expect(cartItem).toBeTruthy();
    expect(cartItem?.querySelector(".nav-badge")).toBeNull();
  });

  it("renders children into the main area", () => {
    const { getByTestId } = render(() => (
      <Shell current="mypage" setRoute={() => {}} crumb={<span />}>
        <p data-testid="child-content">Hello test</p>
      </Shell>
    ));
    expect(getByTestId("child-content").textContent).toBe("Hello test");
  });
});
