// AnalyticsContext.tsx — カード共通の分析メタデータを子に降ろす Solid context
//
// 詳細: docs/sdui-three-layer-model-v5.md §16.3 (ambient context)
//
// **目的**:
//   各 Block で `analyticsId` だけでなく、カード単位のメタデータ
//   (cardId / variant / experiment) も Analytics イベントに乗せたい。
//   これらは Block の props に毎回詰めるのは煩雑なので、Solid context
//   で「カードの中で描画されている」事実から自動的に拾う。
//
// **使い方**:
//   - CardRenderer 側で `<AnalyticsCardProvider value={...}>` で包む
//   - Block レンダラ内で `const ctx = useAnalyticsCardContext()` で受け取る
//   - イベント発火時に `toAnalyticsContext(ctx, { productId })` で
//     `Record<string, string>` に正規化して `recordEvent` に渡す
//
// **無い場合の挙動**:
//   useAnalyticsCardContext() は undefined を返す。Block 単独でテスト renderer
//   する場合 (BlockRenderer.test.tsx 等) は context 無しで動く。

import {
  createContext,
  useContext,
  type JSX,
  type ParentComponent,
} from "solid-js";

import type { Experiment } from "./branded";

/** カード描画中に「下流の Block」へ降ろす ambient メタデータ。 */
export interface AnalyticsCardContext {
  /** CardBlock.id (常に存在)。 */
  cardId: string;
  /** マーチャンダイジング variant (`featured` / `compact` 等)。 */
  variant?: string;
  /** A/B 実験情報 (key + bucket)。 */
  experiment?: Experiment;
}

const Ctx = createContext<AnalyticsCardContext | undefined>(undefined);

/** Provider。CardRenderer / 各 Card テンプレート側で 1 度ラップするだけで OK。 */
export const AnalyticsCardProvider: ParentComponent<{
  value: AnalyticsCardContext;
}> = (props): JSX.Element => {
  return (
    <Ctx.Provider value={props.value}>{props.children}</Ctx.Provider>
  );
};

/** ambient context を読む。Provider 外なら undefined。 */
export const useAnalyticsCardContext = (): AnalyticsCardContext | undefined =>
  useContext(Ctx);

/** ambient context + 追加情報をマージして `Record<string, string>` に変換する。
 *
 *  Analytics event の `context` フィールドは `Map<String, String>` (Rust 側) なので
 *  全部 string に正規化する。空文字キーは省略 (server 側 validation 対策)。 */
export const toAnalyticsContext = (
  ambient: AnalyticsCardContext | undefined,
  extra?: Record<string, string | undefined>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (ambient) {
    if (ambient.cardId) out.cardId = ambient.cardId;
    if (ambient.variant) out.variant = ambient.variant;
    if (ambient.experiment) {
      out.experimentKey = ambient.experiment.key;
      out.experimentBucket = ambient.experiment.bucket;
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== "") out[k] = v;
    }
  }
  return out;
};
