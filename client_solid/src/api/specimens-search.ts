// api/specimens-search.ts — 親個体検索 typeahead 用 mock
//
// **Phase 1 の責務**:
//   - SpecimenDetailForm / 個体化モード詳細展開で使う「父個体 / 母個体」検索
//   - mock では既存 mock specimens (= api/specimens.ts) と新規 promoted specimens
//     から候補を返す
//
// **Phase 7 への移行**:
//   関数 signature を保ったまま `fetch('/api/v1/specimens/search?...')` に置換予定。
//
// **検索条件**:
//   - q (部分一致 ILIKE) で publicId, name, bloodlineName を検索
//   - sex (= 父検索なら male、母検索なら female) でフィルタ
//   - speciesId で絞込 (= 子個体と種が一致するもののみ)
//   - includeDeceased (default true): 死亡個体も親候補に含める

import { LS_KEYS, readJSON } from "./storage";
import type {
  PromotedSpecimen,
  SpecimenSearchQuery,
  SpecimenSearchResult,
} from "../types/cohort";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ──────────────────────────────────────────────────────────────────────
// 初期 seed (= 検索結果に出るサンプル個体)
// ──────────────────────────────────────────────────────────────────────

const SEED_SPECIMENS: SpecimenSearchResult[] = [
  {
    id: "spc_seed_001",
    publicId: "DHH-0042",
    name: "ヘラ太郎",
    sex: "male",
    sizeMm: 82.3,
    weightG: 28.4,
    generation: 2,
    bloodlineName: "ヘラクレス・ホペイ系",
    speciesId: "sp_dorcus_hopei",
    lifeStatus: "active",
  },
  {
    id: "spc_seed_002",
    publicId: "DHH-0058",
    name: "ヘラジ郎",
    sex: "male",
    sizeMm: 79.5,
    weightG: 26.1,
    generation: 2,
    bloodlineName: "ヘラクレス・ホペイ系",
    speciesId: "sp_dorcus_hopei",
    lifeStatus: "active",
  },
  {
    id: "spc_seed_003",
    publicId: "DHH-0099",
    name: "ヘラサブ",
    sex: "male",
    sizeMm: 77.0,
    weightG: 24.8,
    generation: 1,
    bloodlineName: "ヘラクレス・ホペイ系",
    speciesId: "sp_dorcus_hopei",
    lifeStatus: "deceased",
  },
  {
    id: "spc_seed_004",
    publicId: "DHH-0213",
    name: "漆黒",
    sex: "male",
    sizeMm: 85.3,
    weightG: 31.2,
    generation: 1,
    bloodlineName: "能勢 YG",
    speciesId: "sp_dorcus_hopei",
    lifeStatus: "active",
  },
  {
    id: "spc_seed_005",
    publicId: "DHH-0244",
    name: "マリア",
    sex: "female",
    sizeMm: 54.1,
    weightG: 12.3,
    generation: 1,
    bloodlineName: "能勢 YG",
    speciesId: "sp_dorcus_hopei",
    lifeStatus: "active",
  },
  {
    id: "spc_seed_006",
    publicId: "NAT-0341",
    name: "武蔵",
    sex: "male",
    sizeMm: 82.0,
    weightG: 29.8,
    generation: 0,
    bloodlineName: "国産野生",
    speciesId: "sp_dorcus_hopei",
    lifeStatus: "active",
  },
  {
    id: "spc_seed_007",
    publicId: "NAT-0555",
    name: "結",
    sex: "female",
    sizeMm: 45.0,
    weightG: 9.7,
    generation: 0,
    bloodlineName: "国産野生",
    speciesId: "sp_dorcus_hopei",
    lifeStatus: "active",
  },
];

const matchesQuery = (
  s: SpecimenSearchResult,
  q: string | undefined,
): boolean => {
  if (!q) return true;
  const needle = q.toLowerCase();
  const haystacks = [
    s.publicId,
    s.name ?? "",
    s.bloodlineName ?? "",
  ];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
};

const promotedToSearchResult = (
  p: PromotedSpecimen,
  speciesId: string,
): SpecimenSearchResult => ({
  id: p.id,
  publicId: p.publicId,
  name: p.name,
  sex: p.sex ?? "unknown",
  sizeMm: p.sizeMm,
  weightG: p.weightG,
  generation: null,
  bloodlineName: null,
  speciesId,
  lifeStatus: "active",
});

/**
 * mock 親個体検索。promote 済 + manual 登録 + seed を統合して検索。
 *
 * @param query 検索パラメータ
 */
export async function searchSpecimens(
  query: SpecimenSearchQuery,
): Promise<SpecimenSearchResult[]> {
  await sleep(150); // typeahead 用に短め
  // 1% エラーは typeahead では出さない (= UI が壊れるとフォーム入力が止まるため)

  const promoted = readJSON<PromotedSpecimen[]>(LS_KEYS.promotedSpecimens, []);
  const manual = readJSON<PromotedSpecimen[]>(LS_KEYS.manualSpecimens, []);

  // 新規個体は species 不明だが、親候補として混ぜる場合は cohort/manual の species に依存。
  // mock 段階では sp_dorcus_hopei 固定で表示。
  const dynamicResults: SpecimenSearchResult[] = [...promoted, ...manual].map(
    (p) => promotedToSearchResult(p, "sp_dorcus_hopei"),
  );

  const all: SpecimenSearchResult[] = [...dynamicResults, ...SEED_SPECIMENS];

  const filtered = all.filter((s) => {
    if (!matchesQuery(s, query.q)) return false;
    if (query.sex && s.sex !== query.sex) return false;
    if (query.speciesId && s.speciesId !== query.speciesId) return false;
    if (query.bloodlineName && s.bloodlineName !== query.bloodlineName) {
      return false;
    }
    if (query.includeDeceased === false && s.lifeStatus !== "active") {
      return false;
    }
    return true;
  });

  return filtered.slice(0, query.limit ?? 20);
}
