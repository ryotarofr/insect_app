// api/cohorts.ts — cohort ドメインの API 層
//
// 実 BE に fetch する。関数 signature は呼び出し側 (= store/cohorts.ts) と固定。
//
// **エラー扱い**:
//   `SduiFetchError` (status / body 付き) を throw する。
//   呼び出し側は status で 401 (未ログイン) や 404 / 409 を判別できる。
//
// **未対応**:
//   - TODO: 楽観 lock 競合 (cohorts.version) 時の自動 refresh

import { fetchJson, SduiFetchError } from "../sdui/api";
import type {
  CohortDetailView,
  CohortInsert,
  CohortLogType,
  CohortLogView,
  CohortStage,
  CohortView,
  PromoteCohortRequest,
  PromoteCohortResponse,
  PromotedSpecimen,
} from "../types/cohort";

// SduiFetchError を再エクスポート (= mock 時代の MockNetworkError 相当)。
export { SduiFetchError } from "../sdui/api";

/** 後方互換: 旧 mock 時代の `MockNetworkError` 名前で import している箇所向け。 */
export type MockNetworkError = SduiFetchError;

// ──────────────────────────────────────────────────────────────────────
// API 関数 (= mock 時代と signature 同一)
// ──────────────────────────────────────────────────────────────────────

/** GET /cohorts/me — アクティブ + アーカイブ両方を返す (UI 側でフィルタ) */
export async function listCohorts(): Promise<CohortView[]> {
  // ?archived=true で archived も含めて返してもらう
  return fetchJson<CohortView[]>("/cohorts/me?archived=true");
}

/** GET /cohorts/{publicId} */
export async function getCohort(publicId: string): Promise<CohortDetailView> {
  const safe = encodeURIComponent(publicId);
  return fetchJson<CohortDetailView>(`/cohorts/${safe}`);
}

/** POST /cohorts */
export async function createCohort(input: CohortInsert): Promise<CohortView> {
  // server は { id, public_id } のみ返すので、後追いで GET /cohorts/{publicId} する
  const created = await fetchJson<{ id: string; publicId: string }>(`/cohorts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  // 一覧表示に必要な詳細を取り直す
  const detail = await getCohort(created.publicId);
  // CohortDetailView は CohortView のスーパーセットなので、recentLogs / promotedSpecimensCount を落として返す
  const { recentLogs: _logs, promotedSpecimensCount: _count, ...view } = detail;
  return view;
}

/** POST /cohorts/{publicId}/promote — 個体化 1 件 (transactional) */
export async function promoteFromCohort(
  cohortPublicId: string,
  payload: PromoteCohortRequest,
): Promise<PromoteCohortResponse> {
  const safe = encodeURIComponent(cohortPublicId);
  return fetchJson<PromoteCohortResponse>(`/cohorts/${safe}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** POST /cohorts/{publicId}/archive */
export async function archiveCohort(
  cohortPublicId: string,
): Promise<CohortView> {
  const safe = encodeURIComponent(cohortPublicId);
  return fetchJson<CohortView>(`/cohorts/${safe}/archive`, {
    method: "POST",
  });
}

/**
 * GET /cohorts/{publicId}/promoted_specimens は未実装 (= server 側で endpoint 未提供)。
 * 代わりに /cohorts/{publicId} の detail から `promotedSpecimensCount` を見れば足りる。
 * 個別 specimens の一覧が必要になれば `/specimens?cohort_id=:id` の追加が必要。
 *
 * 本関数はスタブで空配列を返す。
 */
export async function listPromotedFromCohort(
  _cohortPublicId: string,
): Promise<PromotedSpecimen[]> {
  return [];
}

/** POST /cohorts/{publicId}/cohort_logs — 群ログ追加 (一括ログ用) */
export async function addCohortLog(
  cohortPublicId: string,
  log: {
    logType: CohortLogType;
    body?: string;
    metrics?: Record<string, unknown>;
    countDelta?: number;
  },
): Promise<CohortLogView> {
  const safe = encodeURIComponent(cohortPublicId);
  return fetchJson<CohortLogView>(`/cohorts/${safe}/cohort_logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(log),
  });
}

// ──────────────────────────────────────────────────────────────────────
// UI 表示用ヘルパ (= mock 時代から維持)
// ──────────────────────────────────────────────────────────────────────

export const STAGE_LABEL: Record<CohortStage, string> = {
  egg: "卵",
  larva_l1: "1 齢",
  larva_l2: "2 齢",
  larva_l3: "3 齢",
  pupa: "蛹",
  mixed: "混合",
};

/** mock リセットは不要 (= 実 DB が真値)。後方互換のため空 stub を残す。 */
export const __resetCohortMocks = (): void => {
  // no-op
};
