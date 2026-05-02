// pages/specimen/new.tsx — 個体登録ページ
//
// **配置**:
//   - エントリ: 飼育一覧の「+ 個体登録」 / マイページ「+ 新規 ▾」 / ⌘K
//   - URL クエリ ?cohort_id=:id で由来 cohort を暗黙指定
//
// **保存処理**:
//   現在は localStorage に書き込む mock。Phase 7 で server fetch に置換予定。
//   manualSpecimens (= LS_KEYS.manualSpecimens) に蓄積し、specimens 検索 mock からも参照可能にする。

import { useLocation, useNavigate } from "@solidjs/router";
import { LS_KEYS, readJSON, writeJSON } from "../../api/storage";
import { SpecimenDetailForm } from "../../components/cohort/SpecimenDetailForm";
import { showToast } from "../../store/toast";
import type { PromotedSpecimen, SpecimenDraft } from "../../types/cohort";

const nextId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 10000).toString(36).padStart(3, "0");
  return `s_${ts}_${rand}`;
};

const SPECIES_PREFIX: Record<string, string> = {
  sp_dorcus_hopei: "OO",
  sp_tarandus: "TR",
  sp_prosopocoilus: "NO",
};

const suggestPublicId = (
  speciesId: string | undefined,
  manuals: PromotedSpecimen[],
): string => {
  const prefix = `${SPECIES_PREFIX[speciesId ?? "sp_dorcus_hopei"] ?? "OO"}-${new Date().getFullYear()}-`;
  const yearItems = manuals
    .map((s) => s.publicId)
    .filter((pid) => pid.startsWith(prefix));
  let max = 0;
  for (const pid of yearItems) {
    const n = parseInt(pid.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
};

export const SpecimenNewPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const cohortIdParam = (() => {
    const params = new URLSearchParams(location.search);
    return params.get("cohort_id") ?? undefined;
  })();

  const handleSubmit = async (draft: SpecimenDraft): Promise<void> => {
    // mock 保存
    const manuals = readJSON<PromotedSpecimen[]>(LS_KEYS.manualSpecimens, []);
    const finalPublicId = draft.publicId || suggestPublicId(draft.speciesId, manuals);
    const newSpecimen: PromotedSpecimen = {
      id: nextId(),
      publicId: finalPublicId,
      name: draft.name ?? null,
      sex: draft.sex ?? null,
      stage: draft.stage ?? "larva_l3",
      weightG: draft.weightG ?? null,
      sizeMm: draft.sizeMm ?? null,
      cohortId: draft.cohortId ?? "",
      promotedFromCohortAt: new Date().toISOString(),
      notes: draft.notes ?? null,
    };
    writeJSON(LS_KEYS.manualSpecimens, [newSpecimen, ...manuals]);
    showToast({
      tone: "success",
      message: `${finalPublicId} を登録しました`,
    });
    // 単発登録は群一覧へ戻る (詳細ページが Phase 4 範囲外のため)
    navigate("/cohorts", { replace: true });
  };

  const handleCancel = () => {
    navigate(-1 as unknown as string);
  };

  // 既存 mock からの自動採番値 (フォーム初期値)
  const manuals = readJSON<PromotedSpecimen[]>(LS_KEYS.manualSpecimens, []);
  const suggested = suggestPublicId("sp_dorcus_hopei", manuals);

  return (
    <SpecimenDetailForm
      cohortId={cohortIdParam}
      defaultSpeciesId="sp_dorcus_hopei"
      suggestedPublicId={suggested}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
};
