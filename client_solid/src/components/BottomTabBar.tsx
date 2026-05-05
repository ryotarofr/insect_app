// BottomTabBar.tsx — モバイル用下部タブ (5 タブ + More シート)
//
// 設計方針:
//   - 主要 5 タブ: ホーム / 羽化 / 記録 / 市場 / カート
//   - それ以外 (商品一覧・個体カルテ・血統・ショップ管理) は "More" シートから辿る
//   - タップ領域 48×48 以上を確保 (Material の推奨値)
//   - バッジ (カート点数 / 羽化予定数) は数値で表示し、99+ に丸める
//   - active の current route が More 内のページの場合は More タブをハイライト
//
// iOS は対象外なので safe-area-inset-bottom は扱うが過剰な HIG 準拠はしない。
import { For, Show, createSignal, type JSX } from "solid-js";
import { A } from "@solidjs/router";
import { type RouteKey } from "../data";
import { Icons } from "./Icons";
import { ROUTE_PATHS, sidebarRouteKey } from "../router";

type PrimaryKey = RouteKey | "more";

interface PrimaryTab {
  key: PrimaryKey;
  label: string;
  icon: () => JSX.Element;
  badge?: () => number | undefined;
}

interface MoreItem {
  key: RouteKey;
  label: string;
  icon: () => JSX.Element;
  hint?: string;
}

interface BottomTabBarProps {
  current: RouteKey;
  /**
   * P2-2 以降: 実際のナビゲーションは <A> が router.navigate で行うため、
   * setRoute は primary/more タブからは呼ばれない。
   * 外部 (キーボードショートカット等) との互換のため残しているが現在未使用。
   */
  setRoute?: (r: RouteKey) => void;
  cartCount?: () => number;
  eclosionCount?: () => number;
}

/** More シート側にまわすルート (= 下部バーに primary として出さないもの) */
// 個体カルテ (specimen) は詳細ビューなので More からは出さない。
// C2C pivot: 旧 "shop" は廃止 (= ショップ管理機能なし)。
const MORE_ROUTES: RouteKey[] = [
  "products",
  "product-detail", // 単独で飛ぶ導線はない (商品一覧経由)
  "bloodline",
];

const formatBadge = (n: number | undefined): string | null => {
  if (!n || n <= 0) return null;
  if (n > 99) return "99+";
  return String(n);
};

export const BottomTabBar = (props: BottomTabBarProps) => {
  const [moreOpen, setMoreOpen] = createSignal(false);

  const primary: PrimaryTab[] = [
    { key: "mypage", label: "ホーム", icon: Icons.home },
    {
      key: "eclosion",
      label: "羽化",
      icon: Icons.bell,
      badge: () => props.eclosionCount?.(),
    },
    // Cohort Phase 1: 旧「記録 (= /log)」を「飼育 (= /cohorts)」に置換。
    { key: "cohort", label: "飼育", icon: Icons.timeline },
    // C2C pivot: 旧 "market" (= C2Cマーケット) は廃止。/products に統合済。
    { key: "products", label: "市場", icon: Icons.beetle },
    {
      key: "cart",
      label: "カート",
      icon: Icons.cart,
      badge: () => props.cartCount?.(),
    },
  ];

  const moreItems: MoreItem[] = [
    // C2C pivot: 旧 "shop" (= ショップ管理) は廃止。
    { key: "products", label: "出品中の生体", icon: Icons.grid, hint: "C2Cマーケット" },
    { key: "bloodline", label: "血統系図", icon: Icons.tree, hint: "系譜・近交係数" },
  ];

  // UX-1: specimen 等の詳細ビューは親ルートに丸めてから判定する。
  const isMoreActive = () => MORE_ROUTES.includes(sidebarRouteKey(props.current));

  const closeMore = () => setMoreOpen(false);

  return (
    <>
      <nav
        class="bottom-tab"
        role="navigation"
        aria-label="モバイルナビゲーション"
      >
        <For each={primary}>
          {(t) => {
            // primary には "more" が含まれないよう key は RouteKey に限定
            const routeKey = t.key as RouteKey;
            // UX-1: 詳細ビュー (specimen) はマイページの子として扱い、ホームを active のままにする。
            const isActive = () => sidebarRouteKey(props.current) === routeKey;
            const badge = () => formatBadge(t.badge?.());
            return (
              <A
                href={ROUTE_PATHS[routeKey]}
                class={"bt-tab" + (isActive() ? " active" : "")}
                aria-current={isActive() ? "page" : undefined}
                aria-label={t.label}
                onClick={closeMore}
              >
                <span class="bt-icon" aria-hidden="true">{t.icon()}</span>
                <span class="bt-label">{t.label}</span>
                <Show when={badge()}>
                  <span class="bt-badge" aria-hidden="true">{badge()}</span>
                </Show>
              </A>
            );
          }}
        </For>
        <button
          type="button"
          class={"bt-tab" + (isMoreActive() || moreOpen() ? " active" : "")}
          aria-expanded={moreOpen()}
          aria-haspopup="menu"
          aria-label="その他"
          onClick={() => setMoreOpen((o) => !o)}
        >
          <span class="bt-icon" aria-hidden="true">
            <svg
              class="nav-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="5" cy="12" r="1.3" fill="currentColor" />
              <circle cx="12" cy="12" r="1.3" fill="currentColor" />
              <circle cx="19" cy="12" r="1.3" fill="currentColor" />
            </svg>
          </span>
          <span class="bt-label">その他</span>
        </button>
      </nav>

      <Show when={moreOpen()}>
        <div
          class="bt-more-backdrop"
          onClick={() => setMoreOpen(false)}
          role="presentation"
        />
        <div class="bt-more-sheet" role="menu" aria-label="その他のメニュー">
          <div class="bt-more-head">
            <span class="section-label">その他</span>
            <button
              type="button"
              class="bt-more-close"
              aria-label="閉じる"
              onClick={() => setMoreOpen(false)}
            >
              ×
            </button>
          </div>
          <ul class="bt-more-list">
            <For each={moreItems}>
              {(m) => (
                <li>
                  <A
                    href={ROUTE_PATHS[m.key]}
                    class={
                      "bt-more-item" +
                      (sidebarRouteKey(props.current) === m.key ? " active" : "")
                    }
                    role="menuitem"
                    onClick={closeMore}
                  >
                    <span class="bt-more-ico" aria-hidden="true">{m.icon()}</span>
                    <span class="bt-more-body">
                      <span class="bt-more-label">{m.label}</span>
                      <Show when={m.hint}>
                        <span class="bt-more-hint">{m.hint}</span>
                      </Show>
                    </span>
                  </A>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </>
  );
};
