// auth.test.ts — login state store のユニットテスト
//
// fetch を vi.stubGlobal で stub し、API 経路は通さずに store の signal 遷移を検証する。
// 並列テスト下で signal が漏れないよう beforeEach で resetAuthForTest を呼ぶ。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentUser,
  currentUserId,
  isLoggedIn,
  login,
  logout,
  refreshMe,
  register,
  resetAuthForTest,
} from "./auth";

const sampleMe = {
  userId: "00000000-0000-4000-8000-000000000001",
  publicId: "alice",
  name: "Alice",
  email: "alice@example.com",
  role: "breeder",
  avatarInitial: "A",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

beforeEach(() => {
  resetAuthForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth store", () => {
  it("starts anonymous (null user / not logged in)", () => {
    expect(currentUser()).toBeNull();
    expect(isLoggedIn()).toBe(false);
    expect(currentUserId()).toBeNull();
  });

  it("login() sets the signal on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, sampleMe)),
    );

    const me = await login({ email: "alice@example.com", password: "longenough" });
    expect(me.publicId).toBe("alice");
    expect(currentUser()?.publicId).toBe("alice");
    expect(isLoggedIn()).toBe(true);
    expect(currentUserId()).toBe(sampleMe.userId);
  });

  it("login() throws on 401 and leaves signal anonymous", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { error: "unauthorized" })),
    );

    await expect(
      login({ email: "alice@example.com", password: "wrong" }),
    ).rejects.toThrow();
    expect(currentUser()).toBeNull();
    expect(isLoggedIn()).toBe(false);
  });

  it("register() sets the signal on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, sampleMe)),
    );

    const me = await register({
      publicId: "alice",
      name: "Alice",
      email: "alice@example.com",
      password: "longenough",
      avatarInitial: "A",
    });
    expect(me.publicId).toBe("alice");
    expect(isLoggedIn()).toBe(true);
  });

  it("logout() clears signal even if server returns error", async () => {
    // 先に login 状態にしておく
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, sampleMe)),
    );
    await login({ email: "alice@example.com", password: "longenough" });
    expect(isLoggedIn()).toBe(true);

    // logout の fetch は 500 を返すが、store は null にする
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(500, { error: "boom" })),
    );
    await expect(logout()).rejects.toThrow();
    expect(currentUser()).toBeNull();
    expect(isLoggedIn()).toBe(false);
  });

  it("logout() succeeds with 204 no-content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, sampleMe)),
    );
    await login({ email: "alice@example.com", password: "longenough" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => noContentResponse()),
    );
    await expect(logout()).resolves.toBeUndefined();
    expect(isLoggedIn()).toBe(false);
  });

  it("refreshMe() returns null silently on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { error: "unauthorized" })),
    );
    const r = await refreshMe();
    expect(r).toBeNull();
    expect(isLoggedIn()).toBe(false);
  });

  it("refreshMe() throws on 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(503, { error: "down" })),
    );
    await expect(refreshMe()).rejects.toThrow();
  });

  it("refreshMe() restores signal from cookie session on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, sampleMe)),
    );
    const r = await refreshMe();
    expect(r?.publicId).toBe("alice");
    expect(isLoggedIn()).toBe(true);
  });
});
