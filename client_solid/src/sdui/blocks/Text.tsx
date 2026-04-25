// Text.tsx — Block.type === "text" のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.2 (Text)
//
// **role による見た目の差異**:
//   - headline: タイトル相当 (font-weight 600, 16-18px)
//   - subhead : 学名・サブタイトル (mono italic, 12px, ink-faint)
//   - eyebrow : 上品なラベル (10px upper, ink-mute)
//   - body / lead / caption / byline: 段落系
//
// 見た目はあくまで MVP のプリセット。Design Token (tokens.css) と整合させてある。

import type { Block } from "../branded";
import { L } from "../L";

type TextBlock = Extract<Block, { type: "text" }>;

/** role → CSS class マッピング (data-role 属性で個別 CSS 上書きも可能に)。
 *  class はインライン style と併用する。テンプレートで上書きしたい時はここを差し替える。 */
const ROLE_STYLE: Record<TextBlock["role"], { class?: string; style: Record<string, string> }> = {
  eyebrow: {
    style: {
      "font-size": "10px",
      "letter-spacing": "0.08em",
      "text-transform": "uppercase",
      color: "var(--ink-mute)",
    },
  },
  headline: {
    style: {
      "font-size": "16px",
      "font-weight": "600",
      color: "var(--ink)",
    },
  },
  subhead: {
    class: "mono",
    style: {
      "font-size": "12px",
      "font-style": "italic",
      color: "var(--ink-faint)",
      "margin-top": "2px",
    },
  },
  lead: {
    style: { "font-size": "14px", color: "var(--ink)" },
  },
  body: {
    style: { "font-size": "13px", color: "var(--ink)", "line-height": "1.6" },
  },
  caption: {
    style: { "font-size": "11px", color: "var(--ink-mute)" },
  },
  byline: {
    style: { "font-size": "11px", color: "var(--ink-faint)" },
  },
};

export const TextBlockView = (props: { block: TextBlock }) => {
  const cfg = () => ROLE_STYLE[props.block.role];
  return (
    <div data-role={props.block.role} class={cfg().class} style={cfg().style}>
      <L value={props.block.content} />
    </div>
  );
};
