// store/specimenLogs.ts — 1 specimen 分の飼育ログ (= /api/v1/specimens/{id}/logs) の reactive store
//
// **責務**:
//   - specimen UUID をキーにした log キャッシュを保持 (Map<specimenUuid, SpecimenLogView[]>)
//   - `refreshLogsForSpecimen(uuid)` で fetch → キャッシュ更新
//   - `serverLogsFor(uuid)` reactive accessor (= 未取得 / 該当なしは undefined)
//   - server -> mock LogEntry shape の adapter 関数も提供 (= 既存 LogTimeline / LogList を再利用)
//
// **設計判断**:
//   - cache key を specimen UUID (= internal id) にしたのは server 側 endpoint が UUID を要求するため。
//     publicId からの解決は呼び出し側 (= store/specimens.ts の findServerSpecimenByPublicId) に任せる。
//   - 401 (= public 閲覧でも anonymous OK のはず) は **発生しない設計**だが、来たら error に詰めて throw。
//     store/specimens の 401 と違って logs は anonymous でも OK の経路なので "静かな失敗" にはしない。
//   - エラー時は cache を変更しない (= 前回値維持)。失敗を localized に呼び出し側で表示できる。

import { createSignal } from "solid-js";

import {
  type SpecimenLogView,
  fetchSpecimenLogs,
} from "../sdui/api";
import type { LogEntry, LogType } from "../data";

type LogsMap = Record<string, SpecimenLogView[]>;

const [logsByUuid, setLogsByUuid] = createSignal<LogsMap>({});
const [errors, setErrors] = createSignal<Record<string, string>>({});

/** UUID 指定で server logs を取り出す (= 未取得は undefined)。 */
export const serverLogsFor = (specimenUuid: string): SpecimenLogView[] | undefined =>
  logsByUuid()[specimenUuid];

/** UUID 指定の最終 fetch エラー (= 直近の失敗があれば文字列、無ければ undefined)。 */
export const serverLogsErrorFor = (specimenUuid: string): string | undefined =>
  errors()[specimenUuid];

/** `/api/v1/specimens/{uuid}/logs` を叩いて cache に詰める。
 *  - 成功時: cache 更新 + error クリア
 *  - 失敗時: cache はそのまま (前回値維持) + error に詰めて throw
 *
 *  呼び出し側はキャッシュ参照だけで描画して、失敗時の表示は `serverLogsErrorFor()` で
 *  分岐する想定。再取得は呼び出し側で `refreshLogsForSpecimen()` を再度呼ぶ。 */
export const refreshLogsForSpecimen = async (
  specimenUuid: string,
): Promise<SpecimenLogView[]> => {
  try {
    const list = await fetchSpecimenLogs(specimenUuid);
    setLogsByUuid({ ...logsByUuid(), [specimenUuid]: list });
    // クリア (= 前回エラーがあっても回復したので消す)
    if (errors()[specimenUuid]) {
      const next = { ...errors() };
      delete next[specimenUuid];
      setErrors(next);
    }
    return list;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setErrors({ ...errors(), [specimenUuid]: msg });
    throw e;
  }
};

// ──────────────────────────────────────────────────────────────────────
// shape adapter: server SpecimenLogView → mock LogEntry
// ──────────────────────────────────────────────────────────────────────

/** server の `logType` (camelCase enum) はそのまま `LogType` と互換だが、念のため
 *  unknown が来た時のために narrow しておく。 */
const KNOWN_LOG_TYPES: ReadonlySet<LogType> = new Set([
  "weight",
  "feed",
  "mat",
  "molt",
  "observation",
] as const);

const toLogType = (raw: string): LogType =>
  (KNOWN_LOG_TYPES as Set<string>).has(raw) ? (raw as LogType) : "observation";

/** "HH:MM:SS" → "HH:MM" 表示用に短縮 (= mock 側 time フィールドは "HH:MM" 形式)。 */
const trimSeconds = (t: string | null): string => {
  if (!t) return "";
  // "HH:MM:SS" or "HH:MM:SS.fff" → "HH:MM"
  const m = t.match(/^(\d{2}:\d{2})/);
  return m ? m[1] : t;
};

/** server SpecimenLogView を **既存 LogTimeline が受け取る LogEntry** に変換する。
 *  specimen フィールドには呼び出し側が指定した display id (= mock では Specimen.id /
 *  server では publicId) を埋める (= LogTimeline の filter 互換性のため)。 */
export const toLogEntry = (
  v: SpecimenLogView,
  displaySpecimenId: string,
): LogEntry => ({
  date: v.loggedAt,
  time: trimSeconds(v.loggedAtTime ?? null),
  type: toLogType(v.logType),
  title: v.title,
  body: v.body,
  photo: v.hasPhoto,
  specimen: displaySpecimenId,
});

/** テスト専用: 全 cache をリセット。 */
export const resetSpecimenLogsForTest = (): void => {
  setLogsByUuid({});
  setErrors({});
};
