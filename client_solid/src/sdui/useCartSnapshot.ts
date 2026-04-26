// useCartSnapshot.ts — cart card のレース耐性を持つスナップショット (Phase 9 前 / M6)
//
// 詳細: docs/sdui-three-layer-model-v6.md §11.8.1 規律 2 (request_seq による最新勝ち merge)
//
// **問題**:
//   素朴な `createResource(fetchCartCard)` 実装では、PATCH (n) → refetch → PATCH (n+1) →
//   refetch の交差で「(n+1) の refetch が n の refetch より早く返ると、(n) のレスポンスが
//   後から到着して UI を古い状態に巻き戻す」現象が起きる。
//
// **解決**:
//   各 refetch に **単調増加 seq** を付与し、レスポンスが返った時点で
//   「これまで適用された最大 seq より自分の seq が小さければ破棄」する。
//
// **API**:
//   - `card()` 現状の cart card (= 最新 seq の結果) / 未取得は undefined
//   - `error()` 直近の fetch エラー (= 最新 seq か、それ以上が成功で上書きするまで残る)
//   - `loading()` 何かしらの fetch が in-flight 中なら true
//   - `reload()` PATCH 無しの bare 再 fetch (= cross-tab 通知などで発火)
//   - `mutate(action)` action (= PATCH/POST/DELETE) を実行し、成功後に seq-tagged 再 fetch
//
// **設計上の注意**:
//   - createResource を使わない理由: refetch のレスポンスは内部で勝手に resource を
//     上書きするため、seq による破棄判定を挟めない。手動 signal 管理が必要。
//   - 初期 fetch は hook 呼び出し時に kick (= eager)。lazy にしたい場合は別途検討。
//   - mutate は action のエラーを **rethrow** する (= 呼び出し側 try/catch で toast 化)。
//     reload のエラーは内部 error() に書くだけで rethrow しない。

import { createSignal, onCleanup, type Accessor } from "solid-js";

import type { CardBlock } from "./branded";
import { fetchCartCard } from "./api";
import { getCartChannel, type InvalidateChannel } from "./cartChannel";

export interface UseCartSnapshotApi {
  /** 現在の cart card (= 最新 seq の result)。未取得は undefined。 */
  card: Accessor<CardBlock | undefined>;
  /** 直近の fetch エラー。成功で undefined にクリア。 */
  error: Accessor<unknown>;
  /** いずれかの fetch が in-flight なら true。 */
  loading: Accessor<boolean>;
  /** PATCH 無しの bare 再 fetch (= cross-tab 通知 / pull-to-refresh 等)。 */
  reload: () => Promise<void>;
  /** action を実行し、成功後に seq-tagged で再 fetch。
   *  action の戻り値は呼び出し側に渡る (= cartCount 等を読む用途)。
   *  action / reload のエラーは throw せず, error() signal に書く。 */
  mutate: <T>(action: () => Promise<T>) => Promise<T>;
}

export interface UseCartSnapshotOptions {
  /** 初期 fetch を kick するか。default true。テストで false にする場面もあり。 */
  initialFetch?: boolean;
  /** fetch 関数の差し替え (テスト用)。default は production の `fetchCartCard`。 */
  fetcher?: () => Promise<CardBlock>;
  /** cross-tab invalidate channel の差し替え (テスト用)。
   *  default は `getCartChannel()` (= production singleton)。
   *  null を渡すと cross-tab 連携を無効化 (= unit test の独立性確保)。 */
  channel?: InvalidateChannel | null;
  /** mutation 成功時に他タブへ invalidate を publish するか。default true。
   *  reload (= bare 再 fetch) は publish しない (= 受信側が自分でも再 fetch するだけ)。 */
  publishOnMutate?: boolean;
}

export const useCartSnapshot = (
  opts: UseCartSnapshotOptions = {},
): UseCartSnapshotApi => {
  const fetcher = opts.fetcher ?? fetchCartCard;
  const [card, setCard] = createSignal<CardBlock | undefined>(undefined);
  const [error, setError] = createSignal<unknown>(undefined);
  const [inflight, setInflight] = createSignal(0);

  // **request_seq**: 各 fetch 開始時にインクリメントして取得する。
  // **highestApplied**: 既に UI に反映された最大 seq。これより小さい seq の
  // 応答は破棄する (§11.8.1 規律 2)。
  let seqCounter = 0;
  let highestApplied = 0;

  const incInflight = () => setInflight((n) => n + 1);
  const decInflight = () => setInflight((n) => Math.max(0, n - 1));

  /** 1 回の fetch を seq-tagged で実行する内部関数。 */
  const refetch = async (): Promise<void> => {
    seqCounter += 1;
    const mySeq = seqCounter;
    incInflight();
    try {
      const fresh = await fetcher();
      // 古い seq のレスポンスは破棄 (= 後発の seq が既に UI を更新している)
      if (mySeq > highestApplied) {
        highestApplied = mySeq;
        setCard(fresh);
        setError(undefined);
      }
      // それ以外 (mySeq <= highestApplied) は静かに破棄
    } catch (err) {
      // エラーも seq で gating する (= 古い失敗が新しい成功を上書きしない)
      if (mySeq > highestApplied) {
        highestApplied = mySeq;
        setError(err);
      }
    } finally {
      decInflight();
    }
  };

  const reload = (): Promise<void> => refetch();

  const mutate = async <T>(action: () => Promise<T>): Promise<T> => {
    // mutation 自体は seq tracking の対象外 (= server を変更する操作で、
    // レスポンスは「成功 / 失敗」だけ。snapshot に直接書き込まない)。
    // mutation 成功後に refetch を seq-tagged で行う。
    const result = await action();
    await refetch();
    // 他タブに「再 fetch せよ」を通知 (= §11.8.2 cross-tab 同期)。
    // データは流さず、各タブが自前で /cards/cart を引き直す。
    if (channel !== null && (opts.publishOnMutate ?? true)) {
      channel.publish();
    }
    return result;
  };

  const loading = () => inflight() > 0;

  // ── cross-tab invalidate channel subscribe (§11.8.2) ─────────────
  // 他タブの mutation を受け取ったら refetch する。データは流れてこないので
  // 自タブは server に問い合わせて真値を引く (= §11.8 主規律と整合)。
  const channel = opts.channel === undefined ? getCartChannel() : opts.channel;
  if (channel !== null) {
    const unsub = channel.subscribe(() => {
      void refetch();
    });
    onCleanup(unsub);
  }

  if (opts.initialFetch !== false) {
    void refetch();
  }

  return { card, error, loading, reload, mutate };
};
