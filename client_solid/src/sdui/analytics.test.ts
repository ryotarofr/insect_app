// analytics.test.ts — buffer + flush の単体テスト
//
// **戦略**:
//   - vi.useFakeTimers で 5s タイマを進める
//   - global fetch / navigator.sendBeacon を vi.stubGlobal で差し替える
//   - 各 it 前後で __resetAnalyticsForTest() で内部状態をクリア

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __getBufferForTest,
  __getFlushIntervalMs,
  __getMaxBuffer,
  __hasTimerForTest,
  __resetAnalyticsForTest,
  flush,
  flushBeacon,
  recordEvent,
} from "./analytics";

beforeEach(() => {
  __resetAnalyticsForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("recordEvent", () => {
  it("buffer に積まれる", () => {
    recordEvent({ analyticsId: "home.hero", eventType: "impression" });
    expect(__getBufferForTest()).toHaveLength(1);
    const ev = __getBufferForTest()[0]!;
    expect(ev.analyticsId).toBe("home.hero");
    expect(ev.eventType).toBe("impression");
    expect(typeof ev.timestampMs).toBe("number");
    expect(ev.context).toBeUndefined();
  });

  it("空 context は省略される", () => {
    recordEvent({
      analyticsId: "x",
      eventType: "click",
      context: {},
    });
    expect(__getBufferForTest()[0]!.context).toBeUndefined();
  });

  it("非空 context はそのまま入る", () => {
    recordEvent({
      analyticsId: "x",
      eventType: "click",
      context: { productId: "p-x", variant: "featured" },
    });
    expect(__getBufferForTest()[0]!.context).toEqual({
      productId: "p-x",
      variant: "featured",
    });
  });

  it("analyticsId が空文字なら no-op (buffer 増えない)", () => {
    recordEvent({ analyticsId: "", eventType: "click" });
    expect(__getBufferForTest()).toHaveLength(0);
  });

  it("analyticsId が undefined なら no-op", () => {
    recordEvent({ analyticsId: undefined, eventType: "click" });
    expect(__getBufferForTest()).toHaveLength(0);
  });

  it("最初の record で timer がセットされる", () => {
    expect(__hasTimerForTest()).toBe(false);
    recordEvent({ analyticsId: "x", eventType: "click" });
    expect(__hasTimerForTest()).toBe(true);
  });
});

describe("flush (timer 経過)", () => {
  it("FLUSH_INTERVAL_MS 経過で fetch が呼ばれて buffer が空になる", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    recordEvent({ analyticsId: "a", eventType: "impression" });
    recordEvent({ analyticsId: "b", eventType: "click" });
    expect(__getBufferForTest()).toHaveLength(2);

    // 5s 経過 → setTimeout 発火
    await vi.advanceTimersByTimeAsync(__getFlushIntervalMs());
    // flush 内の await fetch を解決させるため microtask を進める
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/events");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].analyticsId).toBe("a");
    expect(__getBufferForTest()).toHaveLength(0);
  });
});

describe("flush (上限到達)", () => {
  it("buffer が MAX_BUFFER に達した時点で auto-flush される", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const max = __getMaxBuffer();
    for (let i = 0; i < max; i++) {
      recordEvent({ analyticsId: `e${i}`, eventType: "click" });
    }
    // microtask を待って flush の await fetch を完走させる
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.events).toHaveLength(max);
  });
});

describe("flush (手動)", () => {
  it("空 buffer なら fetch を呼ばない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ネットワーク失敗を黙って飲み込む (best-effort)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    recordEvent({ analyticsId: "x", eventType: "click" });
    await expect(flush()).resolves.toBeUndefined();
    // buffer は drain 済み (再送キューは持たない)
    expect(__getBufferForTest()).toHaveLength(0);
  });
});

describe("flushBeacon", () => {
  it("navigator.sendBeacon を blob で呼ぶ", () => {
    const beaconMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon: beaconMock });

    recordEvent({ analyticsId: "x", eventType: "click" });
    flushBeacon();

    expect(beaconMock).toHaveBeenCalledTimes(1);
    const [url, blob] = beaconMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/events");
    expect(blob).toBeInstanceOf(Blob);
    expect(__getBufferForTest()).toHaveLength(0);
  });

  it("空 buffer なら sendBeacon を呼ばない", () => {
    const beaconMock = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon: beaconMock });
    flushBeacon();
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it("sendBeacon が false を返したら fetch にフォールバック", () => {
    const beaconMock = vi.fn().mockReturnValue(false);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("navigator", { sendBeacon: beaconMock });
    vi.stubGlobal("fetch", fetchMock);

    recordEvent({ analyticsId: "x", eventType: "click" });
    flushBeacon();

    expect(beaconMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("sendBeacon 未対応環境でも fetch にフォールバック", () => {
    vi.stubGlobal("navigator", {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    recordEvent({ analyticsId: "x", eventType: "click" });
    flushBeacon();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("visibilitychange ハンドラ", () => {
  it("'hidden' に切り替わったら sendBeacon が呼ばれる", () => {
    const beaconMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon: beaconMock });

    recordEvent({ analyticsId: "x", eventType: "click" });

    // visibility を hidden にして visibilitychange を発火
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(beaconMock).toHaveBeenCalledTimes(1);
  });
});
