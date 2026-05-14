// api/logs.ts — 飼育ログの取得・追加・フィルタ
//
// **責務**:
//   - `store/myLogs.ts` の `serverMyLogs()` (= /me/logs 経由) から legacy `LogEntry[]` を
//     sync で公開する
//   - `addLog()` は `postSpecimenLog` (= server POST) を叩き、成功後に myLogs を再 fetch する
//
// **anonymous の扱い**:
//   `serverMyLogs()` は anonymous で空配列。listLogs / listLogsBy* は空配列を返す。
//
// **正規化**:
//   server `SpecimenLogView` (specimenId は UUID) を legacy `LogEntry` (specimen は publicId) へ。
//   UUID → publicId 変換は `store/specimens.ts` の cache を使う。
//
// **addLog の async 化**:
//   server POST が必須なので Promise を返す形に変更。caller は await する想定。

import type { LogEntry, LogType } from "../data";
import {
  type CreateSpecimenLogRequest,
  postSpecimenLog,
} from "../sdui/api";
import { serverMyLogs, triggerMyLogsRefresh } from "../store/myLogs";
import { toLogEntry } from "../store/specimenLogs";
import {
  findServerSpecimenByPublicId,
  serverSpecimens,
} from "../store/specimens";

/** UUID → publicId 解決。serverSpecimens cache を線形探索。
 *  cache miss は UUID 文字列をそのまま返す (= filter は publicId 一致なので最低限機能)。 */
const uuidToPublicId = (uuid: string): string => {
  const list = serverSpecimens();
  if (!list) return uuid;
  return list.find((s) => s.id === uuid)?.publicId ?? uuid;
};

/** 全ログを legacy 形式で返す。anonymous / 未取得は空配列。
 *  specimen フィールドには publicId を解決して埋める (= LogTimeline の filter 互換性)。 */
const allLogs = (): LogEntry[] =>
  serverMyLogs().map((v) => toLogEntry(v, uuidToPublicId(v.specimenId)));

export const listLogs = (): LogEntry[] => allLogs();

export const listLogsBySpecimen = (specimenId: string): LogEntry[] =>
  allLogs().filter((l) => l.specimen === specimenId);

export interface NewLogInput {
  type: LogType;
  title: string;
  body: string;
  /** specimen の publicId (= "#DHH-0271")。internal UUID は本関数内で解決。 */
  specimen: string;
  /** ISO yyyy-mm-dd (省略時 today) */
  date?: string;
  /** HH:mm (省略時 now) */
  time?: string;
  photo?: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const nowHM = (d = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** ログを 1 件追加。
 *  - 内部で publicId → UUID を解決し `POST /specimens/{uuid}/logs` を叩く
 *  - 成功後に `triggerMyLogsRefresh()` で server cache を更新
 *  - publicId が未解決 (= specimens cache miss) の場合は throw */
export const addLog = async (input: NewLogInput): Promise<LogEntry> => {
  const sv = findServerSpecimenByPublicId(input.specimen);
  if (!sv) {
    throw new Error(
      `addLog: specimen not found for publicId "${input.specimen}" (specimens cache miss / not logged in)`,
    );
  }

  const date = input.date ?? todayISO();
  const time = input.time ?? nowHM();
  const photo = input.photo ?? false;

  const req: CreateSpecimenLogRequest = {
    logType: input.type,
    loggedAt: date,
    loggedAtTime: `${time}:00`,
    title: input.title,
    body: input.body,
    hasPhoto: photo,
  };
  await postSpecimenLog(sv.id, req);
  triggerMyLogsRefresh();

  return {
    date,
    time,
    type: input.type,
    title: input.title,
    body: input.body,
    photo,
    specimen: input.specimen,
  };
};
