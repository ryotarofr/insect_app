// MetricList.tsx — Block.type === "metric_list" のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.6 (MetricList)
//
// **構造**:
//   key/label/value の trio を縦に並べる。MVP は label を上 (mute) / value を下 (ink) の
//   2 段表示。レスポンシブはせず、横方向は親側 (Region) に任せる。
//
// label / value 両方 Localizable なので `<L>` で解決する。

import { For } from "solid-js";
import type { Block } from "../branded";
import { L } from "../L";

type MetricListBlock = Extract<Block, { type: "metric_list" }>;

export const MetricListBlockView = (props: { block: MetricListBlock }) => {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(auto-fit, minmax(96px, 1fr))",
        gap: "12px",
      }}
    >
      <For each={props.block.items}>
        {(item) => (
          <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
            <span style={{ "font-size": "10px", color: "var(--ink-mute)", "letter-spacing": "0.04em" }}>
              <L value={item.label} />
            </span>
            <span style={{ "font-size": "14px", "font-weight": "500", color: "var(--ink)" }}>
              <L value={item.value} />
            </span>
          </div>
        )}
      </For>
    </div>
  );
};
