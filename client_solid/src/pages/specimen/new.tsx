// pages/specimen/new.tsx — 個体登録ページ (Phase 7: real fetch)
//
// **配置**:
//   - エントリ: 飼育一覧の「+ 個体登録」 / マイページ「+ 新規 ▾」 / ⌘K
//   - URL クエリ ?cohort_id=:id で由来 cohort を暗黙指定 (= 現状未使用、将来用)
//
// **保存処理**:
//   `POST /api/v1/specimens` (= sdui/api::createSpecimen) を呼ぶ。
//   public_id は空送信で server 自動採番に任せる場合と、ユーザ指定値を使う場合がある。
//
// **未対応** (= 別 PR):
//   - father_id / mother_id / father_label / mother_label の指定 (= 現状の
//     POST /specimens は親情報を受け取らない。将来 endpoint 拡張が必要)

import { useLocation, useNavigate } from "@solidjs/router";
import { postSpecimen } from "../../sdui/api";
import { SpecimenDetailForm } from "../../components/cohort/SpecimenDetailForm";
import { showToast } from "../../store/toast";
import { triggerSpecimensRefresh } from "../../store/specimens";
import type { SpecimenDraft } from "../../types/cohort";

const STAGE_LABEL: Record<string, string> = {
  larva_l1: "幼虫 1齢",
  larva_l2: "幼虫 2齢",
  larva_l3: "幼虫 3齢",
  pupa: "蛹",
  adult: "成虫",
};

export const SpecimenNewPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const cohortIdParam = (() => {
    const params = new URLSearchParams(location.search);
    return params.get("cohort_id") ?? undefined;
  })();

  const handleSubmit = async (draft: SpecimenDraft): Promise<void> => {
    // 既存 createSpecimen API は public_id 必須なので、空のときはクライアント側で
    // 暫定 ID を生成する。本来は server に空送信で自動採番させたいが、現行の
    // CreateSpecimenRequest は publicId required なので暫定で client 採番。
    const finalPublicId =
      draft.publicId?.trim() || generateClientFallbackId(draft.speciesId);

    const created = await postSpecimen({
      publicId: finalPublicId,
      speciesId: draft.speciesId,
      name: draft.name ?? "(無名)",
      sex: draft.sex ?? "unknown",
      stage: STAGE_LABEL[draft.stage ?? "larva_l3"] ?? "幼虫 3齢",
      stageProgress: 0,
      sizeMm: draft.sizeMm,
      weightG: draft.weightG,
      generation: draft.generation !== undefined ? `F${draft.generation}` : undefined,
      notes: draft.notes,
    });
    showToast({
      tone: "success",
      message: `${created.publicId} を登録しました`,
    });
    // server cache 更新を促す
    triggerSpecimensRefresh();
    navigate("/cohorts", { replace: true });
  };

  const handleCancel = () => {
    navigate(-1 as unknown as string);
  };

  return (
    <SpecimenDetailForm
      cohortId={cohortIdParam}
      defaultSpeciesId="dhh"
      suggestedPublicId="(自動採番)"
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
};

/** 種 prefix (= public_id の最初 2-3 文字) を緊急採番用に組み立てる。
 *  本来 server 側で重複チェックしてユニーク採番するべきだが、現行 API は public_id を
 *  client 側で渡す必要があるため、一意性を timestamp の base36 で担保する。 */
function generateClientFallbackId(speciesId: string): string {
  const prefix = speciesId.slice(0, 3).toUpperCase();
  const year = new Date().getFullYear();
  const ts = Date.now().toString(36).slice(-5).toUpperCase();
  return `${prefix}-${year}-${ts}`;
}
