// useFormFieldState.ts — FormField のレース耐性 + a11y 統合 hook
//
// 詳細:
//   - docs/sdui-three-layer-model-v6.md §11.8.1 規律 1 (focus/dirty 中の上書き禁止)
//   - docs/sdui-three-layer-model-v6.md §10.5 規律 2/3 (a11y under server-driven state)
//
// **責務**:
//   1. ローカル draft (= 入力中の中間値) を保持
//   2. focus 状態 + 最終編集時刻を追跡し、`shouldAcceptServerValue` を導出
//   3. 上書き判断: focus 中 / 直近 800ms 以内に編集 → server 値の上書きを保留
//   4. blur or 800ms idle で保留解除 → server 値で再描画
//   5. debounce 制御 (default 300ms): 入力 → debounce → submit
//   6. submit 同値ガード (server 値と同じなら no-op)
//
// **保留中も validation_error は通す**:
//   入力値は client 優先 / 妥当性は server 優先 (§11.8.1 規律 1 末文)。
//   そのため validation_error の表示は draft の保留に関わらず、props.block.validationError
//   をそのまま使う設計とする (= この hook の責務外。FormField view 側で直接読む)。
//
// **テスト容易性**:
//   - `now()` を引数で差し替え可能にして時計を fake 可能 (vi.useFakeTimers と共存)
//   - state 変化点ごとに observable な signal を返し、外部から状態確認できる

import { createEffect, createSignal, on, onCleanup } from "solid-js";

/** dirty window: 最終編集からこの ms 以内は server 値の上書きを保留する。
 *  §11.8.1 規律 1 の値そのもの。短すぎると焦点を移した直後の race を取り逃がす、
 *  長すぎると "確定したのにまだ古い値が居座る" UX 劣化。800ms は経験則。 */
export const DIRTY_WINDOW_MS = 800;

/** debounce: 入力が落ち着いてから何 ms 経ったら submit するか。 */
export const DEBOUNCE_MS = 300;

export interface UseFormFieldStateOptions {
  /** 初期 server 値 (`block.value` 相当)。undefined は "未入力 (None)" として "" 扱い。 */
  initialValue: string | undefined;
  /** server 値が更新された時に呼ばれるアクセサ (= props.block.value を購読する関数)。
   *  Solid props proxy 越しに変化を検知させるため signal ではなく function で受ける。 */
  serverValue: () => string | undefined;
  /** 値を server に反映する非同期関数。draft を引数に取り、PATCH を発行して reload する。
   *  失敗時は呼び出し側で toast 等を出す前提 (本 hook はエラーを伝播しない)。 */
  submit: (value: string) => Promise<void>;
  /** デバウンス長 (ms)。default DEBOUNCE_MS。テストで短縮できるよう外出し。 */
  debounceMs?: number;
  /** dirty window (ms)。default DIRTY_WINDOW_MS。テストで短縮できるよう外出し。 */
  dirtyWindowMs?: number;
  /** 時計関数。default `Date.now`。テストで vi.useFakeTimers と一緒に使う場合は
   *  そのままで OK (Date.now が fake される) だが、明示注入したい場面で差し替え可能。 */
  now?: () => number;
}

export interface UseFormFieldStateApi {
  /** 入力欄に bind する現在値 (server 値 or draft の優先順で決定)。 */
  draft: () => string;
  /** UI 上の disabled 等に使う pending 状態 (submit 中)。 */
  pending: () => boolean;
  /** focus 中かどうか。テスト / a11y 強調表示用。 */
  isFocused: () => boolean;
  /** dirty window 中かどうか (= 最終編集から N ms 以内)。デバッグ / テスト用。 */
  isDirty: () => boolean;
  /** input handler (typing 中)。debounce 後に submit を予約。 */
  onInput: (value: string) => void;
  /** 即時 submit (= debounce を待たない)。select / radio 等の確定操作で使う。 */
  onCommit: (value: string) => void;
  /** focus / blur handler。input 要素の event handler に bind する。 */
  onFocus: () => void;
  onBlur: () => void;
  /** disposer (= component unmount 時に呼ぶ)。`onCleanup` で自動登録済みなので
   *  通常呼ぶ必要は無いが、テストで明示的に解除したい時に使う。 */
  dispose: () => void;
}

export const useFormFieldState = (
  opts: UseFormFieldStateOptions,
): UseFormFieldStateApi => {
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const dirtyWindowMs = opts.dirtyWindowMs ?? DIRTY_WINDOW_MS;
  const now = opts.now ?? (() => Date.now());

  const [draft, setDraft] = createSignal(opts.initialValue ?? "");
  const [pending, setPending] = createSignal(false);
  const [isFocused, setFocused] = createSignal(false);
  const [lastEditAt, setLastEditAt] = createSignal<number>(0);

  /** dirty window 中か。focus 中 || 最終編集から N ms 以内なら true。
   *  動的な時計判定なので signal ではなく getter にする (= 呼ぶたび評価)。
   *  ※ Solid のリアクティブ依存は lastEditAt のみで十分 (= dirty 解除のために
   *    pending → idle 後に effect を再評価するトリガが要る場合は別途 timer を回す)。 */
  const isDirty = (): boolean => {
    if (isFocused()) return true;
    const last = lastEditAt();
    if (last === 0) return false;
    return now() - last < dirtyWindowMs;
  };

  // server 値が変わったら、focus / dirty 中で無ければ draft に追従。
  // dirty 中なら保留 (= 上書きしない)。dirty 解除後に server 値が異なっていれば
  // その時点で再 evaluate される (= focus blur 時 / 後述の dirty タイマで)。
  createEffect(
    on(
      opts.serverValue,
      (next) => {
        if (isDirty()) return;
        setDraft(next ?? "");
      },
      { defer: true },
    ),
  );

  // dirty window 解除タイマ。lastEditAt が更新されるたびに、
  // 「N ms 後に dirty 解除 → 必要なら server 値で同期」を予約。
  // focus 中はタイマが切れても dirty のまま (isFocused が true)、
  // blur されたタイミングで再評価するロジックは onBlur に置く。
  let dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(
    on(
      lastEditAt,
      (t) => {
        if (t === 0) return;
        if (dirtyTimer !== null) clearTimeout(dirtyTimer);
        dirtyTimer = setTimeout(() => {
          dirtyTimer = null;
          // タイマ満了時点で focus 外なら server 値に同期。
          if (isFocused()) return;
          const sv = opts.serverValue() ?? "";
          if (draft() !== sv) setDraft(sv);
        }, dirtyWindowMs);
      },
      { defer: true },
    ),
  );

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelDebounce = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const doSubmit = async (value: string) => {
    // 同値ガード (server 値と一致なら no-op = round-trip 節約)
    if (value === (opts.serverValue() ?? "")) return;
    setPending(true);
    try {
      await opts.submit(value);
    } finally {
      setPending(false);
    }
  };

  const onInput = (value: string) => {
    setDraft(value);
    setLastEditAt(now());
    cancelDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void doSubmit(value);
    }, debounceMs);
  };

  const onCommit = (value: string) => {
    setDraft(value);
    setLastEditAt(now());
    cancelDebounce();
    void doSubmit(value);
  };

  const onFocus = () => {
    setFocused(true);
  };

  const onBlur = () => {
    setFocused(false);
    // 残 debounce があれば即時 flush (= タブ移動 / 別 field click で取りこぼさない)
    if (debounceTimer !== null) {
      cancelDebounce();
      void doSubmit(draft());
    }
    // blur 後に server 値が draft と乖離していれば直ちに同期 (= dirty タイマを待たない)。
    // ただし最終編集が dirty window 内ならまだ保留 (= 「ペーストしてすぐ blur」の race を防ぐ)
    if (!isDirty()) {
      const sv = opts.serverValue() ?? "";
      if (draft() !== sv) setDraft(sv);
    }
  };

  const dispose = () => {
    cancelDebounce();
    if (dirtyTimer !== null) {
      clearTimeout(dirtyTimer);
      dirtyTimer = null;
    }
  };

  onCleanup(dispose);

  return {
    draft,
    pending,
    isFocused,
    isDirty,
    onInput,
    onCommit,
    onFocus,
    onBlur,
    dispose,
  };
};
