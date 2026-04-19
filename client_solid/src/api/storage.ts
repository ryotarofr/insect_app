// api/storage.ts — localStorage の JSON アダプタ
//
// SSR / テスト環境 (localStorage が未定義) や QuotaExceeded でも壊れないよう
// 全 I/O を try/catch で包む。キーはここで一元管理する。

export const LS_KEYS = {
  logs: "kochu:logs",
  memos: "kochu:specimen-memos",
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
