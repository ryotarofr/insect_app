// MetaLine.tsx — Block.type === "meta_line" のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.7 (MetaLine)
//
// **構造**:
//   横一列に MetaItem を並べる。各 item:
//     - role: id / shop / code / lot / breeder (見た目を分ける)
//     - value: 素の文字列 (Localizable ではない: §12.6)
//     - align: optional "start" | "end" — "end" の item は flex で右寄せ
//
// MVP では 4px 区切り、12px グレー、id だけ mono、code は forest accent で軽く強調。

import { For } from "solid-js";
import type { Block } from "../branded";

type MetaLineBlock = Extract<Block, { type: "meta_line" }>;
type MetaItem = MetaLineBlock["items"][number];

const ROLE_STYLE: Record<MetaItem["role"], { class?: string; color?: string }> = {
  id: { class: "mono", color: "var(--ink-mute)" },
  shop: { color: "var(--ink-mute)" },
  code: { color: "var(--accent-forest)" },
  lot: { class: "mono", color: "var(--ink-faint)" },
  breeder: { color: "var(--ink-mute)" },
};

export const MetaLineBlockView = (props: { block: MetaLineBlock }) => {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "font-size": "12px",
        "flex-wrap": "wrap",
      }}
    >
      <For each={props.block.items}>
        {(item) => {
          const cfg = ROLE_STYLE[item.role];
          return (
            <span
              data-role={item.role}
              class={cfg.class}
              style={{
                color: cfg.color,
                ...(item.align === "end" ? { "margin-left": "auto" } : {}),
              }}
            >
              {item.value}
            </span>
          );
        }}
      </For>
    </div>
  );
};
