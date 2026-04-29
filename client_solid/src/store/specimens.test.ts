// specimens.test.ts — server specimens store のユニットテスト (happy path 中心)
//
// auth.test.ts と同じく fetch を vi.stubGlobal で stub し、API 経路は通さずに
// store の signal 遷移だけを検証する。並列テスト下で signal が漏れないよう、
// beforeEach で resetServerSpecimensForTest を呼ぶ。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearServerSpecimens,
  findServerSpecimenById,
  findServerSpecimenByPublicId,
  isSpecimensLoading,
  refreshMySpecimens,
  resetServerSpecimensForTest,
  serverSpecimens,
  serverSpecimensError,
} from "./specimens";

const sampleA = {
  id: "00000000-0000-4000-8000-00000000aaaa",
  publicId: "#DHH-0271",
  ownerUserId: "00000000-0000-4000-8000-000000000001",
  speciesId: "dhh",
  name: "ヘラクレス 黒曜",
  sex: "male",
  stage: "幼虫 3齢",
  stageProgress: 0.5,
  sizeMm: null,
  weightG: 32.4,
  birthDate: null,
  purchasedAt: null,
  generation: "CBF2",
  eclosionEta: null,
  lifeStatus: "active",
  isArchived: false,
  notes: null,
};

const sampleB = {
  ...sampleA,
  id: "00000000-0000-4000-8000-00000000bbbb",
  publicId: "#DHH-0272",
  name: "ヘラクレス 翡翠",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetServerSpecimensForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server specimens store", () => {
  it("starts empty (null list, not loading, no error)", () => {
    expect(serverSpecimens()).toBeNull();
    expect(isSpecimensLoading()).toBe(false);
    expect(serverSpecimensError()).toBeNull();
  });

  it("refreshMySpecimens() populates the signal on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, [sampleA, sampleB])),
    );

    const list = await refreshMySpecimens();
    expect(list).toHaveLength(2);
    expect(serverSpecimens()).toHaveLength(2);
    expect(isSpecimensLoading()).toBe(false);
    expect(serverSpecimensError()).toBeNull();
  });

  it("refreshMySpecimens() returns null silently on 401 (anonymous)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { error: "unauthorized" })),
    );

    const list = await refreshMySpecimens();
    expect(list).toBeNull();
    expect(serverSpecimens()).toBeNull();
    // 401 は静かな失敗なので error signal は null のまま (= UI に出さない)
    expect(serverSpecimensError()).toBeNull();
  });

  it("refreshMySpecimens() captures error message and throws on 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: "down" })),
    );

    await expect(refreshMySpecimens()).rejects.toThrow();
    // 5xx は明示的なエラーとして残す (= UI でバナー表示等)
    expect(serverSpecimensError()).not.toBeNull();
  });

  it("findServerSpecimenByPublicId / findServerSpecimenById — cache lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, [sampleA, sampleB])),
    );
    await refreshMySpecimens();

    expect(findServerSpecimenByPublicId("#DHH-0272")?.name).toBe("ヘラクレス 翡翠");
    expect(findServerSpecimenByPublicId("#NOPE")).toBeUndefined();
    expect(findServerSpecimenById(sampleA.id)?.publicId).toBe("#DHH-0271");
  });

  it("clearServerSpecimens() resets the signal without fetching", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, [sampleA])),
    );
    await refreshMySpecimens();
    expect(serverSpecimens()).toHaveLength(1);

    clearServerSpecimens();
    expect(serverSpecimens()).toBeNull();
    expect(serverSpecimensError()).toBeNull();
  });

  it("subsequent refresh after error clears the previous error", async () => {
    // 1 回目: 5xx → error にメッセージが入る
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: "down" })),
    );
    await expect(refreshMySpecimens()).rejects.toThrow();
    expect(serverSpecimensError()).not.toBeNull();

    // 2 回目: 200 → error は null に戻る
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, [sampleA])),
    );
    const list = await refreshMySpecimens();
    expect(list).toHaveLength(1);
    expect(serverSpecimensError()).toBeNull();
  });
});
