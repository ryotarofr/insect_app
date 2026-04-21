// Shop.tsx — ショップ管理ダッシュボード
import { For } from "solid-js";
import { getShopStats, listOrders } from "../api";

const LOW_STOCK = [
  { name: "高栄養ゼリー 17g×50", qty: 12, threshold: 50, img: "amber" },
  { name: "完熟発酵マット 10L", qty: 4, threshold: 20, img: "amber" },
  { name: "菌糸ビン 1400cc", qty: 8, threshold: 30, img: "amber" },
];

const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

export const ShopPage = () => {
  const st = getShopStats();
  const orders = listOrders();
  const maxRev = Math.max(...st.revenue7d);

  const topCards = [
    { label: "本日の売上", val: `¥${st.todayRevenue.toLocaleString()}`, delta: "+38% vs 昨日", tone: "forest" },
    { label: "本日の注文", val: `${st.todayOrders}`, delta: "12 件", tone: "" },
    { label: "要発送", val: `${st.pendingShip}`, delta: "うち要温度制御 2", tone: "amber" },
    { label: "在庫僅少", val: `${st.lowStock}`, delta: "補充推奨", tone: "rose" },
  ];

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">ショップ管理 · ANCHOR BEETLE CO.</div>
          <h1>ショップ管理</h1>
        </div>
        <div class="page-actions">
          <button class="btn">個体を登録</button>
          <button class="btn primary">+ 商品追加</button>
        </div>
      </div>

      <div
        class="grid-cards-4"
        style={{
          gap: "1px",
          background: "var(--line)",
          border: "1px solid var(--line)",
          "border-radius": "var(--r-lg)",
          overflow: "hidden",
          "margin-bottom": "24px",
        }}
      >
        <For each={topCards}>
          {(x) => (
            <div style={{ background: "var(--bg-raised)", padding: "20px" }}>
              <div
                class="mono"
                style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}
              >
                {x.label}
              </div>
              <div
                class="serif"
                style={{
                  "font-size": "30px",
                  "font-weight": 600,
                  "margin-top": "4px",
                  "letter-spacing": "-0.01em",
                }}
              >
                {x.val}
              </div>
              <div class={`chip ${x.tone}`} style={{ "margin-top": "6px" }}>
                {x.delta}
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="grid-detail-narrow">
        <div class="card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", "align-items": "baseline", gap: "10px", "margin-bottom": "20px" }}>
            <span
              class="mono"
              style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}
            >
              売上
            </span>
            <span class="serif" style={{ "font-size": "18px", "font-weight": 600 }}>
              売上推移 (7日)
            </span>
            <div style={{ "margin-left": "auto", display: "flex", gap: "4px" }}>
              <button class="btn sm" style={{ padding: "3px 8px", "font-size": "11px" }}>
                7D
              </button>
              <button class="chip" style={{ padding: "3px 8px" }}>
                30D
              </button>
              <button class="chip" style={{ padding: "3px 8px" }}>
                90D
              </button>
            </div>
          </div>
          <div style={{ display: "flex", "align-items": "flex-end", gap: "10px", height: "180px" }}>
            <For each={st.revenue7d}>
              {(v, i) => (
                <div
                  style={{
                    flex: 1,
                    height: "100%",
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    "justify-content": "flex-end",
                    gap: "6px",
                  }}
                >
                  <div class="mono" style={{ "font-size": "10px", color: "var(--ink-mute)" }}>
                    ¥{(v / 1000).toFixed(0)}k
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: `${(v / maxRev) * 100}%`,
                      background: i() === 6 ? "var(--ink)" : "var(--accent-forest)",
                      "border-radius": "3px 3px 0 0",
                    }}
                  />
                  <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                    {DAY_LABELS[i()]}
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        <div class="card" style={{ padding: "24px" }}>
          <div
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--ink-faint)",
              "letter-spacing": "0.12em",
              "margin-bottom": "14px",
            }}
          >
            在庫僅少 · 要補充
          </div>
          <For each={LOW_STOCK}>
            {(x, i) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "12px",
                  padding: "10px 0",
                  "border-bottom": i() < LOW_STOCK.length - 1 ? "1px dashed var(--line)" : "none",
                }}
              >
                <div class={`ph ${x.img}`} style={{ width: "40px", height: "40px" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ "font-size": "13px", "font-weight": 500 }}>{x.name}</div>
                  <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                    残 {x.qty} / 閾値 {x.threshold}
                  </div>
                  <div
                    style={{
                      height: "3px",
                      background: "var(--bg-sunken)",
                      "border-radius": "2px",
                      "margin-top": "4px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${(x.qty / x.threshold) * 100}%`,
                        height: "100%",
                        background: "var(--accent-rose)",
                      }}
                    />
                  </div>
                </div>
                <button class="btn sm">補充</button>
              </div>
            )}
          </For>
        </div>
      </div>

      <div style={{ "margin-top": "28px" }}>
        <div class="sec-head">
          <span class="num">§</span>
          <h2>注文一覧</h2>
          <span class="meta">本日 {st.todayOrders} 件</span>
        </div>
        <div class="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "140px 120px 1fr 100px 110px 120px 80px",
              padding: "10px 16px",
              "font-size": "10px",
              color: "var(--ink-faint)",
              "letter-spacing": "0.1em",
              "font-family": "var(--font-mono)",
              background: "var(--bg-sunken)",
              "border-bottom": "1px solid var(--line)",
            }}
          >
            <span>注文ID</span>
            <span>購入者</span>
            <span>商品</span>
            <span>合計</span>
            <span>配送</span>
            <span>状態</span>
            <span />
          </div>
          <For each={orders}>
            {(o, i) => (
              <div
                style={{
                  display: "grid",
                  "grid-template-columns": "140px 120px 1fr 100px 110px 120px 80px",
                  padding: "12px 16px",
                  "font-size": "13px",
                  "align-items": "center",
                  "border-bottom":
                    i() < orders.length - 1 ? "1px solid var(--line)" : "none",
                }}
              >
                <span class="mono" style={{ "font-size": "11px" }}>
                  {o.id}
                </span>
                <span>{o.buyer}</span>
                <span style={{ color: "var(--ink-mute)" }}>{o.items}</span>
                <span class="mono">¥{o.total.toLocaleString()}</span>
                <span class={`chip ${o.temp.includes("温度") ? "amber" : ""}`} style={{ "font-size": "10px" }}>
                  {o.temp}
                </span>
                <span
                  class={`chip ${
                    o.status === "要発送"
                      ? "rose"
                      : o.status === "発送済"
                        ? "forest"
                        : o.status === "入金待ち"
                          ? ""
                          : "indigo"
                  }`}
                >
                  {o.status}
                </span>
                <button class="btn sm ghost">詳細 →</button>
              </div>
            )}
          </For>
        </div>
      </div>
    </>
  );
};
