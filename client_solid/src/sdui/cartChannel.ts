// cartChannel.ts — cart cross-tab 同期用 BroadcastChannel ラッパ (Phase 9 前 / M7)
//
// 詳細: docs/sdui-three-layer-model-v6.md §11.8.2 (Cross-tab 同期)
//
// **責務**:
//   - 2 タブで同じユーザがカートを開いている時、片方の mutation を他方に
//     「再 fetch せよ」シグナルとして伝達する。
//   - データ自体は流さない (= 真実値は常に server から引き直す、§11.8 主規律と整合)。
//   - 自タブで発した invalidate を loop back で受け取った場合に dedup する
//     (= 自分の mutation 後に refetch 済みなので、二度引きは無駄)。
//
// **互換性**:
//   `BroadcastChannel` は Safari 15.4+ / Chrome / Firefox / Edge で利用可。
//   非対応環境 (= jsdom + 古い node 等) では `undefined` 判定で no-op に倒し、
//   tab 間連携は失われるが単独タブの動作には影響しない。
//
// **WebSocket push (Future Work) への移行**:
//   §17 で push 接続を追加したら、本 channel は維持しつつ「他デバイスからの push」
//   を新たな invalidate トリガとして併用する。受信側 (subscribe) のロジックは変更不要。
//
// **チャネル分離**:
//   cart / checkout / watch の 3 ドメインで個別の channel 名を使う。混信回避と、
//   将来チャネルごとに subscribe 粒度を変えやすい設計のため。

/** チャネル名定数。production / test で同一文字列を使う。 */
export const CART_CHANNEL_NAME = "kochu_cart_invalidate";
export const CHECKOUT_CHANNEL_NAME = "kochu_checkout_invalidate";
export const WATCH_CHANNEL_NAME = "kochu_watch_invalidate";

/** invalidate メッセージのペイロード。
 *  - `senderId`: タブ起動時に生成する一意 ID (= 自タブ loop back を dedup するため)
 *  - `at`: 送信時刻 (debug / 順序保証用; 業務ロジックには使わない) */
export interface InvalidateMessage {
  type: "invalidate";
  senderId: string;
  at: number;
}

/** タブ起動時に 1 度だけ生成する一意 ID。crypto.randomUUID が無い環境では Math.random で代替。 */
const generateSenderId = (): string => {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  // crypto.randomUUID 不在時の弱フォールバック (= 衝突確率は実用上問題ないレベル)
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const SELF_SENDER_ID = generateSenderId();

/** BroadcastChannel が利用可能か。jsdom 環境などで undefined のことがある。 */
const isBroadcastChannelAvailable = (): boolean =>
  typeof globalThis.BroadcastChannel !== "undefined";

/** チャネル subscriber の登録解除関数。 */
export type Unsubscribe = () => void;

export interface InvalidateChannel {
  /** 他タブに「再 fetch せよ」を通知する。自タブの subscriber には届かない。 */
  publish: () => void;
  /** 他タブからの invalidate を購読する。loop back (= 自タブ発) は除外済み。 */
  subscribe: (handler: () => void) => Unsubscribe;
  /** チャネルを閉じる (= タブ unmount 時)。 */
  close: () => void;
}

/** no-op 実装 (= BroadcastChannel 非対応環境)。 */
const NOOP_CHANNEL: InvalidateChannel = {
  publish: () => {},
  subscribe: () => () => {},
  close: () => {},
};

/** 名前付き invalidate channel を生成する。
 *
 *  内部で `new BroadcastChannel(name)` を 1 つ立て、subscribe / publish を
 *  ラップする。BroadcastChannel 非対応環境では no-op を返す (機能 OFF)。
 *
 *  **dedup 戦略**: publish 時に `senderId = SELF_SENDER_ID` を payload に乗せ、
 *  subscribe 側で「受信した senderId が SELF と一致するなら破棄」する。
 *  これにより自タブの publish が loop back で自分に届くケースを排除する。
 *  (BroadcastChannel の標準動作では同一 BC インスタンスへの loop back は
 *  起きないが、複数 BC を立てた場合の安全策として保持。)
 */
export const createInvalidateChannel = (
  name: string,
): InvalidateChannel => {
  if (!isBroadcastChannelAvailable()) return NOOP_CHANNEL;

  const channel = new BroadcastChannel(name);
  const handlers = new Set<() => void>();

  const onMessage = (ev: MessageEvent<InvalidateMessage>) => {
    const data = ev.data;
    if (!data || data.type !== "invalidate") return;
    if (data.senderId === SELF_SENDER_ID) return; // 自タブ loop back を dedup
    for (const h of handlers) {
      try {
        h();
      } catch {
        // subscriber 側の例外は他 subscriber に波及させない
      }
    }
  };

  channel.addEventListener("message", onMessage);

  const publish = () => {
    const msg: InvalidateMessage = {
      type: "invalidate",
      senderId: SELF_SENDER_ID,
      at: Date.now(),
    };
    channel.postMessage(msg);
  };

  const subscribe = (handler: () => void): Unsubscribe => {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  };

  const close = () => {
    handlers.clear();
    channel.removeEventListener("message", onMessage);
    channel.close();
  };

  return { publish, subscribe, close };
};

// ── lazy singleton: cart 用 invalidate channel ─────────────────────
//
// useCartSnapshot は singleton channel を購読する想定 (= 全 cart hook が
// 同じ channel を共有)。lazy 化して BroadcastChannel 非対応環境でも初期化が
// 失敗しないようにする。

let cartChannelSingleton: InvalidateChannel | null = null;

/** Cart 用 invalidate channel を返す (= 1 タブ内 singleton)。 */
export const getCartChannel = (): InvalidateChannel => {
  if (cartChannelSingleton === null) {
    cartChannelSingleton = createInvalidateChannel(CART_CHANNEL_NAME);
  }
  return cartChannelSingleton;
};

/** test 用: singleton をリセットする (= 各 test で新しい channel を立てる)。 */
export const __resetCartChannelForTest = (): void => {
  if (cartChannelSingleton !== null) {
    cartChannelSingleton.close();
    cartChannelSingleton = null;
  }
};

/** test 用: 自タブの sender id を露出 (= loop back dedup の検証用)。 */
export const __getSelfSenderIdForTest = (): string => SELF_SENDER_ID;
