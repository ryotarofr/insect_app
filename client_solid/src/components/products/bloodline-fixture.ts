// bloodline-fixture.ts — 商品ごとの血統情報 (= 購入動線で参照する読み取り専用データ)
//
// **目的**:
//   /products/:id の血統サマリー + フル系図モーダル用データソース。
//
// **データ層**:
//   `GET /api/v1/product_bloodlines` から fetch して `store/productBloodlines.ts` の
//   signal に詰めた値を参照する。fixture / 定数は本ファイルから廃止済 (Phase 9.x DB 移行)。
//   起動時 `App.tsx` 側で `loadProductBloodlines()` が 1 度呼ばれる前提。
//   それ以前 / fetch 失敗時は `getProductBloodline()` が undefined を返す
//   (= 商品詳細の血統セクションが非表示 = 用品 fallback と同じ振る舞い)。
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
// データ取得 (= server fetch + store cache)
// ──────────────────────────────────────────────────────────
//
// 旧 PRODUCT_BLOODLINE 定数は server (`GET /api/v1/product_bloodlines`) に移行。
// ここでは store の signal を読むだけの薄い adapter を残し、既存呼び出し側
// (BloodlineSummary / BloodlineLineageModal / BloodlineCardChips /
// CartBloodlineReminder) を無改修にする。

import { serverProductBloodlines } from "../../store/productBloodlines";

/** 商品 ID から血統データを取得 (= 用品やデータ未登録なら undefined)。 */
export const getProductBloodline = (
  productId: string,
): ProductBloodline | undefined => serverProductBloodlines()[productId];

/** F値のバンド分類。 */
export type FBand = "safe" | "caution" | "dense";
export const fBand = (coef: number): FBand => {
  if (coef < 0.0625) return "safe";
  if (coef < 0.125) return "caution";
  return "dense";
};
export const fBandLabel = (b: FBand): string =>
  b === "safe" ? "安全" : b === "caution" ? "注意" : "濃い";
