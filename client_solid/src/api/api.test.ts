// api.test.ts — 全フェッチャーのユニットテスト
// データ層（APP_DATA / store）に依存する薄いラッパー群。フィクスチャの厳密値ではなく、
// 形状と不変条件（sort 順・filter 閾値・存在判定）を検証する。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  // C2C pivot: listProducts / getProduct / productExists は listings 由来に変わり、
  // 専用テストは削除済み。Product 型 import も同時に削除。
  listSpecimens,
  getSpecimen,
  specimenExists,
  listUrgentEclosion,
  listEclosionForecasts,
  listLogs,
  listLogsBySpecimen,
  listMarketListings,
  getUpcomingActions,
  getAuditLog,
} from "./index";
// C2C pivot: store/products は廃止 (= api/products.ts は serverListings() 起点に変更)。
//   product 系テストは listings store を seed して実施する。
import {
  resetServerSpecimensForTest,
  setServerSpecimensForTest,
} from "../store/specimens";
import { setSpeciesForTest, resetSpeciesForTest } from "../store/species";
import { setMyLogsForTest, resetMyLogsForTest } from "../store/myLogs";
import {
  setListingsForTest,
  resetListingsForTest,
} from "../store/listings";
import type {
  ListingViewWithCounts,
  SpecimenLogView,
  SpecimenView,
} from "../sdui/api";

// specimens は server の /api/v1/specimens/me から fetch する設計に移行済 (PR #5a)。
// 単体テストでは fetch を経由せず、store/specimens に直接フィクスチャを仕込む。
// `eclosionEta` は今日から +7日 / +30日 / null の 3 パターンを混ぜて閾値テストを満たす。
const todayPlus = (days: number): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const specimensFixture: SpecimenView[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    publicId: "#DHH-0271",
    ownerUserId: "a0a0a0a0-0000-4000-8000-00000000a0a0",
    speciesId: "dhh",
    name: "ヘラクレス 黒曜",
    sex: "male",
    stage: "蛹",
    stageProgress: 0.72,
    sizeMm: 142,
    weightG: 28.4,
    birthDate: "2024-08-12",
    purchasedAt: "2025-11-03",
    generation: "CBF2",
    eclosionEta: todayPlus(7),
    lifeStatus: "active",
    isArchived: false,
    notes: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    publicId: "#CAT-0118",
    ownerUserId: "a0a0a0a0-0000-4000-8000-00000000a0a0",
    speciesId: "cat",
    name: "コーカサス 雷",
    sex: "male",
    stage: "幼虫 3齢",
    stageProgress: 0.35,
    sizeMm: 95,
    weightG: 52,
    birthDate: "2025-09-01",
    purchasedAt: "2026-01-12",
    generation: "CBF3",
    eclosionEta: todayPlus(45),
    lifeStatus: "active",
    isArchived: false,
    notes: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    publicId: "#DHH-0244",
    ownerUserId: "a0a0a0a0-0000-4000-8000-00000000a0a0",
    speciesId: "dhh",
    name: "マリア",
    sex: "female",
    stage: "成虫",
    stageProgress: 1,
    sizeMm: 66,
    weightG: 12.1,
    birthDate: "2023-06-20",
    purchasedAt: "2024-05-01",
    generation: "CBF1",
    eclosionEta: null,
    lifeStatus: "active",
    isArchived: false,
    notes: null,
  },
];

// PR-7: listings は server の /api/v1/listings から fetch する設計に移行済。
// fixture は seller_name / bid_count / watcher_count を含む拡張形 (= server-side で集約)。
const listingsFixture: ListingViewWithCounts[] = [
  {
    id: "11111111-aaaa-4111-8111-111111111111",
    publicId: "L-0421",
    sellerUserId: "a0a0a0a0-0000-4000-8000-00000000a0a0",
    sellerName: "山田 徹",
    specimenId: null,
    title: "ヘラクレス♂ 148mm 自家累代CBF3",
    description: null,
    isAuction: true,
    startingPriceJpy: 50000,
    currentPriceJpy: 52000,
    endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: "active",
    isVerified: true,
    bidCount: 7,
    watcherCount: 34,
  },
  {
    id: "22222222-aaaa-4222-8222-222222222222",
    publicId: "L-0419",
    sellerUserId: "b0b0b0b0-0000-4000-8000-00000000b0b0",
    sellerName: "KUWAGATA.jp",
    specimenId: null,
    title: "コーカサス幼虫 3齢ペア 55g/32g",
    description: null,
    isAuction: false,
    startingPriceJpy: 18000,
    currentPriceJpy: null,
    endsAt: null,
    status: "active",
    isVerified: true,
    bidCount: 0,
    watcherCount: 12,
  },
];

// PR #6: logs は server の /api/v1/me/logs から fetch する設計に移行済。
// fixture を beforeEach で setMyLogsForTest に流し込む。
// specimenId は specimensFixture[0] (= #DHH-0271) の UUID と一致させる。
const logsFixture: SpecimenLogView[] = [
  {
    id: "aaaa1111-1111-4111-8111-111111111111",
    specimenId: "11111111-1111-4111-8111-111111111111",
    authorUserId: "a0a0a0a0-0000-4000-8000-00000000a0a0",
    logType: "weight",
    loggedAt: "2026-04-15",
    loggedAtTime: "22:03:00",
    title: "体重測定",
    body: "52.0g → 52.8g",
    hasPhoto: false,
    metrics: {},
  },
  {
    id: "aaaa2222-2222-4222-8222-222222222222",
    specimenId: "11111111-1111-4111-8111-111111111111",
    authorUserId: "a0a0a0a0-0000-4000-8000-00000000a0a0",
    logType: "observation",
    loggedAt: "2026-04-18",
    loggedAtTime: "21:40:00",
    title: "蛹室確認",
    body: "蛹室の壁が硬くなった",
    hasPhoto: true,
    metrics: {},
  },
];

// C2C pivot: 旧 productFixture (= B2C 商品) は廃止。listings 由来テストのみ残す。

// specimens / species / logs / listings fixture を全テスト前に仕込む。
// (= specimens / logs / audit / metrics / market の各 describe ブロックが依存)
beforeEach(() => {
  setServerSpecimensForTest(specimensFixture);
  setSpeciesForTest([
    { id: "dhh", name: "ヘラクレスオオカブト", sciName: "Dynastes hercules hercules", region: "中南米" },
    { id: "cat", name: "コーカサスオオカブト", sciName: "Chalcosoma chiron", region: "東南アジア" },
  ]);
  setMyLogsForTest(logsFixture);
  setListingsForTest(listingsFixture);
});
afterEach(() => {
  resetServerSpecimensForTest();
  resetSpeciesForTest();
  resetMyLogsForTest();
  resetListingsForTest();
});

// C2C pivot: api/products は listings 由来に変わったため、専用テストは削除。
// listings 起点の振る舞いは下の "api/listings" describe に集約済み。

describe("api/specimens", () => {
  it("listSpecimens returns specimens with ID and eclosionInDays", () => {
    const ss = listSpecimens();
    expect(ss.length).toBeGreaterThan(0);
    for (const s of ss) {
      expect(s.id).toMatch(/^#/);
      expect(typeof s.name).toBe("string");
      // eclosionInDays may be null for already-eclosed specimens
      expect(s.eclosionInDays === null || typeof s.eclosionInDays === "number").toBe(true);
    }
  });

  it("getSpecimen(id) finds by id, undefined if missing", () => {
    const first = listSpecimens()[0];
    // PR #5a: normalize で都度新オブジェクトを生成するため reference 等価から value 等価に変更。
    expect(getSpecimen(first.id)).toEqual(first);
    expect(getSpecimen("#NONEXISTENT")).toBeUndefined();
  });

  it("specimenExists mirrors getSpecimen", () => {
    const first = listSpecimens()[0];
    expect(specimenExists(first.id)).toBe(true);
    expect(specimenExists("#NONEXISTENT")).toBe(false);
  });

  it("listUrgentEclosion(maxDays) filters by threshold and excludes null", () => {
    const urgent = listUrgentEclosion(60);
    for (const s of urgent) {
      expect(s.eclosionInDays).not.toBeNull();
      expect(s.eclosionInDays).toBeLessThan(60);
    }
    // lower threshold produces subset
    const veryUrgent = listUrgentEclosion(10);
    expect(veryUrgent.length).toBeLessThanOrEqual(urgent.length);
  });

  it("listUrgentEclosion default threshold is 60", () => {
    expect(listUrgentEclosion()).toEqual(listUrgentEclosion(60));
  });

  it("listEclosionForecasts is sorted ascending by eclosionInDays", () => {
    const forecasts = listEclosionForecasts();
    for (let i = 1; i < forecasts.length; i++) {
      expect(forecasts[i].eclosionInDays).toBeGreaterThanOrEqual(
        forecasts[i - 1].eclosionInDays,
      );
    }
    // all entries must have non-null eclosionInDays
    for (const s of forecasts) {
      expect(s.eclosionInDays).not.toBeNull();
    }
  });
});

describe("api/logs", () => {
  it("listLogs returns entries with expected shape", () => {
    const ls = listLogs();
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) {
      expect(l).toMatchObject({
        date: expect.any(String),
        type: expect.any(String),
        title: expect.any(String),
        specimen: expect.any(String),
      });
    }
  });

  it("listLogsBySpecimen filters by specimen id", () => {
    const specimenId = listSpecimens()[0].id;
    const filtered = listLogsBySpecimen(specimenId);
    for (const l of filtered) {
      expect(l.specimen).toBe(specimenId);
    }
  });

  it("listLogsBySpecimen returns [] for unknown specimen", () => {
    expect(listLogsBySpecimen("#NONEXISTENT")).toEqual([]);
  });
});

describe("api/market", () => {
  it("listMarketListings returns listings with price and seller", () => {
    const ls = listMarketListings();
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) {
      expect(typeof l.price).toBe("number");
      expect(typeof l.seller).toBe("string");
      expect(typeof l.auction).toBe("boolean");
    }
  });
});

describe("api/nextActions", () => {
  it("returns UpcomingAction[] with required shape", () => {
    const actions = getUpcomingActions(7);
    expect(Array.isArray(actions)).toBe(true);
    for (const a of actions) {
      expect(["feed", "mat", "weigh", "eclosion"]).toContain(a.kind);
      expect(["overdue", "today", "soon"]).toContain(a.priority);
      expect(typeof a.specimenId).toBe("string");
      expect(typeof a.specimenName).toBe("string");
      expect(typeof a.dueInDays).toBe("number");
      expect(typeof a.label).toBe("string");
    }
  });

  it("returns actions sorted by dueInDays ascending (overdue first)", () => {
    const actions = getUpcomingActions(7);
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i].dueInDays).toBeGreaterThanOrEqual(
        actions[i - 1].dueInDays,
      );
    }
  });

  it("priority matches dueInDays sign", () => {
    for (const a of getUpcomingActions(7)) {
      if (a.dueInDays < 0) expect(a.priority).toBe("overdue");
      else if (a.dueInDays === 0) expect(a.priority).toBe("today");
      else expect(a.priority).toBe("soon");
    }
  });

  it("horizonDays filters out farther-future predictions", () => {
    const near = getUpcomingActions(3);
    for (const a of near) {
      expect(a.dueInDays).toBeLessThanOrEqual(3);
    }
  });

  it("includes eclosion actions only when eclosionInDays is set and within horizon", () => {
    const actions = getUpcomingActions(7);
    const eclosionActions = actions.filter((a) => a.kind === "eclosion");
    for (const a of eclosionActions) {
      expect(a.dueInDays).toBeLessThanOrEqual(7);
    }
  });
});

describe("api/audit (P4-21)", () => {
  it("returns entries for a registered specimen", () => {
    const first = listSpecimens()[0];
    const entries = getAuditLog(first.id);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.date).toBe("string");
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof e.event).toBe("string");
      expect(typeof e.actor).toBe("string");
    }
  });

  it("sorts entries in descending date order", () => {
    const first = listSpecimens()[0];
    const entries = getAuditLog(first.id);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].date >= entries[i].date).toBe(true);
    }
  });

  it("returns a fallback entry for unknown ids", () => {
    const entries = getAuditLog("#UNKNOWN-0000");
    expect(entries.length).toBeGreaterThan(0);
  });

  it("is deterministic — same id yields same log", () => {
    const first = listSpecimens()[0];
    const a = getAuditLog(first.id);
    const b = getAuditLog(first.id);
    expect(a).toEqual(b);
  });

  it("includes 個体登録 row for every registered specimen", () => {
    for (const s of listSpecimens()) {
      const entries = getAuditLog(s.id);
      const hasRegister = entries.some((e) =>
        e.event.startsWith("個体登録"),
      );
      expect(hasRegister).toBe(true);
    }
  });
});
