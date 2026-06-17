// matingRecords.test.ts — P4-22 交配記録の signal ストア
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetMatingRecords,
  addMatingRecord,
  listMatingRecords,
  matingRecordCount,
} from "./matingRecords";

describe("matingRecords store", () => {
  beforeEach(() => {
    __resetMatingRecords();
  });

  it("starts empty after reset", () => {
    expect(listMatingRecords()).toEqual([]);
    expect(matingRecordCount()).toBe(0);
  });

  it("addMatingRecord appends a record with generated id + createdAt", () => {
    const rec = addMatingRecord({
      fatherId: "#DHH-0198",
      motherId: "#DHH-0204",
      date: "2026-04-20",
      note: "テスト",
    });
    expect(rec.id).toMatch(/^mr_/);
    expect(rec.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rec.note).toBe("テスト");
    expect(listMatingRecords()).toHaveLength(1);
    expect(matingRecordCount()).toBe(1);
  });

  it("trims whitespace-only notes to undefined", () => {
    const rec = addMatingRecord({
      fatherId: "#DHH-0198",
      motherId: "#DHH-0204",
      date: "2026-04-20",
      note: "   ",
    });
    expect(rec.note).toBeUndefined();
  });

  it("sorts records newest-first", async () => {
    addMatingRecord({
      fatherId: "#A",
      motherId: "#B",
      date: "2026-04-19",
    });
    // 1ms 以上待って createdAt の順序を保証
    await new Promise((r) => setTimeout(r, 5));
    addMatingRecord({
      fatherId: "#C",
      motherId: "#D",
      date: "2026-04-20",
    });
    const list = listMatingRecords();
    expect(list[0].fatherId).toBe("#C");
    expect(list[1].fatherId).toBe("#A");
  });

  it("persists records across signal reads", () => {
    addMatingRecord({
      fatherId: "#DHH-0213",
      motherId: "#DHH-0244",
      date: "2026-04-18",
    });
    const first = listMatingRecords();
    const second = listMatingRecords();
    expect(first).toEqual(second);
  });
});
