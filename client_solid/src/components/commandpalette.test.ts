// commandpalette.test.ts — P4-5 Command Palette の検索/グルーピング ロジック
//
// UI (モーダル表示や keyboard nav) は e2e.test.tsx の領域だが、
// 純粋な filter / group 関数はここでユニットテストする。
import { describe, expect, it } from "vitest";
import {
  filterItems,
  groupByKind,
  type PaletteItem,
} from "./CommandPalette";

const mkItem = (
  kind: PaletteItem["kind"],
  label: string,
  extra = "",
  href = "/",
): PaletteItem => ({
  key: `${kind}:${label}`,
  kind,
  label,
  sub: extra,
  haystack: `${label} ${extra}`.toLowerCase(),
  href,
});

describe("filterItems()", () => {
  const FIXTURES: PaletteItem[] = [
    mkItem("page", "マイページ", "ダッシュボード"),
    mkItem("page", "個体カルテ", "specimen カルテ"),
    mkItem("specimen", "ヘラクレス 月影", "#DHH-0198 Dynastes hercules"),
    mkItem("specimen", "コーカサス 雷", "#CAT-0118 Chalcosoma chiron"),
    mkItem("product", "ヘラクレスオオカブト ♂ 142mm", "p-hh-m-142 血統書付"),
  ];

  it("returns prefix of items when query is empty", () => {
    const out = filterItems(FIXTURES, "");
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toBe("マイページ");
  });

  it("returns prefix of items when query is only whitespace", () => {
    const out = filterItems(FIXTURES, "   ");
    expect(out.length).toBeGreaterThan(0);
  });

  it("matches by label substring (日本語)", () => {
    const out = filterItems(FIXTURES, "月影");
    expect(out.map((i) => i.label)).toEqual(["ヘラクレス 月影"]);
  });

  it("matches by ID substring (英数字)", () => {
    const out = filterItems(FIXTURES, "0118");
    expect(out.map((i) => i.label)).toContain("コーカサス 雷");
  });

  it("is case-insensitive for latin letters", () => {
    const out = filterItems(FIXTURES, "DYNASTES");
    expect(out.map((i) => i.label)).toContain("ヘラクレス 月影");
  });

  it("matches with AND when multiple tokens are given", () => {
    // "ヘラクレス" AND "142" should only pick the product line
    const out = filterItems(FIXTURES, "ヘラクレス 142");
    expect(out.map((i) => i.label)).toEqual([
      "ヘラクレスオオカブト ♂ 142mm",
    ]);
  });

  it("returns empty array when no item matches", () => {
    const out = filterItems(FIXTURES, "zzzzzz-nonexistent");
    expect(out).toEqual([]);
  });
});

describe("groupByKind()", () => {
  it("keeps the section order page → specimen → product", () => {
    const items = [
      mkItem("product", "商品A"),
      mkItem("specimen", "個体A"),
      mkItem("page", "ページA"),
    ];
    const grouped = groupByKind(items);
    expect(grouped.map(([k]) => k)).toEqual(["page", "specimen", "product"]);
  });

  it("omits empty sections", () => {
    const items = [mkItem("page", "ページA")];
    const grouped = groupByKind(items);
    expect(grouped.length).toBe(1);
    expect(grouped[0][0]).toBe("page");
  });

  it("preserves input order within each section", () => {
    const items = [
      mkItem("specimen", "個体Z"),
      mkItem("specimen", "個体A"),
      mkItem("specimen", "個体M"),
    ];
    const [[, specs]] = groupByKind(items);
    expect(specs.map((i) => i.label)).toEqual(["個体Z", "個体A", "個体M"]);
  });

  it("returns [] when items are empty", () => {
    expect(groupByKind([])).toEqual([]);
  });
});
