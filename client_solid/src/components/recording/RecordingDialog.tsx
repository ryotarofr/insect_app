// components/recording/RecordingDialog.tsx — 個体化モードの確認 / 完了 ダイアログ
//
// **2 種類のダイアログ**:
//   - kind="confirm-end": 中断確認 (キャンセル / 終了する)
//   - kind="complete": 100/100 達成時 (3 秒カウントダウン後に自動 onConfirm 発火)
//
// **設計** (docs/cohort-implementation-plan.md §7.3):
//   - position: fixed の backdrop + 中央 modal
//   - confirm-end: Esc / backdrop クリックで onCancel 発火
//   - complete: backdrop クリックは無視 (誤キャンセル防止)、Esc は onConfirm 発火
//   - body / 残り時間は子要素として渡せる

import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";

interface BaseProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

interface ConfirmEndProps extends BaseProps {
  kind: "confirm-end";
  /** 中断時の警告本文 (例: "X 匹を個体化しました。残りは群に残ります。") */
  body: JSX.Element;
}

interface CompleteProps extends BaseProps {
  kind: "complete";
  /** 完了サマリ (例: "100 匹を個体化しました。群詳細に戻ります。") */
  body: JSX.Element;
  /** 自動 onConfirm までの秒数 (デフォルト 3 秒) */
  countdownSec?: number;
}

type Props = ConfirmEndProps | CompleteProps;

export const RecordingDialog = (props: Props) => {
  const [remaining, setRemaining] = createSignal<number>(0);
  let timerId: number | undefined;
  let intervalId: number | undefined;

  const clearTimers = () => {
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timerId = undefined;
    }
    if (intervalId !== undefined) {
      window.clearInterval(intervalId);
      intervalId = undefined;
    }
  };

  // 完了ダイアログ: open になった瞬間にカウントダウン開始
  createEffect(() => {
    if (props.open && props.kind === "complete") {
      const total = (props as CompleteProps).countdownSec ?? 3;
      setRemaining(total);
      clearTimers();
      intervalId = window.setInterval(() => {
        setRemaining((r) => Math.max(0, r - 1));
      }, 1000);
      timerId = window.setTimeout(() => {
        clearTimers();
        props.onConfirm();
      }, total * 1000);
    } else {
      clearTimers();
      setRemaining(0);
    }
  });

  // Esc / backdrop / unmount で timer を解除
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        clearTimers();
        if (props.kind === "complete") {
          props.onConfirm();
        } else {
          props.onCancel();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      clearTimers();
    });
  });

  const onBackdropClick: JSX.EventHandler<HTMLDivElement, MouseEvent> = (e) => {
    // backdrop 自身がターゲットの時のみ閉じる
    if (e.target !== e.currentTarget) return;
    if (props.kind === "confirm-end") {
      props.onCancel();
    }
    // complete: backdrop 押下では閉じない (誤キャンセル防止)
  };

  const onConfirmClick = () => {
    clearTimers();
    props.onConfirm();
  };
  const onCancelClick = () => {
    clearTimers();
    props.onCancel();
  };

  return (
    <Show when={props.open}>
      <div
        class="rec-dialog-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rec-dialog-title"
        onClick={onBackdropClick}
      >
        <div class="rec-dialog">
          <Show when={props.kind === "complete"}>
            <svg
              class="rec-dialog__icon"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="11"
                fill="var(--accent-forest-soft)"
                stroke="var(--accent-forest)"
                stroke-width="1.2"
              />
              <path
                d="M7 12.2l3.2 3.2L17 8.6"
                stroke="var(--accent-forest)"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </Show>
          <h2 id="rec-dialog-title" class="rec-dialog__title">
            {props.kind === "complete"
              ? "個体化モードが完了しました"
              : "個体化モードを終了しますか？"}
          </h2>
          <div class="rec-dialog__body">{props.body}</div>
          <Show when={props.kind === "complete"}>
            <p class="rec-dialog__countdown">
              ({remaining()} 秒後に群詳細へ自動遷移)
            </p>
          </Show>
          <div class="rec-dialog__actions">
            <Show
              when={props.kind === "complete"}
              fallback={
                <>
                  <button
                    type="button"
                    class="btn"
                    onClick={onCancelClick}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    class="btn primary"
                    onClick={onConfirmClick}
                  >
                    終了する
                  </button>
                </>
              }
            >
              <button
                type="button"
                class="btn primary"
                onClick={onConfirmClick}
              >
                OK
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
