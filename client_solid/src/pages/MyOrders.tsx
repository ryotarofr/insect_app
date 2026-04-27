// pages/MyOrders.tsx — 自分の注文履歴一覧 (Phase 9.G / `GET /api/v1/orders/me`)
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

import { createResource, For, Show } from "solid-js";

import type { RouteKey } from "../data";
import {
  type OrderSummary,
  SduiFetchError,
  fetchMyOrders,
} from "../sdui/api";
import { ROUTE_PATHS, orderUrl } from "../router";

interface Props {
  setRoute: (k: RouteKey) => void;
}

export const MyOrdersPage = (props: Props) => {
  // createResource で fetch を suspense っぽく扱う。再 mount で再 fetch される。
  const [orders] = createResource<OrderSummary[]>(async () => {
    return fetchMyOrders();
  });

  return (
    <div class="my-orders" style={{ padding: "24px", "max-width": "720px" }}>
      <div class="cat" style={{ "margin-bottom": "8px" }}>
        マイページ / 注文履歴
      </div>
      <h1 style={{ "margin-bottom": "16px" }}>注文履歴</h1>

      <Show
        when={orders.error}
        fallback={
          <Show
            when={!orders.loading}
            fallback={<p>読み込み中...</p>}
          >
            <Show
              when={(orders() ?? []).length > 0}
              fallback={
                <p style={{ color: "var(--ink-faint, #888)" }}>
                  注文履歴はまだありません。
                </p>
              }
            >
              <ul class="order-list" style={{ "list-style": "none", padding: "0" }}>
                <For each={orders() ?? []}>
                  {(o) => <OrderRow order={o} />}
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

const OrderRow = (props: { order: OrderSummary }) => {
  const o = props.order;
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
          <div style={{ "margin-top": "4px" }}>
            <StatusBadge status={o.status} />
            <span style={{ "margin-left": "8px" }}>
              ¥{o.amountJpy.toLocaleString("ja-JP")}
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

const ErrorBlock = (props: { err: unknown; setRoute: (k: RouteKey) => void }) => {
  const err = props.err;
  if (err instanceof SduiFetchError && err.status === 401) {
    return (
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
    );
  }
  if (err instanceof SduiFetchError && err.status === 0) {
    return (
      <p style={{ color: "var(--alert, #cf222e)" }}>
        ネットワーク接続を確認してください。
      </p>
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return (
    <p style={{ color: "var(--alert, #cf222e)" }}>
      注文履歴の取得に失敗しました: {msg}
    </p>
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
