// components/cohort/CohortStageChip.tsx — ステージ表示用チップ
//
// stage に応じて forest / amber / indigo の色分けを返す。
// 既存 specimen 表示のチップ慣行に合わせる:
//   - 卵 / 1 齢 / 2 齢 → forest
//   - 3 齢 (個体化候補) → amber
//   - 蛹 → indigo
//   - 混合 → mute (色なし)

import { STAGE_LABEL } from "../../api/cohorts";
import type { CohortStage } from "../../types/cohort";

const STAGE_TONE: Record<CohortStage, "forest" | "amber" | "indigo" | "mute"> = {
  egg: "forest",
  larva_l1: "forest",
  larva_l2: "forest",
  larva_l3: "amber",
  pupa: "indigo",
  mixed: "mute",
};

export const CohortStageChip = (props: { stage: CohortStage }) => {
  const tone = () => STAGE_TONE[props.stage];
  return (
    <span class={`chip chip-${tone()}`} aria-label={`ステージ: ${STAGE_LABEL[props.stage]}`}>
      {STAGE_LABEL[props.stage]}
    </span>
  );
};
