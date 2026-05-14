// api/storage.ts — localStorage の JSON アダプタ
//
// SSR / テスト環境 (localStorage が未定義) や QuotaExceeded でも壊れないよう
// 全 I/O を try/catch で包む。キーはここで一元管理する。

export const LS_KEYS = {
  /** P4-22: Bloodline 交配記録 (= 別機能、現状 client-only 永続化が残る)。 */
  matingRecords: "kochu:mating-records",
  /** FE-first mock data の永続化先。TODO: server 駆動に切り替えたら削除。 */
  cohorts: "kochu:cohorts-mock",
  cohortLogs: "kochu:cohort-logs-mock",
  /** 個体化セッション中に作成された specimens の保存。 */
  promotedSpecimens: "kochu:promoted-specimens-mock",
  /** 単独個体登録で作成された specimens の保存。 */
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
