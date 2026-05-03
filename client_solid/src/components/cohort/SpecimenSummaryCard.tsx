// components/cohort/SpecimenSummaryCard.tsx — 飼育一覧で使う「単独個体」カード
//
// CohortCard と同じ design language で SpecimenView を 1 件表示する。
// クリックで `/specimen/:publicId` (個体カルテ) へ遷移。
//
// **CohortCard との視覚的区別**:
//   - eyebrow に「単独」バッジを並べる (cohort には無い)
//   - 数値表示は「数量 N/M匹」ではなく「サイズ / 体重」の 2 軸メトリクス
//   - 上部の chip は cohort の「ステージ chip」相当として
//     specimen の `stage` (例: "幼虫 3齢" / "蛹" / "成虫") をテキストでそのまま出す
//
// **species 名の解決**:
//   SpecimenView は `speciesId` (例: "dhh") しか持たないので、
//   species cache (= store/species.ts) から和名を引く。未取得時は speciesId を fallback。
//
// **アーカイブ表示**:
//   archived 個体 (= isArchived=true / lifeStatus !== "active") は呼び出し側で
//   フィルタ済みの想定。本コンポーネント側で薄字化等はしない (cohort も同様)。

import { A } from "@solidjs/router";
import { Show } from "solid-js";
import { findSpeciesById } from "../../store/species";
import { specimenUrl } from "../../router";
import type { SpecimenView } from "../../sdui/api";

interface Props {
  specimen: SpecimenView;
}

const SEX_LABEL: Record<string, string> = {
  male: "♂",
  female: "♀",
  unknown: "?",
};

/** stage 文字列から chip の tone を判定する。CohortStageChip と同方針。 */
const stageTone = (stage: string): "forest" | "amber" | "indigo" | "mute" => {
  if (stage.includes("3齢")) return "amber";
  if (stage.includes("幼虫") || stage.includes("卵")) return "forest";
  if (stage.includes("蛹") || stage.includes("前蛹")) return "indigo";
  if (stage.includes("成虫")) return "indigo";
  return "mute";
};

/** life_status から状態ヒント文言を返す。active は null (= 表示しない)。 */
const lifeStatusHint = (s: SpecimenView): string | null => {
  switch (s.lifeStatus) {
    case "deceased":
      return "死亡";
    case "transferred":
      return "譲渡済";
    case "escaped":
      return "脱走";
    default:
      return null;
  }
};

export const SpecimenSummaryCard = (props: Props) => {
  const s = () => props.specimen;
  const speciesName = () =>
    findSpeciesById(s().speciesId)?.name ?? s().speciesId;
  const tone = () => stageTone(s().stage);

  return (
    <A
      href={specimenUrl(s().publicId)}
      class="cohort-card card"
      aria-label={`${s().publicId} ${s().name}`}
    >
      <div class="cohort-card__head">
        <span class="cohort-card__id mn">{s().publicId}</span>
        <span class={`chip chip-${tone()}`} aria-label={`ステージ: ${s().stage}`}>
          {s().stage}
        </span>
      </div>
      <p class="cohort-card__species ser">{s().name}</p>
      <p class="cohort-card__sub">
        {speciesName()} · {SEX_LABEL[s().sex] ?? s().sex}
        {s().generation ? ` · ${s().generation}` : ""}
      </p>
      <div class="cohort-card__count-row">
        <span class="cohort-card__count ser">
          {s().sizeMm ?? "—"}
        </span>
        <span class="cohort-card__count-suffix">mm</span>
        <span class="cohort-card__count ser" style={{ "margin-left": "16px" }}>
          {s().weightG ?? "—"}
        </span>
        <span class="cohort-card__count-suffix">g</span>
        <span
          class="mn"
          style={{
            "margin-left": "auto",
            "font-size": "10px",
            color: "var(--ink-faint)",
            "letter-spacing": "0.06em",
          }}
        >
          単独
        </span>
      </div>
      <Show when={lifeStatusHint(s())}>
        <p class="cohort-card__hint cohort-hint--mute">{lifeStatusHint(s())}</p>
      </Show>
    </A>
  );
};
