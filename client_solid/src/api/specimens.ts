// api/specimens.ts — 個体 (Specimen) の取得 + 羽化予測 + メモ更新
//
// **責務**:
//   - `store/specimens.ts` の `serverSpecimens()` (= /specimens/me 経由) から正規化した
//     legacy `Specimen[]` を sync で公開する
//   - 個体メモ (notes) は `PATCH /specimens/{id}/notes` で server 永続化
//
// **anonymous の扱い**:
//   `serverSpecimens()` は未 login 時 null。本ファイルは null → `[]` で吸収する。
//
// **正規化**:
//   `SpecimenView` (server) と legacy `Specimen` (data.ts) は 9 フィールド差分。
//   `normalizeSpecimenForLegacy()` で defaults 埋めをして shape を揃える。
//   notes は server 値そのまま。

import type { Specimen } from "../data";
import { patchSpecimenNotes } from "../sdui/api";
import {
  findServerSpecimenByPublicId,
  normalizeSpecimenForLegacy,
  serverSpecimens,
  triggerSpecimensRefresh,
} from "../store/specimens";

/** `serverSpecimens()` を legacy `Specimen[]` に正規化して返す。null は空配列。 */
const normalizedSpecimens = (): Specimen[] => {
  const list = serverSpecimens();
  if (!list) return [];
  return list.map((v) => normalizeSpecimenForLegacy(v));
};

export const listSpecimens = (): Specimen[] => normalizedSpecimens();

export const getSpecimen = (id: string): Specimen | undefined =>
  normalizedSpecimens().find((s) => s.id === id);

export const specimenExists = (id: string): boolean =>
  normalizedSpecimens().some((s) => s.id === id);

/** eclosionInDays が `maxDays` 未満の個体だけを返す。eclosionInDays が null の個体は除外。 */
export const listUrgentEclosion = (
  maxDays = 60,
): Array<Specimen & { eclosionInDays: number }> =>
  normalizedSpecimens().filter(
    (s): s is Specimen & { eclosionInDays: number } =>
      s.eclosionInDays !== null && s.eclosionInDays < maxDays,
  );

/** 羽化予測対象 (eclosionInDays が数値) の個体を早い順にソートして返す。 */
export const listEclosionForecasts = (): Array<
  Specimen & { eclosionInDays: number }
> =>
  normalizedSpecimens()
    .filter(
      (s): s is Specimen & { eclosionInDays: number } =>
        s.eclosionInDays !== null,
    )
    .sort((a, b) => a.eclosionInDays - b.eclosionInDays);

/** 個体メモの取得。serverSpecimens cache から server 値を引く。
 *  キャッシュ未読込 / publicId 不存在は空文字列。 */
export const getSpecimenMemo = (id: string): string =>
  getSpecimen(id)?.notes ?? "";

/** メモを更新。`PATCH /specimens/{uuid}/notes` を叩いて server 永続化する。
 *  成功後に `triggerSpecimensRefresh()` で specimens cache を更新 (= UI 自動反映)。
 *  publicId 未解決 / login 切れ時は throw。 */
export const updateSpecimenMemo = async (
  id: string,
  memo: string,
): Promise<void> => {
  const sv = findServerSpecimenByPublicId(id);
  if (!sv) {
    throw new Error(
      `updateSpecimenMemo: specimen not found for publicId "${id}" (cache miss / not logged in)`,
    );
  }
  await patchSpecimenNotes(sv.id, memo);
  triggerSpecimensRefresh();
};
