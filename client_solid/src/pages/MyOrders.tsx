// pages/MyOrders.tsx — 自分の注文履歴一覧 (`GET /api/v1/orders/me`)
//
// **責務**:
//   - mount 時に `fetchMyOrders()` を 1 回呼んで signal に詰める
//   - anonymous (= 401) は "ログインが必要" inline message + login リンク
//   - 5xx / network 障害は inline error message
//   - 各注文を card 風 list で表示 (= status / amount / 日時 / Stripe 関連 ID)
//
// **未実装 (= 後続)**:
//   - 注文 1 件をクリック → 詳細ページ (= /orders/{id} = OrderDetail UI)
//   - status filter / 期間フィルタ
//   - ページネーション (現状は 1 リクエストで全件返す前提)

import { createResource, createSignal, For, Match, Show, Switch } from "solid-js";

import type { RouteKey } from "../data";
import {
  type OrderRole,
  type OrderSummary,
  SduiFetchError,
  fetchMyOrders,
} from "../sdui/api";
import { ROUTE_PATHS, orderUrl } from "../router";
import { currentUserId } from "../store/auth";

interface Props {
  setRoute: (k: RouteKey) => void;
}

const TAB_LABEL: Record<OrderRole, string> = {
  buyer: "購入",
  seller: "売却",
  all: "すべて",
};
const TAB_ORDER: OrderRole[] = ["buyer", "seller", "all"];

export const MyOrdersPage = (props: Props) => {
  const [role, setRole] = createSignal<OrderRole>("buyer");

  // role 切替で createResource を再 fetch させるため、source に role() を渡す。
  // role が変わると Solid が自動で fetcher を再実行する。
  const [orders] = createResource<OrderSummary[], OrderRole>(role, async (r) => {
    return fetchMyOrders(r);
  });

  // 自分の userId (= role=all のときに「これは購入か売却か」を 1 行ずつ判別するのに使う)
  const myUserId = () => currentUserId();

  return (
    <div class="my-orders" style={{ padding: "24px", "max-width": "720px" }}>
      <div class="cat" style={{ "margin-bottom": "8px" }}>
        マイページ / 取引履歴
      </div>
      <h1 style={{ "margin-bottom": "16px" }}>取引履歴</h1>

      {/* role タブ (購入 / 売却 / すべて) */}
      <RoleTabs current={role()} onChange={setRole} />

      <Show
        when={orders.error}
        fallback={
          <Show
            when={!orders.loading}
            fallback={<p>読み込み中...</p>}
          >
            <Show
              when={(orders() ?? []).length > 0}
              fallback={<EmptyState role={role()} />}
            >
              <ul class="order-list" style={{ "list-style": "none", padding: "0" }}>
                <For each={orders() ?? []}>
                  {(o) => <OrderRow order={o} myUserId={myUserId()} />}
                </For>
              </ul>
              {/* note: OrderRow は内部で `<a href={orderUrl(o.id)}>` リンクなので、
                  ブラウザ側 navigation で SPA route が変わる。setRoute の手当ては不要。 */}
            </Show>
          </Show>
        }
      >
        {(err) => <ErrorBlock err={err()} setRoute={props.setRoute} />}
      </Show>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────
// role タブ
// ──────────────────────────────────────────────────────────────────────

const RoleTabs = (props: {
  current: OrderRole;
  onChange: (r: OrderRole) => void;
}) => (
  <div
    role="tablist"
    aria-label="取引履歴のロールタブ"
    style={{
      display: "flex",
      gap: "4px",
      "border-bottom": "1px solid var(--line, #ddd)",
      "margin-bottom": "12px",
    }}
  >
    <For each={TAB_ORDER}>
      {(r) => {
        const isActive = () => props.current === r;
        return (
          <button
            role="tab"
            type="button"
            aria-selected={isActive()}
            onClick={() => props.onChange(r)}
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
              "font-family": "inherit",
              "margin-bottom": "-1px",
            }}
          >
            {TAB_LABEL[r]}
          </button>
        );
      }}
    </For>
  </div>
);

const EmptyState = (props: { role: OrderRole }) => {
  const message = () => {
    switch (props.role) {
      case "buyer":
        return "購入履歴はまだありません。";
      case "seller":
        return "売却履歴はまだありません。出品が落札・購入されると表示されます。";
      case "all":
        return "取引履歴はまだありません。";
    }
  };
  return (
    <p style={{ color: "var(--ink-faint, #888)" }}>
      {message()}
    </p>
  );
};

const OrderRow = (props: { order: OrderSummary; myUserId: string | null }) => {
  const o = props.order;

  // role=all のとき各行が「購入」か「売却」かを判定する。
  // - 自分が seller なら「売却」(緑、+¥) / 自分が buyer なら「購入」(青、−¥)
  // - sellerUserId / buyerUserId が不在の response に備えて optional chain で読む。
  const isSell = () =>
    props.myUserId != null && o.sellerUserId === props.myUserId;
  const isBuy = () =>
    props.myUserId != null && o.buyerUserId === props.myUserId;

  return (
    <li class="order-row">
      {/* 行全体を `<a>` にして SPA navigation を有効化 (= middle-click も効く)。
          a 要素は @solidjs/router の navigate を踏むので setRoute は不要。 */}
      <a
        href={orderUrl(o.id)}
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          gap: "16px",
          padding: "12px 16px",
          "border-bottom": "1px solid var(--ink-faint, #ddd)",
          "text-decoration": "none",
          color: "inherit",
        }}
      >
        <div style={{ flex: "1" }}>
          <div style={{ "font-size": "12px", color: "var(--ink-faint, #888)" }}>
            {formatDate(o.createdAt)} · #{shorten(o.id)}
          </div>
          <div style={{ "margin-top": "4px", display: "flex", "align-items": "center", gap: "8px" }}>
            <StatusBadge status={o.status} />
            {/* 売却/購入の方向タグ (= role=all で見やすくする) */}
            <Show when={isSell()}>
              <span
                style={{
                  padding: "2px 8px",
                  "border-radius": "4px",
                  background: "var(--accent-forest-soft, oklch(0.93 0.03 150))",
                  color: "var(--accent-forest, oklch(0.45 0.08 150))",
                  "font-size": "11px",
                  "font-weight": 600,
                }}
              >
                売却
              </span>
            </Show>
            <Show when={isBuy() && !isSell()}>
              <span
                style={{
                  padding: "2px 8px",
                  "border-radius": "4px",
                  background: "var(--accent-blue-soft, oklch(0.95 0.03 240))",
                  color: "var(--accent-blue, oklch(0.55 0.10 240))",
                  "font-size": "11px",
                  "font-weight": 600,
                }}
              >
                購入
              </span>
            </Show>
            <span style={{ "font-weight": isSell() ? 600 : 400 }}>
              {isSell() ? "+" : isBuy() ? "−" : ""}¥{o.amountJpy.toLocaleString("ja-JP")}
            </span>
          </div>
          <Show when={o.stripeSessionId}>
            {(sid) => (
              <div
                style={{
                  "font-size": "10px",
                  color: "var(--ink-faint, #888)",
                  "font-family": "var(--font-mono, monospace)",
                  "margin-top": "2px",
                }}
              >
                {sid()}
              </div>
            )}
          </Show>
        </div>
        <div aria-hidden="true" style={{ color: "var(--ink-faint, #888)" }}>
          ▶
        </div>
      </a>
    </li>
  );
};

const StatusBadge = (props: { status: string }) => {
  const palette: Record<string, string> = {
    pending: "#888",
    paid: "#1a7f37",
    failed: "#cf222e",
    canceled: "#999",
  };
  const label: Record<string, string> = {
    pending: "未払い",
    paid: "決済完了",
    failed: "失敗",
    canceled: "キャンセル",
  };
  return (
    <span
      style={{
        padding: "2px 8px",
        "border-radius": "4px",
        background: palette[props.status] ?? "#888",
        color: "white",
        "font-size": "11px",
      }}
    >
      {label[props.status] ?? props.status}
    </span>
  );
};

// review fix (minor / SolidJS): CODE_REVIEW_PROMPT §2.9 — `const err = props.err`
// + `if (...) return <X>` の早期 return で props を 1 度だけ評価すると、`<Show>` の
// fallback 側で props.err が 401 → 500 / 500 → 0 と変わった時に古い branch のまま
// 残る。`<Switch>/<Match>` で reactive 分岐に倒し、各 Match の `when` を function
// (= reactive getter) で渡すと props.err 更新が DOM に反映される。
const ErrorBlock = (props: { err: unknown; setRoute: (k: RouteKey) => void }) => {
  const isUnauthorized = () =>
    props.err instanceof SduiFetchError && props.err.status === 401;
  const isOffline = () =>
    props.err instanceof SduiFetchError && props.err.status === 0;
  const fallbackMessage = () => {
    const e = props.err;
    return e instanceof Error ? e.message : String(e);
  };
  return (
    <Switch
      fallback={
        <p style={{ color: "var(--alert, #cf222e)" }}>
          注文履歴の取得に失敗しました: {fallbackMessage()}
        </p>
      }
    >
      <Match when={isUnauthorized()}>
        <div style={{ padding: "16px 0" }}>
          <p>注文履歴の閲覧にはログインが必要です。</p>
          <a
            href={ROUTE_PATHS.login}
            onClick={(e) => {
              // SPA navigation: <a> が router の navigate を叩くようにする
              e.preventDefault();
              props.setRoute("login");
            }}
            style={{ color: "var(--accent, #1a7f37)" }}
          >
            ログインへ
          </a>
        </div>
      </Match>
      <Match when={isOffline()}>
        <p style={{ color: "var(--alert, #cf222e)" }}>
          ネットワーク接続を確認してください。
        </p>
      </Match>
    </Switch>
  );
};

function shorten(uuid: string): string {
  return uuid.slice(0, 8);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
