// bloodline-fixture.ts — 商品ごとの血統情報 (= 購入動線で参照する読み取り専用データ)
//
// **目的**:
//   /products/:id の血統サマリー + フル系図モーダル用データソース。
//   現状は手書き fixture。将来は GET /api/v1/cards/products/{id}/bloodline 経由で
//   server-driven 化する予定 (= shape を維持しておけば差し替えが楽)。
//
// **対象**:
//   `kind: "生体"` の商品のみ。用品 (ゼリー / マット 等) には bloodline 無し。
//
// **F値 (= 近交係数 inbreeding coefficient)**:
//   0.00 〜 0.0625  ⇒ "安全" (緑)     親同士に共通祖先がほぼ無い
//   0.0625 〜 0.125 ⇒ "注意" (アンバー) 親同士に近い祖先が居る
//   0.125 〜       ⇒ "濃い" (ローズ)  full sibling 交配以上、リスクあり
//
// **認証バッジ**:
//   - breederCertified: ブリーダー本人が血統書を発行
//   - thirdPartyVerified: 第三者団体 (= 国産カブト血統認証協会 等) が監査済

export type Sex = "m" | "f";

/** 1 個体の血統情報 (= 親 / 祖父母レベルの軽量表現)。 */
export interface BlAncestor {
  id: string;
  name: string;
  sex: Sex;
  /** 世代タグ。"WILD" / "F0" / "CBF1" / "CBF2" 等の自由文字列 */
  gen: string;
  sizeMm?: number;
  /** WILD = 野生個体。色合いを変える */
  isWild: boolean;
  /** "故 (2025-10-02)" のような死亡注記。サマリーでは表示しないが詳細 modal で出す */
  deceasedNote?: string;
}

/** 1 商品の血統データ。3 世代までを保持する。 */
export interface ProductBloodline {
  productId: string;
  /** 商品自身の世代タグ ("CBF2" 等) */
  generation: string;
  /** 近交係数 (Wright's F)。0..1。 */
  inbreedingCoef: number;
  breederCertified: boolean;
  thirdPartyVerified: boolean;
  /** 血統メモ (= 起源・累代の要約)。サマリーで 2 行、modal で全文 */
  pedigreeNotes: string;
  father: BlAncestor;
  mother: BlAncestor;
  /** 祖父母 4 個体 (任意)。modal で表示。 */
  grandparents?: {
    paternalFather?: BlAncestor;
    paternalMother?: BlAncestor;
    maternalFather?: BlAncestor;
    maternalMother?: BlAncestor;
  };
}

// ──────────────────────────────────────────────────────────
// fixture data (= 既存 NODES (= /bloodline) と整合させる)
// ──────────────────────────────────────────────────────────

const w = (id: string, name: string, sex: Sex): BlAncestor => ({
  id, name, sex, gen: "WILD", isWild: true,
});

const a = (
  id: string, name: string, sex: Sex, gen: string, sizeMm?: number,
  deceasedNote?: string,
): BlAncestor => ({
  id, name, sex, gen, sizeMm, isWild: false, deceasedNote,
});

export const PRODUCT_BLOODLINE: Record<string, ProductBloodline> = {
  "p-hh-m-142": {
    productId: "p-hh-m-142",
    generation: "CBF2",
    inbreedingCoef: 0.05,
    breederCertified: true,
    thirdPartyVerified: false,
    pedigreeNotes:
      "ANCHOR BEETLE CO. 自家累代。父系は 2019 グアドループ産 WILD から 3 代目。" +
      "母系は ANCHOR BEETLE CO. 自家累代 F0。F値 0.05 で安全圏内。",
    father: a("#DHH-0213", "漆黒", "m", "CBF1", 152),
    mother: a("#DHH-0244", "マリア", "f", "F0", 66),
    grandparents: {
      paternalFather: a("#DHH-0150", "月影", "m", "F0", 148, "故 (2025-10-02)"),
      paternalMother: a("#DHH-0204", "花音", "f", "F0", 68),
      maternalFather: w("#WILD-DHH-A", "野生 ♂", "m"),
      maternalMother: w("#WILD-DHH-B", "野生 ♀", "f"),
    },
  },

  "p-cat-l": {
    productId: "p-cat-l",
    generation: "CBF3",
    inbreedingCoef: 0.08,
    breederCertified: true,
    thirdPartyVerified: false,
    pedigreeNotes:
      "ANCHOR BEETLE CO. 自家累代 CBF3。父系・母系ともに KUWAGATA.jp 由来 F0 ペアから。" +
      "F値 0.08 で「注意」域。次サイクルは別系統との交配を推奨。",
    father: a("#CAT-0118", "雷", "m", "CBF1", 95),
    mother: a("#CAT-0089", "雪", "f", "CBF1", 50),
    grandparents: {
      paternalFather: a("#CAT-0091", "嵐", "m", "F0", 110),
      paternalMother: a("#CAT-0097", "蘭", "f", "F0", 60),
      maternalFather: a("#CAT-0091", "嵐", "m", "F0", 110), // sibling 交配で同じ親
      maternalMother: a("#CAT-0097", "蘭", "f", "F0", 60),
    },
  },

  "p-neo-m": {
    productId: "p-neo-m",
    generation: "CBF2",
    inbreedingCoef: 0.0,
    breederCertified: true,
    thirdPartyVerified: true,
    pedigreeNotes:
      "MIYAMA FARM 自家累代 CBF2。父系・母系ともに別系統の MIYAMA FARM F0 ペア。" +
      "F値 0.00 で完全に安全圏。第三者血統認証済。",
    father: a("#NEO-0058", "青嵐", "m", "CBF1", 102),
    mother: a("#NEO-0024", "凜", "f", "F0", 68),
    grandparents: {
      paternalFather: a("#NEO-0011", "蒼", "m", "F0", 125),
      paternalMother: a("#NEO-0007", "翠", "f", "F0", 65),
      maternalFather: w("#WILD-NEO-A", "野生 ♂", "m"),
      maternalMother: w("#WILD-NEO-B", "野生 ♀", "f"),
    },
  },

  "p-aki": {
    productId: "p-aki",
    generation: "WF1",
    inbreedingCoef: 0.0,
    breederCertified: true,
    thirdPartyVerified: true,
    pedigreeNotes:
      "MIYAMA FARM が 2024 年に直輸入した WILD ペアから採れた WF1。" +
      "両親ともペルー産野生個体で完全血統不明 + F値 0.00。第三者認証済。",
    father: w("#WILD-AKI-A", "野生 ♂ ペルー", "m"),
    mother: w("#WILD-AKI-B", "野生 ♀ ペルー", "f"),
    // WF1 は祖父母不明 (= grandparents 省略)
  },
};

/** 商品 ID から血統データを取得 (= 用品やデータ未登録なら undefined)。 */
export const getProductBloodline = (
  productId: string,
): ProductBloodline | undefined => PRODUCT_BLOODLINE[productId];

/** F値のバンド分類。 */
export type FBand = "safe" | "caution" | "dense";
export const fBand = (coef: number): FBand => {
  if (coef < 0.0625) return "safe";
  if (coef < 0.125) return "caution";
  return "dense";
};
export const fBandLabel = (b: FBand): string =>
  b === "safe" ? "安全" : b === "caution" ? "注意" : "濃い";
