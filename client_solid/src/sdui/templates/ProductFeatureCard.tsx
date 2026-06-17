// ProductFeatureCard.tsx — `template === "product_feature"` のレイアウト
//
// 詳細: docs/sdui-three-layer-model-v5.md §5.4 (ProductFeature)
//
// **5 リージョンの並び**:
//   header → media → meta → body → footer
//   - header: 横並び badge 群 (画像の上にチップを重ねる "標識" 的役割)
//   - media : 画像 / 動画 / placeholder (200px 固定高、border 付き)
//   - meta  : 1 行スペック (id / shop / code 等)
//   - body  : 商品名・学名などのテキスト
//   - footer: 価格 + 羽化予測。MVP は縦積み (画面幅により横一列にしてもよい)
//
// 既存の `.card` クラス (overflow-hidden + 軽い影 + border) を再利用し、
// 中の region は padding / gap を内側で持つ。

import { Show } from "solid-js";
import type { CardBlock } from "../branded";
import { RegionRenderer } from "../RegionRenderer";

type ProductFeatureCardBlock = Extract<CardBlock, { template: "product_feature" }>;

export const ProductFeatureCard = (props: { card: ProductFeatureCardBlock }) => {
  const regions = () => props.card.regions;

  return (
    <article
      class="card"
      data-template="product_feature"
      data-variant={props.card.variant ?? "default"}
      data-card-id={props.card.id}
      style={{ overflow: "hidden", display: "flex", "flex-direction": "column" }}
    >
      {/* media を最上段に。header (badges) は absolute で画像左上にオーバーレイ */}
      <div style={{ position: "relative" }}>
        <RegionRenderer blocks={regions().media} />
        <Show when={regions().header.length > 0}>
          <RegionRenderer
            blocks={regions().header}
            style={{
              position: "absolute",
              top: "8px",
              left: "8px",
              display: "flex",
              gap: "6px",
              "z-index": "1",
            }}
          />
        </Show>
      </div>

      <div style={{ padding: "14px", display: "flex", "flex-direction": "column", gap: "10px" }}>
        <Show when={regions().body.length > 0}>
          <RegionRenderer
            blocks={regions().body}
            style={{ display: "flex", "flex-direction": "column", gap: "2px" }}
          />
        </Show>

        <Show when={regions().meta.length > 0}>
          <RegionRenderer blocks={regions().meta} />
        </Show>

        <Show when={regions().footer.length > 0}>
          <RegionRenderer
            blocks={regions().footer}
            style={{ display: "flex", "flex-direction": "column", gap: "6px", "margin-top": "4px" }}
          />
        </Show>
      </div>
    </article>
  );
};
