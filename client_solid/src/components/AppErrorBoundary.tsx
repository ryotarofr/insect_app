// AppErrorBoundary.tsx — ルートごとのエラー境界
// Solid.js の <ErrorBoundary> に日本語のフォールバック UI + reset ボタンを重ねるだけの薄いラッパー。
import { ErrorBoundary, type JSX } from "solid-js";

export interface AppErrorBoundaryProps {
  /** エラー境界の識別子。内部ログと fallback UI のラベルに使う */
  label?: string;
  children: JSX.Element;
}

export const AppErrorBoundary = (props: AppErrorBoundaryProps) => (
  <ErrorBoundary
    fallback={(err, reset) => (
      <div
        role="alert"
        style={{
          padding: "40px 24px",
          "text-align": "center",
          color: "var(--ink-mute)",
          border: "1px dashed var(--line-strong)",
          "border-radius": "var(--r-lg)",
          margin: "20px 0",
        }}
      >
        <div
          class="mono"
          style={{
            "font-size": "11px",
            "letter-spacing": "0.12em",
            color: "var(--accent-rose)",
          }}
        >
          ERROR · {props.label ?? "view"}
        </div>
        <div
          class="serif"
          style={{
            "font-size": "20px",
            "font-weight": 600,
            margin: "6px 0 8px",
            color: "var(--ink)",
          }}
        >
          このビューを表示できませんでした
        </div>
        <div style={{ "font-size": "13px", "margin-bottom": "14px" }}>
          {err instanceof Error ? err.message : String(err)}
        </div>
        <button class="btn primary" onClick={reset}>
          再試行
        </button>
      </div>
    )}
  >
    {props.children}
  </ErrorBoundary>
);
