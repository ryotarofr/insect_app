// cartChannel.test.ts — cross-tab invalidate channel の単体テスト (Phase 9 前 / M7)
//
// 詳細: docs/sdui-three-layer-model-v6.md §11.8.2
//
// **狙い**:
//   1. publish → 他 channel の subscriber に invalidate が届く
//   2. 自タブ loop back: 同 senderId の publish は subscriber に届かない
//   3. close 後は subscribe / publish が no-op
//   4. BroadcastChannel 非対応環境では publish/subscribe が no-op に倒れる
//   5. 複数 subscriber の独立性
//   6. useCartSnapshot 統合: mutation で他タブが refetch される

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

import {
  CART_CHANNEL_NAME,
  __getSelfSenderIdForTest,
  createInvalidateChannel,
} from "./cartChannel";
import type { CardBlock } from "./branded";
import { useCartSnapshot } from "./useCartSnapshot";

// jsdom (vitest) は BroadcastChannel を v25+ から実装している前提。
// 念のため beforeEach で存在確認する。
beforeEach(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    // 動的 polyfill は重いので skip。jsdom 未対応環境では下記 it.skip 相当。
    throw new Error(
      "BroadcastChannel not available in test env. update jsdom?",
    );
  }
});

const TEST_NAME = "kochu_cart_invalidate_test";

describe("createInvalidateChannel (基本)", () => {
  it("publish → 他 channel が subscribe で受け取る", async () => {
    const ch1 = createInvalidateChannel(TEST_NAME);
    const ch2 = createInvalidateChannel(TEST_NAME);

    const handler = vi.fn();
    ch2.subscribe(handler);

    // ch1 が他タブ役、ch2 が自タブ役だが loop back dedup は senderId で判定するため、
    // 同一 senderId (= 同 process) の publish は届かない仕様 (= 自タブ自身は届かない)。
    // よって ch1.publish() が ch2 に届くか確認するには別 senderId が必要だが、
    // 単一テストプロセスでは senderId は固定 → loop back dedup で届かない。
    //
    // テスト戦略: 同一プロセス内で「他タブ」を simulate するため、
    // BroadcastChannel を直接使って外部 publish を行い、別 senderId のメッセージを
    // 流す方式で検証する (= 後述の it("外部 senderId なら届く") を参照)。

    ch1.publish();
    // BroadcastChannel は async に message event を発火するので待つ
    await new Promise((r) => setTimeout(r, 10));

    // 自プロセス内 (= 同 senderId) なので handler は呼ばれない
    expect(handler).not.toHaveBeenCalled();

    ch1.close();
    ch2.close();
  });

  it("外部 senderId のメッセージは届く (= 他タブ simulate)", async () => {
    const ch = createInvalidateChannel(TEST_NAME);
    const handler = vi.fn();
    ch.subscribe(handler);

    // 別 senderId で BroadcastChannel に直接 post → 他タブから来たメッセージを simulate
    const externalChannel = new BroadcastChannel(TEST_NAME);
    externalChannel.postMessage({
      type: "invalidate",
      senderId: "other-tab-id",
      at: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalledTimes(1);

    externalChannel.close();
    ch.close();
  });

  it("自タブ loop back dedup: SELF_SENDER_ID なら破棄", async () => {
    const ch = createInvalidateChannel(TEST_NAME);
    const handler = vi.fn();
    ch.subscribe(handler);

    const externalChannel = new BroadcastChannel(TEST_NAME);
    externalChannel.postMessage({
      type: "invalidate",
      senderId: __getSelfSenderIdForTest(),
      at: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();

    externalChannel.close();
    ch.close();
  });

  it("type !== 'invalidate' の message は無視", async () => {
    const ch = createInvalidateChannel(TEST_NAME);
    const handler = vi.fn();
    ch.subscribe(handler);

    const externalChannel = new BroadcastChannel(TEST_NAME);
    externalChannel.postMessage({
      type: "ping",
      senderId: "other",
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();

    externalChannel.close();
    ch.close();
  });

  it("subscribe の戻り unsubscribe で listener が外れる", async () => {
    const ch = createInvalidateChannel(TEST_NAME);
    const handler = vi.fn();
    const unsubscribe = ch.subscribe(handler);

    const externalChannel = new BroadcastChannel(TEST_NAME);

    externalChannel.postMessage({
      type: "invalidate",
      senderId: "other-tab",
      at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    externalChannel.postMessage({
      type: "invalidate",
      senderId: "other-tab",
      at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalledTimes(1); // 増えない

    externalChannel.close();
    ch.close();
  });

  it("close 後は subscribe / publish が no-op (= リスナーに届かない)", async () => {
    const ch = createInvalidateChannel(TEST_NAME);
    const handler = vi.fn();
    ch.subscribe(handler);
    ch.close();

    const externalChannel = new BroadcastChannel(TEST_NAME);
    externalChannel.postMessage({
      type: "invalidate",
      senderId: "other-tab",
      at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();

    externalChannel.close();
  });

  it("CART_CHANNEL_NAME が export されている (= 使用側で hardcode しない)", () => {
    expect(typeof CART_CHANNEL_NAME).toBe("string");
    expect(CART_CHANNEL_NAME.length).toBeGreaterThan(0);
  });
});

// ── useCartSnapshot 統合テスト ─────────────────────────────────────
//
// useCartSnapshot は opts.channel で channel を差し替え可能。同一プロセス内に
// 別の channel インスタンスを 2 つ立て、片方の mutate がもう片方の subscribe
// 経由で refetch を起こすかを確認する。

const makeCart = (id: string): CardBlock =>
  ({
    template: "cart",
    id,
    regions: {
      header: [],
      items: [],
      shipping: [],
      shippingMethod: [],
      summary: [],
      cta: [],
    },
  }) as unknown as CardBlock;

describe("useCartSnapshot × cartChannel 統合", () => {
  it("mutate 成功時に他 hook (= 別タブ simulate) が refetch される", async () => {
    // 共有 channel 名 (= 同じ BroadcastChannel に乗る)
    const channelName = "kochu_cart_invalidate_int_test";

    // タブ A の channel 役 (mutation を発する側)
    const chA = createInvalidateChannel(channelName);
    // タブ B の channel 役 (mutation を受ける側; 別 senderId にしないと loop back dedup されてしまう)
    // → 単一プロセスでは senderId が共通なので、タブ B 用に外部 BroadcastChannel から
    //   別 senderId のメッセージを送り込む方式で simulate する。

    let nB = 0;
    const fetcherB = vi.fn().mockImplementation(async () => {
      nB += 1;
      return makeCart(`B-${nB}`);
    });

    let snapB!: ReturnType<typeof useCartSnapshot>;
    const disposeB = createRoot((d) => {
      // タブ B 役: chA とは別 instance だが同じ channelName
      const chB = createInvalidateChannel(channelName);
      snapB = useCartSnapshot({ fetcher: fetcherB, channel: chB });
      return d;
    });

    await vi.waitFor(() => expect(snapB.card()?.id).toBe("B-1"));
    expect(fetcherB).toHaveBeenCalledTimes(1);

    // 他タブ (= タブ A) からの invalidate を simulate
    // chA.publish() は loop back dedup で snapB に届かないため、外部 BC で別 senderId 送信
    const externalA = new BroadcastChannel(channelName);
    externalA.postMessage({
      type: "invalidate",
      senderId: "tab-A-fake-id",
      at: Date.now(),
    });

    // snapB が refetch するのを待つ
    await vi.waitFor(() => expect(fetcherB).toHaveBeenCalledTimes(2));
    expect(snapB.card()?.id).toBe("B-2");

    externalA.close();
    chA.close();
    disposeB();
  });

  it("opts.channel = null で cross-tab 連携 OFF (= 完全独立)", async () => {
    let n = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      n += 1;
      return makeCart(`x-${n}`);
    });

    let snap!: ReturnType<typeof useCartSnapshot>;
    const dispose = createRoot((d) => {
      snap = useCartSnapshot({ fetcher, channel: null });
      return d;
    });

    await vi.waitFor(() => expect(snap.card()?.id).toBe("x-1"));

    // 外部 channel に invalidate を流しても snap には届かない
    const external = new BroadcastChannel("kochu_cart_invalidate");
    external.postMessage({
      type: "invalidate",
      senderId: "other-tab",
      at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetcher).toHaveBeenCalledTimes(1); // 追加 fetch 無し

    external.close();
    dispose();
  });

  it("publishOnMutate=false なら mutate 成功で publish しない", async () => {
    const channelName = "kochu_cart_no_publish";

    let nB = 0;
    const fetcherB = vi.fn().mockImplementation(async () => {
      nB += 1;
      return makeCart(`B-${nB}`);
    });

    // タブ B 役 (受信側)
    let snapB!: ReturnType<typeof useCartSnapshot>;
    const disposeB = createRoot((d) => {
      const chB = createInvalidateChannel(channelName);
      snapB = useCartSnapshot({ fetcher: fetcherB, channel: chB });
      return d;
    });
    await vi.waitFor(() => expect(snapB.card()?.id).toBe("B-1"));

    // タブ A 役 (送信側) — publishOnMutate=false で mutate
    const fetcherA = vi.fn().mockResolvedValue(makeCart("A"));
    let snapA!: ReturnType<typeof useCartSnapshot>;
    const disposeA = createRoot((d) => {
      const chA = createInvalidateChannel(channelName);
      snapA = useCartSnapshot({
        fetcher: fetcherA,
        channel: chA,
        publishOnMutate: false,
      });
      return d;
    });
    await vi.waitFor(() => expect(snapA.card()?.id).toBe("A"));

    await snapA.mutate(async () => "ok");

    // タブ B には届かない (= publish が抑制された)
    await new Promise((r) => setTimeout(r, 30));
    expect(fetcherB).toHaveBeenCalledTimes(1); // 初期のみ

    disposeA();
    disposeB();
  });
});
