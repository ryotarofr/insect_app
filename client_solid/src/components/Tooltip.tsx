// Tooltip.tsx — シンプルな ⓘ ツールチップ
//
// KPI カードなどの「この数字どう集計しているの?」を
// ホバー / フォーカス / タップで補足表示する小さなウィジェット。
//
// - アクセシビリティ: role="button" + tabindex で tab フォーカス可能
//   aria-describedby で補足文と関連付け
// - モバイル: タップで開閉 (click 時に signal を toggle)
// - デスクトップ: CSS :hover で自動表示 (signal 状態と OR 合成で共存)
// - 外側クリックで閉じる
import { createSignal, onCleanup, onMount } from "solid-js";

interface TooltipProps {
  /** ツールチップに表示する文字列 (改行 OK) */
  content: string;
  /** スクリーンリーダー用ラベル (省略時は "詳細") */
  label?: string;
}

let uid = 0;
const nextId = () => `tt-${++uid}`;

export const Tooltip = (props: TooltipProps) => {
  const [open, setOpen] = createSignal(false);
  const id = nextId();
  let rootEl: HTMLSpanElement | undefined;

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    setOpen((v) => !v);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((v) => !v);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // 外側クリックで閉じる
  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootEl) return;
      if (!rootEl.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  return (
    <span class="tt" ref={rootEl}>
      <button
        type="button"
        class="tt-trigger"
        aria-label={props.label ?? "詳細"}
        aria-describedby={id}
        aria-expanded={open()}
        title={props.content}
        onClick={toggle}
        onKeyDown={onKey}
      >
        ⓘ
      </button>
      <span
        id={id}
        role="tooltip"
        class={"tt-bubble" + (open() ? " open" : "")}
      >
        {props.content}
      </span>
    </span>
  );
};
