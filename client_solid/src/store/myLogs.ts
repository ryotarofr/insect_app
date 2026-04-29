// store/myLogs.ts — login user の全 specimen 横断ログ (= /api/v1/me/logs) の reactive cache
//
// **責務**:
//   - login user の全飼育ログを 1 fetch で取得し signal に詰める
//   - `serverMyLogs()` で sync 読み (= legacy api/logs.ts の listLogs() の真値ソース)
//   - `triggerMyLogsRefresh()` でログ追加後に refire させる
//
// **設計判断**:
//   - store/specimens.ts と同じパターン: 起動時に 1 度 + login 状態変化時に再 fetch
//   - 401 は静かに [] にして toast を出さない (= anonymous は legacy adapter で空配列扱い)
//   - 5xx / network はエラー signal に詰める (= UI 側でバナー出す余地)
//   - cache は `SpecimenLogView[]` のまま保持。表示形式 (LegacyLogEntry) への正規化は
//     `api/logs.ts` 側の責務。

import { createSignal } from "solid-js";

import {
  type SpecimenLogView,
  SduiFetchError,
  fetchMyLogs,
} from "../sdui/api";

const [logs, setLogs] = createSignal<SpecimenLogView[]>([]);
const [error, setError] = createSignal<string | null>(null);

/** login user の全飼育ログ (= 時系列降順)。anonymous / 未取得は空配列。 */
export const serverMyLogs = logs;

/** 最終 fetch エラー (= 401 は除く)。 */
export const serverMyLogsError = error;

/** `/api/v1/me/logs` を 1 回叩いて signal に詰める。
 *  - 401 → cache を空配列にして静かに終了 (= anonymous)
 *  - 200 → 配列を signal に詰める
 *  - 5xx / network → error に詰めて throw */
export const refreshMyLogs = async (): Promise<SpecimenLogView[]> => {
  setError(null);
  try {
    const list = await fetchMyLogs();
    setLogs(list);
    return list;
  } catch (e) {
    if (e instanceof SduiFetchError && e.status === 401) {
      setLogs([]);
      return [];
    }
    const msg = e instanceof Error ? e.message : String(e);
    setError(msg);
    throw e;
  }
};

/** fire-and-forget で再取得。create / delete 直後の cache 同期に使う。 */
export const triggerMyLogsRefresh = (): void => {
  refreshMyLogs().catch((e) => {
    console.warn("triggerMyLogsRefresh failed:", e);
  });
};

/** logout / anonymous 遷移で cache を空に戻す。 */
export const clearMyLogs = (): void => {
  setLogs([]);
  setError(null);
};

/** テスト専用: signal にフィクスチャを直接セットする。 */
export const setMyLogsForTest = (list: SpecimenLogView[]): void => {
  setLogs(list);
};

/** テスト専用: signal をリセット。 */
export const resetMyLogsForTest = (): void => {
  setLogs([]);
  setError(null);
};
