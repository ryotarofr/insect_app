// specimenLogs.test.ts — server logs cache のユニットテスト (happy path 中心)
//
// 既存 specimens.test.ts と同じ vi.stubGlobal("fetch") パターン。
// 並列テスト下で signal が漏れないよう、beforeEach で resetSpecimenLogsForTest を呼ぶ。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshLogsForSpecimen,
  resetSpecimenLogsForTest,
  serverLogsErrorFor,
  serverLogsFor,
  toLogEntry,
} from "./specimenLogs";
import type { SpecimenLogView } from "../sdui/api";

const SPECIMEN_UUID = "00000000-0000-4000-8000-00000000aaaa";

const sampleLog: SpecimenLogView = {
  id: "00000000-0000-4000-8000-000000000111",
  specimenId: SPECIMEN_UUID,
  authorUserId: "00000000-0000-4000-8000-000000000001",
  logType: "weight",
  loggedAt: "2026-04-12",
  loggedAtTime: "09:30:00",
  title: "計測",
  body: "32.4g",
  hasPhoto: false,
  metrics: { weight_g: 32.4 },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetSpecimenLogsForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server specimen logs store", () => {
  it("starts empty for any specimen UUID", () => {
    expect(serverLogsFor(SPECIMEN_UUID)).toBeUndefined();
    expect(serverLogsErrorFor(SPECIMEN_UUID)).toBeUndefined();
  });

  it("refreshLogsForSpecimen() populates the cache on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, [sampleLog])),
    );

    const list = await refreshLogsForSpecimen(SPECIMEN_UUID);
    expect(list).toHaveLength(1);
    expect(serverLogsFor(SPECIMEN_UUID)).toHaveLength(1);
    expect(serverLogsErrorFor(SPECIMEN_UUID)).toBeUndefined();
  });

  it("refreshLogsForSpecimen() captures error and throws on 5xx (cache untouched)", async () => {
    // 先に 200 で cache を埋める
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, [sampleLog])),
    );
    await refreshLogsForSpecimen(SPECIMEN_UUID);
    expect(serverLogsFor(SPECIMEN_UUID)).toHaveLength(1);

    // 次は 5xx で失敗
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: "down" })),
    );
    await expect(refreshLogsForSpecimen(SPECIMEN_UUID)).rejects.toThrow();

    // cache は前回値維持、error にメッセージが入る
    expect(serverLogsFor(SPECIMEN_UUID)).toHaveLength(1);
    expect(serverLogsErrorFor(SPECIMEN_UUID)).toBeTruthy();
  });

  it("recovery: subsequent 200 clears the previous error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: "down" })),
    );
    await expect(refreshLogsForSpecimen(SPECIMEN_UUID)).rejects.toThrow();
    expect(serverLogsErrorFor(SPECIMEN_UUID)).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, [])),
    );
    const list = await refreshLogsForSpecimen(SPECIMEN_UUID);
    expect(list).toEqual([]);
    expect(serverLogsErrorFor(SPECIMEN_UUID)).toBeUndefined();
  });

  it("toLogEntry() maps server fields to mock LogEntry shape", () => {
    const e = toLogEntry(sampleLog, "#DHH-0271");
    expect(e.date).toBe("2026-04-12");
    expect(e.time).toBe("09:30");
    expect(e.type).toBe("weight");
    expect(e.title).toBe("計測");
    expect(e.body).toBe("32.4g");
    expect(e.photo).toBe(false);
    expect(e.specimen).toBe("#DHH-0271");
  });

  it("toLogEntry() handles null loggedAtTime + unknown logType", () => {
    // 「将来 server が追加した未知 enum 値が来た」状況を再現するため、
    //   client 側 narrow 用 SpecimenLogType を意図的に逸脱した value を渡す。
    const unknownLog = {
      ...sampleLog,
      loggedAtTime: null,
      logType: "dance-marathon",
    } as unknown as SpecimenLogView;
    const e = toLogEntry(unknownLog, "#X-1");
    expect(e.time).toBe("");
    expect(e.type).toBe("observation");
  });
});
