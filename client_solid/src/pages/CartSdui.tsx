// CartSdui.tsx — Phase 7 の SDUI 駆動カート画面
//
// 詳細: docs/sdui-three-layer-model-v5.md §11 (移行戦略 / Strangler Fig)
//
// **責務**:
//   1. `GET /api/v1/cards/cart` を叩いて CartCard を取得
//   2. CartReloadProvider に refetch を流す
//   3. CardRenderer に渡して描画
//   4. 失敗時はエラー表示、ロード中はスピナ
//
// **既存 `/cart` (Cart.tsx) との関係 (Strangler Fig 段階 1)**:
//   - 旧 Cart.tsx は shipping form / checkout / Stripe 決済を内包しており、
//     SDUI 側は「カート明細 + 集計 + CTA」だけが対象。Phase 7 では新 route `/cart-sdui`
//     を立て、本ページで SDUI 表示の検証 + 既存 store/cart と並行運用する。
//   - shipping / checkout は Phase 7+ で SDUI 化を検討 (= 段階移行)。
//
// **再 fetch 戦略**:
//   LineItem の +/- や 削除を押す → サーバ側 store が変わる → 再 fetch して
//   サーバの真値を再描画。createResource の `refetch()` を CartReloadProvider に流す。
//   （楽観 update はせず、サーバ-driven 状態を信用する MVP 方針）。

import { ErrorBoundary, Show, createResource } from "solid-js";

import { CardRenderer } from "../sdui/CardRenderer";
import { CartReloadProvider } from "../sdui/CartContext";
import { SduiFetchError, fetchCartCard } from "../sdui/api";

const ErrorView = (props: { err: unknown }) => {
  const message = () => {
    const err = props.err;
    if (err instanceof SduiFetchError) {
      if (err.status === 0) return "ネットワーク接続を確認してください";
      return `カート情報を取得できませんでした (HTTP ${err.status})`;
    }
    return "予期しないエラーが発生しました";
  };
  return (
    <div
      role="alert"
      data-cart-error="true"
      style={{
        padding: "20px",
        "max-width": "640px",
        margin: "20px auto",
        border: "1px dashed var(--accent-rose)",
        color: "var(--accent-rose)",
        "border-radius": "8px",
      }}
    >
      {message()}
    </div>
  );
};

export const CartSduiPage = () => {
  // resource の reload は `refetch` で叩く。Cart 内 LineItem からは
  // CartReloadProvider 経由で取り出す。
  const [card, { refetch }] = createResource(fetchCartCard);

  return (
    <ErrorBoundary fallback={(err) => <ErrorView err={err} />}>
      <Show
        when={card.loading}
        fallback={
          <Show when={card.error} fallback={
            <Show when={card()}>
              {(c) => (
                <CartReloadProvider value={() => refetch()}>
                  <CardRenderer card={c()} />
                </CartReloadProvider>
              )}
            </Show>
          }>
            <ErrorView err={card.error} />
          </Show>
        }
      >
        <div
          aria-live="polite"
          aria-busy="true"
          style={{
            padding: "40px",
            "text-align": "center",
            color: "var(--ink-mute)",
          }}
        >
          カートを読み込み中…
        </div>
      </Show>
    </ErrorBoundary>
  );
};
