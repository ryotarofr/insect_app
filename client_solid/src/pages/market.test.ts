// market.test.ts — templateFor() の文面組立のユニットテスト
// (P2-12 の自動生成ロジックの回帰防止)
import { describe, expect, it } from "vitest";
import { deriveListingState, templateFor } from "./Market";
import type { Listing, Specimen } from "../data";

const baseSpec: Specimen = {
  id: "#TST-0001",
  name: "テスト個体 A",
  species: "テスト属",
  sci: "Testus testus",
  sex: "♂ オス",
  stage: "成虫",
  stageProgress: 100,
  sizeMm: 142,
  weightG: 34,
  birthDate: "2025-01-01",
  purchasedAt: "2025-06-01",
  shop: "グアドループ産",
  generation: "CBF2",
  price: 48000,
  eclosionETA: "2026-05-15",
  eclosionInDays: 22,
  status: "alive",
  bloodline: { father: "#DAD-001", mother: "#MOM-001" },
};

describe("templateFor()", () => {
  it("includes name, sex, size, weight", () => {
    const out = templateFor(baseSpec);
    expect(out).toContain("テスト個体 A");
    expect(out).toContain("♂ オス");
    expect(out).toContain("142mm");
    expect(out).toContain("34g");
  });

  it("includes generation and parents", () => {
    const out = templateFor(baseSpec);
    expect(out).toContain("CBF2");
    expect(out).toContain("父 #DAD-001");
    expect(out).toContain("母 #MOM-001");
  });

  it("marks WILD / F0 as 野生個体", () => {
    const out = templateFor({ ...baseSpec, generation: "WILD" });
    expect(out).toContain("野生個体");
  });

  it("falls back when sizeMm is 0", () => {
    const out = templateFor({ ...baseSpec, sizeMm: 0 });
    expect(out).toContain("サイズ未計測");
  });

  it("omits weight line when weightG is 0", () => {
    const out = templateFor({ ...baseSpec, weightG: 0 });
    expect(out).not.toMatch(/\/ 0g/);
    expect(out).not.toMatch(/0g/);
  });

  it("handles missing eclosion (成虫)", () => {
    const out = templateFor({ ...baseSpec, eclosionETA: null, eclosionInDays: null });
    expect(out).toContain("羽化済み");
  });

  it("handles missing bloodline", () => {
    const out = templateFor({ ...baseSpec, bloodline: { father: "", mother: "" } });
    expect(out).toContain("親個体情報なし");
  });
});

// P3-22: deriveListingState() — 出品の状態判定
const baseListing: Listing = {
  id: "L-TEST",
  title: "テスト出品",
  seller: "tester",
  price: 10000,
  bids: null,
  watchers: 0,
  endsIn: "即決のみ",
  auction: false,
  verified: false,
};

describe("deriveListingState()", () => {
  it("returns 'buynow' for non-auction listings", () => {
    expect(deriveListingState(baseListing)).toBe("buynow");
  });

  it("returns 'auction' when days remain (endsIn contains 日)", () => {
    const l: Listing = { ...baseListing, auction: true, endsIn: "2日 14h" };
    expect(deriveListingState(l)).toBe("auction");
  });

  it("returns 'ending-soon' for hours-only auctions", () => {
    const l: Listing = { ...baseListing, auction: true, endsIn: "18h" };
    expect(deriveListingState(l)).toBe("ending-soon");
  });

  it("returns 'ending-soon' for sub-hour auctions", () => {
    const l: Listing = { ...baseListing, auction: true, endsIn: "4h 32m" };
    expect(deriveListingState(l)).toBe("ending-soon");
  });

  it("prioritizes buynow even when endsIn is empty", () => {
    const l: Listing = { ...baseListing, auction: false, endsIn: "" };
    expect(deriveListingState(l)).toBe("buynow");
  });
});
