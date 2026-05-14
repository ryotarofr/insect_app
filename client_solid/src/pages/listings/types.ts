// pages/listings/types.ts — 出品 Wizard の共有型 / 定数
//
// new.tsx (= 状態を集中管理する親) と steps.tsx (= presentational なステップ群) の
// 両方から参照するため、循環 import を避けて独立ファイルに置く。

export type SellMode = "auction" | "fixed";
export type WizardStep = 1 | 2 | 3 | 4;

export const STEP_LABELS: Record<WizardStep, string> = {
  1: "個体を選ぶ",
  2: "写真と説明",
  3: "価格と販売方式",
  4: "確認 → 出品",
};
