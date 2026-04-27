// CartSdui.tsx — Phase 7 の SDUI 駆動カート画面
//
// 詳細: docs/sdui-three-layer-model-v5.md §11 (移行戦略 / Strangler Fig)
//
// **責務**:
//   1. `GET /api/v1/cards/cart` を叩いて CartCard を取得
//   2. CartReloadProvider に refetch を流す
//   3. CardRenderer に渡して描画
//   4. 失敗時はエラー表示、ロード中はスピナ
//   5. (Phase 3) 血統リマインダ <CartBloodlineReminder /> をカード直下に重ねる
//
// **既存 `/cart` (Cart.tsx) との関係 (Strangler Fig 段階 1)**:
//   - 旧 Cart.tsx は shipping form / checkout / Stripe 決済を内包しており、
//     SDUI 側は「カート明細 + 集計 + CTA」だけが対象。Phase 7 では新 route `/cart-sdui`
//     を立て、本ページで SDUI 表示の検証 + 既存 store/cart と並行運用する。
//   - shipping / checkout は Phase 7+ で SDUI 化を検討 (= 段階移行)。
//
// **再 fetch 戦略 (M6 で seq-tagged 化)**:
//   LineItem の +/- や 削除 / FormField の入力 / ShippingMethodPicker の選択 →
//   サーバ側 store が変わる → 再 fetch して サーバの真値を再描画。
//
//   素朴な createResource では「PATCH (n) → refetch → PATCH (n+1) → refetch」が
//   交差した時に古い refetch が後から到着して UI を巻き戻す race がある (= §11.8.1 規律 2)。
//   useCartSnapshot は各 fetch に単調増加 seq を付与し、最大 seq の結果のみが
//   UI を更新する。CartReloadProvider に流すのは seq-aware な reload 関数。

import { ErrorBoundary, Show } from "solid-js";

import { CardRenderer } from "../sdui/CardRenderer";
import { CartReloadProvider } from "../sdui/CartContext";
import { SduiFetchError } from "../sdui/api";
import { useCartSnapshot } from "../sdui/useCartSnapshot";
import { CartBloodlineReminder } from "../components/products/CartBloodlineReminder";
import "../styles/bloodline.css";
import "../styles/product-bloodline.css";

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
  // useCartSnapshot は seq-tagged な fetch / reload / mutate を提供する。
  // Cart 内 LineItem / FormField / ShippingMethodPicker は CartReloadProvider 経由で
  // reload を取り出す (= seq tracking が透過的に効く)。
  const snap = useCartSnapshot();

  // 初期 fetch 中は loading=true で card=undefined。card が来た瞬間に loading が
  // 0 に戻り、card() が値を持つ。
  const isInitialLoading = () => snap.loading() && snap.card() === undefined;

  const hasErrorWithoutCard = () => Boolean(snap.error()) && !snap.card();

  return (
    <ErrorBoundary fallback={(err) => <ErrorView err={err} />}>
      <Show
        when={isInitialLoading()}
        fallback={
          <Show
            when={hasErrorWithoutCard()}
            fallback={
              <Show when={snap.card()}>
                {(c) => (
                  <CartReloadProvider value={snap.reload}>
                    <CardRenderer card={c()} />
                    {/* Phase 3: SDUI カード直下に血統リマインダを差し込む.
                        CartCard は max-width: 640px / margin: 0 auto で中央寄せ
                        されているので、リマインダ側も同じ制約を CSS で揃える. */}
                    <CartBloodlineReminder card={c()} />
                  </CartReloadProvider>
                )}
              </Show>
            }
          >
            <ErrorView err={snap.error()} />
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
