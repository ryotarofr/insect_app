// pages/OrderDetail.tsx — 1 注文の詳細表示 (`GET /api/v1/orders/{id}`)
//
// **責務**:
//   - mount 時に `fetchOrderDetail(id)` を呼んで order + lineItems を取得
//   - 所有者でない / 不存在 / 不正な UUID は server 側で 404 → ここでは inline error
//   - line_items を 1 行ずつ表示し、合計 / 配送料 / Stripe 関連 ID も並べる
//
// **未実装 (= 後続)**:
//   - 配送先 (shipping_addresses) の取得 + 表示 (= server 側 GET endpoint なし)
//   - 「再注文する」「キャンセル申請」等のアクション
//   - 注文ステータスの timeline / status_history 表示

import { createResource, For, Match, Show, Switch } from "solid-js";

import type { RouteKey } from "../data";
import {
  type OrderDetail,
  SduiFetchError,
  fetchOrderDetail,
} from "../sdui/api";
import { ROUTE_PATHS } from "../router";

interface Props {
  orderId: string;
  setRoute: (k: RouteKey) => void;
}

export const OrderDetailPage = (props: Props) => {
  // orderId は URL 由来で props 経由で来る。createResource の source に渡して、
  // id が変わったら自動 refetch される (= /orders/A → /orders/B 遷移時)。
  const [detail] = createResource<OrderDetail, string>(
    () => props.orderId,
    async (id) => fetchOrderDetail(id),
  );

  return (
    <div class="order-detail" style={{ padding: "24px", "max-width": "720px" }}>
      <div class="cat" style={{ "margin-bottom": "8px" }}>
        マイページ / 注文履歴 / 注文詳細
      </div>
      <h1 style={{ "margin-bottom": "16px" }}>注文詳細</h1>

      <Show
        when={detail.error}
        fallback={
          <Show when={!detail.loading} fallback={<p>読み込み中...</p>}>
            <Show when={detail()}>
              {(d) => <Body detail={d()} />}
            </Show>
          </Show>
        }
      >
        {(err) => <ErrorBlock err={err()} setRoute={props.setRoute} />}
      </Show>
    </div>
  );
};

const Body = (props: { detail: OrderDetail }) => {
  const d = props.detail;
  return (
    <div>
      {/* メタ情報 */}
      <section style={{ "margin-bottom": "24px" }}>
        <div style={{ "font-size": "12px", color: "var(--ink-faint, #888)" }}>
          注文 ID: <code>{d.id}</code>
        </div>
        <div style={{ "margin-top": "4px", "font-size": "12px" }}>
          注文日時: {formatDate(d.createdAt)}
        </div>
        <div style={{ "margin-top": "4px" }}>
          ステータス: <StatusBadge status={d.status} />
        </div>
        <Show when={d.stripeSessionId}>
          {(sid) => (
            <div
              style={{
                "font-size": "10px",
                color: "var(--ink-faint, #888)",
                "font-family": "var(--font-mono, monospace)",
                "margin-top": "4px",
              }}
            >
              Stripe Session: {sid()}
            </div>
          )}
        </Show>
      </section>

      {/* 行明細 */}
      <section style={{ "margin-bottom": "24px" }}>
        <h2 style={{ "font-size": "14px", "margin-bottom": "8px" }}>注文内容</h2>
        <ul style={{ "list-style": "none", padding: "0", margin: "0" }}>
          <For each={d.lineItems}>
            {(li) => (
              <li
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  padding: "8px 0",
                  "border-bottom": "1px solid var(--ink-faint, #eee)",
                }}
              >
                <div>
                  <div>{li.title}</div>
                  <div
                    style={{
                      "font-size": "11px",
                      color: "var(--ink-faint, #888)",
                    }}
                  >
                    {/* listing 削除済の注文では listingId が null になるので shorten で fallback。 */}
                    #{li.listingId?.slice(0, 8) ?? "(削除済)"} × {li.qty}
                  </div>
                </div>
                <div style={{ "font-family": "var(--font-mono, monospace)" }}>
                  ¥{li.subtotalJpy.toLocaleString("ja-JP")}
                </div>
              </li>
            )}
          </For>
        </ul>
      </section>

      {/* 合計 */}
      <section
        style={{
          padding: "12px 0",
          "border-top": "2px solid var(--ink, #333)",
          display: "flex",
          "justify-content": "space-between",
          "font-weight": "bold",
        }}
      >
        <Show when={d.shippingJpy != null}>
          <div style={{ "font-weight": "normal", "font-size": "12px" }}>
            (配送料 ¥{(d.shippingJpy ?? 0).toLocaleString("ja-JP")} 込み)
          </div>
        </Show>
        <div style={{ "margin-left": "auto" }}>
          合計 ¥{d.amountJpy.toLocaleString("ja-JP")}
        </div>
      </section>
    </div>
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
// + 早期 return パターンは props 更新を取りこぼす。`<Switch>/<Match>` で reactive
// 分岐に置換し、各 `when` を function で渡すことで 401 → 404 → 0 の遷移が DOM に
// 反映されるようにする。MyOrders.tsx の ErrorBlock と対称な修正。
const ErrorBlock = (props: { err: unknown; setRoute: (k: RouteKey) => void }) => {
  const isUnauthorized = () =>
    props.err instanceof SduiFetchError && props.err.status === 401;
  const isNotFound = () =>
    props.err instanceof SduiFetchError && props.err.status === 404;
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
          注文詳細の取得に失敗しました: {fallbackMessage()}
        </p>
      }
    >
      <Match when={isUnauthorized()}>
        <div>
          <p>注文の閲覧にはログインが必要です。</p>
          <a
            href={ROUTE_PATHS.login}
            onClick={(e) => {
              e.preventDefault();
              props.setRoute("login");
            }}
          >
            ログインへ
          </a>
        </div>
      </Match>
      <Match when={isNotFound()}>
        <div>
          <p>注文が見つかりません (URL の id が不正か、他人の注文の可能性があります)。</p>
          <a
            href={ROUTE_PATHS.orders}
            onClick={(e) => {
              e.preventDefault();
              props.setRoute("orders");
            }}
          >
            注文履歴に戻る
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
