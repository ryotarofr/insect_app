// Cart.tsx — カート・チェックアウト
import { createMemo, createSignal, For, Show } from "solid-js";
import { cartItems, cartSubtotal, removeItem, updateQty } from "../store/cart";

interface ShippingOption {
  id: "cold" | "normal";
  name: string;
  sub: string;
  price: number;
}

const SHIPPING_OPTIONS: ShippingOption[] = [
  { id: "cold", name: "温度制御便（推奨）", sub: "生体含むため必須設定 · 15〜25℃", price: 1800 },
  { id: "normal", name: "通常便", sub: "用品のみの場合", price: 800 },
];

export const CartPage = () => {
  const [shippingId, setShippingId] = createSignal<ShippingOption["id"]>("cold");

  const items = cartItems;
  const subtotal = cartSubtotal;
  const shipping = createMemo(
    () => SHIPPING_OPTIONS.find((o) => o.id === shippingId())?.price ?? 0,
  );
  const shippingLabel = createMemo(() =>
    shippingId() === "cold" ? "温度制御" : "通常",
  );
  const total = createMemo(() => subtotal() + shipping());

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">お会計</div>
          <h1>カートとお届け先</h1>
        </div>
      </div>

      <Show
        when={items().length > 0}
        fallback={
          <div
            class="card"
            style={{
              padding: "60px 24px",
              "text-align": "center",
              color: "var(--ink-mute)",
            }}
          >
            <div class="serif" style={{ "font-size": "18px", "font-weight": 600 }}>
              カートは空です
            </div>
            <div style={{ "font-size": "13px", "margin-top": "8px" }}>
              ショップから気になる個体や用品を追加してください。
            </div>
          </div>
        }
      >
        <div class="grid-cart">
          <div>
            <div class="sec-head">
              <span class="num">§01</span>
              <h2>カート ({items().length} 点)</h2>
            </div>
            <For each={items()}>
              {(it) => (
                <div
                  class="card"
                  style={{ padding: "14px", display: "flex", gap: "14px", "margin-bottom": "10px" }}
                >
                  <div
                    class={`ph ${it.tone}`}
                    style={{ width: "80px", height: "80px", "flex-shrink": 0 }}
                    role="img"
                    aria-label={`${it.kind} のサムネイル`}
                  >
                    <span class="mono" style={{ "font-size": "10px" }}>
                      {it.kind}
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ "font-weight": 500 }}>{it.title}</div>
                    <div
                      class="mono"
                      style={{ "font-size": "11px", color: "var(--ink-faint)", "margin-top": "2px" }}
                    >
                      {it.meta}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        gap: "10px",
                        "margin-top": "10px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          border: "1px solid var(--line-strong)",
                          "border-radius": "var(--r-md)",
                        }}
                      >
                        <button
                          aria-label={`${it.title} の数量を減らす`}
                          style={{ padding: "4px 10px" }}
                          onClick={() => updateQty(it.id, -1)}
                          disabled={it.qty <= 1}
                        >
                          −
                        </button>
                        <span
                          class="mono"
                          aria-label={`数量 ${it.qty}`}
                          style={{
                            padding: "4px 10px",
                            "border-left": "1px solid var(--line)",
                            "border-right": "1px solid var(--line)",
                          }}
                        >
                          {it.qty}
                        </span>
                        <button
                          aria-label={`${it.title} の数量を増やす`}
                          style={{ padding: "4px 10px" }}
                          onClick={() => updateQty(it.id, 1)}
                        >
                          ＋
                        </button>
                      </div>
                      <button
                        class="btn sm ghost"
                        style={{ color: "var(--ink-faint)" }}
                        onClick={() => removeItem(it.id)}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                  <div
                    class="serif"
                    style={{ "font-size": "20px", "font-weight": 600, "align-self": "center" }}
                  >
                    ¥{(it.price * it.qty).toLocaleString()}
                  </div>
                </div>
              )}
            </For>

            <div class="sec-head" style={{ "margin-top": "28px" }}>
              <span class="num">§02</span>
              <h2>お届け先</h2>
            </div>
            <div class="card" style={{ padding: "20px" }}>
              <div
                style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "12px" }}
              >
                <div>
                  <label class="label" for="ship-name">
                    氏名
                  </label>
                  <input id="ship-name" class="input" value="山田 徹" />
                </div>
                <div>
                  <label class="label" for="ship-tel">
                    電話
                  </label>
                  <input id="ship-tel" class="input mono" value="080-0000-0000" />
                </div>
                <div>
                  <label class="label" for="ship-zip">
                    郵便番号
                  </label>
                  <input id="ship-zip" class="input mono" value="150-0001" />
                </div>
                <div>
                  <label class="label" for="ship-pref">
                    都道府県
                  </label>
                  <select id="ship-pref" class="select">
                    <option>東京都</option>
                  </select>
                </div>
                <div style={{ "grid-column": "1 / 3" }}>
                  <label class="label" for="ship-addr">
                    住所
                  </label>
                  <input id="ship-addr" class="input" value="渋谷区神宮前..." />
                </div>
              </div>
            </div>

            <div class="sec-head" style={{ "margin-top": "28px" }}>
              <span class="num">§03</span>
              <h2>配送方法</h2>
            </div>
            <div class="card" style={{ padding: 0 }}>
              <For each={SHIPPING_OPTIONS}>
                {(o, i) => (
                  <label
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "12px",
                      padding: "16px",
                      "border-bottom":
                        i() < SHIPPING_OPTIONS.length - 1 ? "1px solid var(--line)" : "none",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="ship"
                      checked={shippingId() === o.id}
                      onChange={() => setShippingId(o.id)}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ "font-weight": 500 }}>{o.name}</div>
                      <div style={{ "font-size": "12px", color: "var(--ink-mute)" }}>{o.sub}</div>
                    </div>
                    <span class="mono">¥{o.price.toLocaleString()}</span>
                  </label>
                )}
              </For>
            </div>
          </div>

          <div
            class="card"
            style={{ padding: "22px", position: "sticky", top: "72px" }}
          >
            <div
              class="mono"
              style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}
            >
              注文サマリー
            </div>
            <div
              class="serif"
              style={{ "font-size": "20px", "font-weight": 600, "margin-bottom": "16px" }}
            >
              ご注文内容
            </div>

            <For each={items()}>
              {(it) => (
                <div
                  style={{
                    display: "flex",
                    "justify-content": "space-between",
                    padding: "6px 0",
                    "font-size": "13px",
                    "border-bottom": "1px dashed var(--line)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--ink-mute)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                      "margin-right": "8px",
                    }}
                  >
                    {it.title} × {it.qty}
                  </span>
                  <span class="mono">¥{(it.price * it.qty).toLocaleString()}</span>
                </div>
              )}
            </For>

            <div style={{ "margin-top": "14px" }}>
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  padding: "4px 0",
                  "font-size": "13px",
                }}
              >
                <span style={{ color: "var(--ink-mute)" }}>小計</span>
                <span class="mono">¥{subtotal().toLocaleString()}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  padding: "4px 0",
                  "font-size": "13px",
                }}
              >
                <span style={{ color: "var(--ink-mute)" }}>
                  配送料 ({shippingLabel()})
                </span>
                <span class="mono">¥{shipping().toLocaleString()}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  padding: "10px 0 4px",
                  "border-top": "1px solid var(--ink)",
                  "margin-top": "8px",
                }}
              >
                <span style={{ "font-weight": 600 }}>合計（税込）</span>
                <span class="serif" style={{ "font-size": "22px", "font-weight": 600 }}>
                  ¥{total().toLocaleString()}
                </span>
              </div>
            </div>

            <div
              style={{
                padding: "12px",
                background: "var(--accent-forest-soft)",
                "border-radius": "var(--r-md)",
                "font-size": "11px",
                "margin-top": "12px",
                color: "var(--accent-forest)",
              }}
            >
              ✓ 購入後、生体は自動でカルテに登録されます
            </div>

            <button class="btn primary lg block" style={{ "margin-top": "14px" }}>
              Stripeで決済 →
            </button>
          </div>
        </div>
      </Show>
    </>
  );
};
