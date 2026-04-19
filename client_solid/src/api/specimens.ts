// api/specimens.ts — 個体 (Specimen) の取得 + 羽化予測 + メモ永続化
//
// 個体メモ (notes) は localStorage 側の上書きを優先し、未編集の個体は
// APP_DATA の seed をそのまま返す。reactive な signal を経由するので、
// updateSpecimenMemo() 後にコンポーネントは自動更新される。
import { createSignal } from "solid-js";
import { APP_DATA, type Specimen } from "../data";
import { LS_KEYS, readJSON, writeJSON } from "./storage";

type MemoMap = Record<string, string>;

const [memos, setMemos] = createSignal<MemoMap>(
  readJSON<MemoMap>(LS_KEYS.memos, {}),
);

/** 編集済みメモがあれば notes を上書きした個体を返す。なければ参照そのまま。 */
const applyMemo = (s: Specimen): Specimen => {
  const m = memos()[s.id];
  return m !== undefined ? { ...s, notes: m } : s;
};

export const listSpecimens = (): Specimen[] =>
  APP_DATA.specimens.map(applyMemo);

export const getSpecimen = (id: string): Specimen | undefined => {
  const s = APP_DATA.specimens.find((x) => x.id === id);
  return s ? applyMemo(s) : undefined;
};

export const specimenExists = (id: string): boolean =>
  APP_DATA.specimens.some((s) => s.id === id);

/** eclosionInDays が `maxDays` 未満の個体だけを返す。eclosionInDays が null の個体は除外。 */
export const listUrgentEclosion = (
  maxDays = 60,
): Array<Specimen & { eclosionInDays: number }> =>
  APP_DATA.specimens
    .map(applyMemo)
    .filter(
      (s): s is Specimen & { eclosionInDays: number } =>
        s.eclosionInDays !== null && s.eclosionInDays < maxDays,
    );

/** 羽化予測対象（eclosionInDays が数値）の個体を早い順にソートして返す */
export const listEclosionForecasts = (): Array<
  Specimen & { eclosionInDays: number }
> =>
  APP_DATA.specimens
    .map(applyMemo)
    .filter(
      (s): s is Specimen & { eclosionInDays: number } =>
        s.eclosionInDays !== null,
    )
    .sort((a, b) => a.eclosionInDays - b.eclosionInDays);

/** 個体メモの取得。編集済みなら永続化分、未編集なら APP_DATA の seed (notes ?? "") */
export const getSpecimenMemo = (id: string): string => {
  const m = memos()[id];
  if (m !== undefined) return m;
  return APP_DATA.specimens.find((s) => s.id === id)?.notes ?? "";
};

/** メモを更新 (空文字列も許可) */
export const updateSpecimenMemo = (id: string, memo: string): void => {
  const next: MemoMap = { ...memos(), [id]: memo };
  setMemos(next);
  writeJSON(LS_KEYS.memos, next);
};

/** テスト用: 全メモをクリア (localStorage も消す) */
export const __resetSpecimenMemos = (): void => {
  setMemos({});
  writeJSON(LS_KEYS.memos, {});
};
