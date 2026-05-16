// Breadcrumb.tsx — パンくずナビ
//
// 各階層をタップ/クリックで親に戻れるようにする。
//
// crumbFor(route, ids) で pages/route ごとに階層構造を組み立て、
// Breadcrumb がそれを <nav aria-label="breadcrumb"> として描画する。
import { For, Show } from "solid-js";
import { A } from "@solidjs/router";

/** パンくずの 1 つ分 */
export interface Crumb {
  label: string;
  /** 省略時は「現在地」としてリンクにしない */
  href?: string;
}

interface BreadcrumbProps {
  items: Crumb[];
  /** 区切り文字 (default: " / ") */
  separator?: string;
}

export const Breadcrumb = (props: BreadcrumbProps) => {
  const sep = () => props.separator ?? " / ";
  return (
    <nav
      class="crumb"
      aria-label="パンくずリスト"
      style={{ display: "inline-flex", "align-items": "center", gap: "2px", "flex-wrap": "wrap" }}
    >
      <For each={props.items}>
        {(c, i) => {
          const isLast = () => i() === props.items.length - 1;
          return (
            <>
              <Show
                when={c.href && !isLast()}
                fallback={
                  <span
                    aria-current={isLast() ? "page" : undefined}
                    style={{
                      "font-weight": isLast() ? 600 : 400,
                      color: isLast() ? "var(--ink)" : "var(--ink-mute)",
                    }}
                  >
                    {c.label}
                  </span>
                }
              >
                <A
                  href={c.href!}
                  class="crumb-link"
                  style={{
                    color: "var(--ink-mute)",
                    "text-decoration": "none",
                    padding: "2px 4px",
                    "border-radius": "4px",
                  }}
                >
                  {c.label}
                </A>
              </Show>
              <Show when={!isLast()}>
                <span aria-hidden="true" style={{ color: "var(--ink-faint)" }}>
                  {sep()}
                </span>
              </Show>
            </>
          );
        }}
      </For>
    </nav>
  );
};
