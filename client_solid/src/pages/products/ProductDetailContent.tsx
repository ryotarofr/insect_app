// ProductDetailContent.tsx — 商品詳細の右ペイン (タイトル/価格/説明/CTA)
import { Show } from "solid-js";
import type { Product } from "../../api";
import { addItem } from "../../store/cart";
import type { RouteKey } from "../../data";

const productToCartItem = (p: Product) => ({
  id: p.id,
  title: p.title,
  meta: p.generation ? `${p.generation} · ${p.shop}` : p.shop,
  price: p.price,
  qty: 1,
  kind: p.kind,
  tone: p.tone,
});

export const ProductDetailContent = (props: {
  product: Product;
  setRoute: (r: RouteKey) => void;
}) => {
  const p = () => props.product;
  const isLive = () => p().kind === "生体";

  const handleAddToCart = () => {
    addItem(productToCartItem(p()));
    props.setRoute("cart");
  };

  return (
    <div>
      <div
        class="mono"
        style={{ "font-size": "11px", color: "var(--ink-faint)", "letter-spacing": "0.1em" }}
      >
        {p().shop}
      </div>
      <h1 class="serif" style={{ margin: "4px 0 4px", "font-size": "26px", "font-weight": 600 }}>
        {p().title}
      </h1>
      <Show when={p().sci}>
        <div
          class="mono"
          style={{ "font-size": "11px", "font-style": "italic", color: "var(--ink-mute)" }}
        >
          {p().sci}
        </div>
      </Show>

      <div style={{ display: "flex", gap: "6px", "margin-top": "14px", "flex-wrap": "wrap" }}>
        <Show when={isLive()}>
          <span class="chip forest">
            <span class="dot" />
            生体
          </span>
        </Show>
        <Show when={p().badge}>
          <span class="chip indigo">{p().badge}</span>
        </Show>
        {/* 血統書付は badge と重複することがあるので条件付き */}
        <Show when={isLive() && p().badge !== "血統書付"}>
          <span class="chip amber">血統書付</span>
        </Show>
        <Show when={isLive()}>
          <span class="chip">要温度制御便</span>
        </Show>
      </div>

      <div style={{ display: "flex", "align-items": "baseline", gap: "8px", "margin-top": "22px" }}>
        <span
          class="serif"
          style={{ "font-size": "38px", "font-weight": 600, "letter-spacing": "-0.02em" }}
        >
          ¥{p().price.toLocaleString()}
        </span>
        <span style={{ "font-size": "12px", color: "var(--ink-mute)" }}>
          税込 / 配送料 ¥1,800〜
        </span>
      </div>

      <div style={{ display: "flex", gap: "8px", "margin-top": "18px" }}>
        <button class="btn lg primary" style={{ flex: 2 }} onClick={handleAddToCart}>
          カートに追加
        </button>
        <button class="btn lg" style={{ flex: 1 }} aria-label={`${p().title} をウォッチ`}>
          ウォッチ
        </button>
      </div>

      <div
        class="card"
        style={{
          "margin-top": "20px",
          padding: "16px",
          background: "var(--bg-sunken)",
          "border-color": "transparent",
        }}
      >
        <div
          class="mono"
          style={{
            "font-size": "11px",
            color: "var(--ink-mute)",
            "margin-bottom": "10px",
            "letter-spacing": "0.08em",
          }}
        >
          CARE GUARANTEE
        </div>
        <div style={{ display: "flex", gap: "18px", "font-size": "12px" }}>
          <div>✓ 死着補償（24h 自動返金）</div>
          <div>✓ 温度制御便</div>
          <div>✓ 購入後 自動カルテ生成</div>
        </div>
      </div>

      <Show when={isLive()}>
        <div style={{ "margin-top": "24px" }}>
          <div class="sec-head">
            <span class="num">§</span>
            <h2>個体詳細</h2>
          </div>
          <dl style={{ margin: 0 }}>
            <div class="spec">
              <dt>サイズ</dt>
              <dd class="mono">142mm (頭角含)</dd>
            </div>
            <div class="spec">
              <dt>性別</dt>
              <dd>♂ オス</dd>
            </div>
            <div class="spec">
              <dt>羽化日</dt>
              <dd class="mono">2025-11-18</dd>
            </div>
            <div class="spec">
              <dt>累代</dt>
              <dd class="mono">CBF2 · 父 #DHH-0198 / 母 #DHH-0204</dd>
            </div>
            <div class="spec">
              <dt>産地</dt>
              <dd>グアドループ産 (人工繁殖)</dd>
            </div>
            <div class="spec">
              <dt>ブリーダー</dt>
              <dd>
                ANCHOR BEETLE CO.{" "}
                <span class="chip indigo" style={{ "margin-left": "6px" }}>
                  認証済
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </Show>
    </div>
  );
};
