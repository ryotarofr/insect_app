// TrackImpression.tsx — IntersectionObserver で 1 度だけ impression を記録するラッパ
//
// 詳細: docs/sdui-three-layer-model-v5.md §16.4 (Impression 計装)
//
// **責務**:
//   children を `<div>` で囲み、IntersectionObserver で「画面に 50% 以上見えた」
//   タイミングで `recordEvent({ eventType: "impression" })` を 1 回だけ発火する。
//   発火後は observer を disconnect して以降のスクロールに反応しない (重複防止)。
//
// **layout 上の影響 (既知の制約)**:
//   - 各 Block を block-level `<div>` で包むため、flex/grid 親では「div 1 個」が
//     flex/grid item になる。chip 列・text 段落いずれも見た目は変わらない想定。
//   - `display: contents` だと IntersectionObserver が box を持たない要素を
//     観測しない (no-op になる) ため、ここでは敢えて real `<div>` を使う。
//
// **環境フォールバック**:
//   `IntersectionObserver` が存在しない (jsdom 等) → mount 時に即発火する。
//   = 「描画されたら見えたとみなす」近似。テストではこの挙動を assert する。

import { onMount, type JSX, type ParentComponent } from "solid-js";

import {
  toAnalyticsContext,
  useAnalyticsCardContext,
} from "./AnalyticsContext";
import { recordEvent } from "./analytics";

export interface TrackImpressionProps {
  /** Block / Card の analyticsId。空文字なら no-op (event は積まれない)。 */
  analyticsId: string | undefined | null;
  /** 追加 context (productId 等)。ambient context に上書きマージされる。 */
  context?: Record<string, string | undefined>;
  /** デフォルト 0.5 (50% 可視で発火)。0 = 1px でも見えれば即発火。 */
  threshold?: number;
}

export const TrackImpression: ParentComponent<TrackImpressionProps> = (
  props,
): JSX.Element => {
  const cardCtx = useAnalyticsCardContext();
  let elRef: HTMLDivElement | undefined;
  let fired = false;

  const fire = () => {
    if (fired) return;
    if (!props.analyticsId) return;
    fired = true;
    recordEvent({
      analyticsId: props.analyticsId,
      eventType: "impression",
      context: toAnalyticsContext(cardCtx, props.context),
    });
  };

  onMount(() => {
    if (!elRef) return;
    if (!props.analyticsId) return; // analyticsId 不在 → observer も張らない

    if (typeof IntersectionObserver === "undefined") {
      // polyfill 無し環境 (jsdom 等) → mount 時に即発火
      fire();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            fire();
            io.disconnect();
            break;
          }
        }
      },
      { threshold: props.threshold ?? 0.5 },
    );
    io.observe(elRef);
  });

  return (
    <div
      ref={(el) => {
        elRef = el;
      }}
      data-track-impression={props.analyticsId ?? ""}
    >
      {props.children}
    </div>
  );
};
