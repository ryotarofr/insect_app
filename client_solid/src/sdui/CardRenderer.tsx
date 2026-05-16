// CardRenderer.tsx — CardBlock の template 判別ディスパッチ
//
// 詳細: docs/sdui-three-layer-model-v5.md §5 (Template / Card)
//
// **責務**:
//   `template` で switch し、各 template 用の React コンポーネントに振り分ける。
//   `product_feature` (一覧カード) / `product_detail` (詳細ページ) に対応。
//   将来: `hero_intro` / `promise_step` 等。
//
// **未知の template への対応**:
//   サーバ側で新 template が deploy されてフロントが古いケースに備えて、
//   fallback で警告ログ + 何も描画しない (画面真っ白を避ける目的)。
//
// **エラーバウンダリ (運用堅牢化)**:
//   テンプレート内で throw された場合、grid 全体や他カードへの波及を防ぐ。
//   `<ErrorBoundary>` で 1 枚分を分離し、落ちた時は CardErrorFallback を出す。
//   - id が解る範囲で表示 (debug ヒントに)
//   - エラー内容は console.error に詰める (UI には出さない = 機密漏洩予防)
//   一覧 (/products) 側は更にもう一段 ErrorBoundary を入れる二重防御。

import { ErrorBoundary, Match, Switch, createEffect } from "solid-js";
import type { CardBlock } from "./branded";
import { AnalyticsCardProvider } from "./AnalyticsContext";
import { ProductFeatureCard } from "./templates/ProductFeatureCard";
import { ProductDetailCard } from "./templates/ProductDetailCard";
import { CartCard } from "./templates/CartCard";

const warnedTemplates = new Set<string>();

/** 未知 template fallback。Switch の fallback として使うため、
 *  純粋なコンポーネントにして「実際に描画された時だけ warn」させる。 */
const UnknownTemplateFallback = (props: { card: CardBlock }) => {
  createEffect(() => {
    const t = (props.card as { template: string }).template;
    if (warnedTemplates.has(t)) return;
    warnedTemplates.add(t);
    // eslint-disable-next-line no-console
    console.warn(`[sdui] unknown card template: "${t}" (skipped, id="${props.card.id}")`);
  });
  return null;
};

/** カード描画中の throw を吸収する fallback。
 *  - 視覚的には「壊れた 1 枚」だと判るプレースホルダ
 *  - id とテンプレート名は出すが、エラーメッセージ本体は console に逃がす
 *    (ユーザに技術詳細を見せず、開発者は devtools で追える) */
const CardErrorFallback = (props: { card: CardBlock; err: unknown }) => {
  createEffect(() => {
    // eslint-disable-next-line no-console
    console.error(
      `[sdui] card render failed: id="${props.card.id}" template="${(props.card as { template: string }).template}"`,
      props.err,
    );
  });
  return (
    <article
      class="card"
      data-card-error="true"
      data-card-id={props.card.id}
      style={{
        padding: "16px",
        border: "1px dashed var(--accent-rose)",
        color: "var(--accent-rose)",
        "font-size": "12px",
      }}
    >
      <strong>カードを表示できませんでした</strong>
      <div style={{ "margin-top": "4px", color: "var(--ink-mute)" }}>
        id: <code>{props.card.id}</code>
      </div>
    </article>
  );
};

export const CardRenderer = (props: { card: CardBlock }) => {
  // ambient analytics context: 子孫の Block レンダラから useAnalyticsCardContext() で読める。
  // variant / experiment はカード単位で固定なので component init 時に確定して OK。
  const analyticsValue = () => ({
    cardId: props.card.id,
    variant: props.card.variant,
    experiment: props.card.experiment,
  });
  return (
    <ErrorBoundary fallback={(err) => <CardErrorFallback card={props.card} err={err} />}>
      <AnalyticsCardProvider value={analyticsValue()}>
        <Switch fallback={<UnknownTemplateFallback card={props.card} />}>
          <Match when={props.card.template === "product_feature"}>
            <ProductFeatureCard
              card={props.card as Extract<CardBlock, { template: "product_feature" }>}
            />
          </Match>
          <Match when={props.card.template === "product_detail"}>
            <ProductDetailCard
              card={props.card as Extract<CardBlock, { template: "product_detail" }>}
            />
          </Match>
          <Match when={props.card.template === "cart"}>
            <CartCard
              card={props.card as Extract<CardBlock, { template: "cart" }>}
            />
          </Match>
        </Switch>
      </AnalyticsCardProvider>
    </ErrorBoundary>
  );
};
