// LineItem.tsx — Block.type === "line_item" のレンダラ (Phase 7)
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.10 (LineItem)
//
// **責務**:
//   - カート 1 行を描画 (画像 + タイトル + 単価 + qty stepper + 小計 + 削除)
//   - +/- / 削除ボタンを LineItemAction に従って HTTP に変換し、成功後にカード再 fetch
//   - server-driven 状態を信頼 (= サーバ側 PATCH/DELETE が真値、クライアント側 mirror なし)
//
// **`block.decrementAction` が undefined の時**:
//   qty == 1 を意味する (= サーバが「これ以上下げる先がない」と判断)。"−" ボタンを
//   disabled にする。"これ以下にしたい" ユーザは "削除" を押す導線。
//
// **再 fetch の方法**:
//   ページ側 (`/cart` page) が `<CartReloadProvider value={...}>` で reload 関数を流し、
//   ここから `useCartReload()` で取り出す。Provider が無い時 (= テストや誤用) は
//   no-op にして UI だけ動く。
//
// **多重クリック対策**:
//   pending 中はボタンを全部 disabled にして PATCH/DELETE を直列化。
//   失敗時は toast でユーザに通知。

import { Show, createSignal } from "solid-js";

import type { Block, LineItemAction } from "../branded";
import { L } from "../L";
import {
  SduiFetchError,
  deleteCartItem,
  patchCartItemQty,
} from "../api";
import { showToast } from "../../store/toast";
import { useCartReload } from "../CartContext";

type LineItemBlock = Extract<Block, { type: "line_item" }>;

/** Number → "¥48,000" 形式。MVP は JPY 固定。 */
const formatJpy = (amount: number): string =>
  amount.toLocaleString("ja-JP");

/** SduiFetchError → ユーザー向け文言 (Cta.tsx と同じパターン)。 */
const toUserMessage = (e: unknown, fallback: string): string => {
  if (e instanceof SduiFetchError) {
    if (e.status === 0) return "ネットワーク接続を確認してください";
    return `${fallback} (HTTP ${e.status})`;
  }
  return fallback;
};

/** LineItemAction を実行 → カード再 fetch を依頼する。
 *  失敗時は toast に流し、再 fetch はしない (= 表示が「現状の真値」のまま残る)。 */
const runAction = async (
  action: LineItemAction,
  reload: () => Promise<unknown> | unknown,
): Promise<void> => {
  try {
    if (action.type === "set_qty") {
      await patchCartItemQty(action.token, action.qty);
    } else {
      await deleteCartItem(action.token);
    }
    await reload();
  } catch (err) {
    showToast({
      message: toUserMessage(
        err,
        action.type === "set_qty"
          ? "数量を更新できませんでした"
          : "商品を削除できませんでした",
      ),
      tone: "error",
    });
  }
};

export const LineItemBlockView = (props: { block: LineItemBlock }) => {
  const [pending, setPending] = createSignal(false);
  const reload = useCartReload();

  const handle = async (action: LineItemAction | undefined) => {
    if (!action) return;
    if (pending()) return;
    setPending(true);
    try {
      await runAction(action, reload);
    } finally {
      setPending(false);
    }
  };

  const qtyAriaLabel = () =>
    `${(props.block.title as { source: string; text?: string }).text ?? ""} の数量`;

  return (
    <div
      data-block-type="line_item"
      data-product-id={props.block.productId}
      style={{
        display: "grid",
        "grid-template-columns": "64px 1fr auto",
        gap: "12px",
        "align-items": "center",
        padding: "12px 0",
        "border-bottom": "1px solid var(--line)",
      }}
    >
      {/* サムネ (= placeholder セル) */}
      <a
        href={props.block.detailHref}
        style={{
          display: "block",
          width: "64px",
          height: "64px",
          "border-radius": "6px",
          background: "var(--bg-mute)",
          overflow: "hidden",
        }}
        aria-hidden={!props.block.imageSrc}
      >
        <Show when={props.block.imageSrc}>
          {(src) => (
            <img
              src={src()}
              alt={
                props.block.imageAlt
                  ? (props.block.imageAlt as { source: string; text?: string }).text ?? ""
                  : ""
              }
              style={{ width: "100%", height: "100%", "object-fit": "cover" }}
            />
          )}
        </Show>
      </a>

      {/* 商品名 + 単価 */}
      <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
        <a
          href={props.block.detailHref}
          style={{
            color: "var(--ink)",
            "text-decoration": "none",
            "font-size": "14px",
            "font-weight": "500",
          }}
        >
          <L value={props.block.title} />
        </a>
        <div style={{ "font-size": "12px", color: "var(--ink-mute)" }}>
          単価 ¥{formatJpy(props.block.unitPriceAmount)}
        </div>
      </div>

      {/* 右側: qty stepper + 小計 + 削除 */}
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          "align-items": "flex-end",
          gap: "6px",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
          <button
            type="button"
            data-action-type="decrement"
            aria-label={`${qtyAriaLabel()} を減らす`}
            disabled={pending() || !props.block.decrementAction}
            onClick={() => handle(props.block.decrementAction)}
            style={{
              width: "28px",
              height: "28px",
              "border-radius": "6px",
              border: "1px solid var(--line-strong)",
              background: "var(--bg)",
              cursor: props.block.decrementAction && !pending() ? "pointer" : "not-allowed",
              opacity: props.block.decrementAction && !pending() ? "1" : "0.4",
            }}
          >
            −
          </button>
          <span
            data-qty
            aria-label={qtyAriaLabel()}
            style={{
              "min-width": "24px",
              "text-align": "center",
              "font-variant-numeric": "tabular-nums",
              "font-size": "14px",
            }}
          >
            {props.block.qty}
          </span>
          <button
            type="button"
            data-action-type="increment"
            aria-label={`${qtyAriaLabel()} を増やす`}
            disabled={pending()}
            onClick={() => handle(props.block.incrementAction)}
            style={{
              width: "28px",
              height: "28px",
              "border-radius": "6px",
              border: "1px solid var(--line-strong)",
              background: "var(--bg)",
              cursor: pending() ? "wait" : "pointer",
              opacity: pending() ? "0.4" : "1",
            }}
          >
            ＋
          </button>
        </div>
        <div
          data-subtotal
          class="serif"
          style={{ "font-size": "16px", "font-weight": "600" }}
        >
          ¥{formatJpy(props.block.subtotalAmount)}
        </div>
        <button
          type="button"
          data-action-type="remove"
          aria-label="この商品をカートから削除"
          disabled={pending()}
          onClick={() => handle(props.block.removeAction)}
          style={{
            "font-size": "11px",
            color: "var(--accent-rose)",
            background: "transparent",
            border: "none",
            cursor: pending() ? "wait" : "pointer",
            padding: "0",
          }}
        >
          削除
        </button>
      </div>
    </div>
  );
};
