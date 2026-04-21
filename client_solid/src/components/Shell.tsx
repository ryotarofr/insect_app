// Shell.tsx — sidebar + topbar shell (Solid.js port of poc/components/shell.jsx)
import { For, Show, type JSX } from "solid-js";
import { type RouteKey } from "../data";
import { getCurrentUser } from "../api";
import { Icons } from "./Icons";

interface NavEntry {
  key: RouteKey;
  label: string;
  icon: () => JSX.Element;
  group: "EC" | "飼育" | "取引" | "運営";
  /** 動的な数値として評価される。0 や undefined の場合はバッジを表示しない */
  badge?: () => number | undefined;
  hidden?: boolean;
}

const GROUPS: Array<NavEntry["group"]> = ["EC", "飼育", "取引", "運営"];

interface ShellProps {
  current: RouteKey;
  setRoute: (r: RouteKey) => void;
  crumb: JSX.Element;
  children: JSX.Element;
  topActions?: JSX.Element;
  /** カート内の合計点数 */
  cartCount?: () => number;
  /** 60 日以内に羽化予定の個体数 */
  eclosionCount?: () => number;
}

export const Shell = (props: ShellProps) => {
  const nav: NavEntry[] = [
    { key: "products", label: "生体・用品", icon: Icons.grid, group: "EC" },
    { key: "product-detail", label: "商品詳細", icon: Icons.tag, group: "EC", hidden: true },
    {
      key: "cart",
      label: "カート",
      icon: Icons.cart,
      group: "EC",
      badge: () => props.cartCount?.(),
    },
    { key: "mypage", label: "マイページ", icon: Icons.home, group: "飼育" },
    { key: "specimen", label: "個体カルテ", icon: Icons.card, group: "飼育" },
    { key: "log", label: "飼育ログ", icon: Icons.timeline, group: "飼育" },
    {
      key: "eclosion",
      label: "羽化予測",
      icon: Icons.bell,
      group: "飼育",
      badge: () => props.eclosionCount?.(),
    },
    { key: "bloodline", label: "血統系図", icon: Icons.tree, group: "飼育" },
    { key: "market", label: "C2Cマーケット", icon: Icons.beetle, group: "取引" },
    { key: "shop", label: "ショップ管理", icon: Icons.shop, group: "運営" },
  ];

  return (
    <div class="app">
      <aside class="sidebar" role="navigation" aria-label="メインナビゲーション">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            蟲
          </div>
          <div>
            <div class="brand-name">KOCHŪ</div>
            <div class="brand-sub">昆虫EC × 飼育ログ</div>
          </div>
        </div>

        <For each={GROUPS}>
          {(g) => (
            <div class="nav-group">
              <div class="nav-title">{g}</div>
              <For each={nav.filter((n) => n.group === g && !n.hidden)}>
                {(n) => {
                  const isActive = () => props.current === n.key;
                  const badgeVal = () => n.badge?.();
                  return (
                    <div
                      class={"nav-item" + (isActive() ? " active" : "")}
                      role="button"
                      tabindex="0"
                      aria-current={isActive() ? "page" : undefined}
                      onClick={() => props.setRoute(n.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          props.setRoute(n.key);
                        }
                      }}
                    >
                      {n.icon()}
                      <span>{n.label}</span>
                      <Show when={badgeVal() && badgeVal()! > 0}>
                        <span class="nav-badge" aria-label={`${n.label} ${badgeVal()} 件`}>
                          {badgeVal()}
                        </span>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          )}
        </For>

        <div class="sidebar-footer">
          <div class="avatar" aria-hidden="true">
            {getCurrentUser().initial}
          </div>
          <div>
            <div class="user-name">{getCurrentUser().name}</div>
            <div class="user-role">{getCurrentUser().role}</div>
          </div>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <div class="crumb">{props.crumb}</div>
          <div class="search" title="検索はまだ実装されていません">
            <svg
              class="sicon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <label for="topbar-search" class="visually-hidden">
              検索
            </label>
            <input
              id="topbar-search"
              placeholder="個体ID・種名・商品を検索（準備中）"
              disabled
              aria-disabled="true"
            />
            <span class="kbd skbd" aria-hidden="true">
              ⌘K
            </span>
          </div>
          {props.topActions}
        </header>
        <main class="content fade-enter" role="main">
          {props.children}
        </main>
      </div>
    </div>
  );
};
