// ShippingMethodPicker.tsx — Block.type === "shipping_method_picker" のレンダラ (Phase 8)
//
// 詳細: docs/sdui-three-layer-model-v6.md §5.8.2 (FormField + ShippingMethodPicker)
//
// **責務**:
//   - 配送方法候補 (cold / normal 等) を radio group で描画
//   - 各 option の name / description / amount を縦並びで表示
//   - radio change で `patchCheckoutShippingMethod(id)` → `useCartReload()` で再 fetch
//
// **FormField::Select で代用しない理由 (§5.8.2 設計書)**:
//   - 「料金 + 説明文」を含む rich option で id+label では表現できない
//   - <select> ではなく <label>+<input type="radio"> の縦並びで描画したい (a11y / 視認性)
//   - PATCH endpoint も /checkout/shipping_method (単一値) で別系統
//
// **a11y**:
//   - <fieldset> + <legend> で group 全体を意味付け (= スクリーンリーダーで「配送方法」と読み上げ)
//   - 各 radio に aria-label / aria-describedby は付けない (label 直接連結で十分)
//   - PATCH 中は disabled で再操作を防止

import { For, createSignal } from "solid-js";

import type { Block } from "../branded";
import { L } from "../L";
import { SduiFetchError, patchCheckoutShippingMethod } from "../api";
import { useCartReload } from "../CartContext";
import { showToast } from "../../store/toast";

type PickerBlock = Extract<Block, { type: "shipping_method_picker" }>;

/** Number → "¥1,800" 形式。MVP は JPY 固定 (LineItem.tsx と同じパターン)。 */
const formatJpy = (amount: number): string => `¥${amount.toLocaleString("ja-JP")}`;

/** SduiFetchError → ユーザ向け文言 (FormField と揃える)。 */
const toUserMessage = (e: unknown): string => {
  if (e instanceof SduiFetchError) {
    if (e.status === 0) return "ネットワーク接続を確認してください";
    if (e.status === 400) return "選択された配送方法は無効です";
    return `配送方法を変更できませんでした (HTTP ${e.status})`;
  }
  return "配送方法を変更できませんでした";
};

export const ShippingMethodPickerView = (props: { block: PickerBlock }) => {
  const reload = useCartReload();
  const [pending, setPending] = createSignal(false);

  const handleChange = async (id: string) => {
    if (id === props.block.selectedId) return; // 同値クリックは no-op
    setPending(true);
    try {
      await patchCheckoutShippingMethod(id);
      await reload();
    } catch (err) {
      showToast({ message: toUserMessage(err), tone: "error" });
    } finally {
      setPending(false);
    }
  };

  return (
    <fieldset class="sdui-shipping-method" disabled={pending()}>
      <ul class="sdui-shipping-method__list" role="presentation">
        <For each={props.block.options}>
          {(opt) => {
            const inputId = `smp-${props.block.key}-${opt.id}`;
            const isSelected = () => opt.id === props.block.selectedId;
            return (
              <li class="sdui-shipping-method__item">
                <label
                  class="sdui-shipping-method__label"
                  for={inputId}
                  data-selected={isSelected() ? "true" : "false"}
                >
                  <input
                    id={inputId}
                    type="radio"
                    name={`shipping-method-${props.block.key}`}
                    class="sdui-shipping-method__radio"
                    value={opt.id}
                    checked={isSelected()}
                    onChange={() => handleChange(opt.id)}
                  />
                  <span class="sdui-shipping-method__main">
                    <span class="sdui-shipping-method__name">
                      <L value={opt.name} />
                    </span>
                    <span class="sdui-shipping-method__desc">
                      <L value={opt.description} />
                    </span>
                  </span>
                  <span class="sdui-shipping-method__price">
                    {formatJpy(opt.amount)}
                  </span>
                </label>
              </li>
            );
          }}
        </For>
      </ul>
    </fieldset>
  );
};
