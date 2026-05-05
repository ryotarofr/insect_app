// Shell.tsx — sidebar + topbar shell (Solid.js port of poc/components/shell.jsx)
//
// P2-2: nav-item を <A href> 化。
//   - <A> が <a> を描画するため、middle-click / Cmd+click / 新しいタブ が効く。
//   - setRoute は keyboard shortcut 経由では残す (prop として受ける)。
//   - 実際のナビゲーションは <A> が router.navigate を呼ぶので setRoute は不要。
//
// P4-20: ルート遷移で毎回 .fade-enter をリトリガー。
//   - <main> に static で付いている .fade-enter は初回マウント時しか発火しない。
//   - useLocation().pathname を watch し、変わったタイミングで class を一度外して
//     強制 reflow 後に再付与することで CSS アニメーションを再生する。
import { createEffect, For, Show, type JSX } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { type RouteKey } from "../data";
import { Icons } from "./Icons";
import { BottomTabBar } from "./BottomTabBar";
import { Breadcrumb, type Crumb } from "./Breadcrumb";
import { ROUTE_PATHS, sidebarRouteKey } from "../router";
import { openCommandPalette } from "../store/commandPalette";
import {
  getThemeMode,
  hasSeenNightRedOnboarding,
  markNightRedOnboardingSeen,
  toggleNightRed,
} from "../store/theme";
import { showToast } from "../store/toast";
import { currentUser, logout as authLogout } from "../store/auth";

interface NavEntry {
  key: RouteKey;
  label: string;
  icon: () => JSX.Element;
  group: "マーケット" | "飼育";
  /** 動的な数値として評価される。0 や undefined の場合はバッジを表示しない */
  badge?: () => number | undefined;
  hidden?: boolean;
}

// C2C pivot: 旧 "EC" / "取引" / "運営" を「マーケット」に統合。
//   - "EC" (= 生体・用品 + カート) と "取引" (= C2Cマーケット) は同概念のため統合
//   - "運営" (= ショップ管理) は B2C 概念のため全廃
const GROUPS: Array<NavEntry["group"]> = ["マーケット", "飼育"];

interface ShellProps {
  current: RouteKey;
  setRoute: (r: RouteKey) => void;
  /** P2-14: パンくずは構造化した Crumb[] で渡す (JSX ではない) */
  crumbs: Crumb[];
  children: JSX.Element;
  topActions?: JSX.Element;
  /** カート内の合計点数 */
  cartCount?: () => number;
  /** 60 日以内に羽化予定の個体数 */
  eclosionCount?: () => number;
}

export const Shell = (props: ShellProps) => {
  // P4-20: route 変更で <main> の fade アニメを再生する
  const location = useLocation();
  let mainRef: HTMLElement | undefined;
  let prevPath: string | null = null;
  createEffect(() => {
    const path = location.pathname;
    if (!mainRef) {
      prevPath = path;
      return;
    }
    if (prevPath !== null && prevPath !== path) {
      mainRef.classList.remove("fade-enter");
      // reflow を強制して animation を確実にリスタートさせる
      void mainRef.offsetWidth;
      mainRef.classList.add("fade-enter");
    }
    prevPath = path;
  });

  const nav: NavEntry[] = [
    // C2C pivot: 「生体・用品」を「出品中の生体」に改名。/products URL はそのまま。
    { key: "products", label: "出品中の生体", icon: Icons.grid, group: "マーケット" },
    { key: "product-detail", label: "出品詳細", icon: Icons.tag, group: "マーケット", hidden: true },
    // C2C pivot: 出品作成ページ (= 個体カルテ「この個体を出品」/ 一覧の CTA から到達)
    { key: "listing-new", label: "出品する", icon: Icons.plus, group: "マーケット", hidden: true },
    // Phase 3: 自分の出品管理 (= /listings/me)。販売者目線の主要動線。
    { key: "my-listings", label: "マイ出品", icon: Icons.tag, group: "マーケット" },
    // Phase 3: 取引履歴 (= /orders、C2C pivot 後は購入+販売の取引履歴として運用)。
    //   実装本体は MyOrdersPage / OrderDetailPage。販売側 orders は Phase 4 で統合予定。
    { key: "orders", label: "取引履歴", icon: Icons.timeline, group: "マーケット" },
    { key: "order-detail", label: "取引詳細", icon: Icons.card, group: "マーケット", hidden: true },
    {
      key: "cart",
      label: "カート",
      icon: Icons.cart,
      group: "マーケット",
      badge: () => props.cartCount?.(),
    },
    { key: "mypage", label: "マイページ", icon: Icons.home, group: "飼育" },
    // 個体カルテは詳細ビュー (`:id` パラメトリック) なので、サイドバーには出さない。
    // マイページの所有個体カード / 羽化レーダー / Bloodline 等から id 付きで開く。
    { key: "specimen", label: "個体カルテ", icon: Icons.card, group: "飼育", hidden: true },
    // Cohort Phase 1: 旧「飼育ログ」を「飼育」にリネームして /cohorts に統合。
    //   ロギング機能は群詳細・個体詳細・個体化モードのコンテキスト内に内包。
    { key: "cohort", label: "飼育", icon: Icons.timeline, group: "飼育" },
    // Cohort Phase 1 派生ルート (= サイドバーに出さない、親 cohort をハイライト)
    { key: "cohort-detail", label: "群詳細", icon: Icons.card, group: "飼育", hidden: true },
    { key: "cohort-promote", label: "個体化", icon: Icons.card, group: "飼育", hidden: true },
    { key: "cohort-new", label: "群を作成", icon: Icons.card, group: "飼育", hidden: true },
    { key: "specimen-new", label: "個体登録", icon: Icons.card, group: "飼育", hidden: true },
    {
      key: "eclosion",
      label: "羽化予測",
      icon: Icons.bell,
      group: "飼育",
      badge: () => props.eclosionCount?.(),
    },
    { key: "bloodline", label: "血統系図", icon: Icons.tree, group: "飼育" },
    // C2C pivot: 旧 "C2Cマーケット" は /products に統合済 (= sidebar から削除)。
    // 旧 "ショップ管理" は B2C 概念のため全廃。
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
                  // UX-1: 詳細ビュー (specimen / product-detail) は親ルートの子として扱う。
                  //   個体カルテ表示中もサイドバー上ではマイページを active にする。
                  const isActive = () => sidebarRouteKey(props.current) === n.key;
                  const badgeVal = () => n.badge?.();
                  return (
                    <A
                      href={ROUTE_PATHS[n.key]}
                      class={"nav-item" + (isActive() ? " active" : "")}
                      aria-current={isActive() ? "page" : undefined}
                    >
                      {n.icon()}
                      <span>{n.label}</span>
                      <Show when={badgeVal() && badgeVal()! > 0}>
                        <span class="nav-badge" aria-label={`${n.label} ${badgeVal()} 件`}>
                          {badgeVal()}
                        </span>
                      </Show>
                    </A>
                  );
                }}
              </For>
            </div>
          )}
        </For>

        <Show when={currentUser()}>
          {(u) => (
            <div class="sidebar-footer">
              <div class="avatar" aria-hidden="true">
                {u().avatarInitial ?? u().name.slice(0, 1)}
              </div>
              <div>
                <div class="user-name">{u().name}</div>
                <div class="user-role">{u().role}</div>
              </div>
            </div>
          )}
        </Show>

        {/* Phase 9.G: 認証 quick action。anonymous → ログインリンク / 既ログイン → ログアウト。
            mock user 表示 (上の sidebar-footer) はそのまま残し、本リンクは独立 row で出す。
            CSS は app-layout.css の .sidebar-auth-link を参照 (= 軽い inline スタイルでも代用可)。 */}
        <div
          class="sidebar-auth"
          style={{
            padding: "8px 16px",
            "border-top": "1px solid var(--ink-faint, #ddd)",
            "font-size": "11px",
            "text-align": "center",
          }}
        >
          <Show
            when={currentUser()}
            fallback={
              <A href={ROUTE_PATHS.login} class="sidebar-auth-link">
                ログイン / 新規登録
              </A>
            }
          >
            {(_user) => (
              <button
                type="button"
                class="sidebar-auth-link"
                onClick={() => {
                  // logout 自体は失敗しても store/auth が finally で signal を null にする。
                  // ここでは promise を持たず fire-and-forget でよい。
                  void authLogout();
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--ink-faint, #888)",
                  cursor: "pointer",
                  padding: "0",
                  font: "inherit",
                }}
              >
                ログアウト
              </button>
            )}
          </Show>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <Breadcrumb items={props.crumbs} />
          {/* P4-5: 擬似検索バー — クリックで CommandPalette を開く (input ではなく button) */}
          <button
            type="button"
            class="search search-trigger"
            aria-label="検索 (Command+K)"
            onClick={openCommandPalette}
          >
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
            <span class="search-placeholder">
              個体ID・種名・商品を検索...
            </span>
            <span class="kbd skbd" aria-hidden="true">
              ⌘K
            </span>
          </button>
          {/* P4-8: 夜間赤色テーマ トグル
              §4 改善: 一般的なダークモードと混同されないように
                - アイコンに赤い「ドット」を併置 (= active 時は赤丸塗り潰し)
                - tooltip に「暗順応保護用」を明記
                - 初回 ON 時に1度だけ説明トースト */}
          <button
            type="button"
            class={
              "theme-toggle" +
              (getThemeMode() === "night-red" ? " is-active" : "")
            }
            onClick={() => {
              const willTurnOn = getThemeMode() !== "night-red";
              toggleNightRed();
              // 初回 ON 時のみ、混同防止のオンボーディングを出す。
              if (willTurnOn && !hasSeenNightRedOnboarding()) {
                showToast({
                  message:
                    "夜間赤色モードをオン: これは暗順応保護用 (天体観測・夜間飼育) の赤テーマで、一般的なダークモードではありません。",
                  tone: "info",
                  duration: 6000,
                });
                markNightRedOnboardingSeen();
              }
            }}
            aria-pressed={getThemeMode() === "night-red"}
            aria-label={
              getThemeMode() === "night-red"
                ? "夜間赤色モード (暗順応保護用) をオフ"
                : "夜間赤色モード (暗順応保護用) をオン"
            }
            title={
              getThemeMode() === "night-red"
                ? "夜間赤色モード (暗順応保護用) — オン"
                : "夜間赤色モード (暗順応保護用) — オフ (自動)"
            }
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              {/* 赤色モードであることを示す赤いドット (active=塗り / off=線) */}
              <circle
                cx="17"
                cy="7"
                r="2.4"
                fill={
                  getThemeMode() === "night-red" ? "oklch(0.55 0.2 25)" : "none"
                }
                stroke="oklch(0.55 0.2 25)"
                stroke-width="1.4"
              />
            </svg>
          </button>
          {props.topActions}
        </header>
        <main
          class="content fade-enter"
          role="main"
          ref={(el) => (mainRef = el)}
        >
          {props.children}
        </main>
      </div>

      {/* モバイル下部タブ — desktop/tablet では CSS で非表示 */}
      <BottomTabBar
        current={props.current}
        setRoute={props.setRoute}
        cartCount={props.cartCount}
        eclosionCount={props.eclosionCount}
      />
    </div>
  );
};
