// store/species.ts — 種マスタ (= server /api/v1/species) の reactive cache
//
// **責務**:
//   - アプリ起動時に `loadSpecies()` を 1 度呼んで `SpeciesSummary[]` を signal に詰める
//   - `serverSpecies()` で同期的に最新値を読めるようにする
//   - `findSpeciesById(id)` で speciesId → SpeciesSummary を引く (= specimens 正規化用)
//
// **設計判断**:
//   - store/products.ts と同じパターン: 起動時 1 回 fetch + module-scope signal
//   - **5 件しか無い master**: cache は単純な配列で線形探索で十分
//   - fetch 失敗時は空配列 (= specimens の species 表示が speciesId のままになるが画面は壊れない)

import { createSignal } from "solid-js";

import { type SpeciesSummary, fetchSpecies } from "../sdui/api";

const [species, setSpecies] = createSignal<SpeciesSummary[]>([]);

/** 種マスタの reactive accessor。loadSpecies() 前は空配列。 */
export const serverSpecies = species;

/** `GET /api/v1/species?locale=ja` を叩いて signal に詰める。 */
export const loadSpecies = async (locale = "ja"): Promise<SpeciesSummary[]> => {
  try {
    const list = await fetchSpecies(locale);
    setSpecies(list);
    return list;
  } catch (e) {
    console.warn("[store/species] fetch failed:", e);
    return species();
  }
};

/** speciesId (= "dhh" 等) で 1 件引く。未取得 / 不存在は undefined。 */
export const findSpeciesById = (id: string): SpeciesSummary | undefined =>
  species().find((s) => s.id === id);

/** テスト専用: signal にフィクスチャを直接セットする。 */
export const setSpeciesForTest = (list: SpeciesSummary[]): void => {
  setSpecies(list);
};

/** テスト専用: signal をリセット。 */
export const resetSpeciesForTest = (): void => {
  setSpecies([]);
};
