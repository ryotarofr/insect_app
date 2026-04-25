// Divider.tsx — Block.type === "divider" のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.11 (Divider)
//
// 1px の水平区切り線。Region 内で論理的なまとまりを示す。
// 既存 var(--line) を使用。装飾要素なので role="presentation"。

import type { Block } from "../branded";

type DividerBlock = Extract<Block, { type: "divider" }>;

// Divider は内容を持たないため block prop は使わない。型シグネチャだけ揃える。
export const DividerBlockView = (_props: { block: DividerBlock }) => {
  return (
    <hr
      role="presentation"
      style={{
        border: "none",
        height: "1px",
        background: "var(--line)",
        margin: "8px 0",
      }}
    />
  );
};
