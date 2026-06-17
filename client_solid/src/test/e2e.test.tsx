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
  // Phase 9 Cart Legacy 移行 (= task #47-51) で /cart ルートが旧 Cart.tsx (= `.cat` "お会計"
  // ヘッダ + cartItems() 直描画) から CartSduiPage (= /cards/cart 経由 fetch) に切り替わった。
  // 「8 → cart → .cat 'お会計'」を確認する版は legacy DOM 構造前提なので skip し、
  // 後続 PR で `vi.stubGlobal("fetch", ...)` 経由で SduiPage を mock 検証する想定。
  // それ以外のショートカット (= 2 / 4) は依然有効なので別テストで切り出す。
  it("responds to shortcuts 2 (products) and 4 (eclosion)", async () => {
    const { container } = render(() => <AppInRouter />);

    // default: mypage (no stored route)
    const initialHeader = container.querySelector(".cat")?.textContent ?? "";
    expect(initialHeader).toMatch(/マイページ/);

    // "2" → products
    fireKey("2");
    await waitFor(10);
    // C2C pivot 後: ProductsList の cat ラベルは「ショップ」→「マーケット」。
    expect(container.querySelector(".cat")?.textContent).toMatch(/マーケット/);

    // "4" → eclosion
    fireKey("4");
    await waitFor(10);
    expect(container.querySelector(".cat")?.textContent).toMatch(/羽化予測/);
  });

  it("reflects numeric shortcut in URL pathname", async () => {
    const { container } = render(() => <AppInRouter />);
    // Cohort Phase 1: SHORTCUT_MAP["3"] は旧 "log" から "cohort" に再割当てされ、
    // RouteKey "cohort" は router.ts::ROUTES で "/cohorts" にマップされる。
    // (UX-1: 個体カルテのショートカットは廃止 → 飼育 (cohort) に統合)
    fireKey("3");
    await waitFor(10);
    expect(window.location.pathname).toBe("/cohorts");
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

  // sidebar の cart badge は `cartCount()` (= local store) を直接見るので Cart Legacy 移行後も
  // そのまま動く。本テストは現役で残す。
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

  // **Phase 9 Cart Legacy 移行 (task #47-51) 後の状態** で skip:
  //   /cart 路は CartSduiPage (= /cards/cart fetch + SDUI レンダ) に置き換わったため、
  //   旧 Cart.tsx 前提の DOM (= title/price 直描画 / 削除ボタン / "お会計" fallback) は出ない。
  //   後続 PR で `vi.stubGlobal("fetch", ...)` で /cards/cart モックを返す再構成版を書く。
  //   それまでは sidebar badge と URL navigation を確認する `sidebar cart badge` だけで
  //   "/cart 周りに最低限の回帰検出" を担保する。
  it.skip("[legacy / migrated to SduiPage] cart page shows added item and total", async () => {
    addItem(item);
    const { container } = render(() => <AppInRouter />);
    fireKey("8");
    await waitFor(10);

    const text = container.textContent ?? "";
    expect(text).toContain("E2E ヘラクレス");
    expect(text).toContain("50,000");
  });

  it.skip("[legacy / migrated to SduiPage] removeItem button removes row from cart display", async () => {
    addItem(item);
    addItem({ ...item, id: "e2e-3", title: "E2E 用品" });
    const { container } = render(() => <AppInRouter />);
    fireKey("8");
    await waitFor(10);

    const before = (container.textContent ?? "").match(/E2E/g)?.length ?? 0;
    expect(before).toBeGreaterThanOrEqual(2);

    const { removeItem } = await import("../store/cart");
    removeItem("e2e-1");
    await waitFor(10);

    expect(container.textContent).not.toContain("E2E ヘラクレス");
    expect(container.textContent).toContain("E2E 用品");
  });

  it.skip("[legacy / migrated to SduiPage] empty cart shows fallback message", async () => {
    clearCart();
    const { container } = render(() => <AppInRouter />);
    fireKey("8");
    await waitFor(10);

    const text = container.textContent ?? "";
    expect(text).toContain("お会計");
    expect(cartItems()).toEqual([]);
  });
});

describe("E2E: specimen carte tabs", () => {
  // PR #5a: APP_DATA.specimens 廃止後は serverSpecimens cache に fixture を仕込む。
  // App の createEffect が currentUser()=null で clearServerSpecimens() を呼ぶため、
  // auth fixture も併せて仕込む (= login 状態にして refresh 経路へ流す。fetch は失敗するが
  // 例外パスは fixture を消さないので fixture は残る)。
  beforeEach(async () => {
    const { setAuthForTest } = await import("../store/auth");
    const { setServerSpecimensForTest } = await import("../store/specimens");
    setAuthForTest({
      userId: "a0a0a0a0-0000-4000-8000-00000000a0a0",
      publicId: "t_yamada",
      name: "山田 徹",
      role: "breeder",
      avatarInitial: "山",
      joinedAt: "2024-03-15T00:00:00Z",
    });
    setServerSpecimensForTest([
      {
        id: "11111111-1111-4111-8111-111111111111",
        publicId: "#DHH-0271",
        ownerUserId: "a0a0a0a0-0000-4000-8000-00000000a0a0",
        speciesId: "dhh",
        name: "ヘラクレス 黒曜",
        sex: "male",
        stage: "蛹",
        stageProgress: 0.72,
        sizeMm: 142,
        weightG: 28.4,
        birthDate: "2024-08-12",
        purchasedAt: "2025-11-03",
        generation: "CBF2",
        eclosionEta: "2026-05-04",
        lifeStatus: "active",
        isArchived: false,
        notes: null,
      },
    ]);
  });

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
