// CartCard.tsx — `template === "cart"` のレイアウト
//
// 詳細: docs/sdui-three-layer-model-v5.md §5.6 (Cart)
//
// **4 リージョンの並び**:
//   header → items → summary → cta
//   - header  : "あなたのカート (N 件)" 見出し
//   - items   : LineItem の縦リスト (空 = empty state)
//   - summary : OrderSummary 1 件 (空カート時は出さない)
//   - cta     : 「レジへ進む」「買い物を続ける」
//
// **空カート時の表現**:
//   `items.length === 0` を checker にして「カートは空です」プレースホルダを出す。
//   CartVariant を分けず、renderer 側でこの分岐を吸収する設計。
//
// 既存 `.card` は使わず、cart 画面はもう少しゆったりしたレイアウトに。

import { Show } from "solid-js";
import type { CardBlock } from "../branded";
import { RegionRenderer } from "../RegionRenderer";

type CartCardBlock = Extract<CardBlock, { template: "cart" }>;

export const CartCard = (props: { card: CartCardBlock }) => {
  const regions = () => props.card.regions;
  const isEmpty = () => regions().items.length === 0;

  return (
    <article
      data-template="cart"
      data-variant={props.card.variant ?? "default"}
      data-card-id={props.card.id}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "16px",
        "max-width": "640px",
        margin: "0 auto",
        padding: "20px",
      }}
    >
      <Show when={regions().header.length > 0}>
        <RegionRenderer
          blocks={regions().header}
          style={{ display: "flex", "flex-direction": "column", gap: "4px" }}
        />
      </Show>

      <Show
        when={!isEmpty()}
        fallback={
          <div
            data-cart-empty="true"
            style={{
              padding: "40px 20px",
              "text-align": "center",
              color: "var(--ink-mute)",
              border: "1px dashed var(--line)",
              "border-radius": "8px",
            }}
          >
            カートは空です。お気に入りの一頭を見つけてください。
          </div>
        }
      >
        <RegionRenderer
          blocks={regions().items}
          style={{
            display: "flex",
            "flex-direction": "column",
            "border-top": "1px solid var(--line)",
          }}
        />
      </Show>

      <Show when={regions().summary.length > 0}>
        <RegionRenderer blocks={regions().summary} />
      </Show>

      <Show when={regions().cta.length > 0}>
        <RegionRenderer
          blocks={regions().cta}
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "8px",
            "margin-top": "8px",
          }}
        />
      </Show>
    </article>
  );
};
