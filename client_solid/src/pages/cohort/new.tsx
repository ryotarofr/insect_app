// pages/cohort/new.tsx — 群を作成ページ
//
// **エントリ**: 飼育一覧の「+ 群を作成」 / マイページ「+ 新規 ▾」 / ⌘K
// **保存処理**: api/cohorts.ts の createCohort (= mock) を呼ぶ。成功で /cohorts/:newPublicId へ。

import { useNavigate } from "@solidjs/router";
import { CohortDetailForm } from "../../components/cohort/CohortDetailForm";
import { createCohort } from "../../store/cohorts";
import { showToast } from "../../store/toast";
import { LS_KEYS, readJSON } from "../../api/storage";
import { cohortUrl } from "../../router";
import type { CohortInsert, CohortView } from "../../types/cohort";

const todayYearLotPrefix = (): string => `LOT-${new Date().getFullYear()}-`;

const suggestLotId = (cohorts: CohortView[]): string => {
  const prefix = todayYearLotPrefix();
  let max = 0;
  for (const c of cohorts) {
    if (!c.publicId.startsWith(prefix)) continue;
    const n = parseInt(c.publicId.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
};

// mock 親交配選択肢 (Phase 1 mock では mating_records 統合は未対応)
const MATING_OPTIONS = [
  {
    id: "M-2026-003",
    label: "#M-2026-003 — ♂85.3 × ♀54.1 (能勢 YG, 04/22)",
  },
  {
    id: "M-2026-002",
    label: "#M-2026-002 — ♂78.0 × ♀51.3 (川西, 04/15)",
  },
  {
    id: "M-2026-001",
    label: "#M-2026-001 — ♂82.5 × ♀53.2 (久留米, 04/08)",
  },
];

export const CohortNewPage = () => {
  const navigate = useNavigate();

  const cohorts = readJSON<CohortView[]>(LS_KEYS.cohorts, []);
  const suggested = suggestLotId(cohorts);

  const handleSubmit = async (input: CohortInsert): Promise<void> => {
    const created = await createCohort(input);
    showToast({
      tone: "success",
      message: `${created.publicId} を作成しました`,
    });
    navigate(cohortUrl(created.publicId), { replace: true });
  };

  const handleCancel = () => {
    navigate("/cohorts", { replace: true });
  };

  return (
    <CohortDetailForm
      suggestedPublicId={suggested}
      matingOptions={MATING_OPTIONS}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
};
