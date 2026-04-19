// smoke.test.ts — vitest セットアップ確認
import { describe, expect, it } from "vitest";

describe("vitest setup", () => {
  it("can run a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("has jsdom environment", () => {
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");
  });

  it("has localStorage from jsdom", () => {
    localStorage.setItem("foo", "bar");
    expect(localStorage.getItem("foo")).toBe("bar");
  });
});
