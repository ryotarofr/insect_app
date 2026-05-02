// store/cohorts.ts — cohort signal store (FE-first / mock 駆動)
//
// **責務**:
//   - api/cohorts.ts から取得した CohortView[] を signal で保持
//   - 一覧の refresh / 詳細取得 / promote / archive のラッパを提供
//   - 個体化セッション中の状態 (promoteSession) も module-scope signal で管理
//
// **現状の永続化**:
//   api/cohorts.ts の mock 層が localStorage に書く。本 store は単に in-memory cache。
//   Phase 7 で server 駆動に切り替わるが、署名は変えない。
//
// **store/specimens.ts との違い**:
//   specimens は SDUI fetch 直接呼出。本 store は mock 経由なので CohortView を
//   そのまま保存する (= 正規化レイヤなし)。

import { createMemo, createSignal } from "solid-js";

import {
  archiveCohort as apiArchiveCohort,
  createCohort as apiCreateCohort,
  getCohort as apiGetCohort,
  listCohorts as apiListCohorts,
  promoteFromCohort as apiPromoteFromCohort,
} from "../api/cohorts";
import type {
  CohortDetailView,
  CohortInsert,
  CohortView,
  PromoteCohortRequest,
  PromoteCohortResponse,
} from "../types/cohort";

// ──────────────────────────────────────────────────────────────────────
// 一覧 cache (= GET /cohorts/me)
// ──────────────────────────────────────────────────────────────────────

const [cohorts, setCohorts] = createSignal<CohortView[] | null>(null);
const [isListLoading, setIsListLoading] = createSignal(false);
const [listError, setListError] = createSignal<string | null>(null);

/** 全 cohort (active + archived 混在)。`null` = 未取得。 */
export const allCohorts = cohorts;
export const isCohortListLoading = isListLoading;
export const cohortListError = listError;

/** active な cohort のみ */
export const activeCohorts = createMemo<CohortView[]>(() => {
  const all = cohorts();
  if (!all) return [];
  return all.filter((c) => !c.archivedAt);
});

/** archived な cohort のみ */
export const archivedCohorts = createMemo<CohortView[]>(() => {
  const all = cohorts();
  if (!all) return [];
  return all.filter((c) => c.archivedAt);
});

/** 一覧を取り直す (= GET /cohorts/me 相当) */
export async function refreshCohorts(): Promise<void> {
  setIsListLoading(true);
  setListError(null);
  try {
    const rows = await apiListCohorts();
    setCohorts(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setListError(msg);
    console.warn("refreshCohorts failed:", err);
  } finally {
    setIsListLoading(false);
  }
}

/** 一覧 cache を localStorage 値で seed する (Phase 1 の起動時用) */
export function seedCohortsFromLocalStorage(): void {
  if (cohorts() !== null) return;
  void refreshCohorts();
}

// ──────────────────────────────────────────────────────────────────────
// 詳細 (active な cohort 詳細画面用)
// ──────────────────────────────────────────────────────────────────────

const [detail, setDetail] = createSignal<CohortDetailView | null>(null);
const [detailLoading, setDetailLoading] = createSignal(false);
const [detailError, setDetailError] = createSignal<string | null>(null);

export const cohortDetail = detail;
export const isCohortDetailLoading = detailLoading;
export const cohortDetailError = detailError;

export async function loadCohortDetail(publicId: string): Promise<void> {
  setDetailLoading(true);
  setDetailError(null);
  try {
    const view = await apiGetCohort(publicId);
    setDetail(view);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setDetailError(msg);
    console.warn("loadCohortDetail failed:", err);
    setDetail(null);
  } finally {
    setDetailLoading(false);
  }
}

export function clearCohortDetail(): void {
  setDetail(null);
  setDetailError(null);
}

// ──────────────────────────────────────────────────────────────────────
// mutation: 作成 / アーカイブ / 個体化
// ──────────────────────────────────────────────────────────────────────

/** 群を新規作成。成功すると一覧 cache を refresh。 */
export async function createCohort(input: CohortInsert): Promise<CohortView> {
  const created = await apiCreateCohort(input);
  await refreshCohorts();
  return created;
}

/** 個体化 1 件。成功すると detail / 一覧 cache を refresh。 */
export async function promoteFromCohort(
  cohortPublicId: string,
  payload: PromoteCohortRequest,
): Promise<PromoteCohortResponse> {
  const res = await apiPromoteFromCohort(cohortPublicId, payload);
  // 詳細 cache を refresh (= cohort の current_count や archivedAt を最新に)
  if (detail() && detail()!.publicId === cohortPublicId) {
    await loadCohortDetail(cohortPublicId);
  }
  // 一覧 cache も同期
  await refreshCohorts();
  return res;
}

/** アーカイブ (= 中断時の手動 archived 化)。 */
export async function archiveCohort(
  cohortPublicId: string,
): Promise<CohortView> {
  const updated = await apiArchiveCohort(cohortPublicId);
  if (detail() && detail()!.publicId === cohortPublicId) {
    await loadCohortDetail(cohortPublicId);
  }
  await refreshCohorts();
  return updated;
}

// ──────────────────────────────────────────────────────────────────────
// 個体化セッション state (`/cohorts/:id/promote` 滞在中の揮発 state)
// ──────────────────────────────────────────────────────────────────────

export interface PromoteSessionState {
  cohortPublicId: string;
  /** セッション開始時の current_count (= 母数) */
  denominator: number;
  /** 今回のセッションで個体化された件数 */
  promotedCount: number;
  /** 直近個体化された specimens (新→古) */
  recentlyPromoted: Array<{
    publicId: string;
    weightG: number | null;
    sizeMm: number | null;
    promotedAt: string;
  }>;
  status: "active" | "completing" | "completed" | "interrupted";
}

const [session, setSession] = createSignal<PromoteSessionState | null>(null);
export const promoteSession = session;

export function startPromoteSession(
  cohortPublicId: string,
  denominator: number,
): void {
  setSession({
    cohortPublicId,
    denominator,
    promotedCount: 0,
    recentlyPromoted: [],
    status: "active",
  });
}

export function recordPromotion(
  res: PromoteCohortResponse,
): void {
  const cur = session();
  if (!cur) return;
  // server は session 情報を持たないので FE 側でカウンタを加算する。
  // res.session.promotedCountInSession は存在しないので FE のローカル値 +1 を使う。
  const nextCount = cur.promotedCount + 1;
  setSession({
    ...cur,
    promotedCount: nextCount,
    recentlyPromoted: [
      {
        publicId: res.specimen.publicId,
        weightG: res.specimen.weightG,
        sizeMm: res.specimen.sizeMm,
        promotedAt: res.specimen.promotedFromCohortAt,
      },
      ...cur.recentlyPromoted,
    ].slice(0, 50),
    status: res.session.completed ? "completing" : "active",
  });
}

export function markSessionCompleted(): void {
  const cur = session();
  if (!cur) return;
  setSession({ ...cur, status: "completed" });
}

export function markSessionInterrupted(): void {
  const cur = session();
  if (!cur) return;
  setSession({ ...cur, status: "interrupted" });
}

export function endPromoteSession(): void {
  setSession(null);
}

// ──────────────────────────────────────────────────────────────────────
// テスト専用: signal を全て空に戻す
// ──────────────────────────────────────────────────────────────────────

/** Vitest beforeEach で並列テスト間の漏れを防ぐためのリセット。 */
export function resetCohortStoreForTest(): void {
  setCohorts(null);
  setIsListLoading(false);
  setListError(null);
  setDetail(null);
  setDetailLoading(false);
  setDetailError(null);
  setSession(null);
}
