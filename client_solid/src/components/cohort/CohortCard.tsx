// components/cohort/CohortCard.tsx — 飼育一覧で使う群カード
//
// 既存 specimen card の設計言語を踏襲:
//   - 上部: mono LOT ID (eyebrow) + ステージチップ
//   - 中央: serif 種名 + italic 系統 / 経過日
//   - 下部: 大型 serif 数値 + 状態テキスト
//   - クリックで群詳細へ遷移
//
// 「個体化推奨」「観察推奨」などの状態テキストは現状を表す簡易ヒント (mock)。

import { A } from "@solidjs/router";
import { Show } from "solid-js";
import { CohortStageChip } from "./CohortStageChip";
import { findSpeciesById } from "../../store/species";
import type { CohortView } from "../../types/cohort";
import { cohortUrl } from "../../router";

interface Props {
  cohort: CohortView;
}

const daysSince = (iso: string): number => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = today.getTime() - d.getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
};

const statusHint = (cohort: CohortView): string | null => {
  if (cohort.archivedAt) return "完了";
  if (cohort.stage === "larva_l3") return "個体化推奨";
  if (cohort.stage === "pupa") return "観察推奨";
  if (cohort.stage === "egg" && cohort.currentCount === 0) return "孵化前";
  return null;
};

const statusTone = (cohort: CohortView): "amber" | "indigo" | "mute" => {
  if (cohort.archivedAt) return "mute";
  if (cohort.stage === "larva_l3") return "amber";
  if (cohort.stage === "pupa") return "indigo";
  return "mute";
};

export const CohortCard = (props: Props) => {
  const c = () => props.cohort;
  return (
    <A
      href={cohortUrl(c().publicId)}
      class="cohort-card card"
      aria-label={`${c().publicId} ${c().speciesName ?? c().speciesId}`}
    >
      <div class="cohort-card__head">
        <span class="cohort-card__id mn">#{c().publicId}</span>
        <CohortStageChip stage={c().stage} />
      </div>
      <p class="cohort-card__species ser">
        {c().speciesName ?? findSpeciesById(c().speciesId)?.name ?? c().speciesId}
      </p>
      <p class="cohort-card__sub">
        {c().bloodlineName ? `${c().bloodlineName} · ` : ""}
        {daysSince(c().startDate)} 日経過
      </p>
      <div class="cohort-card__count-row">
        <span class="cohort-card__count ser">{c().currentCount}</span>
        <span class="cohort-card__count-suffix">
          / {c().initialCount} 匹
        </span>
      </div>
      <Show when={statusHint(c())}>
        <p class={`cohort-card__hint cohort-hint--${statusTone(c())}`}>
          {statusHint(c())}
        </p>
      </Show>
    </A>
  );
};
