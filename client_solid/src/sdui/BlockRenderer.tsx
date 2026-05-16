// BlockRenderer.tsx — Block (13 variants) のディスパッチ
//
// 詳細: docs/sdui-three-layer-model-v6.md §6.3 (BlockRenderer)
//
// **責務**: 1 つの Block を `type` 判別して対応するレンダラに振り分ける。
//   Region の中で `<For>` で各 block を回し、ここに 1 ノードずつ渡す想定。
//
// Solid の `<Switch>/<Match>` を使い、各 Match 内で type narrowing 用の
// `Extract<Block, { type: "..." }>` キャストを 1 行ずつ書く。
//
// **未知の type への対応**:
//   サーバ側が新 block 種を追加してフロントが古いケースに備えて、
//   `<UnknownBlockFallback>` を fallback に置く (= §10.1 「型生成パイプラインの遷移期保険」)。
//   これ自体は createEffect で 1 度だけ console.warn してから null を返すので、
//   画面真っ白にはならない。

import { Match, Show, Switch, createEffect } from "solid-js";
import type { Block } from "./branded";
import { TextBlockView } from "./blocks/Text";
import { CtaBlockView } from "./blocks/Cta";
import { MediaBlockView } from "./blocks/Media";
import { BadgeBlockView } from "./blocks/Badge";
import { MetricListBlockView } from "./blocks/MetricList";
import { MetaLineBlockView } from "./blocks/MetaLine";
import { PriceBlockView } from "./blocks/Price";
import { EclosionForecastBlockView } from "./blocks/EclosionForecast";
import { DividerBlockView } from "./blocks/Divider";
import { LineItemBlockView } from "./blocks/LineItem";
import { OrderSummaryBlockView } from "./blocks/OrderSummary";
import { FormFieldView } from "./blocks/FormField";
import { ShippingMethodPickerView } from "./blocks/ShippingMethodPicker";
import { TrackImpression } from "./TrackImpression";

const warnedTypes = new Set<string>();

/** 未知 block の fallback。Switch の fallback prop に置くため、
 *  IIFE ではなく純粋なコンポーネントにしておく (毎 render 評価されないように)。 */
const UnknownBlockFallback = (props: { block: Block }) => {
  // createEffect は実際にこの fallback が描画された時のみ走る = 該当 block の時だけ warn する
  createEffect(() => {
    const t = (props.block as { type: string }).type;
    if (warnedTypes.has(t)) return;
    warnedTypes.add(t);
    // eslint-disable-next-line no-console
    console.warn(
      `[sdui] unknown block type: "${t}" (skipped, key="${(props.block as { key?: string }).key ?? "?"}")`,
    );
  });
  return null;
};

/** Block の analyticsId を型横断で取り出す。Block の各 variant は全部
 *  `analyticsId?: string` を持つ (divider 除く) ので、cast で読み出して OK。 */
const blockAnalyticsId = (block: Block): string | undefined => {
  const id = (block as { analyticsId?: string }).analyticsId;
  return id && id.length > 0 ? id : undefined;
};

/** 型横断で type に応じた分岐コンポーネント。TrackImpression と分けるための helper。 */
const BlockSwitch = (props: { block: Block }) => (
  <Switch fallback={<UnknownBlockFallback block={props.block} />}>
    <Match when={props.block.type === "text"}>
      <TextBlockView block={props.block as Extract<Block, { type: "text" }>} />
    </Match>
    <Match when={props.block.type === "cta"}>
      <CtaBlockView block={props.block as Extract<Block, { type: "cta" }>} />
    </Match>
    <Match when={props.block.type === "media"}>
      <MediaBlockView block={props.block as Extract<Block, { type: "media" }>} />
    </Match>
    <Match when={props.block.type === "badge"}>
      <BadgeBlockView block={props.block as Extract<Block, { type: "badge" }>} />
    </Match>
    <Match when={props.block.type === "metric_list"}>
      <MetricListBlockView block={props.block as Extract<Block, { type: "metric_list" }>} />
    </Match>
    <Match when={props.block.type === "meta_line"}>
      <MetaLineBlockView block={props.block as Extract<Block, { type: "meta_line" }>} />
    </Match>
    <Match when={props.block.type === "price"}>
      <PriceBlockView block={props.block as Extract<Block, { type: "price" }>} />
    </Match>
    <Match when={props.block.type === "eclosion_forecast"}>
      <EclosionForecastBlockView block={props.block as Extract<Block, { type: "eclosion_forecast" }>} />
    </Match>
    <Match when={props.block.type === "divider"}>
      <DividerBlockView block={props.block as Extract<Block, { type: "divider" }>} />
    </Match>
    <Match when={props.block.type === "line_item"}>
      <LineItemBlockView block={props.block as Extract<Block, { type: "line_item" }>} />
    </Match>
    <Match when={props.block.type === "order_summary"}>
      <OrderSummaryBlockView block={props.block as Extract<Block, { type: "order_summary" }>} />
    </Match>
    <Match when={props.block.type === "form_field"}>
      <FormFieldView block={props.block as Extract<Block, { type: "form_field" }>} />
    </Match>
    <Match when={props.block.type === "shipping_method_picker"}>
      <ShippingMethodPickerView
        block={props.block as Extract<Block, { type: "shipping_method_picker" }>}
      />
    </Match>
  </Switch>
);

export const BlockRenderer = (props: { block: Block }) => {
  // analyticsId 不在の block は wrapper なしで描画 (= 既存挙動を完全維持)。
  // analyticsId がある場合のみ TrackImpression で <div> wrap して IO 観測する。
  const analyticsId = () => blockAnalyticsId(props.block);
  return (
    <Show when={analyticsId()} fallback={<BlockSwitch block={props.block} />}>
      {(id) => (
        <TrackImpression analyticsId={id()}>
          <BlockSwitch block={props.block} />
        </TrackImpression>
      )}
    </Show>
  );
};
