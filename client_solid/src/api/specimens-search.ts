// api/specimens-search.ts — 親個体検索 typeahead (Phase 7: real fetch)
//
// **Phase 7**: mock layer (= 旧 SEED_SPECIMENS) を削除し、`/api/v1/specimens/search`
// に実 fetch する。
//
// **server 側 DTO** (= handlers::specimens::SpecimenView):
//   typeahead 表示に必要なフィールドは server 側 SpecimenView と一部のみ重なる
//   (publicId, name, sex, sizeMm, weightG, generation 等)。
//   bloodlineName / lifeStatus は server SpecimenView に含まれないので、ここで
//   undefined / 'active' 既定で穴埋めする。

import { fetchJson } from "../sdui/api";
import type { SpecimenView } from "../generated/api-types";
import type {
  SpecimenSearchQuery,
  SpecimenSearchResult,
} from "../types/cohort";

/**
 * 親個体検索。owner = current user に固定 (server 側で session 抽出)。
 *
 * @param query 検索パラメータ
 */
export async function searchSpecimens(
  query: SpecimenSearchQuery,
): Promise<SpecimenSearchResult[]> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.sex) params.set("sex", query.sex);
  if (query.speciesId) params.set("speciesId", query.speciesId);
  if (query.includeDeceased !== undefined) {
    params.set("includeDeceased", String(query.includeDeceased));
  }
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  const qs = params.toString();
  const path = `/specimens/search${qs ? `?${qs}` : ""}`;

  const rows = await fetchJson<SpecimenView[]>(path);
  return rows.map(toSearchResult);
}

/** server SpecimenView を typeahead 用 SpecimenSearchResult に変換 */
function toSearchResult(v: SpecimenView): SpecimenSearchResult {
  // generation は server 側で "F2" 等の文字列なので数値化する
  const gen = v.generation
    ? parseInt(v.generation.replace(/^F/, ""), 10)
    : null;
  return {
    id: v.id,
    publicId: v.publicId,
    name: v.name,
    sex: (v.sex as "male" | "female" | "unknown") ?? "unknown",
    sizeMm: v.sizeMm ?? null,
    weightG: v.weightG ?? null,
    generation: Number.isFinite(gen) ? (gen as number) : null,
    bloodlineName: null, // server SpecimenView に bloodline 情報なし
    speciesId: v.speciesId,
    lifeStatus: (v.lifeStatus as SpecimenSearchResult["lifeStatus"]) ?? "active",
  };
}
