// Badge.tsx — Block.type === "badge" のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.5 (Badge)
//
// **role と既存トーンのマッピング (MVP)**:
//   - status   → chip.forest  (おすすめ・新着など中立的なステータス)
//   - evidence → chip.indigo  (血統書付・認証など信頼を示す)
//   - warning  → chip.rose    (在庫僅少・受付終了など注意喚起)
//   - promo    → chip.amber   (セール・期間限定)
//
// 既存 tokens.css の `.chip.<color>` クラスを流用するため新 CSS 不要。

import type { Block } from "../branded";
import { L } from "../L";

type BadgeBlock = Extract<Block, { type: "badge" }>;

const ROLE_TONE: Record<BadgeBlock["role"], string> = {
  status: "forest",
  evidence: "indigo",
  warning: "rose",
  promo: "amber",
};

export const BadgeBlockView = (props: { block: BadgeBlock }) => {
  const tone = () => ROLE_TONE[props.block.role];
  return (
    <span class={`chip ${tone()}`} data-role={props.block.role}>
      <L value={props.block.label} />
    </span>
  );
};
