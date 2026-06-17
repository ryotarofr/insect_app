// pages/account/StripeConnectReturn.tsx — Stripe Connect onboarding 後の戻り先
//
// **責務**:
//   Stripe ホスト型 onboarding から戻ってきた直後 (= /account/stripe-connect/return) に
//   server で連携状態を再同期し、画面で結果を表示する。
//
// **フロー**:
//   1. mount 時に `fetchStripeConnectStatus()` を 1 回呼ぶ
//      (= server が Stripe.Account.retrieve で実状態を引いて DB に書く)
//   2. status を見て:
//      - active     → "連携完了" 表示 + マイページへ戻るボタン
//      - pending    → "書類審査中 / フォーム未完了" 表示 + 続きから入力リンク
//      - restricted → "追加情報が必要" 表示 + Stripe ダッシュボードリンク
//      - unlinked   → "連携が完了していません" 表示 + 再試行ボタン
//   3. 同時に store/auth の refreshMe() で /me の値も更新 (= 全画面の状態が同期される)。

import { createResource, Match, Show, Switch } from "solid-js";
import { A } from "@solidjs/router";

import type { RouteKey } from "../../data";
import {
  type StripeConnectStatusResponse,
  fetchStripeConnectStatus,
  postStripeConnectOnboarding,
  SduiFetchError,
} from "../../sdui/api";
import { refreshMe } from "../../store/auth";
import { ROUTE_PATHS } from "../../router";

interface Props {
  setRoute: (k: RouteKey) => void;
}

export const StripeConnectReturnPage = (_props: Props) => {
  // mount 時に 1 回 fetch。await 後に refreshMe() も走らせて Shell / wizard 等の状態を同期。
  const [status] = createResource<StripeConnectStatusResponse>(async () => {
    const res = await fetchStripeConnectStatus();
    // refreshMe は失敗を握りつぶす (= status fetch は成功しているので不整合より進める)
    refreshMe().catch(() => {});
    return res;
  });

  const onRetry = async () => {
    try {
      const res = await postStripeConnectOnboarding();
      // 完全 URL なので window.location で外部遷移 (= router.navigate ではない)
      window.location.href = res.onboardingUrl;
    } catch (e) {
      const msg =
        e instanceof SduiFetchError
          ? `HTTP ${e.status} — ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      alert(`再試行に失敗しました: ${msg}`);
    }
  };

  return (
    <div style={{ padding: "24px", "max-width": "640px" }}>
      <div class="cat" style={{ "margin-bottom": "8px" }}>
        マイページ / Stripe Connect 連携
      </div>
      <h1 style={{ "margin-bottom": "24px" }}>Stripe Connect 連携</h1>

      <Show when={status.loading}>
        <p style={{ color: "var(--ink-mute)" }}>連携状態を確認しています…</p>
      </Show>

      <Show when={status.error}>
        <div
          style={{
            padding: "12px 14px",
            background: "var(--accent-rose-soft, #fde8e8)",
            color: "var(--accent-rose, #b91c1c)",
            "border-radius": "var(--r-md)",
            "font-size": "13px",
          }}
          role="alert"
        >
          連携状態の取得に失敗しました。時間をおいて再度お試しください。
        </div>
      </Show>

      {/* Solid の <Show> は `when` の truthy 型をキー付きでキャストするため、
          response 値を AND の右辺に置いて narrowing が `StripeConnectStatusResponse` を
          返すようにする (= 左辺に置くと結果が `boolean` になり s() が `true` 型になる)。 */}
      <Show when={!status.loading && status()}>
        {(s) => (
          <Switch>
            <Match when={s().status === "active"}>
              <StatusCard
                tone="success"
                title="連携が完了しました"
                body="売上の振込先が確認できました。出品が可能になります。"
                primaryHref={ROUTE_PATHS["my-listings"]}
                primaryLabel="マイ出品ページへ"
              />
            </Match>
            <Match when={s().status === "pending"}>
              <StatusCard
                tone="warn"
                title="書類審査中 / 入力が完了していません"
                body="Stripe の onboarding を最後まで完了してください。"
                primaryAction={onRetry}
                primaryLabel="続きから入力する"
              />
            </Match>
            <Match when={s().status === "restricted"}>
              <StatusCard
                tone="warn"
                title="追加情報が必要です"
                body="Stripe から追加書類の提出を求められています。Stripe ダッシュボードで確認してください。"
                primaryAction={onRetry}
                primaryLabel="Stripe で確認する"
              />
            </Match>
            <Match when={s().status === "unlinked"}>
              <StatusCard
                tone="warn"
                title="連携が完了していません"
                body="onboarding が中断されたようです。もう一度お試しください。"
                primaryAction={onRetry}
                primaryLabel="再試行"
              />
            </Match>
          </Switch>
        )}
      </Show>

      <div style={{ "margin-top": "24px" }}>
        <A
          href="/"
          style={{ color: "var(--ink-mute)", "font-size": "13px" }}
        >
          ← マイページに戻る
        </A>
      </div>
    </div>
  );
};

const StatusCard = (props: {
  tone: "success" | "warn";
  title: string;
  body: string;
  primaryHref?: string;
  primaryAction?: () => void | Promise<void>;
  primaryLabel: string;
}) => {
  const isSuccess = props.tone === "success";
  return (
    <div
      style={{
        padding: "20px",
        "border-radius": "var(--r-md)",
        background: isSuccess
          ? "var(--accent-forest-soft, oklch(0.93 0.03 150))"
          : "var(--accent-amber-soft, oklch(0.96 0.04 80))",
        "border-left": isSuccess
          ? "4px solid var(--accent-forest, oklch(0.45 0.08 150))"
          : "4px solid var(--accent-amber, oklch(0.78 0.13 80))",
      }}
    >
      <div
        style={{
          "font-weight": 600,
          "font-size": "16px",
          "margin-bottom": "8px",
          color: isSuccess
            ? "var(--accent-forest, oklch(0.45 0.08 150))"
            : "oklch(0.40 0.13 80)",
        }}
      >
        {props.title}
      </div>
      <p style={{ "font-size": "13px", color: "var(--ink-mute)", "margin-bottom": "12px" }}>
        {props.body}
      </p>
      <Show when={props.primaryHref}>
        {(href) => (
          <A
            href={href()}
            class="btn primary"
            style={{
              "text-decoration": "none",
              padding: "8px 14px",
              "border-radius": "var(--r-md)",
              background: "var(--accent-forest, oklch(0.45 0.08 150))",
              color: "white",
              "font-weight": 600,
              "font-size": "13px",
              display: "inline-block",
            }}
          >
            {props.primaryLabel}
          </A>
        )}
      </Show>
      <Show when={props.primaryAction}>
        {(action) => (
          <button
            type="button"
            class="btn primary"
            onClick={() => void action()()}
            style={{
              padding: "8px 14px",
              "border-radius": "var(--r-md)",
              background: "var(--ink)",
              color: "white",
              "font-weight": 600,
              "font-size": "13px",
              border: "none",
              cursor: "pointer",
            }}
          >
            {props.primaryLabel}
          </button>
        )}
      </Show>
    </div>
  );
};
