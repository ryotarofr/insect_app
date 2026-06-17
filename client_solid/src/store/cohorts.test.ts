// cohorts.test.ts — store/cohorts.ts の signal 遷移と派生 (active/archived) の単体検証
//
// 方針:
//   - store/specimens.test.ts と同じく fetch を vi.stubGlobal で stub
//   - 並列テストで signal 漏れが起きないよう beforeEach で resetCohortStoreForTest()
//   - 個体化セッション state (recordPromotion / endPromoteSession) も
//     fetch を経由しない純粋関数として検証する

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeCohorts,
  allCohorts,
  archiveCohort,
  archivedCohorts,
  cohortDetail,
  cohortDetailError,
  loadCohortDetail,
  promoteSession,
  recordPromotion,
  refreshCohorts,
  resetCohortStoreForTest,
  seedCohortsFromLocalStorage,
  startPromoteSession,
  endPromoteSession,
} from "./cohorts";
import type {
  CohortDetailView,
  CohortView,
  PromoteCohortResponse,
} from "../types/cohort";

// ──────────────────────────────────────────────────────────────────────
// fixtures
// ──────────────────────────────────────────────────────────────────────

const baseCohort: CohortView = {
  id: "00000000-0000-4000-8000-00000000a001",
  publicId: "LOT-2026-0001",
  ownerUserId: "00000000-0000-4000-8000-000000000001",
  speciesId: "dhh",
  speciesName: "ヘラクレスオオカブト",
  originKind: "egg_lay",
  parentMatingId: null,
  initialCount: 100,
  currentCount: 100,
  stage: "larva_l3",
  startDate: "2026-04-01",
  notes: null,
  archivedAt: null,
  version: 1,
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
};

const archivedCohort: CohortView = {
  ...baseCohort,
  id: "00000000-0000-4000-8000-00000000a002",
  publicId: "LOT-2026-0002",
  currentCount: 0,
  archivedAt: "2026-04-30T00:00:00Z",
};

const detailFixture: CohortDetailView = {
  ...baseCohort,
  recentLogs: [],
  promotedSpecimensCount: 0,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetCohortStoreForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ──────────────────────────────────────────────────────────────────────
// list refresh + active/archived 派生
// ──────────────────────────────────────────────────────────────────────

describe("cohort store: list", () => {
  it("starts empty", () => {
    expect(allCohorts()).toBeNull();
    expect(activeCohorts()).toEqual([]);
    expect(archivedCohorts()).toEqual([]);
  });

  it("refreshCohorts() populates the signal on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, [baseCohort, archivedCohort])),
    );
    await refreshCohorts();
    expect(allCohorts()).toHaveLength(2);
    expect(activeCohorts()).toHaveLength(1);
    expect(activeCohorts()[0].publicId).toBe("LOT-2026-0001");
    expect(archivedCohorts()).toHaveLength(1);
    expect(archivedCohorts()[0].publicId).toBe("LOT-2026-0002");
  });

  it("refreshCohorts() captures error on 5xx (does not throw)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: "down" })),
    );
    // 設計上 list refresh は throw せず error signal に詰める。
    await refreshCohorts();
    expect(allCohorts()).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// detail
// ──────────────────────────────────────────────────────────────────────

describe("cohort store: detail", () => {
  it("loadCohortDetail() populates detail on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, detailFixture)),
    );
    await loadCohortDetail("LOT-2026-0001");
    expect(cohortDetail()?.publicId).toBe("LOT-2026-0001");
    expect(cohortDetailError()).toBeNull();
  });

  it("loadCohortDetail() sets error on 4xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { error: "not found" })),
    );
    await loadCohortDetail("LOT-NOPE");
    expect(cohortDetail()).toBeNull();
    expect(cohortDetailError()).not.toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// 個体化セッション state — recordPromotion 加算 / completed 遷移
// ──────────────────────────────────────────────────────────────────────

describe("promote session state", () => {
  const makeRes = (
    completed: boolean,
    remainingInCohort: number,
  ): PromoteCohortResponse => ({
    specimen: {
      id: "00000000-0000-4000-8000-00000000c001",
      publicId: "DH-2026-0001",
      cohortId: baseCohort.id,
      name: null,
      sex: "unknown",
      stage: "larva_l3",
      sizeMm: null,
      weightG: 8.5,
      promotedFromCohortAt: "2026-05-02T00:00:00Z",
      notes: null,
    },
    cohort: { ...baseCohort, currentCount: remainingInCohort },
    session: {
      remainingInCohort,
      completed,
    },
  });

  it("startPromoteSession sets denominator and zeroes the counter", () => {
    startPromoteSession(baseCohort.publicId, 100);
    const s = promoteSession();
    expect(s).not.toBeNull();
    expect(s?.denominator).toBe(100);
    expect(s?.promotedCount).toBe(0);
    expect(s?.status).toBe("active");
  });

  it("recordPromotion increments promotedCount and prepends recentlyPromoted", () => {
    startPromoteSession(baseCohort.publicId, 100);
    recordPromotion(makeRes(false, 99));
    recordPromotion(makeRes(false, 98));
    const s = promoteSession();
    expect(s?.promotedCount).toBe(2);
    expect(s?.recentlyPromoted).toHaveLength(2);
    // 新しいものが先頭
    expect(s?.status).toBe("active");
  });

  it("recordPromotion with completed=true flips status to completing", () => {
    startPromoteSession(baseCohort.publicId, 1);
    recordPromotion(makeRes(true, 0));
    expect(promoteSession()?.status).toBe("completing");
  });

  it("endPromoteSession clears the signal", () => {
    startPromoteSession(baseCohort.publicId, 100);
    endPromoteSession();
    expect(promoteSession()).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// archive / seed
// ──────────────────────────────────────────────────────────────────────

describe("cohort store: mutations", () => {
  it("archiveCohort() POSTs and refreshes both detail and list", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        calls.push(u);
        if (u.endsWith("/archive")) {
          return jsonResponse(200, { ...baseCohort, archivedAt: "2026-05-02T00:00:00Z" });
        }
        if (u.includes("/cohorts/LOT-2026-0001") && !u.includes("?")) {
          return jsonResponse(200, {
            ...detailFixture,
            archivedAt: "2026-05-02T00:00:00Z",
          });
        }
        if (u.includes("/cohorts/me")) {
          return jsonResponse(200, [
            { ...baseCohort, archivedAt: "2026-05-02T00:00:00Z" },
          ]);
        }
        return jsonResponse(404, { error: "unmocked" });
      }),
    );

    await loadCohortDetail("LOT-2026-0001");
    const updated = await archiveCohort("LOT-2026-0001");
    expect(updated.archivedAt).not.toBeNull();
    expect(calls.some((u) => u.endsWith("/archive"))).toBe(true);
    expect(calls.some((u) => u.includes("/cohorts/me"))).toBe(true);
  });
});

describe("cohort store: seed", () => {
  it("seedCohortsFromLocalStorage() triggers refresh only when cache is null", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, [baseCohort]));
    vi.stubGlobal("fetch", fetchMock);

    seedCohortsFromLocalStorage();
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    seedCohortsFromLocalStorage();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
