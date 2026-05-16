// store/toast.ts — 非侵襲的なトースト通知
//
// P2-7: Toast system
//   - 画面右下 (モバイルは画面下中央) に一時的な通知を出す。
//   - 各トーストは Undo / Dismiss 等のアクションを任意で持てる。
//   - デフォルト寿命は 3500ms。Undo ありは 5000ms まで滞在。
//   - 同時表示は最大 3 件までキューで管理する (新しいものを下に積む)。
//
// 使用側 API:
//   showToast({ message: "保存しました" })
//   showToast({ message: "削除しました", action: { label: "Undo", onClick: ... }, tone: "warn" })
import { createSignal } from "solid-js";

export type ToastTone = "info" | "success" | "warn" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** ms, 0 でユーザー操作のみで閉じる */
  duration: number;
  action?: ToastAction;
  /** トーストが dismiss される直前に呼ぶ (タイマー or 手動 or action). */
  onClose?: () => void;
}

export interface ShowToastInput {
  message: string;
  tone?: ToastTone;
  duration?: number;
  action?: ToastAction;
  onClose?: () => void;
}

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 3500;
const WITH_ACTION_DURATION = 5000;

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextId = 1;

const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** 内部: id のタイマーをキャンセル */
const clearTimer = (id: number) => {
  const t = timers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(id);
  }
};

export const dismissToast = (id: number) => {
  const current = toasts().find((t) => t.id === id);
  clearTimer(id);
  setToasts((list) => list.filter((t) => t.id !== id));
  current?.onClose?.();
};

/** 外部から全部クリア (テスト等) */
export const clearToasts = () => {
  for (const id of Array.from(timers.keys())) clearTimer(id);
  setToasts([]);
};

export const showToast = (input: ShowToastInput): number => {
  const id = nextId++;
  const duration =
    input.duration ??
    (input.action ? WITH_ACTION_DURATION : DEFAULT_DURATION);
  const toast: Toast = {
    id,
    message: input.message,
    tone: input.tone ?? "info",
    duration,
    action: input.action,
    onClose: input.onClose,
  };
  setToasts((list) => {
    const next = [...list, toast];
    // オーバーフローした古いものを落とす (onClose は呼ばずに済ます)
    if (next.length > MAX_VISIBLE) {
      const overflow = next.slice(0, next.length - MAX_VISIBLE);
      for (const o of overflow) clearTimer(o.id);
      return next.slice(-MAX_VISIBLE);
    }
    return next;
  });
  if (duration > 0) {
    const h = setTimeout(() => dismissToast(id), duration);
    timers.set(id, h);
  }
  return id;
};

/** 読み取り専用の signal (UI 側はこれを For で回す) */
export const toastList = toasts;
