// ProductMediaGallery.tsx — 商品詳細の画像ビュー + サムネ + 動画枠
import { createSignal, For } from "solid-js";
import type { Product } from "../../api";

export const ProductMediaGallery = (p: { product: Product }) => {
  const [thumb, setThumb] = createSignal(0);

  return (
    <div>
      <div
        class={`ph ${p.product.tone}`}
        style={{ height: "480px", "border-radius": "var(--r-lg)" }}
      >
        <span class="ph-label">{p.product.phLabel}</span>
      </div>
      <div style={{ display: "flex", gap: "8px", "margin-top": "12px" }}>
        <For each={[0, 1, 2, 3]}>
          {(i) => (
            <div
              onClick={() => setThumb(i)}
              class={`ph ${p.product.tone}`}
              style={{
                height: "72px",
                width: "96px",
                cursor: "pointer",
                "border-color": thumb() === i ? "var(--ink)" : undefined,
                "border-width": thumb() === i ? "2px" : "1px",
              }}
            >
              <span class="mono" style={{ "font-size": "9px" }}>
                0{i + 1}
              </span>
            </div>
          )}
        </For>
        <div class="ph amber" style={{ height: "72px", width: "96px", cursor: "pointer" }}>
          <span class="ph-label">▶ 開封動画</span>
        </div>
      </div>
    </div>
  );
};
