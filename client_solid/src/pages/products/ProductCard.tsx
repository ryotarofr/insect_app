// ProductCard.tsx — 商品一覧のグリッドカード
import { Show } from "solid-js";
import type { Product } from "../../api";

export const ProductCard = (p: { product: Product; onClick: () => void }) => {
  const prod = () => p.product;
  return (
    <div
      class="card"
      style={{ cursor: "pointer", overflow: "hidden" }}
      onClick={p.onClick}
    >
      <div
        class={`ph ${prod().tone}`}
        style={{
          height: "200px",
          "border-radius": 0,
          border: "none",
          "border-bottom": "1px solid var(--line)",
        }}
      >
        <span class="ph-label">{prod().phLabel}</span>
      </div>
      <div style={{ padding: "14px" }}>
        <div
          style={{
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
            "margin-bottom": "4px",
          }}
        >
          <span class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
            {prod().kind.toUpperCase()} · {prod().shop}
          </span>
          <Show when={prod().badge}>
            <span class={`chip ${prod().tone}`}>{prod().badge}</span>
          </Show>
        </div>
        <div style={{ "font-weight": 500, "font-size": "14px" }}>{prod().title}</div>
        <Show when={prod().sci}>
          <div
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--ink-faint)",
              "font-style": "italic",
              "margin-top": "2px",
            }}
          >
            {prod().sci}
          </div>
        </Show>
        <div style={{ display: "flex", "align-items": "baseline", gap: "4px", "margin-top": "10px" }}>
          <span class="serif" style={{ "font-size": "22px", "font-weight": 600 }}>
            ¥{prod().price.toLocaleString()}
          </span>
          <span style={{ "font-size": "11px", color: "var(--ink-mute)" }}>税込 / 送料別</span>
        </div>
      </div>
    </div>
  );
};
