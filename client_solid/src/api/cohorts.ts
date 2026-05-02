// api/cohorts.ts — cohort ドメインの mock API 層 (FE-first)
//
// **Phase 1 の責務**:
//   - cohort / cohort_log / 個体化 (promote) の操作を localStorage で擬似的に提供
//   - すべての関数は `Promise<T>` を返し、Phase 7 で実 fetch に差し替え可能
//   - 300ms の意図的遅延 + 1% のネットワークエラーで lifelike な振る舞いを再現
//
// **Phase 7 への移行戦略**:
//   関数シグネチャを保ったまま内部実装を `fetch('/api/v1/cohorts/...')` に置換すれば、
//   呼び出し側 (= store/cohorts.ts, ページコンポーネント) は変更不要。
//
// **データモデル**:
//   types/cohort.ts の interface に揃えている。BE が ts-rs export を吐いたあと、
//   `generated/api-types.ts` から import する形に切り替え予定。

import { LS_KEYS, readJSON, writeJSON } from "./storage";
import type {
  CohortDetailView,
  CohortInsert,
  CohortLogView,
  CohortStage,
  CohortView,
  PromoteCohortRequest,
  PromoteCohortResponse,
  PromotedSpecimen,
} from "../types/cohort";

// ──────────────────────────────────────────────────────────────────────
// Mock helpers (= Phase 7 で削除)
// ──────────────────────────────────────────────────────────────────────

/** 意図的なネットワーク遅延 (300ms)。実 BE 接続時の体感を再現する。 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 1% の確率で擬似ネットワークエラーを発生させ、エラー UI も検証可能にする。 */
const FAILURE_RATE = 0.01;
const maybeFail = (op: string): void => {
  if (Math.random() < FAILURE_RATE) {
    throw new MockNetworkError(op);
  }
};

export class MockNetworkError extends Error {
  constructor(op: string) {
    super(`mock network error during ${op}`);
    this.name = "MockNetworkError";
  }
}

/** 衝突しにくい id (timestamp + 乱数) */
const nextId = (prefix: string): string => {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 10000)
    .toString(36)
    .padStart(3, "0");
  return `${prefix}_${ts}_${rand}`;
};

const isoNow = (): string => new Date().toISOString();

// ──────────────────────────────────────────────────────────────────────
// LOT ID 採番 (mock)
// ──────────────────────────────────────────────────────────────────────

const lotIdFromCohorts = (cohorts: CohortView[]): string => {
  const year = new Date().getFullYear();
  const prefix = `LOT-${year}-`;
  const yearLots = cohorts
    .map((c) => c.publicId)
    .filter((pid) => pid.startsWith(prefix));
  let max = 0;
  for (const pid of yearLots) {
    const n = parseInt(pid.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
};

const specimenIdFromExisting = (
  manualSpecimens: PromotedSpecimen[],
  promoted: PromotedSpecimen[],
  speciesPrefix: string,
): string => {
  const year = new Date().getFullYear();
  const prefix = `${speciesPrefix}-${year}-`;
  const all = [...manualSpecimens, ...promoted].map((s) => s.publicId);
  const yearItems = all.filter((pid) => pid.startsWith(prefix));
  let max = 0;
  for (const pid of yearItems) {
    const n = parseInt(pid.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
};

// ──────────────────────────────────────────────────────────────────────
// 初期サンプルデータ (mock 起動時の seed)
// ──────────────────────────────────────────────────────────────────────

const today = (): string => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const SEED_COHORTS: CohortView[] = [
  {
    id: "c_seed_001",
    publicId: "LOT-2026-0007",
    ownerUserId: "u_self",
    speciesId: "sp_dorcus_hopei",
    speciesName: "国産オオクワガタ",
    bloodlineName: "能勢 YG",
    originKind: "egg_lay",
    parentMatingId: null,
    initialCount: 100,
    currentCount: 100,
    stage: "larva_l3",
    startDate: daysAgo(74),
    notes: "4/22 の産卵セットから割出",
    archivedAt: null,
    version: 0,
    createdAt: daysAgo(74) + "T08:00:00Z",
    updatedAt: daysAgo(2) + "T19:30:00Z",
  },
  {
    id: "c_seed_002",
    publicId: "LOT-2026-0009",
    ownerUserId: "u_self",
    speciesId: "sp_dorcus_hopei",
    speciesName: "国産オオクワガタ",
    bloodlineName: "川西",
    originKind: "egg_lay",
    parentMatingId: null,
    initialCount: 30,
    currentCount: 28,
    stage: "pupa",
    startDate: daysAgo(130),
    notes: null,
    archivedAt: null,
    version: 0,
    createdAt: daysAgo(130) + "T08:00:00Z",
    updatedAt: daysAgo(5) + "T10:15:00Z",
  },
  {
    id: "c_seed_003",
    publicId: "LOT-2026-0011",
    ownerUserId: "u_self",
    speciesId: "sp_tarandus",
    speciesName: "タランドゥス",
    bloodlineName: null,
    originKind: "egg_lay",
    parentMatingId: null,
    initialCount: 100,
    currentCount: 0,
    stage: "egg",
    startDate: daysAgo(12),
    notes: null,
    archivedAt: null,
    version: 0,
    createdAt: daysAgo(12) + "T08:00:00Z",
    updatedAt: daysAgo(12) + "T08:00:00Z",
  },
  {
    id: "c_seed_004",
    publicId: "LOT-2026-0014",
    ownerUserId: "u_self",
    speciesId: "sp_prosopocoilus",
    speciesName: "国産ノコギリ",
    bloodlineName: null,
    originKind: "field_collected",
    parentMatingId: null,
    initialCount: 50,
    currentCount: 42,
    stage: "larva_l2",
    startDate: daysAgo(42),
    notes: "群馬県採集",
    archivedAt: null,
    version: 0,
    createdAt: daysAgo(42) + "T08:00:00Z",
    updatedAt: daysAgo(8) + "T17:20:00Z",
  },
];

const SEED_COHORT_LOGS: CohortLogView[] = [
  {
    id: "cl_seed_001",
    cohortId: "c_seed_001",
    logType: "mat",
    countDelta: null,
    metrics: { scope: "all" },
    loggedAt: daysAgo(4) + "T09:00:00Z",
    authorUserId: "u_self",
    body: "全数マット交換",
  },
  {
    id: "cl_seed_002",
    cohortId: "c_seed_001",
    logType: "feed",
    countDelta: null,
    metrics: { scope: "all" },
    loggedAt: daysAgo(10) + "T08:30:00Z",
    authorUserId: "u_self",
    body: "餌交換 + 観察",
  },
  {
    id: "cl_seed_003",
    cohortId: "c_seed_001",
    logType: "observation",
    countDelta: null,
    metrics: { tag: "promote_candidate" },
    loggedAt: daysAgo(17) + "T11:15:00Z",
    authorUserId: "u_self",
    body: "個体化候補マーク",
  },
];

// ──────────────────────────────────────────────────────────────────────
// localStorage I/O ラッパ
// ──────────────────────────────────────────────────────────────────────

const loadCohorts = (): CohortView[] =>
  readJSON<CohortView[]>(LS_KEYS.cohorts, SEED_COHORTS);
const saveCohorts = (rows: CohortView[]): void =>
  writeJSON(LS_KEYS.cohorts, rows);

const loadCohortLogs = (): CohortLogView[] =>
  readJSON<CohortLogView[]>(LS_KEYS.cohortLogs, SEED_COHORT_LOGS);
const saveCohortLogs = (rows: CohortLogView[]): void =>
  writeJSON(LS_KEYS.cohortLogs, rows);

const loadPromoted = (): PromotedSpecimen[] =>
  readJSON<PromotedSpecimen[]>(LS_KEYS.promotedSpecimens, []);
const savePromoted = (rows: PromotedSpecimen[]): void =>
  writeJSON(LS_KEYS.promotedSpecimens, rows);

const loadManual = (): PromotedSpecimen[] =>
  readJSON<PromotedSpecimen[]>(LS_KEYS.manualSpecimens, []);
const saveManual = (rows: PromotedSpecimen[]): void =>
  writeJSON(LS_KEYS.manualSpecimens, rows);

// ──────────────────────────────────────────────────────────────────────
// API 関数 (Promise シグネチャ) — Phase 7 で fetch 実装に置換
// ──────────────────────────────────────────────────────────────────────

/** GET /cohorts/me 相当。アクティブとアーカイブを混ぜて返し、UI 側で filter する。 */
export async function listCohorts(): Promise<CohortView[]> {
  await sleep(300);
  maybeFail("listCohorts");
  return loadCohorts();
}

/** GET /cohorts/:publicId 相当。 */
export async function getCohort(publicId: string): Promise<CohortDetailView> {
  await sleep(300);
  maybeFail("getCohort");
  const cohorts = loadCohorts();
  const found = cohorts.find((c) => c.publicId === publicId);
  if (!found) {
    throw new Error(`cohort not found: ${publicId}`);
  }
  const logs = loadCohortLogs()
    .filter((l) => l.cohortId === found.id)
    .sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : -1));
  const promotedSpecimensCount = loadPromoted().filter(
    (s) => s.cohortId === found.id,
  ).length;
  return { ...found, recentLogs: logs.slice(0, 10), promotedSpecimensCount };
}

/** POST /cohorts 相当。 */
export async function createCohort(input: CohortInsert): Promise<CohortView> {
  await sleep(300);
  maybeFail("createCohort");
  const existing = loadCohorts();
  const newCohort: CohortView = {
    id: nextId("c"),
    publicId: input.publicId ?? lotIdFromCohorts(existing),
    ownerUserId: "u_self",
    speciesId: input.speciesId,
    speciesName: undefined,
    bloodlineName: input.bloodlineName,
    originKind: input.originKind,
    parentMatingId: input.parentMatingId ?? null,
    initialCount: input.initialCount,
    currentCount: input.initialCount,
    stage: input.stage,
    startDate: input.startDate,
    notes: input.notes ?? null,
    archivedAt: null,
    version: 0,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
  saveCohorts([newCohort, ...existing]);
  return newCohort;
}

/** POST /cohorts/:publicId/promote 相当。1 トランザクションで個体化を 1 件処理。 */
export async function promoteFromCohort(
  cohortPublicId: string,
  payload: PromoteCohortRequest,
): Promise<PromoteCohortResponse> {
  await sleep(300);
  maybeFail("promoteFromCohort");

  const cohorts = loadCohorts();
  const idx = cohorts.findIndex((c) => c.publicId === cohortPublicId);
  if (idx < 0) throw new Error(`cohort not found: ${cohortPublicId}`);
  const cohort = cohorts[idx];
  if (cohort.archivedAt) throw new Error("cohort already archived");
  if (cohort.currentCount <= 0) throw new Error("cohort empty");

  // 種 prefix の自動採番 (mock では単純に "OO" 固定。Phase 7 で species master から引く)
  const speciesPrefix = "OO";
  const promoted = loadPromoted();
  const manual = loadManual();
  const newPublicId =
    payload.specimen.publicId ??
    specimenIdFromExisting(manual, promoted, speciesPrefix);

  const newSpecimen: PromotedSpecimen = {
    id: nextId("s"),
    publicId: newPublicId,
    name: payload.specimen.name ?? null,
    sex: payload.specimen.sex ?? null,
    stage: payload.specimen.stage ?? "larva_l3",
    weightG: payload.specimen.weightG ?? null,
    sizeMm: payload.specimen.sizeMm ?? null,
    cohortId: cohort.id,
    promotedFromCohortAt: isoNow(),
    notes: payload.specimen.notes ?? null,
  };
  savePromoted([newSpecimen, ...promoted]);

  const nextCount = cohort.currentCount - 1;
  const updatedCohort: CohortView = {
    ...cohort,
    currentCount: nextCount,
    archivedAt: nextCount === 0 ? isoNow() : cohort.archivedAt,
    version: cohort.version + 1,
    updatedAt: isoNow(),
  };
  cohorts[idx] = updatedCohort;
  saveCohorts(cohorts);

  // セッションでの promotion 数を計算 (= cohort の current_count 開始値からの差分)
  const promotedThisSession = promoted.filter(
    (s) => s.cohortId === cohort.id,
  ).length;

  return {
    specimen: newSpecimen,
    cohort: updatedCohort,
    session: {
      promotedCountInSession: promotedThisSession + 1,
      remainingInCohort: nextCount,
      completed: nextCount === 0,
    },
  };
}

/** POST /cohorts/:publicId/archive 相当 (= 中断時に手動で archived 化)。 */
export async function archiveCohort(
  cohortPublicId: string,
): Promise<CohortView> {
  await sleep(300);
  maybeFail("archiveCohort");
  const cohorts = loadCohorts();
  const idx = cohorts.findIndex((c) => c.publicId === cohortPublicId);
  if (idx < 0) throw new Error(`cohort not found: ${cohortPublicId}`);
  const next: CohortView = {
    ...cohorts[idx],
    archivedAt: isoNow(),
    version: cohorts[idx].version + 1,
    updatedAt: isoNow(),
  };
  cohorts[idx] = next;
  saveCohorts(cohorts);
  return next;
}

/** GET /cohorts/:publicId/promoted_specimens 相当。 */
export async function listPromotedFromCohort(
  cohortPublicId: string,
): Promise<PromotedSpecimen[]> {
  await sleep(150);
  const cohort = loadCohorts().find((c) => c.publicId === cohortPublicId);
  if (!cohort) return [];
  return loadPromoted()
    .filter((s) => s.cohortId === cohort.id)
    .sort((a, b) =>
      a.promotedFromCohortAt < b.promotedFromCohortAt ? 1 : -1,
    );
}

/** POST /cohorts/:publicId/cohort_logs 相当 (= 一括ログ用)。 */
export async function addCohortLog(
  cohortPublicId: string,
  log: {
    logType: CohortLogView["logType"];
    body?: string;
    metrics?: Record<string, unknown>;
    countDelta?: number;
  },
): Promise<CohortLogView> {
  await sleep(300);
  maybeFail("addCohortLog");
  const cohort = loadCohorts().find((c) => c.publicId === cohortPublicId);
  if (!cohort) throw new Error(`cohort not found: ${cohortPublicId}`);
  const newLog: CohortLogView = {
    id: nextId("cl"),
    cohortId: cohort.id,
    logType: log.logType,
    countDelta: log.countDelta ?? null,
    metrics: log.metrics ?? null,
    loggedAt: isoNow(),
    authorUserId: "u_self",
    body: log.body ?? null,
  };
  const all = loadCohortLogs();
  saveCohortLogs([newLog, ...all]);
  return newLog;
}

/** ユーティリティ: 型は CohortStage stages と表示名の対応 (UI 用) */
export const STAGE_LABEL: Record<CohortStage, string> = {
  egg: "卵",
  larva_l1: "1 齢",
  larva_l2: "2 齢",
  larva_l3: "3 齢",
  pupa: "蛹",
  mixed: "混合",
};

/** mock リセット (テスト / 手動初期化用) */
export const __resetCohortMocks = (): void => {
  saveCohorts(SEED_COHORTS);
  saveCohortLogs(SEED_COHORT_LOGS);
  savePromoted([]);
  saveManual([]);
};
