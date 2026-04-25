// api.test.ts — 全フェッチャーのユニットテスト
// データ層（APP_DATA）に依存する薄いラッパー群。フィクスチャの厳密値ではなく、
// 形状と不変条件（sort 順・filter 閾値・存在判定）を検証する。
import { describe, expect, it } from "vitest";
import {
  getCurrentUser,
  listProducts,
  getProduct,
  productExists,
  listSpecimens,
  getSpecimen,
  specimenExists,
  listUrgentEclosion,
  listEclosionForecasts,
  listLogs,
  listLogsBySpecimen,
  listLogsByType,
  listMarketListings,
  getShopStats,
  listOrders,
  getUpcomingActions,
  getAuditLog,
} from "./index";

describe("api/user", () => {
  it("returns a user with required fields", () => {
    const u = getCurrentUser();
    expect(u).toMatchObject({
      name: expect.any(String),
      initial: expect.any(String),
      role: expect.any(String),
      since: expect.any(String),
    });
    expect(u.initial.length).toBeGreaterThanOrEqual(1);
  });
});

describe("api/products", () => {
  it("listProducts returns a non-empty array of products", () => {
    const ps = listProducts();
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/i);
      expect(typeof p.price).toBe("number");
    }
  });

  it("getProduct(id) returns matching product", () => {
    const first = listProducts()[0];
    expect(getProduct(first.id)).toBe(first);
  });

  it("getProduct(nonexistent) returns undefined", () => {
    expect(getProduct("nonexistent-product-id")).toBeUndefined();
  });

  it("productExists reflects getProduct behavior", () => {
    const first = listProducts()[0];
    expect(productExists(first.id)).toBe(true);
    expect(productExists("nonexistent-product-id")).toBe(false);
  });
});

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
    expect(getSpecimen(first.id)).toBe(first);
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

  it("listLogsByType filters by log type", () => {
    const weight = listLogsByType("weight");
    for (const l of weight) {
      expect(l.type).toBe("weight");
    }
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

describe("api/shop", () => {
  it("getShopStats returns numeric fields", () => {
    const s = getShopStats();
    expect(typeof s.todayRevenue).toBe("number");
    expect(typeof s.todayOrders).toBe("number");
    expect(typeof s.pendingShip).toBe("number");
    expect(typeof s.lowStock).toBe("number");
    expect(Array.isArray(s.revenue7d)).toBe(true);
    expect(s.revenue7d.length).toBe(7);
  });

  it("listOrders returns orders with required fields", () => {
    const orders = listOrders();
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      expect(o.id).toMatch(/^/);
      expect(typeof o.total).toBe("number");
      expect(typeof o.status).toBe("string");
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
