// api/logs.ts — 飼育ログの取得・追加・フィルタ
//
// ユーザが追加したログは createSignal + localStorage に保存し、
// APP_DATA のシードログとマージして返す。
// `listLogs()` などは Solid のリアクティブ追跡対象になるため、
// `addLog()` 後にコンポーネントの createMemo / createEffect が再評価される。
import { createSignal } from "solid-js";
import { APP_DATA, type LogEntry, type LogType } from "../data";
import { LS_KEYS, readJSON, writeJSON } from "./storage";

const [userLogs, setUserLogs] = createSignal<LogEntry[]>(
  readJSON<LogEntry[]>(LS_KEYS.logs, []),
);

/** ユーザ追加分 + シードログ。新しいユーザログを先頭に。 */
const allLogs = (): LogEntry[] => [...userLogs(), ...APP_DATA.logs];

export const listLogs = (): LogEntry[] => allLogs();

export const listLogsBySpecimen = (specimenId: string): LogEntry[] =>
  allLogs().filter((l) => l.specimen === specimenId);

export const listLogsByType = (type: LogType): LogEntry[] =>
  allLogs().filter((l) => l.type === type);

export interface NewLogInput {
  type: LogType;
  title: string;
  body: string;
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

export const addLog = (input: NewLogInput): LogEntry => {
  const entry: LogEntry = {
    date: input.date ?? todayISO(),
    time: input.time ?? nowHM(),
    type: input.type,
    title: input.title,
    body: input.body,
    photo: input.photo ?? false,
    specimen: input.specimen,
  };
  const next = [entry, ...userLogs()];
  setUserLogs(next);
  writeJSON(LS_KEYS.logs, next);
  return entry;
};

/** テスト用: ユーザログをクリア (localStorage も消す) */
export const __resetUserLogs = (): void => {
  setUserLogs([]);
  writeJSON(LS_KEYS.logs, []);
};
