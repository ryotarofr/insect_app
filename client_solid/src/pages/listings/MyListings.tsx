// pages/listings/MyListings.tsx — 自分の出品管理ページ (Phase 3 / GET /api/v1/listings/me)
//
// **責務**:
//   - mount 時 + auth 連動で `refreshMyListings()` を呼んで signal に詰める
//     (= App.tsx の `createEffect(currentUser)` で既に走っているので、ここでは重複させない)
//   - タブ式で `出品中 / 入札中 / 売却済 / 取消・期限切れ` を切替表示
//   - 各行で出品取消 (`POST /listings/{id}/cancel`) を実行可能 (active のみ)
//   - anonymous (= currentUser() == null) は inline message + ログインリンク
//
// **設計判断**:
//   - 4 status を 1 fetch で取得し、タブ切替は派生 selector (`myListingsByStatus`) で行う。
//     サーバ往復が 1 回で済み、cancel 後の active → canceled 遷移も 1 cache で完結する。
//   - 出品取消は楽観的更新せず、成功後に `triggerMyListingsRefresh()` で server の真値で再描画。
//     これは store/specimens.ts の規律に合わせる (= server-driven state)。
//   - 行クリックで `/products/{public_id}` (= 既存 ProductDetail = listing detail) に遷移。
//     listings 専用詳細ルートは未追加のため。
//   - i18n は当面 inline 日本語で。Phase 8 で SDUI / sdui/i18n 経由に切替予定。

import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { A } from "@solidjs/router";

import type { RouteKey } from "../../data";
import type { ListingViewWithCounts } from "../../sdui/api";
import { postListingCancel, SduiFetchError } from "../../sdui/api";
import { ROUTE_PATHS } from "../../router";
import { currentUser } from "../../store/auth";
import {
  myListingsByStatus,
  serverMyListingsError,
  triggerMyListingsRefresh,
} from "../../store/myListings";
import { showToast } from "../../store/toast";

interface Props {
  setRoute: (k: RouteKey) => void;
}

type TabKey = "active" | "bidding" | "sold" | "canceledOrExpired";

const TAB_LABEL: Record<TabKey, string> = {
  active: "出品中",
  bidding: "入札中",
  sold: "売却済",
  canceledOrExpired: "取消・期限切れ",
};

const TAB_ORDER: TabKey[] = ["active", "bidding", "sold", "canceledOrExpired"];

export const MyListingsPage = (props: Props) => {
  const [tab, setTab] = createSignal<TabKey>("active");

  const grp = myListingsByStatus;
  const rows = createMemo(() => grp()[tab()]);

  return (
    <div style={{ padding: "24px", "max-width": "920px" }}>
      <div class="cat" style={{ "margin-bottom": "8px" }}>
        マイページ / マイ出品
      </div>

      <header
        style={{
          display: "flex",
          "align-items": "baseline",
          "justify-content": "space-between",
          "margin-bottom": "16px",
          "flex-wrap": "wrap",
          gap: "12px",
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 4px" }}>マイ出品</h1>
          <p style={{ margin: 0, color: "var(--ink-mute, #666)", "font-size": "13px" }}>
            自分が出品中・売却済・取消した listings を一覧で管理
          </p>
        </div>
        <A
          href={ROUTE_PATHS["listing-new"]}
          class="btn primary"
          style={{
            "text-decoration": "none",
            padding: "8px 14px",
            "border-radius": "8px",
            background: "var(--accent-forest, oklch(0.45 0.08 150))",
            color: "var(--bg, #fff)",
            "font-weight": 600,
            "font-size": "13px",
          }}
        >
          ＋ 出品する
        </A>
      </header>

      <Show
        when={currentUser()}
        fallback={
          <UnauthenticatedView setRoute={props.setRoute} />
        }
      >
        {/* error がある (= 5xx / network) ときはエラー先出し、無ければ通常表示 */}
        <Show
          when={serverMyListingsError()}
          fallback={
            <>
              <Tabs current={tab()} setTab={setTab} />
              <Show
                when={rows().length > 0}
                fallback={<EmptyState tab={tab()} totalCount={grp().all.length} />}
              >
                <ul class="my-listings-list" style={{ "list-style": "none", padding: 0, margin: 0 }}>
                  <For each={rows()}>
                    {(l) => <ListingRow listing={l} />}
                  </For>
                </ul>
              </Show>
            </>
          }
        >
          {(msg) => (
            <p style={{ color: "var(--alert, #cf222e)" }}>
              出品の取得に失敗しました: {msg()}
            </p>
          )}
        </Show>
      </Show>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────
// タブ
// ──────────────────────────────────────────────────────────────────────

const Tabs = (props: { current: TabKey; setTab: (t: TabKey) => void }) => {
  const grp = myListingsByStatus;
  return (
    <div
      role="tablist"
      aria-label="マイ出品のステータスタブ"
      style={{
        display: "flex",
        gap: "4px",
        "border-bottom": "1px solid var(--line, #ddd)",
        "margin-bottom": "12px",
        "overflow-x": "auto",
      }}
    >
      <For each={TAB_ORDER}>
        {(t) => {
          const count = () => grp()[t].length;
          const isActive = () => props.current === t;
          return (
            <button
              role="tab"
              type="button"
              aria-selected={isActive()}
              onClick={() => props.setTab(t)}
              style={{
                border: "none",
                background: "transparent",
                padding: "10px 14px",
                "font-size": "13px",
                "font-weight": isActive() ? 600 : 500,
                "border-bottom": isActive()
                  ? "2px solid var(--accent-forest, oklch(0.45 0.08 150))"
                  : "2px solid transparent",
                color: isActive()
                  ? "var(--accent-forest, oklch(0.45 0.08 150))"
                  : "var(--ink-mute, #666)",
                cursor: "pointer",
                "white-space": "nowrap",
                display: "inline-flex",
                "align-items": "center",
                gap: "6px",
                "font-family": "inherit",
                "margin-bottom": "-1px",
              }}
            >
              {TAB_LABEL[t]}
              <span
                class="mono"
                style={{
                  "font-size": "10px",
                  padding: "0 6px",
                  "border-radius": "99px",
                  border: "1px solid var(--line, #ddd)",
                  color: isActive() ? "var(--accent-forest)" : "var(--ink-faint, #888)",
                  background: isActive()
                    ? "var(--accent-forest-soft, oklch(0.93 0.03 150))"
                    : "transparent",
                }}
              >
                {count()}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────
// 1 行 (出品)
// ──────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active: "出品中",
  sold: "売却済",
  canceled: "取消",
  expired: "期限切れ",
};

const formatPrice = (l: ListingViewWithCounts): string => {
  if (l.isAuction && l.currentPriceJpy != null) {
    return `¥${l.currentPriceJpy.toLocaleString("ja-JP")}`;
  }
  const base = `¥${l.startingPriceJpy.toLocaleString("ja-JP")}`;
  return l.isAuction ? `${base}〜` : base;
};

const ListingRow = (props: { listing: ListingViewWithCounts }) => {
  const l = props.listing;
  const [pendingCancel, setPendingCancel] = createSignal(false);

  const onCancel = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pendingCancel()) return;
    if (!confirm(`「${l.title}」を取消しますか？`)) return;
    setPendingCancel(true);
    try {
      await postListingCancel(l.id);
      showToast({ message: "出品を取消しました", tone: "success", duration: 3000 });
      // server の真値で再描画 (= active から canceled にスナップショットが切り替わる)
      triggerMyListingsRefresh();
    } catch (err) {
      const msg =
        err instanceof SduiFetchError
          ? `取消失敗 (HTTP ${err.status})`
          : "取消に失敗しました";
      showToast({ message: msg, tone: "error", duration: 4000 });
    } finally {
      setPendingCancel(false);
    }
  };

  return (
    <li
      style={{
        display: "grid",
        "grid-template-columns": "64px 1fr auto auto auto auto",
        gap: "12px",
        "align-items": "center",
        padding: "12px 14px",
        "border-bottom": "1px solid var(--line, #ddd)",
      }}
    >
      <A
        href={`/products/${encodeURIComponent(l.publicId)}`}
        aria-label={`${l.title} の詳細を見る`}
        style={{
          width: "64px",
          height: "64px",
          "border-radius": "8px",
          background:
            "linear-gradient(135deg, oklch(0.92 0.04 80), oklch(0.86 0.05 70))",
          display: "grid",
          "place-items": "center",
          "font-size": "26px",
          "text-decoration": "none",
        }}
      >
        🪲
      </A>

      <A
        href={`/products/${encodeURIComponent(l.publicId)}`}
        style={{ "text-decoration": "none", color: "inherit", "min-width": 0 }}
      >
        <div
          style={{
            "font-weight": 600,
            "font-size": "13.5px",
            "white-space": "nowrap",
            overflow: "hidden",
            "text-overflow": "ellipsis",
          }}
        >
          {l.title}
        </div>
        <div
          class="mono"
          style={{
            "font-size": "11px",
            color: "var(--ink-faint, #888)",
            "margin-top": "3px",
          }}
        >
          {l.publicId}
          <Show when={l.isVerified}>
            <span
              style={{
                "margin-left": "8px",
                color: "var(--accent-forest)",
                "font-weight": 600,
              }}
            >
              血統認証
            </span>
          </Show>
          <Show when={l.isAuction}>
            <span style={{ "margin-left": "8px" }}>オークション</span>
          </Show>
        </div>
      </A>

      <div class="serif" style={{ "font-size": "15px", "font-weight": 600 }}>
        {formatPrice(l)}
      </div>

      <div
        style={{
          "font-size": "11.5px",
          color: "var(--ink-mute, #666)",
          "text-align": "right",
          "min-width": "80px",
        }}
      >
        <div>
          <b>{l.bidCount}</b> 入札
        </div>
        <div>
          <b>{l.watcherCount}</b> watcher
        </div>
      </div>

      <span
        class={`chip ${l.status === "active" ? "forest" : "ink"}`}
        style={{ "font-size": "11px" }}
      >
        {STATUS_LABEL[l.status] ?? l.status}
      </span>

      {/* active な出品にだけ取消ボタンを出す。 cancel 中は disabled。 */}
      <Show
        when={l.status === "active"}
        fallback={<span style={{ width: "84px" }} />}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={pendingCancel()}
          style={{
            padding: "6px 10px",
            "border-radius": "6px",
            border: "1px solid var(--line, #ddd)",
            background: "transparent",
            color: pendingCancel() ? "var(--ink-faint)" : "var(--ink, #333)",
            "font-size": "12px",
            cursor: pendingCancel() ? "wait" : "pointer",
            "font-family": "inherit",
            "white-space": "nowrap",
          }}
          aria-label={`${l.title} を取消`}
        >
          {pendingCancel() ? "取消中..." : "取消"}
        </button>
      </Show>
    </li>
  );
};

// ──────────────────────────────────────────────────────────────────────
// 空状態 / 未認証
// ──────────────────────────────────────────────────────────────────────

const EmptyState = (props: { tab: TabKey; totalCount: number }) => {
  // 全 tab で 0 件ならまだ出品をしていない user。
  // 該当 tab だけ 0 件なら他 tab に切替を促す。
  return (
    <div
      style={{
        padding: "32px 16px",
        "text-align": "center",
        color: "var(--ink-mute, #666)",
        "font-size": "13px",
        "border-bottom": "1px solid var(--line, #ddd)",
      }}
    >
      <Switch>
        <Match when={props.totalCount === 0}>
          <p style={{ margin: "0 0 12px" }}>まだ出品がありません。</p>
          <A
            href={ROUTE_PATHS["listing-new"]}
            style={{
              color: "var(--accent-forest, oklch(0.45 0.08 150))",
              "text-decoration": "none",
              "font-weight": 600,
            }}
          >
            ＋ 個体を出品する →
          </A>
        </Match>
        <Match when={props.totalCount > 0}>
          <p style={{ margin: 0 }}>
            「{TAB_LABEL[props.tab]}」の出品はありません。
          </p>
        </Match>
      </Switch>
    </div>
  );
};

const UnauthenticatedView = (props: { setRoute: (k: RouteKey) => void }) => (
  <div style={{ padding: "24px 0" }}>
    <p>マイ出品の閲覧にはログインが必要です。</p>
    <a
      href={ROUTE_PATHS.login}
      onClick={(e) => {
        e.preventDefault();
        props.setRoute("login");
      }}
      style={{ color: "var(--accent-forest, oklch(0.45 0.08 150))" }}
    >
      ログインへ →
    </a>
  </div>
);
