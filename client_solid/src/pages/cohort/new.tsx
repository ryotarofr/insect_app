// pages/cohort/new.tsx — 群を作成ページ
//
// **エントリ**: 飼育一覧の「+ 群を作成」 / マイページ「+ 新規 ▾」 / ⌘K
// **保存処理**: api/cohorts.ts の createCohort を呼ぶ。成功で /cohorts/:newPublicId へ。
//
// **LOT ID**: 空送信で server 側 (= handlers::cohorts::generate_lot_id) が
//   `LOT-{YYYY}-NNNN` を採番する。FE では「(自動採番)」placeholder を表示するだけ。

import { useNavigate } from "@solidjs/router";
import { CohortDetailForm } from "../../components/cohort/CohortDetailForm";
import { createCohort } from "../../store/cohorts";
import { showToast } from "../../store/toast";
import { cohortUrl } from "../../router";
import type { CohortInsert } from "../../types/cohort";

// mock 親交配選択肢 (mating_records 統合は未対応)
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

  const handleSubmit = async (input: CohortInsert): Promise<void> => {
    // publicId が空文字なら server 採番に任せる (= undefined にして送信しない)
    const payload = {
      ...input,
      publicId: input.publicId?.trim() ? input.publicId : undefined,
    };
    const created = await createCohort(payload);
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
      suggestedPublicId="(自動採番)"
      matingOptions={MATING_OPTIONS}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
};
