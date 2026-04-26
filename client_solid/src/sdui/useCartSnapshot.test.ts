// useCartSnapshot.test.ts — request_seq による最新勝ち merge の単体テスト (Phase 9 前 / M6)
//
// 詳細: docs/sdui-three-layer-model-v6.md §11.8.1 規律 2
//
// **狙い**:
//   1. 初期 fetch が成功すると card() に値が入る
//   2. 初期 fetch 失敗で error() に値が入る
//   3. mutate(action) は action 実行 → refetch → card 更新 の順で動く
//   4. 逆順到着レスポンス: 古い seq の応答は破棄され、新しい seq の応答のみが UI を更新
//   5. mutation のエラーは throw、reload のエラーは error() に書く
//   6. loading() は in-flight 中 true、収束で false

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

import type { CardBlock } from "./branded";
import { useCartSnapshot } from "./useCartSnapshot";

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

const setupHook = <Args extends unknown[]>(opts: {
  fetcher: () => Promise<CardBlock>;
  initialFetch?: boolean;
}) => {
  let api!: ReturnType<typeof useCartSnapshot>;
  const dispose = createRoot((d) => {
    api = useCartSnapshot(opts);
    return d;
  });
  return { api, dispose };
};

describe("useCartSnapshot (基本)", () => {
  it("初期 fetch 成功で card() が値を持つ", async () => {
    const fetcher = vi.fn().mockResolvedValue(makeCart("cart"));
    const { api, dispose } = setupHook({ fetcher });

    expect(api.loading()).toBe(true);
    await vi.waitFor(() => expect(api.card()).toBeDefined());
    expect(api.loading()).toBe(false);
    expect(api.card()?.id).toBe("cart");
    dispose();
  });

  it("初期 fetch 失敗で error() に値が入り card() は undefined", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("boom"));
    const { api, dispose } = setupHook({ fetcher });

    await vi.waitFor(() => expect(api.error()).toBeDefined());
    expect(api.card()).toBeUndefined();
    expect((api.error() as Error).message).toBe("boom");
    dispose();
  });

  it("initialFetch=false なら fetcher が呼ばれない", () => {
    const fetcher = vi.fn().mockResolvedValue(makeCart("cart"));
    const { api, dispose } = setupHook({ fetcher, initialFetch: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(api.card()).toBeUndefined();
    expect(api.loading()).toBe(false);
    dispose();
  });

  it("reload() で再 fetch される", async () => {
    let n = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      n += 1;
      return makeCart(`cart-${n}`);
    });
    const { api, dispose } = setupHook({ fetcher });

    await vi.waitFor(() => expect(api.card()?.id).toBe("cart-1"));
    await api.reload();
    expect(api.card()?.id).toBe("cart-2");
    expect(fetcher).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("mutate(action) は action 実行 → refetch → card 更新", async () => {
    let n = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      n += 1;
      return makeCart(`cart-${n}`);
    });
    const action = vi.fn().mockResolvedValue("action-result");

    const { api, dispose } = setupHook({ fetcher });
    await vi.waitFor(() => expect(api.card()?.id).toBe("cart-1"));

    const result = await api.mutate(action);
    expect(result).toBe("action-result");
    expect(action).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2); // 初期 + mutate 後
    expect(api.card()?.id).toBe("cart-2");
    dispose();
  });

  it("mutation のエラーは rethrow される", async () => {
    const fetcher = vi.fn().mockResolvedValue(makeCart("cart"));
    const { api, dispose } = setupHook({ fetcher });
    await vi.waitFor(() => expect(api.card()).toBeDefined());

    const action = vi.fn().mockRejectedValue(new Error("mutation-failed"));
    await expect(api.mutate(action)).rejects.toThrow("mutation-failed");
    // refetch されない (= action が失敗したので)
    expect(fetcher).toHaveBeenCalledTimes(1);
    dispose();
  });
});

describe("useCartSnapshot (§11.8.1 規律 2: request_seq による最新勝ち merge)", () => {
  it("逆順到着: 後発 seq が先着、先発 seq が後着 → 後発の値が UI に残る", async () => {
    // fetch を 2 回繰り返すが、レスポンスを resolve するタイミングを test 側で制御。
    let resolveA: (v: CardBlock) => void;
    let resolveB: (v: CardBlock) => void;
    const promiseA = new Promise<CardBlock>((r) => {
      resolveA = r;
    });
    const promiseB = new Promise<CardBlock>((r) => {
      resolveB = r;
    });
    const fetcher = vi
      .fn(() => Promise.resolve<CardBlock>(undefined as never))
      .mockReturnValueOnce(promiseA) // 1 回目: A (= seq 1)
      .mockReturnValueOnce(promiseB); // 2 回目: B (= seq 2)

    const { api, dispose } = setupHook({ fetcher, initialFetch: false });

    // seq 1 を kick
    const reload1 = api.reload();
    // seq 2 を kick (まだ A も B も resolve してない)
    const reload2 = api.reload();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(api.loading()).toBe(true);

    // ★ B (= seq 2) を先に resolve
    resolveB!(makeCart("cart-B"));
    await reload2;
    expect(api.card()?.id).toBe("cart-B");

    // ★ A (= seq 1) を後から resolve → 古い seq なので破棄される
    resolveA!(makeCart("cart-A"));
    await reload1;
    expect(api.card()?.id).toBe("cart-B"); // B のまま (= 最新勝ち)
    dispose();
  });

  it("正順到着: seq 1, 2 順に resolve → 最終的に seq 2 の値", async () => {
    let resolveA: (v: CardBlock) => void;
    let resolveB: (v: CardBlock) => void;
    const promiseA = new Promise<CardBlock>((r) => {
      resolveA = r;
    });
    const promiseB = new Promise<CardBlock>((r) => {
      resolveB = r;
    });
    const fetcher = vi
      .fn(() => Promise.resolve<CardBlock>(undefined as never))
      .mockReturnValueOnce(promiseA)
      .mockReturnValueOnce(promiseB);

    const { api, dispose } = setupHook({ fetcher, initialFetch: false });
    const reload1 = api.reload();
    const reload2 = api.reload();

    resolveA!(makeCart("cart-A"));
    await reload1;
    expect(api.card()?.id).toBe("cart-A");

    resolveB!(makeCart("cart-B"));
    await reload2;
    expect(api.card()?.id).toBe("cart-B");
    dispose();
  });

  it("古い seq の失敗が新しい seq の成功を上書きしない", async () => {
    let resolveA: (v: CardBlock) => void;
    let rejectA: (e: unknown) => void;
    const promiseA = new Promise<CardBlock>((res, rej) => {
      resolveA = res;
      rejectA = rej;
    });
    const fetcher = vi
      .fn(() => Promise.resolve<CardBlock>(undefined as never))
      .mockReturnValueOnce(promiseA) // seq 1: 後で reject
      .mockResolvedValueOnce(makeCart("cart-B")); // seq 2: success

    const { api, dispose } = setupHook({ fetcher, initialFetch: false });
    const r1 = api.reload();
    const r2 = api.reload();

    await r2;
    expect(api.card()?.id).toBe("cart-B");
    expect(api.error()).toBeUndefined();

    // seq 1 を reject — 既に seq 2 が highestApplied なので無視される
    rejectA!(new Error("late-failure"));
    await r1;
    expect(api.card()?.id).toBe("cart-B");
    expect(api.error()).toBeUndefined();
    dispose();
  });

  it("loading() は in-flight 数 (= 2 並走で true、両方終わると false)", async () => {
    let resolveA: (v: CardBlock) => void;
    let resolveB: (v: CardBlock) => void;
    const promiseA = new Promise<CardBlock>((r) => {
      resolveA = r;
    });
    const promiseB = new Promise<CardBlock>((r) => {
      resolveB = r;
    });
    const fetcher = vi
      .fn(() => Promise.resolve<CardBlock>(undefined as never))
      .mockReturnValueOnce(promiseA)
      .mockReturnValueOnce(promiseB);

    const { api, dispose } = setupHook({ fetcher, initialFetch: false });
    const r1 = api.reload();
    const r2 = api.reload();
    expect(api.loading()).toBe(true);

    resolveA!(makeCart("a"));
    await r1;
    expect(api.loading()).toBe(true); // まだ B が in-flight

    resolveB!(makeCart("b"));
    await r2;
    expect(api.loading()).toBe(false);
    dispose();
  });
});
