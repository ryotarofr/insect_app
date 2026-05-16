// NewDropdown.tsx — マイページの「+ 新規 ▾」 dropdown
//
// 「自分の手元に新しいレコードを作る」アクションを 1 dropdown に集約。
// 「+ 新しい個体を探す」(EC) は意味カテゴリが違うので別ボタンとして親に残す。
//
// 将来追加候補:
//   - 交配記録を作成 (mating_records 直接作成)
//   - PDF を取り込む (血統書 OCR)
// dropdown は項目追加で自然に拡張できる構造を維持する。

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { RouteKey } from "../../data";
import { Icons } from "../Icons";

interface NewDropdownProps {
  setRoute: (r: RouteKey) => void;
}

export const NewDropdown = (props: NewDropdownProps) => {
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  const close = () => setOpen(false);

  // click outside で閉じる
  onMount(() => {
    const onClick = (e: MouseEvent) => {
      if (!open()) return;
      if (!rootEl) return;
      if (e.target instanceof Node && !rootEl.contains(e.target)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open()) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  const select = (r: RouteKey) => {
    close();
    props.setRoute(r);
  };

  return (
    <div ref={rootEl} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        class="btn"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {Icons.plus()} 新規{" "}
        <span style={{ "margin-left": "2px", "font-size": "10px" }}>▾</span>
      </button>
      <Show when={open()}>
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            "min-width": "200px",
            background: "var(--bg-raised)",
            border: "1px solid var(--line)",
            "border-radius": "8px",
            "box-shadow": "0 4px 16px oklch(0 0 0 / 0.08)",
            "z-index": 30,
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            role="menuitem"
            class="dropdown-item"
            onClick={() => select("specimen-new")}
            style={{
              display: "block",
              width: "100%",
              padding: "9px 14px",
              "text-align": "left",
              background: "transparent",
              border: 0,
              "font-size": "12px",
              color: "var(--ink)",
              cursor: "pointer",
              "border-bottom": "1px solid var(--line)",
            }}
          >
            個体を登録
          </button>
          <button
            type="button"
            role="menuitem"
            class="dropdown-item"
            onClick={() => select("cohort-new")}
            style={{
              display: "block",
              width: "100%",
              padding: "9px 14px",
              "text-align": "left",
              background: "transparent",
              border: 0,
              "font-size": "12px",
              color: "var(--ink)",
              cursor: "pointer",
            }}
          >
            群を作成
          </button>
        </div>
      </Show>
    </div>
  );
};
