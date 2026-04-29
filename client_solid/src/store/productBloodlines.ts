// store/productBloodlines.ts — 商品血統情報 (= server /api/v1/product_bloodlines) の reactive cache
//
// **責務**:
//   - アプリ起動時に `loadProductBloodlines()` を 1 度呼んで `Record<productId, ProductBloodline>`
//     を signal に詰める
//   - `serverProductBloodlines()` で同期的に最新値を読めるようにする
//   - `bloodline-fixture.ts::getProductBloodline()` から参照される唯一の真実
//
// **設計判断**:
//   - **store/products.ts と同じパターン**: 起動時 1 回 fetch + module-scope signal。
//     fixture (4 件) は変動しない master data なので bulk fetch + cache が単純。
//   - **fetch 失敗時は空 Record**: 商品詳細の血統セクション / カート血統リマインダ /
//     商品一覧 chip が表示されないだけで、購入動線自体は壊れない。warn ログのみ。
//   - **server レスポンスを `ProductBloodline` 形に正規化**: ancestor の role 別 6 役割を
//     `father` / `mother` / `grandparents.{paternalFather,...}` の nested shape に詰め直し、
//     既存呼び出し側 (= BloodlineSummary / BloodlineLineageModal / BloodlineCardChips /
//     CartBloodlineReminder) が無改修で動くようにする。

import { createSignal } from "solid-js";

import type { ProductBloodline, BlAncestor, Sex } from "../components/products/bloodline-fixture";
import { fetchProductBloodlines } from "../sdui/api";
import type { ProductBloodlineAncestor, ProductBloodlineSummary } from "../sdui/api";

const [bloodlines, setBloodlines] = createSignal<Record<string, ProductBloodline>>(
  {},
);

/** 商品血統の reactive accessor。loadProductBloodlines() 前は空 Record。 */
export const serverProductBloodlines = bloodlines;

/** server response 1 件 → フロント `ProductBloodline` 形に正規化。
 *  ancestor 配列を role 別に振り分けて nested shape (= father / mother / grandparents.*) に詰める。
 *  父母 (father / mother) が欠けていた場合は呼び出し側に undefined で気づかせるため、
 *  null 安全 chain を経由しつつ最終 shape では assert する (= server seed では必ず揃う前提)。 */
const normalize = (s: ProductBloodlineSummary): ProductBloodline | null => {
  const byRole = (role: string): ProductBloodlineAncestor | undefined =>
    s.ancestors.find((a) => a.role === role);

  const toAncestor = (a: ProductBloodlineAncestor): BlAncestor => ({
    id: a.id,
    name: a.name,
    sex: a.sex as Sex,
    gen: a.gen,
    sizeMm: a.sizeMm ?? undefined,
    isWild: a.isWild,
    deceasedNote: a.deceasedNote ?? undefined,
  });

  const father = byRole("father");
  const mother = byRole("mother");
  if (!father || !mother) {
    // 父母不在 = データ不整合。warn を出して null を返し、cache から除外する。
    console.warn(
      `[store/productBloodlines] product ${s.productId}: father / mother missing`,
    );
    return null;
  }

  const pf = byRole("paternal_father");
  const pm = byRole("paternal_mother");
  const mf = byRole("maternal_father");
  const mm = byRole("maternal_mother");

  // 4 役割いずれかが入っているなら grandparents object を組む。全部 undefined なら省略
  // (= WF1 等で祖父母不明のケース。フロント既存仕様: grandparents キー自体を持たない)。
  const hasAnyGp = pf || pm || mf || mm;
  const grandparents = hasAnyGp
    ? {
        paternalFather: pf ? toAncestor(pf) : undefined,
        paternalMother: pm ? toAncestor(pm) : undefined,
        maternalFather: mf ? toAncestor(mf) : undefined,
        maternalMother: mm ? toAncestor(mm) : undefined,
      }
    : undefined;

  return {
    productId: s.productId,
    generation: s.generation,
    inbreedingCoef: s.inbreedingCoef,
    breederCertified: s.breederCertified,
    thirdPartyVerified: s.thirdPartyVerified,
    pedigreeNotes: s.pedigreeNotes,
    father: toAncestor(father),
    mother: toAncestor(mother),
    ...(grandparents ? { grandparents } : {}),
  };
};

/** `GET /api/v1/product_bloodlines` を叩いて signal に詰める。
 *  失敗時は warn ログを残し、cache は前回値のまま (= 起動初回なら空 Record のまま)。 */
export const loadProductBloodlines = async (): Promise<
  Record<string, ProductBloodline>
> => {
  try {
    const list = await fetchProductBloodlines();
    const map: Record<string, ProductBloodline> = {};
    for (const s of list) {
      const n = normalize(s);
      if (n) map[n.productId] = n;
    }
    setBloodlines(map);
    return map;
  } catch (e) {
    console.warn("[store/productBloodlines] fetch failed:", e);
    return bloodlines();
  }
};

/** テスト専用: signal にフィクスチャを直接セットする。 */
export const setProductBloodlinesForTest = (
  map: Record<string, ProductBloodline>,
): void => {
  setBloodlines(map);
};

/** テスト専用: signal をリセット (= 空 Record に戻す)。 */
export const resetProductBloodlinesForTest = (): void => {
  setBloodlines({});
};
