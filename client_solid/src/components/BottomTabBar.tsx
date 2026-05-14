// BottomTabBar.tsx — モバイル用下部タブ (4 nav + 中央 FAB + ActionSheet)
//
// **C2C モバイル動線の中核**:
//   サイドバー 8 項目を 4 主要ナビ + 中央 FAB に集約。FAB を押すと「作る」アクションを束ねた
//   ActionSheet (出品する / 個体登録 / 群を作成 / ログを記録 / カートを見る) が立ち上がる。
//
// **5 スロット構成**:
//   ホーム (mypage) | 探す (products) | + (FAB) | 飼育 (cohort) | マイ出品 (my-listings)
//
// **設計判断**:
//   - 旧 5 primary + More dropdown を撤廃。「探す/カート/羽化/血統」を上位ナビに残すと
//     モバイル幅 ~360px でラベルが潰れるため、4 ナビに絞る。
//   - 羽化 / 血統 / カート は MyPage (= ホーム) 経由 + sidebar (desktop) で到達。
//   - カートは ActionSheet 内に「カートを見る」を 1 行入れて常時アクセス可能にする
//     (= 取引フローの中で頻出するため)。
//   - 中央 FAB は ink (= 黒) の丸ボタン + 縁取りでタブ列から浮かせる。z-index は
//     bottom-tab (40) より上の 41。
//   - 「ログを記録」は既存 QuickLogSheet を呼ぶため、親から `onOpenLogSheet` callback で受ける。
//
// **active 判定**:
//   `sidebarRouteKey(props.current)` で詳細ビュー (specimen / order-detail 等) を親に丸めてから
//   一致判定する。order-detail / cohort-detail / specimen 等が drill-in 中もタブの active が
//   ぶれない。
//
// iOS は対象外なので safe-area-inset-bottom は CSS 側で max(6px, env(...)) 程度。

import { For, Show, createSignal, type JSX } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { type RouteKey } from "../data";
import { Icons } from "./Icons";
import { ROUTE_PATHS, sidebarRouteKey } from "../router";

interface NavTab {
  key: RouteKey;
  label: string;
  icon: () => JSX.Element;
  badge?: () => number | undefined;
}

interface ActionItem {
  key: string;
  label: string;
  hint?: string;
  icon: () => JSX.Element;
  /** href があれば router 経由遷移、無ければ onClick が呼ばれる (= QuickLogSheet 起動等) */
  href?: string;
  onClick?: () => void;
}

interface BottomTabBarProps {
  current: RouteKey;
  /** 旧 API 互換 (= 現状未使用)。 keyboard shortcut 等の外部からの遷移は App 側で処理。 */
  setRoute?: (r: RouteKey) => void;
  cartCount?: () => number;
  eclosionCount?: () => number;
  /** 中央 FAB の ActionSheet「ログを記録」が呼ぶ callback。
   *  App.tsx 側の QuickLogSheet を開くのに使う (= 既存挙動を継承)。 */
  onOpenLogSheet?: () => void;
}

const formatBadge = (n: number | undefined): string | null => {
  if (!n || n <= 0) return null;
  if (n > 99) return "99+";
  return String(n);
};

export const BottomTabBar = (props: BottomTabBarProps) => {
  const [actionsOpen, setActionsOpen] = createSignal(false);
  const navigate = useNavigate();

  // 4 主要ナビ。中央 FAB の左右に 2 つずつ配置する (= 順序固定)。
  const navTabs: NavTab[] = [
    { key: "mypage", label: "ホーム", icon: Icons.home },
    { key: "products", label: "探す", icon: Icons.beetle },
    { key: "cohort", label: "飼育", icon: Icons.timeline },
    { key: "my-listings", label: "マイ出品", icon: Icons.tag },
  ];

  // ActionSheet の中身 (= 「+」FAB を押した時に出る create アクション)。
  // 順序: 出品 → 個体登録 → 群作成 → ログ記録 → カート (= EC 完結性のため最後にカートを残す)。
  const actions: ActionItem[] = [
    {
      key: "listing-new",
      label: "出品する",
      hint: "C2C マーケットに個体を出品",
      icon: Icons.tag,
      href: ROUTE_PATHS["listing-new"],
    },
    {
      key: "specimen-new",
      label: "個体を登録",
      hint: "個体カルテを新規作成",
      icon: Icons.card,
      href: ROUTE_PATHS["specimen-new"],
    },
    {
      key: "cohort-new",
      label: "群を作成",
      hint: "卵 / 幼虫のロットを開始",
      icon: Icons.grid,
      href: ROUTE_PATHS["cohort-new"],
    },
    {
      key: "log-record",
      label: "ログを記録",
      hint: "餌・マット・体重・脱皮を記録",
      icon: Icons.plus,
      onClick: () => {
        if (props.onOpenLogSheet) {
          props.onOpenLogSheet();
        }
      },
    },
    {
      key: "cart-open",
      label: "カートを見る",
      hint: "未決済の購入を確認",
      icon: Icons.cart,
      href: ROUTE_PATHS.cart,
    },
  ];

  const isActive = (key: RouteKey) => sidebarRouteKey(props.current) === key;
  const closeActions = () => setActionsOpen(false);

  /** ActionSheet 行クリック時のハンドリング:
   *  href があれば navigate、onClick があれば呼び出し、いずれにせよシートを閉じる。 */
  const onActionClick = (a: ActionItem) => (e: MouseEvent) => {
    e.preventDefault();
    closeActions();
    if (a.href) {
      navigate(a.href);
    } else if (a.onClick) {
      a.onClick();
    }
  };

  // 左 2 タブ / 右 2 タブに分けてレンダ (中央 FAB を中央に配置するため)
  const leftTabs = () => navTabs.slice(0, 2);
  const rightTabs = () => navTabs.slice(2);

  return (
    <>
      <nav
        class="bottom-tab"
        role="navigation"
        aria-label="モバイルナビゲーション"
      >
        <For each={leftTabs()}>{(t) => <NavLink t={t} active={isActive(t.key)} />}</For>

        {/* 中央 FAB (= 「作る」アクションの起点) */}
        <button
          type="button"
          class={"bt-fab" + (actionsOpen() ? " is-open" : "")}
          aria-haspopup="menu"
          aria-expanded={actionsOpen()}
          aria-label="新規作成メニュー"
          onClick={() => setActionsOpen((o) => !o)}
        >
          <span class="bt-fab-ico" aria-hidden="true">
            {Icons.plus()}
          </span>
        </button>

        <For each={rightTabs()}>
          {(t) => (
            <NavLink
              t={t}
              active={isActive(t.key)}
              badge={
                t.key === "cart"
                  ? formatBadge(props.cartCount?.())
                  : t.key === "eclosion"
                    ? formatBadge(props.eclosionCount?.())
                    : null
              }
            />
          )}
        </For>
      </nav>

      {/* ActionSheet (= 中央 FAB を押した時のシート) */}
      <Show when={actionsOpen()}>
        <div
          class="bt-actions-backdrop"
          onClick={closeActions}
          role="presentation"
        />
        <div
          class="bt-actions-sheet"
          role="menu"
          aria-label="新規作成メニュー"
        >
          <div class="bt-actions-head">
            <span class="section-label">作成 / 開く</span>
            <button
              type="button"
              class="bt-actions-close"
              aria-label="閉じる"
              onClick={closeActions}
            >
              ×
            </button>
          </div>
          <ul class="bt-actions-list">
            <For each={actions}>
              {(a) => (
                <li>
                  {/* href がある場合は <a> + onClick の preventDefault で SPA navigate。
                      無い場合 (= ログを記録) は button 相当として onClick だけ起動。 */}
                  <a
                    href={a.href ?? "#"}
                    role="menuitem"
                    class="bt-actions-item"
                    onClick={onActionClick(a)}
                  >
                    <span class="bt-actions-ico" aria-hidden="true">
                      {a.icon()}
                    </span>
                    <span class="bt-actions-body">
                      <span class="bt-actions-label">{a.label}</span>
                      <Show when={a.hint}>
                        <span class="bt-actions-hint">{a.hint}</span>
                      </Show>
                    </span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </>
  );
};

// ──────────────────────────────────────────────────────────────────────
// 1 タブ (= 左右の主要ナビ用)
// ──────────────────────────────────────────────────────────────────────

const NavLink = (props: {
  t: NavTab;
  active: boolean;
  badge?: string | null;
}) => (
  <A
    href={ROUTE_PATHS[props.t.key]}
    class={"bt-tab" + (props.active ? " active" : "")}
    aria-current={props.active ? "page" : undefined}
    aria-label={props.t.label}
  >
    <span class="bt-icon" aria-hidden="true">
      {props.t.icon()}
    </span>
    <span class="bt-label">{props.t.label}</span>
    <Show when={props.badge}>
      <span class="bt-badge" aria-hidden="true">
        {props.badge}
      </span>
    </Show>
  </A>
);
