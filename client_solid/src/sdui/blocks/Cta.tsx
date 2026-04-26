// Cta.tsx — Block.type === "cta" のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.3 (CTA) / §15 (Phase 2.5 Action)
//
// **intent と見た目**:
//   - primary     → ink 反転ボタン (一番強い CTA)
//   - secondary   → ボーダー + ink (中間)
//   - tertiary    → 文字リンク (最も控えめ)
//   - destructive → rose 系 (削除など破壊的アクション)
//
// **href**: branded `Href`。https / 内部パスのみ許容 (server 側で parse 済み)。
//
// ── Phase 2.5: action ────────────────────────────────────────────────
//
// `block.action` が undefined → 既存通り `<a href>` で純粋ナビゲーション
//   (progressive enhancement: JS 無し / 旧ブラウザでも飛べる)。
//
// `block.action` が定義されている場合は `<button>` に切り替え:
//   - `add_to_cart`  → POST /api/v1/cart → 成功時:
//        addItemWithUndo() で local store mirror + showToast w/ Undo
//        Undo クリック → DELETE /cart/items/:token + local undo()
//   - `toggle_watch` → POST /api/v1/watch/:productId → showToast (watching 状態)
//
// **失敗時**:
//   いずれも error tone の toast を出す。SduiFetchError(status=0) は
//   "ネットワーク接続を確認してください" にユーザ向け文言を寄せる。
//
// **多重クリック対策**:
//   in-flight 中はボタンを disabled にして二重 POST を防ぐ。createSignal で
//   pending state を持つ。
//
// **テスト容易性**:
//   `data-action-type` 属性で「どのアクションがバインドされたか」を assert できる。

import { createSignal } from "solid-js";

import type { Block } from "../branded";
import {
  SduiFetchError,
  deleteCartItem,
  postCartAdd,
  postCheckoutSubmit,
  postWatchToggle,
} from "../api";
import { L, resolveLocalizable } from "../L";
import { addItemWithUndo, type CartItem } from "../../store/cart";
import { showToast } from "../../store/toast";
import { recordEvent } from "../analytics";
import {
  toAnalyticsContext,
  useAnalyticsCardContext,
} from "../AnalyticsContext";

type CtaBlock = Extract<Block, { type: "cta" }>;
type CtaAction = NonNullable<CtaBlock["action"]>;

const INTENT_STYLE: Record<CtaBlock["intent"], Record<string, string>> = {
  primary: {
    background: "var(--bg-inverse)",
    color: "var(--ink-inverse)",
    border: "1px solid var(--bg-inverse)",
  },
  secondary: {
    background: "var(--bg)",
    color: "var(--ink)",
    border: "1px solid var(--line-strong)",
  },
  tertiary: {
    background: "transparent",
    color: "var(--ink)",
    border: "1px solid transparent",
    "text-decoration": "underline",
  },
  destructive: {
    background: "var(--accent-rose-soft)",
    color: "var(--accent-rose)",
    border: "1px solid transparent",
  },
};

/** SduiFetchError → ユーザー向け文言。
 *  status=0 (network) は別 wording、それ以外は generic + status 数字。 */
const toUserMessage = (e: unknown, fallback: string): string => {
  if (e instanceof SduiFetchError) {
    if (e.status === 0) return "ネットワーク接続を確認してください";
    return `${fallback} (HTTP ${e.status})`;
  }
  return fallback;
};

/** `add_to_cart` 用の最小 CartItem を生成する。
 *
 *  サーバ側はカート内訳の詳細 (title / price / meta) を返さないので、
 *  クライアント側ローカル mirror では「productId と qty」だけが正確。
 *  title / meta / price は表示崩れを防ぐため placeholder。実装が進んだら
 *  AddToCartResponse に含めるか、別 GET で fetch する。 */
const synthesizeCartItem = (productId: string, qty: number): CartItem => ({
  id: productId,
  title: productId,
  meta: "",
  price: 0,
  qty,
  kind: "商品",
  tone: "forest",
});

export const CtaBlockView = (props: { block: CtaBlock }) => {
  const [pending, setPending] = createSignal(false);
  const cardCtx = useAnalyticsCardContext();

  /** 対象 CTA に analyticsId があれば click を 1 件 enqueue する。
   *  - <a> 純ナビ も <button> アクション も同じ helper で済む。
   *  - 内部で sync に buffer に積むだけなので、navigation を遅らせない。 */
  const recordClick = () => {
    const id = (props.block as { analyticsId?: string }).analyticsId;
    if (!id) return;
    const action = props.block.action;
    const extra: Record<string, string | undefined> = {};
    if (action) {
      extra.actionType = action.type;
      // add_to_cart / toggle_watch どちらも productId を持つ
      extra.productId = (action as { productId?: string }).productId;
    }
    recordEvent({
      analyticsId: id,
      eventType: "click",
      context: toAnalyticsContext(cardCtx, extra),
    });
  };

  const style = () => ({
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    height: "36px",
    padding: "0 16px",
    "border-radius": "8px",
    "font-size": "13px",
    "font-weight": "500",
    "text-decoration": "none",
    cursor: pending() ? "wait" : "pointer",
    opacity: pending() ? "0.6" : "1",
    ...INTENT_STYLE[props.block.intent],
  });

  // action 無し → 既存の <a> 動作 (純粋ナビゲーション + JS off フォールバック)
  if (!props.block.action) {
    return (
      <a
        href={props.block.href}
        data-intent={props.block.intent}
        style={style()}
        onClick={recordClick}
      >
        <L value={props.block.label} />
      </a>
    );
  }

  // action 付き → <button> に切り替えてサーバ側状態を変える
  const action: CtaAction = props.block.action;
  // resolve しておく (toast に流す用 / button label には <L> を使う)
  const labelText = () => resolveLocalizable(props.block.label);

  const runAddToCart = async (productId: string, qty: number) => {
    try {
      const res = await postCartAdd(productId, qty);
      // local store mirror (Undo 対応の addItemWithUndo を使う)
      const { undo: undoLocal } = addItemWithUndo(
        synthesizeCartItem(productId, qty),
      );
      showToast({
        message: "カートに追加しました",
        tone: "success",
        action: {
          label: "Undo",
          onClick: () => {
            // 楽観的に local を即戻し、サーバには非同期で DELETE を投げる
            undoLocal();
            deleteCartItem(res.undoToken).catch((err) => {
              showToast({
                message: toUserMessage(err, "Undo に失敗しました"),
                tone: "error",
              });
            });
          },
        },
      });
    } catch (err) {
      showToast({
        message: toUserMessage(err, "カートに追加できませんでした"),
        tone: "error",
      });
    }
  };

  const runToggleWatch = async (productId: string) => {
    try {
      const res = await postWatchToggle(productId);
      showToast({
        message: res.watching ? "ウォッチに追加しました" : "ウォッチを解除しました",
        tone: res.watching ? "success" : "info",
      });
    } catch (err) {
      showToast({
        message: toUserMessage(err, "ウォッチを切り替えられませんでした"),
        tone: "error",
      });
    }
  };

  /** Phase 9.1: Stripe Checkout を開始。成功時は sessionUrl に navigate。 */
  const runStripeCheckout = async () => {
    try {
      const res = await postCheckoutSubmit();
      // SPA 内遷移ではなく、外部 (Stripe Hosted Checkout / mock landing) に行くため
      // window.location.href で navigate する。`/checkout/mock/{order_id}` は同一オリジン。
      if (typeof window !== "undefined") {
        window.location.href = res.sessionUrl;
      }
    } catch (err) {
      showToast({
        message: toUserMessage(err, "決済画面に進めませんでした"),
        tone: "error",
      });
    }
  };

  const onClick = async (e: MouseEvent) => {
    // <button type="button"> なので default は何もしないが、念のため。
    e.preventDefault();
    if (pending()) return;
    // analytics: 二重クリック (pending 中) は計測しない方針。
    // 1 ユーザ操作 = 1 click event を保証するため、pending guard の後で記録する。
    recordClick();
    setPending(true);
    try {
      if (action.type === "add_to_cart") {
        await runAddToCart(action.productId, action.qty);
      } else if (action.type === "toggle_watch") {
        await runToggleWatch(action.productId);
      } else if (action.type === "stripe_checkout") {
        await runStripeCheckout();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      data-intent={props.block.intent}
      data-action-type={action.type}
      disabled={pending()}
      aria-busy={pending()}
      aria-label={labelText()}
      onClick={onClick}
        >
      <L value={props.block.label} />
    </button>
  );
};
