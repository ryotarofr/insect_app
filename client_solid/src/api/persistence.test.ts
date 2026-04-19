// persistence.test.ts — addLog / updateSpecimenMemo の永続化挙動
import { beforeEach, describe, expect, it } from "vitest";
import {
  addLog,
  getSpecimen,
  getSpecimenMemo,
  listLogs,
  listLogsBySpecimen,
  listLogsByType,
  listSpecimens,
  updateSpecimenMemo,
} from "./index";
import { LS_KEYS } from "./storage";

describe("addLog persistence", () => {
  beforeEach(() => {
    // setup.ts で signal はリセット済み。LS も空。
  });

  it("addLog increases listLogs count by 1", () => {
    const before = listLogs().length;
    addLog({
      type: "weight",
      title: "体重 15.0g",
      body: "15.0",
      specimen: "#TEST-001",
    });
    expect(listLogs().length).toBe(before + 1);
  });

  it("new log appears at the top of listLogs", () => {
    addLog({
      type: "observation",
      title: "新規観察",
      body: "test note",
      specimen: "#TEST-001",
    });
    expect(listLogs()[0].title).toBe("新規観察");
  });

  it("listLogsBySpecimen returns user-added log for matching id", () => {
    addLog({
      type: "feed",
      title: "給餌",
      body: "ゼリー2個",
      specimen: "#NEW-XYZ",
    });
    const matched = listLogsBySpecimen("#NEW-XYZ");
    expect(matched.length).toBe(1);
    expect(matched[0].body).toBe("ゼリー2個");
  });

  it("listLogsByType groups user-added logs by type", () => {
    const before = listLogsByType("molt").length;
    addLog({
      type: "molt",
      title: "脱皮",
      body: "L3 → L2",
      specimen: "#TEST-002",
    });
    expect(listLogsByType("molt").length).toBe(before + 1);
  });

  it("addLog defaults date / time to ISO 'YYYY-MM-DD' / 'HH:mm'", () => {
    const e = addLog({
      type: "weight",
      title: "体重 20g",
      body: "20",
      specimen: "#TEST-003",
    });
    expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("addLog persists to localStorage under the documented key", () => {
    addLog({
      type: "mat",
      title: "マット交換",
      body: "完熟マット 10L",
      specimen: "#TEST-004",
    });
    const raw = localStorage.getItem(LS_KEYS.logs);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Array<{ body: string }>;
    expect(parsed[0].body).toBe("完熟マット 10L");
  });
});

describe("updateSpecimenMemo persistence", () => {
  it("returns seed notes (or empty string) before any edit", () => {
    const first = listSpecimens()[0];
    expect(getSpecimenMemo(first.id)).toBe(first.notes ?? "");
  });

  it("updateSpecimenMemo + getSpecimenMemo round-trips a value", () => {
    const id = listSpecimens()[0].id;
    updateSpecimenMemo(id, "今日は活発に活動");
    expect(getSpecimenMemo(id)).toBe("今日は活発に活動");
  });

  it("getSpecimen reflects the persisted memo via notes field", () => {
    const id = listSpecimens()[0].id;
    updateSpecimenMemo(id, "メモ反映確認");
    expect(getSpecimen(id)?.notes).toBe("メモ反映確認");
  });

  it("empty memo override is still respected (clear behaviour)", () => {
    const id = listSpecimens()[0].id;
    updateSpecimenMemo(id, "");
    expect(getSpecimenMemo(id)).toBe("");
  });

  it("memo persists to localStorage under the documented key", () => {
    const id = listSpecimens()[0].id;
    updateSpecimenMemo(id, "永続化確認");
    const raw = localStorage.getItem(LS_KEYS.memos);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Record<string, string>;
    expect(parsed[id]).toBe("永続化確認");
  });

  it("updating one specimen's memo does not affect another", () => {
    const ss = listSpecimens();
    if (ss.length < 2) return; // データ不足なら skip
    updateSpecimenMemo(ss[0].id, "A");
    updateSpecimenMemo(ss[1].id, "B");
    expect(getSpecimenMemo(ss[0].id)).toBe("A");
    expect(getSpecimenMemo(ss[1].id)).toBe("B");
  });
});
