// logtimeline.test.ts — groupByDate() (P3-23 月区切り & 週末判定) の回帰テスト
import { describe, expect, it } from "vitest";
import { groupByDate } from "./LogTimeline";
import type { LogEntry } from "../../api";

const mk = (date: string, title = "t"): LogEntry => ({
  date,
  time: "09:00",
  type: "observation",
  title,
  body: "",
  photo: false,
  specimen: "#X-0001",
});

describe("groupByDate() — P3-23", () => {
  it("sorts groups newest-first", () => {
    const gs = groupByDate([mk("2026-04-01"), mk("2026-04-15"), mk("2026-04-10")]);
    expect(gs.map((g) => g.date)).toEqual(["2026-04-15", "2026-04-10", "2026-04-01"]);
  });

  it("merges same-day entries into one group", () => {
    const gs = groupByDate([mk("2026-04-20", "a"), mk("2026-04-20", "b")]);
    expect(gs).toHaveLength(1);
    expect(gs[0].items).toHaveLength(2);
  });

  it("marks first (newest) group as month boundary", () => {
    const gs = groupByDate([mk("2026-04-20"), mk("2026-04-15")]);
    expect(gs[0].isMonthBoundary).toBe(true);
  });

  it("marks transition between months as boundary", () => {
    // 4月 → 3月 の境界
    const gs = groupByDate([mk("2026-04-01"), mk("2026-03-28")]);
    expect(gs[0].isMonthBoundary).toBe(true); // 最新
    expect(gs[1].isMonthBoundary).toBe(true); // 月が変わる
  });

  it("does not mark same-month consecutive days as boundary", () => {
    const gs = groupByDate([mk("2026-04-20"), mk("2026-04-19"), mk("2026-04-18")]);
    expect(gs[0].isMonthBoundary).toBe(true);
    expect(gs[1].isMonthBoundary).toBe(false);
    expect(gs[2].isMonthBoundary).toBe(false);
  });

  it("marks year boundary as well", () => {
    const gs = groupByDate([mk("2026-01-03"), mk("2025-12-28")]);
    expect(gs[1].isMonthBoundary).toBe(true);
  });

  it("computes dow correctly (Sunday=0 ... Saturday=6)", () => {
    // 2026-04-18 is Saturday, 2026-04-19 is Sunday, 2026-04-20 is Monday.
    const gs = groupByDate([mk("2026-04-20"), mk("2026-04-19"), mk("2026-04-18")]);
    expect(gs.find((g) => g.date === "2026-04-20")!.dow).toBe(1); // 月
    expect(gs.find((g) => g.date === "2026-04-19")!.dow).toBe(0); // 日
    expect(gs.find((g) => g.date === "2026-04-18")!.dow).toBe(6); // 土
  });

  it("generates readable yearMonth label", () => {
    const gs = groupByDate([mk("2026-04-20")]);
    expect(gs[0].yearMonth).toBe("2026年 4月");
  });
});
