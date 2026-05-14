// scrollMemory.test.ts — pathname ごとの scrollY 記憶の挙動
import { beforeEach, describe, expect, it } from "vitest";
import {
  saveScroll,
  consumeScroll,
  _clearScrollMemory,
} from "./scrollMemory";

beforeEach(() => {
  _clearScrollMemory();
});

describe("scrollMemory", () => {
  it("returns null for unknown pathname", () => {
    expect(consumeScroll("/unknown")).toBeNull();
  });

  it("saves and consumes a value", () => {
    saveScroll("/", 500);
    expect(consumeScroll("/")).toBe(500);
  });

  it("consume deletes the entry (one-shot)", () => {
    saveScroll("/", 500);
    expect(consumeScroll("/")).toBe(500);
    expect(consumeScroll("/")).toBeNull();
  });

  it("save overwrites previous value for same pathname", () => {
    saveScroll("/", 100);
    saveScroll("/", 800);
    expect(consumeScroll("/")).toBe(800);
  });

  it("tracks multiple pathnames independently", () => {
    saveScroll("/", 100);
    saveScroll("/products", 250);
    saveScroll("/specimen/%23DHH-0271", 0);
    expect(consumeScroll("/products")).toBe(250);
    expect(consumeScroll("/")).toBe(100);
    expect(consumeScroll("/specimen/%23DHH-0271")).toBe(0);
  });
});
