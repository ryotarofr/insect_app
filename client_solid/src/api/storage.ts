// api/storage.ts — localStorage の JSON アダプタ
//
// SSR / テスト環境 (localStorage が未定義) や QuotaExceeded でも壊れないよう
// 全 I/O を try/catch で包む。キーはここで一元管理する。

export const LS_KEYS = {
  // PR #6 で `logs` (= 旧 ユーザ追加ログ) は server 化により削除済。
  // PR #5b で `memos` (= 旧 個体メモ) は server 化により削除済。
  /** P4-22: Bloodline 交配記録 (= 別機能、現状 client-only 永続化が残る)。 */
  matingRecords: "kochu:mating-records",
  /** Cohort Phase 1: FE-first mock data の永続化先 (= Phase 7 で削除予定)。 */
  cohorts: "kochu:cohorts-mock",
  cohortLogs: "kochu:cohort-logs-mock",
  /** Cohort Phase 1: 個体化セッション中に作成された specimens の保存。 */
  promotedSpecimens: "kochu:promoted-specimens-mock",
  /** Cohort Phase 1: 単独個体登録で作成された specimens の保存。 */
  manualSpecimens: "kochu:manual-specimens-mock",
} as const;

export const readJSON = <T>(key: string, fallback: T): T => {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writeJSON = (key: string, value: unknown): void => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // QuotaExceeded 等は握りつぶす (永続化は best-effort)
  }
};
