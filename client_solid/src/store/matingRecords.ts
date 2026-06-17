// store/matingRecords.ts — Bloodline 交配記録 (P4-22)
//
// Bloodline ページの「+ 交配記録」モーダルから保存された記録を保持する signal。
// POC なので localStorage 永続化のみ (サーバー連携は未実装)。
//
// 保存内容:
//   - fatherId / motherId (Bloodline Individual の id)
//   - date: YYYY-MM-DD (既定 = 保存した当日)
//   - note: 自由記述 (任意)
//   - createdAt: ISO 8601
//
// 非破壊の追加のみ (編集 / 削除はモーダル仕様外)。
// 表示側は listMatingRecords() / matingRecordCount() を購読すれば reactive に更新される。
import { createMemo, createSignal } from "solid-js";
import { LS_KEYS, readJSON, writeJSON } from "../api/storage";

export interface MatingRecord {
  id: string;
  fatherId: string;
  motherId: string;
  /** YYYY-MM-DD */
  date: string;
  note?: string;
  /** ISO 8601 タイムスタンプ */
  createdAt: string;
}

const [records, setRecords] = createSignal<MatingRecord[]>(
  readJSON<MatingRecord[]>(LS_KEYS.matingRecords, []),
);

/** 新→古 でソートされた一覧 (signal) */
export const listMatingRecords = createMemo(() =>
  [...records()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
);
export const matingRecordCount = createMemo(() => records().length);

/** 新規追加。id / createdAt は自動採番。 */
export interface AddMatingInput {
  fatherId: string;
  motherId: string;
  date: string;
  note?: string;
}

/** 衝突しにくい擬似 ID (timestamp + 乱数 4 桁)。 */
const nextId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 10000)
    .toString(36)
    .padStart(3, "0");
  return `mr_${ts}_${rand}`;
};

export const addMatingRecord = (input: AddMatingInput): MatingRecord => {
  const rec: MatingRecord = {
    id: nextId(),
    fatherId: input.fatherId,
    motherId: input.motherId,
    date: input.date,
    note: input.note?.trim() ? input.note.trim() : undefined,
    createdAt: new Date().toISOString(),
  };
  const next = [rec, ...records()];
  setRecords(next);
  writeJSON(LS_KEYS.matingRecords, next);
  return rec;
};

/** テスト用: 全件リセット */
export const __resetMatingRecords = (): void => {
  setRecords([]);
  writeJSON(LS_KEYS.matingRecords, []);
};
