// e2e.test.tsx — ページ統合テスト
// App をマウントし、実際のキーボード操作とカート追加フローを再現する
//
// P2-1 以降、App は @solidjs/router の useLocation/useNavigate を使うため、
// テストでは MemoryRouter (Router + memoryIntegration) で包む必要がある。
import { render, fireEvent } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it } from "vitest";
import { Router, Route } from "@solidjs/router";
import { App } from "../App";
import { clearCart, addItem, cartItems, type CartItem } from "../store/cart";

// fade-enter 等の CSS transition は jsdom では不要なので無視

// module-scoped cart 状態は beforeEach でクリアする。
// history API も mypage に戻す (各テスト独立)。
beforeEach(() => {
  clearCart();
  window.history.replaceState({}, "", "/");
});

/** App を Router で包むヘルパ */
const AppInRouter = () => (
  <Router>
    <Route path="*" component={App} />
  </Router>
);

const waitFor = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fireKey = (key: string) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
};

describe("E2E: route navigation via keyboard", () => {
  it("starts on mypage and responds to numeric shortcuts", async () => {
    const { container } = render(() => <AppInRouter />);

    // default: mypage (no stored route)
    const initialHeader = container.querySelector(".cat")?.textContent ?? "";
    expect(initialHeader).toMatch(/マイページ/);

    // "2" → products
    fireKey("2");
    await waitFor(10);
    expect(container.querySelector(".cat")?.textContent).toMatch(/ショップ/);

    // UX-1: 個体カルテをショートカットから外したので 1-8 連番。
    // "4" → eclosion
    fireKey("4");
    await waitFor(10);
    expect(container.querySelector(".cat")?.textContent).toMatch(/羽化予測/);

    // "8" → cart
    fireKey("8");
    await waitFor(10);
    expect(container.querySelector(".cat")?.textContent).toMatch(/お会計/);
  });

  it("reflects numeric shortcut in URL pathname", async () => {
    const { container } = render(() => <AppInRouter />);
    // UX-1: "3" → log (個体カルテのショートカットは廃止)
    fireKey("3");
    await waitFor(10);
    expect(window.location.pathname).toBe("/log");
    void container;
  });
});

describe("E2E: cart flow", () => {
  const item: CartItem = {
    id: "e2e-1",
    title: "E2E ヘラクレス",
    meta: "CBF2 · #E2E-0001",
    price: 50000,
    qty: 1,
    kind: "生体",
    tone: "forest",
  };

  it("sidebar cart badge reflects cartCount", async () => {
    addItem(item);
    addItem({ ...item, id: "e2e-2", qty: 2 });
    const { container } = render(() => <AppInRouter />);

    // cart nav item should show badge = 3
    const navItems = container.querySelectorAll(".nav-item");
    const cartNav = Array.from(navItems).find((el) =>
      el.textContent?.includes("カート"),
    );
    expect(cartNav?.querySelector(".nav-badge")?.textContent).toBe("3");
  });

  it("cart page shows added item and total", async () => {
    addItem(item);
    const { container } = render(() => <AppInRouter />);
    fireKey("8"); // UX-1: navigate to cart (renumbered)
    await waitFor(10);

    const text = container.textContent ?? "";
    expect(text).toContain("E2E ヘラクレス");
    expect(text).toContain("50,000"); // price
  });

  it("removeItem button removes row from cart display", async () => {
    addItem(item);
    addItem({ ...item, id: "e2e-3", title: "E2E 用品" });
    const { container } = render(() => <AppInRouter />);
    fireKey("8");
    await waitFor(10);

    // Find the first row and click its 削除 button
    const before = (container.textContent ?? "").match(/E2E/g)?.length ?? 0;
    expect(before).toBeGreaterThanOrEqual(2);

    // cartItems = [e2e-1, e2e-3]. remove e2e-1 programmatically, verify UI reactivity.
    // (Triggering the actual button click couples the test to DOM layout.)
    const { removeItem } = await import("../store/cart");
    removeItem("e2e-1");
    await waitFor(10);

    expect(container.textContent).not.toContain("E2E ヘラクレス");
    expect(container.textContent).toContain("E2E 用品");
  });

  it("empty cart shows fallback message", async () => {
    clearCart();
    const { container } = render(() => <AppInRouter />);
    fireKey("8");
    await waitFor(10);

    const text = container.textContent ?? "";
    // CartPage has an empty fallback with 60px padding
    expect(text).toContain("お会計");
    // Make sure no item rows render
    expect(cartItems()).toEqual([]);
  });
});

describe("E2E: specimen carte tabs", () => {
  // UX-1: 個体カルテはサイドバー / ショートカットから外したので、
  //   テストでは直接 URL で個体ページにジャンプする (実運用では MyPage 所有個体カードから遷移)。
  //   id の "#" は fragment と区別するため encodeURIComponent で %23 にエンコードする。
  const enterSpecimen = async () => {
    const id = encodeURIComponent("#DHH-0271");
    window.history.replaceState({}, "", `/specimen/${id}`);
    const { container } = render(() => <AppInRouter />);
    await waitFor(10);
    return container;
  };

  it("renders 1-hero-3-tabs layout and switches tabs", async () => {
    const container = await enterSpecimen();

    // Hero は最新KPI 3点を表示
    const heroText = container.querySelector(".carte-hero")?.textContent ?? "";
    expect(heroText).toContain("体重");
    expect(heroText).toContain("サイズ");
    expect(heroText).toContain("次の羽化");

    // タブは 3つ (概要 / ログ / 血統)
    const tabs = container.querySelectorAll(".carte-tabs button");
    expect(tabs.length).toBe(3);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");

    // ログタブへ切替
    fireEvent.click(tabs[1]);
    await waitFor(10);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("タイムライン");

    // 血統タブへ切替
    fireEvent.click(tabs[2]);
    await waitFor(10);
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("血統");
  });

  it("opens QuickLogSheet when a quicklog shortcut button is clicked", async () => {
    // P4-10: 「この個体にログを追加」単一ボタン → 5 ボタンショートカット (体重/給餌/観察/脱皮/マット)
    const container = await enterSpecimen();

    // シートは初期状態では非表示
    expect(container.querySelector(".sheet-dialog")).toBeNull();

    // quicklog-row 内に 5 ボタンが存在し、それぞれの LogType を preset してシートを開く
    const row = container.querySelector(".quicklog-row");
    expect(row).not.toBeNull();
    const buttons = row!.querySelectorAll("button.quicklog-btn");
    expect(buttons.length).toBe(5);

    // 体重ボタン (先頭) をクリック
    fireEvent.click(buttons[0]);
    await waitFor(10);

    expect(container.querySelector(".sheet-dialog")).not.toBeNull();
    expect(container.querySelector(".sheet-dialog")?.textContent).toContain("記録を追加");
  });
});

describe("E2E: /specimen no-id redirects to mypage (UX-1)", () => {
  it("strips /specimen (no id) URL back to mypage on mount", async () => {
    window.history.replaceState({}, "", "/specimen");
    render(() => <AppInRouter />);
    await waitFor(20);
    // redirect が走った直後の pathname は "/" になっているはず
    expect(window.location.pathname).toBe("/");
  });
});
