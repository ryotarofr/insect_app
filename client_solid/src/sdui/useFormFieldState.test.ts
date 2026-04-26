// useFormFieldState.test.ts — focus / dirty / debounce 規律の単体テスト (Phase 9 前 / M6)
//
// 詳細: docs/sdui-three-layer-model-v6.md §11.8.1 規律 1
//
// **狙い**:
//   1. 通常の input → debounce → submit が走る
//   2. focus 中は server 値が変わっても draft が上書きされない (= 規律 1)
//   3. blur 後は server 値で同期される (dirty window 越えれば即時 / 越えてなければ保留)
//   4. dirty window 中 (focus 外でも) は上書きされない
//   5. blur 時の残 debounce が flush される
//   6. 同値 submit はスキップ
//   7. onCommit (= select / radio 用) は debounce 無しで即 submit

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";

import {
  DEBOUNCE_MS,
  DIRTY_WINDOW_MS,
  useFormFieldState,
} from "./useFormFieldState";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** root を立てて useFormFieldState を呼び出す helper。
 *  dispose を返すので test 末尾で自分で呼ぶ (= ここでは onCleanup を回さない)。 */
const setupHook = (
  initialValue: string | undefined,
  serverValue: () => string | undefined,
  submit: (value: string) => Promise<void>,
  options?: {
    debounceMs?: number;
    dirtyWindowMs?: number;
  },
) => {
  let api!: ReturnType<typeof useFormFieldState>;
  const dispose = createRoot((d) => {
    api = useFormFieldState({
      initialValue,
      serverValue,
      submit,
      ...options,
    });
    return d;
  });
  return { api, dispose };
};

describe("useFormFieldState (基本動作)", () => {
  it("初期値が draft に入る", () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const { api, dispose } = setupHook("初期", () => "初期", submit);
    expect(api.draft()).toBe("初期");
    dispose();
  });

  it("input → DEBOUNCE_MS 後に submit が呼ばれる", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const { api, dispose } = setupHook("", () => "", submit);

    api.onInput("山田");
    expect(submit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(submit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("山田");
    dispose();
  });

  it("blur で残 debounce が即時 flush される", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const { api, dispose } = setupHook("", () => "", submit);

    api.onInput("x");
    api.onBlur();
    // blur で submit が走る
    await vi.runOnlyPendingTimersAsync();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("x");
    dispose();
  });

  it("onCommit は debounce 無しで即 submit", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const { api, dispose } = setupHook("01", () => "01", submit);

    api.onCommit("13");
    await vi.runOnlyPendingTimersAsync();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("13");
    dispose();
  });

  it("同値 submit はスキップ (server 値と一致)", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const { api, dispose } = setupHook("山田", () => "山田", submit);

    api.onInput("山田"); // server 値と同じ
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
    expect(submit).not.toHaveBeenCalled();
    dispose();
  });

  it("submit 中は pending = true、終了で false", async () => {
    let resolve!: () => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const { api, dispose } = setupHook("", () => "", submit);

    api.onCommit("x");
    // microtask で submit が呼ばれて pending=true になるまで待つ
    await Promise.resolve();
    expect(api.pending()).toBe(true);

    resolve();
    await Promise.resolve();
    await Promise.resolve(); // microtask flush
    expect(api.pending()).toBe(false);
    dispose();
  });
});

describe("useFormFieldState (規律 1: focus / dirty 中の上書き禁止)", () => {
  it("focus 中は server 値が変わっても draft が変わらない", () => {
    const [serverVal, setServerVal] = createSignal("初期");
    const submit = vi.fn().mockResolvedValue(undefined);
    const { api, dispose } = setupHook("初期", serverVal, submit);

    api.onFocus();
    expect(api.isFocused()).toBe(true);

    // server から新しい値が降ってくる
    setServerVal("外部からの値");

    // focus 中なので draft は元のまま
    expect(api.draft()).toBe("初期");
    dispose();
  });

  it("blur 後 (dirty window 外) は server 値で同期される", async () => {
    const [serverVal, setServerVal] = createSignal("初期");
    const submit = vi.fn().mockResolvedValue(undefined);
    const { api, dispose } = setupHook("初期", serverVal, submit, {
      dirtyWindowMs: 100,
    });

    api.onFocus();
    setServerVal("外部値");
    expect(api.draft()).toBe("初期"); // 上書き保留

    api.onBlur();
    // blur 直後、最終編集時刻が 0 (= 触ってない) なので isDirty=false → 即同期
    expect(api.draft()).toBe("外部値");
    dispose();
  });

  it("最終編集後は dirty window 中なので上書き保留", async () => {
    const [serverVal, setServerVal] = createSignal("初期");
    const submit = vi.fn().mockResolvedValue(undefined);
    const { api, dispose } = setupHook("初期", serverVal, submit, {
      debounceMs: 50,
      dirtyWindowMs: 200,
    });

    api.onFocus();
    api.onInput("ユーザ入力中");
    // debounce 過ぎて submit (server に飛ぶが、ここでは server 値は外部から変わる)
    await vi.advanceTimersByTimeAsync(60);
    setServerVal("競合する外部値");

    // focus 中なので保留
    expect(api.draft()).toBe("ユーザ入力中");

    api.onBlur();
    // blur 直後でも dirty window 内なので保留
    expect(api.draft()).toBe("ユーザ入力中");

    // dirty window 経過後にタイマで同期
    await vi.advanceTimersByTimeAsync(200);
    // タイマで server 値同期
    expect(api.draft()).toBe("競合する外部値");
    dispose();
  });

  it("focus 中の dirty タイマは満了しても draft を巻き戻さない", async () => {
    const [serverVal, setServerVal] = createSignal("初期");
    const submit = vi.fn().mockResolvedValue(undefined);
    const { api, dispose } = setupHook("初期", serverVal, submit, {
      debounceMs: 50,
      dirtyWindowMs: 100,
    });

    api.onFocus();
    api.onInput("入力中");
    setServerVal("外部値");

    // dirty window を超えても focus 中なら保留継続
    await vi.advanceTimersByTimeAsync(200);
    expect(api.isFocused()).toBe(true);
    expect(api.draft()).toBe("入力中");
    dispose();
  });
});
