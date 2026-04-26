// FormField.tsx — Block.type === "form_field" のレンダラ (Phase 8)
//
// 詳細:
//   - docs/sdui-three-layer-model-v6.md §5.8.2 (FormField + ShippingMethodPicker)
//   - docs/sdui-three-layer-model-v6.md §11.8.1 規律 1 (focus/dirty 中の上書き禁止)
//   - docs/sdui-three-layer-model-v6.md §10.5 (a11y under server-driven state)
//
// **責務**:
//   - 配送先 1 フィールド (氏名 / 電話 / 郵便番号 / 都道府県 / 住所) を描画
//   - kind.inputType に応じて <input type="text|tel"> / <input inputmode="numeric"> /
//     <select> を出し分け
//   - useFormFieldState hook で focus / dirty / debounce を統合管理
//     (= §11.8.1 規律 1: focus 中・直近編集中は server snapshot で上書きしない)
//   - validation_error が server から来たら <input aria-invalid> + 下に赤字で表示
//
// **server-driven 状態の規律 (§11.8 / §11.8.1)**:
//   server 値が真値だが、入力中の中間状態だけは client が一時保持する。
//   blur or 800ms idle で server 値に同期する (= focus 中の値巻き戻しを防止)。
//
// **a11y (§10.5)**:
//   - validation_error → aria-invalid + aria-describedby={errId}
//   - エラー文 box は role="alert" + aria-live="polite"
//   - required → aria-required="true" を付与
//
// **fail-soft**:
//   submit 失敗時は toast でユーザに通知。再 fetch しない (= 表示が現状維持)。

import { For, Show } from "solid-js";

import type { Block, Localizable } from "../branded";
import { L, resolveLocalizable } from "../L";
import { SduiFetchError, patchCheckoutShippingField } from "../api";
import { useCartReload } from "../CartContext";
import { showToast } from "../../store/toast";
import { useFormFieldState } from "../useFormFieldState";

type FormFieldBlock = Extract<Block, { type: "form_field" }>;

/** server validation error / 通信エラーをユーザ向け文言に正規化。 */
const toUserMessage = (e: unknown): string => {
  if (e instanceof SduiFetchError) {
    if (e.status === 0) return "ネットワーク接続を確認してください";
    if (e.status === 400) return "入力値が無効です";
    return `保存に失敗しました (HTTP ${e.status})`;
  }
  return "保存に失敗しました";
};

/** Localizable を string に展開。空文字 fallback は呼び出し側責務。 */
const localizableToString = (v: Localizable | undefined): string =>
  v ? resolveLocalizable(v) : "";

export const FormFieldView = (props: { block: FormFieldBlock }) => {
  const reload = useCartReload();

  // useFormFieldState: focus/dirty/debounce を統合した hook (§11.8.1 規律 1)。
  // submit 内で patch + reload を行う。失敗は toast に流して swallow。
  const state = useFormFieldState({
    initialValue: props.block.value,
    serverValue: () => props.block.value,
    submit: async (value) => {
      try {
        await patchCheckoutShippingField(props.block.name, value);
        await reload();
      } catch (err) {
        showToast({ message: toUserMessage(err), tone: "error" });
      }
    },
  });

  const fieldId = () => `ff-${props.block.name}`;
  const errorId = () => `${fieldId()}-error`;

  return (
    <div class="sdui-form-field" data-name={props.block.name}>
      <label class="sdui-form-field__label" for={fieldId()}>
        <L value={props.block.label} />
        <Show when={props.block.required}>
          <span class="sdui-form-field__required" aria-hidden="true">
            {" *"}
          </span>
        </Show>
      </label>

      <Show when={props.block.kind.inputType === "select"}>
        <select
          id={fieldId()}
          class="sdui-form-field__select"
          value={state.draft()}
          required={props.block.required}
          aria-required={props.block.required ? "true" : undefined}
          aria-invalid={props.block.validationError ? "true" : undefined}
          aria-describedby={
            props.block.validationError ? errorId() : undefined
          }
          disabled={state.pending()}
          onChange={(ev) => state.onCommit(ev.currentTarget.value)}
          onFocus={state.onFocus}
          onBlur={state.onBlur}
        >
          <For
            each={
              props.block.kind.inputType === "select"
                ? (props.block.kind as { options: { id: string; label: Localizable }[] }).options
                : []
            }
          >
            {(opt) => (
              <option value={opt.id}>{localizableToString(opt.label)}</option>
            )}
          </For>
        </select>
      </Show>

      <Show when={props.block.kind.inputType !== "select"}>
        <input
          id={fieldId()}
          class="sdui-form-field__input"
          type={
            props.block.kind.inputType === "tel"
              ? "tel"
              : props.block.kind.inputType === "postal_code"
                ? "text"
                : "text"
          }
          inputmode={
            props.block.kind.inputType === "postal_code"
              ? "numeric"
              : props.block.kind.inputType === "tel"
                ? "tel"
                : undefined
          }
          autocomplete={props.block.autocomplete}
          placeholder={localizableToString(props.block.placeholder) || undefined}
          value={state.draft()}
          required={props.block.required}
          aria-required={props.block.required ? "true" : undefined}
          aria-invalid={props.block.validationError ? "true" : undefined}
          aria-describedby={
            props.block.validationError ? errorId() : undefined
          }
          disabled={state.pending()}
          onInput={(ev) => state.onInput(ev.currentTarget.value)}
          onFocus={state.onFocus}
          onBlur={state.onBlur}
        />
      </Show>

      <Show when={props.block.validationError}>
        {(err) => (
          <p
            id={errorId()}
            class="sdui-form-field__error"
            role="alert"
            aria-live="polite"
          >
            <L value={err()} />
          </p>
        )}
      </Show>
    </div>
  );
};
