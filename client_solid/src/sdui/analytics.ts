// analytics.ts — SDUI Analytics クライアント buffer + flush (Phase 3)
//
// 詳細: docs/sdui-three-layer-model-v5.md §16 (Analytics 契約)
//
// **責務**:
//   - `recordEvent({ analyticsId, eventType, context })` を呼ぶと内部 buffer に積む
//   - 5 秒ごと、または buffer が 50 件溜まったら `POST /api/v1/events` でまとめ送り
//   - タブが裏に回ったら (visibilitychange='hidden') `navigator.sendBeacon` で flush
//   - `analyticsId` が空文字の event は **何もしない** (= server 側 400 を踏ませない)
//
// **best-effort 設計**:
//   分析データは「失われても致命的でない」。ネットワーク失敗は黙って捨てる
//   (再送キューや永続化はしない)。これにより、計装の有無がアプリの動作に
//   影響しないことを保証する (= "広告が落ちても本体は動く" の SDUI 版)。
//
// **sendBeacon を採用する理由**:
//   visibilitychange='hidden' / pagehide のタイミングで通常の fetch を投げると、
//   ブラウザがページ遷移を優先してリクエストを中断する (= 末尾イベントを取りこぼす)。
//   sendBeacon は OS レベルのキューに積んで送るため、unload を跨いで配送される。
//
// **テスト容易性**:
//   - `__resetAnalyticsForTest()` で buffer + timer を初期化
//   - `__getBufferForTest()` で内部 buffer を覗く
//   - `__getFlushIntervalMs()` で定数を export (timer 経過テスト用)

import type { AnalyticsEvent, AnalyticsEventType } from "../generated/sdui";

const ENDPOINT = "/api/v1/events";
const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER = 50;

let buffer: AnalyticsEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let visibilityListenerInstalled = false;

const installVisibilityListener = () => {
  if (visibilityListenerInstalled) return;
  if (typeof document === "undefined") return;
  visibilityListenerInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushBeacon();
    }
  });
};

const ensureTimer = () => {
  if (timer !== null) return;
  // jsdom + vi.useFakeTimers の互換のため setTimeout を使う (setInterval だと
  // 1 度走った後の clearInterval を都度書く必要があり煩雑になる)。
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
};

const drain = (): AnalyticsEvent[] => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const events = buffer;
  buffer = [];
  return events;
};

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

export interface RecordInput {
  /** Block / Card の analyticsId。空文字なら no-op。 */
  analyticsId: string | undefined | null;
  eventType: AnalyticsEventType;
  /** productId / variant / experimentKey などの追加情報。空 record なら省略される。 */
  context?: Record<string, string> | undefined;
}

/** 1 件のイベントを buffer に積む。analyticsId 不在なら no-op (= 計装漏れに寛容)。 */
export const recordEvent = (input: RecordInput): void => {
  const id = input.analyticsId;
  if (!id) return;

  const ev: AnalyticsEvent = {
    analyticsId: id,
    eventType: input.eventType,
    timestampMs: Date.now(),
  };
  if (input.context && Object.keys(input.context).length > 0) {
    ev.context = input.context;
  }
  buffer.push(ev);

  installVisibilityListener();

  if (buffer.length >= MAX_BUFFER) {
    void flush();
  } else {
    ensureTimer();
  }
};

/** 通常 flush (定期 / 上限到達 / 手動)。fetch + keepalive で投げる。 */
export const flush = async (): Promise<void> => {
  const events = drain();
  if (events.length === 0) return;

  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      // ナビゲーション中も生かす。sendBeacon ほど強くないが best-effort 改善。
      keepalive: true,
    });
  } catch {
    // best-effort: 失敗しても何もしない
  }
};

/** unload-safe な flush。`navigator.sendBeacon` 優先、なければ fetch+keepalive。 */
export const flushBeacon = (): void => {
  const events = drain();
  if (events.length === 0) return;

  const body = JSON.stringify({ events });

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
  ) {
    const blob = new Blob([body], { type: "application/json" });
    const ok = navigator.sendBeacon(ENDPOINT, blob);
    if (ok) return;
    // sendBeacon が false (queue 満杯 / quota 超過) → fetch fallback
  }

  // fallback: fetch with keepalive
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* noop */
  }
};

// ──────────────────────────────────────────────────────────────────────
// テスト用フック (production code から呼んではいけない)
// ──────────────────────────────────────────────────────────────────────

/** test fixture: buffer + timer を初期状態に戻す。 */
export const __resetAnalyticsForTest = (): void => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  buffer = [];
};

/** test fixture: 内部 buffer を覗き見する (length / 内容を assert する用)。 */
export const __getBufferForTest = (): readonly AnalyticsEvent[] => buffer;

/** test fixture: timer が走っているかどうか。 */
export const __hasTimerForTest = (): boolean => timer !== null;

/** test fixture: 定数を export (timer 経過テスト用)。 */
export const __getFlushIntervalMs = (): number => FLUSH_INTERVAL_MS;
export const __getMaxBuffer = (): number => MAX_BUFFER;
