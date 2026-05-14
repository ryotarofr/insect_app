// Toast.tsx — トースト通知のポータル描画
//
// store/toast を購読し、画面右下 (mobile は下中央) に積み上げて表示する。
// アクセシビリティ: aria-live="polite" + role="status" で読み上げ対応。
// モーション: transform: translateY で slide-up アニメーション。
import { For, Show } from "solid-js";
import { dismissToast, toastList, type Toast } from "../store/toast";

const toneClass = (tone: Toast["tone"]): string => {
  switch (tone) {
    case "success":
      return "toast-success";
    case "warn":
      return "toast-warn";
    case "error":
      return "toast-error";
    default:
      return "toast-info";
  }
};

export const ToastContainer = () => (
  <div
    class="toast-region"
    role="region"
    aria-live="polite"
    aria-label="通知"
  >
    <For each={toastList()}>
      {(t) => (
        <div class={`toast ${toneClass(t.tone)}`} role="status">
          <span class="toast-msg">{t.message}</span>
          <Show when={t.action}>
            <button
              type="button"
              class="toast-action"
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action!.label}
            </button>
          </Show>
          <button
            type="button"
            class="toast-close"
            aria-label="通知を閉じる"
            onClick={() => dismissToast(t.id)}
          >
            ×
          </button>
        </div>
      )}
    </For>
  </div>
);
