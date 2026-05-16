// TrackImpression.test.tsx — IntersectionObserver 連携 (mock) と fallback 挙動

import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __getBufferForTest,
  __resetAnalyticsForTest,
} from "./analytics";
import { AnalyticsCardProvider } from "./AnalyticsContext";
import { TrackImpression } from "./TrackImpression";

beforeEach(() => {
  __resetAnalyticsForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TrackImpression (no IntersectionObserver = jsdom default)", () => {
  it("IO 未対応環境では mount 時に impression を即発火", () => {
    // jsdom には IntersectionObserver が無いので何も stub しない
    render(() => (
      <TrackImpression analyticsId="block.x">
        <span>child</span>
      </TrackImpression>
    ));
    const buf = __getBufferForTest();
    expect(buf).toHaveLength(1);
    expect(buf[0]!.analyticsId).toBe("block.x");
    expect(buf[0]!.eventType).toBe("impression");
  });

  it("analyticsId 空文字なら何も発火しない (= no-op wrapper)", () => {
    render(() => (
      <TrackImpression analyticsId="">
        <span>child</span>
      </TrackImpression>
    ));
    expect(__getBufferForTest()).toHaveLength(0);
  });

  it("AnalyticsCardProvider 配下なら ambient context が乗る", () => {
    render(() => (
      <AnalyticsCardProvider
        value={{
          cardId: "p-x",
          variant: "featured",
          experiment: { key: "k", bucket: "B" },
        }}
      >
        <TrackImpression analyticsId="block.x" context={{ productId: "p-x" }}>
          <span>child</span>
        </TrackImpression>
      </AnalyticsCardProvider>
    ));
    const ev = __getBufferForTest()[0]!;
    expect(ev.context).toEqual({
      cardId: "p-x",
      variant: "featured",
      experimentKey: "k",
      experimentBucket: "B",
      productId: "p-x",
    });
  });

  it("data-track-impression 属性が付く", () => {
    const { container } = render(() => (
      <TrackImpression analyticsId="block.y">
        <span>child</span>
      </TrackImpression>
    ));
    expect(
      container.querySelector("[data-track-impression='block.y']"),
    ).not.toBeNull();
  });
});

describe("TrackImpression (with IntersectionObserver mock)", () => {
  it("isIntersecting=true の callback で 1 回だけ発火、disconnect される", () => {
    let observerCallback:
      | ((entries: Array<{ isIntersecting: boolean }>) => void)
      | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const unobserve = vi.fn();
    const ctor = vi.fn().mockImplementation((cb: typeof observerCallback) => {
      observerCallback = cb;
      return { observe, disconnect, unobserve };
    });
    vi.stubGlobal("IntersectionObserver", ctor);

    render(() => (
      <TrackImpression analyticsId="block.io">
        <span>child</span>
      </TrackImpression>
    ));

    // mount 時は impression まだ発火しない (IO callback 待ち)
    expect(__getBufferForTest()).toHaveLength(0);
    expect(observe).toHaveBeenCalledTimes(1);

    // IO callback を発火 (見えた状態)
    observerCallback!([{ isIntersecting: true }]);
    expect(__getBufferForTest()).toHaveLength(1);
    expect(disconnect).toHaveBeenCalledTimes(1);

    // 2 度目の callback でも追加発火しない
    observerCallback!([{ isIntersecting: true }]);
    expect(__getBufferForTest()).toHaveLength(1);
  });

  it("isIntersecting=false の callback では発火しない", () => {
    let cb: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    const ctor = vi.fn().mockImplementation((c: typeof cb) => {
      cb = c;
      return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
    });
    vi.stubGlobal("IntersectionObserver", ctor);

    render(() => (
      <TrackImpression analyticsId="block.io">
        <span>child</span>
      </TrackImpression>
    ));
    cb!([{ isIntersecting: false }]);
    expect(__getBufferForTest()).toHaveLength(0);
  });
});
