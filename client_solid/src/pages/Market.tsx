// Market.tsx — C2Cマーケットプレイス
import { createSignal, For, Show } from "solid-js";
import { getSpecimen, listMarketListings, listSpecimens } from "../api";

type Tab = "browse" | "sell";
type SellMode = "auction" | "fixed";

const MarketBrowse = () => (
  <>
    <div
      class="card"
      style={{
        padding: "16px",
        "margin-bottom": "20px",
        display: "flex",
        "align-items": "center",
        gap: "12px",
        background: "var(--bg-sunken)",
        "border-color": "transparent",
      }}
    >
      <span class="chip indigo">血統認証</span>
      <span style={{ "font-size": "13px", color: "var(--ink-mute)" }}>
        このバッジは、イベントログで累代を検証済の個体に付与されます。
      </span>
      <span class="mono" style={{ "margin-left": "auto", "font-size": "11px", color: "var(--ink-faint)" }}>
        Stripe Connect エスクロー適用
      </span>
    </div>

    <div class="grid-cards-2">
      <For each={listMarketListings()}>
        {(l) => (
          <div class="card" style={{ display: "flex", gap: 0, overflow: "hidden", cursor: "pointer" }}>
            <div
              class="ph forest"
              style={{
                width: "180px",
                "min-height": "180px",
                "border-radius": 0,
                "flex-shrink": 0,
                border: "none",
                "border-right": "1px solid var(--line)",
              }}
            >
              <span class="ph-label">出品画像</span>
            </div>
            <div style={{ padding: "16px", flex: 1, display: "flex", "flex-direction": "column" }}>
              <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "4px" }}>
                <span class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                  {l.id}
                </span>
                <span class={`chip ${l.auction ? "amber" : "forest"}`}>
                  {l.auction ? `オークション · 残 ${l.endsIn}` : "即決のみ"}
                </span>
              </div>
              <div style={{ "font-weight": 600, "font-size": "14px" }}>{l.title}</div>
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "6px",
                  "margin-top": "6px",
                  "font-size": "12px",
                  color: "var(--ink-mute)",
                }}
              >
                <span>
                  出品者: <b style={{ color: "var(--ink)" }}>{l.seller}</b>
                </span>
                <Show when={l.verified}>
                  <span class="chip indigo" style={{ padding: "1px 6px", "font-size": "10px" }}>
                    ✓ 認証ブリーダー
                  </span>
                </Show>
              </div>

              <div
                style={{
                  display: "flex",
                  "align-items": "baseline",
                  gap: "4px",
                  "margin-top": "auto",
                  "padding-top": "14px",
                }}
              >
                <span class="serif" style={{ "font-size": "24px", "font-weight": 600 }}>
                  ¥{l.price.toLocaleString()}
                </span>
                <span style={{ "font-size": "11px", color: "var(--ink-mute)", "margin-left": "4px" }}>
                  {l.auction ? "現在価格" : "即決"}
                </span>
                <div
                  style={{
                    "margin-left": "auto",
                    display: "flex",
                    gap: "12px",
                    "font-size": "11px",
                    color: "var(--ink-mute)",
                  }}
                >
                  <Show when={l.bids !== null}>
                    <span>
                      入札{" "}
                      <b class="mono" style={{ color: "var(--ink)" }}>
                        {l.bids}
                      </b>
                    </span>
                  </Show>
                  <span>👁 {l.watchers}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "6px", "margin-top": "12px" }}>
                <Show when={l.auction}>
                  <button class="btn sm" style={{ flex: 1 }}>
                    入札
                  </button>
                </Show>
                <button class="btn sm primary" style={{ flex: 1 }}>
                  {l.auction ? "即決購入" : "購入する"}
                </button>
                <button class="btn sm ghost">♡</button>
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  </>
);

const MarketSell = () => {
  const [picked, setPicked] = createSignal<string | null>(null);
  const [mode, setMode] = createSignal<SellMode>("auction");
  const myStock = listSpecimens();
  const pickedSpec = () => {
    const id = picked();
    return id ? getSpecimen(id) : undefined;
  };

  return (
    <div class="grid-detail-narrow">
      <div>
        <div class="sec-head">
          <span class="num">§01</span>
          <h2>出品する個体を選ぶ</h2>
          <span class="meta">カルテから自動引用</span>
        </div>
        <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "10px" }}>
          <For each={myStock}>
            {(s) => (
              <div
                onClick={() => setPicked(s.id)}
                class="card"
                style={{
                  padding: "12px",
                  cursor: "pointer",
                  "border-color": picked() === s.id ? "var(--ink)" : "var(--line)",
                  "border-width": picked() === s.id ? "2px" : "1px",
                }}
              >
                <div style={{ display: "flex", gap: "10px" }}>
                  <div class="ph forest" style={{ width: "50px", height: "50px", "flex-shrink": 0 }} />
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                      {s.id}
                    </div>
                    <div
                      style={{
                        "font-weight": 500,
                        "font-size": "13px",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {s.name}
                    </div>
                    <div style={{ display: "flex", gap: "4px", "margin-top": "4px" }}>
                      <span class="chip" style={{ "font-size": "9px", padding: "1px 5px" }}>
                        {s.generation}
                      </span>
                      <span class="chip" style={{ "font-size": "9px", padding: "1px 5px" }}>
                        {s.sex}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="card" style={{ padding: "24px", position: "sticky", top: "72px", "align-self": "start" }}>
        <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}>
          新規出品
        </div>
        <div class="serif" style={{ "font-size": "20px", "font-weight": 600, "margin-bottom": "16px" }}>
          出品情報
        </div>

        <Show
          when={picked()}
          fallback={
            <div
              style={{
                "margin-bottom": "14px",
                padding: "12px",
                border: "1px dashed var(--line-strong)",
                "border-radius": "var(--r-md)",
                color: "var(--ink-faint)",
                "font-size": "12px",
                "text-align": "center",
              }}
            >
              ← 左から個体を選択してください
            </div>
          }
        >
          <div
            style={{
              "margin-bottom": "14px",
              padding: "12px",
              background: "var(--accent-forest-soft)",
              "border-radius": "var(--r-md)",
            }}
          >
            <div class="mono" style={{ "font-size": "11px", color: "var(--accent-forest)" }}>
              選択中
            </div>
            <div style={{ "font-weight": 500 }}>{pickedSpec()?.name}</div>
            <div class="mono" style={{ "font-size": "11px", color: "var(--ink-mute)" }}>
              カルテ情報が自動反映されます
            </div>
          </div>
        </Show>

        <label class="label">販売方式</label>
        <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "6px", "margin-bottom": "12px" }}>
          <button
            class="btn sm"
            onClick={() => setMode("auction")}
            style={{
              background: mode() === "auction" ? "var(--bg-inverse)" : "var(--bg-raised)",
              color: mode() === "auction" ? "var(--ink-inverse)" : "var(--ink)",
            }}
          >
            オークション
          </button>
          <button
            class="btn sm"
            onClick={() => setMode("fixed")}
            style={{
              background: mode() === "fixed" ? "var(--bg-inverse)" : "var(--bg-raised)",
              color: mode() === "fixed" ? "var(--ink-inverse)" : "var(--ink)",
            }}
          >
            即決のみ
          </button>
        </div>

        <label class="label">{mode() === "auction" ? "開始価格" : "即決価格"}</label>
        <div style={{ position: "relative" }}>
          <span
            class="mono"
            style={{
              position: "absolute",
              left: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--ink-mute)",
            }}
          >
            ¥
          </span>
          <input class="input mono" style={{ "padding-left": "28px" }} value="45,000" />
        </div>

        <Show when={mode() === "auction"}>
          <label class="label" style={{ "margin-top": "12px" }}>
            終了期間
          </label>
          <select class="select">
            <option>3日</option>
            <option>5日</option>
            <option>7日</option>
          </select>
        </Show>

        <label class="label" style={{ "margin-top": "12px" }}>
          商品説明（自動生成 / 編集可）
        </label>
        <textarea
          class="textarea"
          value={
            picked()
              ? `ヘラクレスオオカブト ♂ 142mm。CBF3個体。父 #DHH-0213、母 #DHH-0244。血統書付、認証ブリーダーによる累代。蛹期を経ての出品、状態良好。`
              : ""
          }
        />

        <div
          style={{
            padding: "12px",
            background: "var(--bg-sunken)",
            "border-radius": "var(--r-md)",
            "margin-top": "14px",
            "font-size": "11px",
            color: "var(--ink-mute)",
            "line-height": 1.7,
          }}
        >
          <div style={{ "font-weight": 600, color: "var(--ink)", "margin-bottom": "4px" }}>
            手数料と保護
          </div>
          販売手数料 10% / Stripe決済手数料 3.6% / エスクロー購入者保護 / 死着自動返金
        </div>

        <button class="btn primary lg block" style={{ "margin-top": "14px" }} disabled={!picked()}>
          出品する
        </button>
      </div>
    </div>
  );
};

export const MarketPage = () => {
  const [tab, setTab] = createSignal<Tab>("browse");

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">C2Cマーケット</div>
          <h1>個体を探す / 出品する</h1>
        </div>
        <div class="page-actions">
          <div class="variants">
            <button class={tab() === "browse" ? "active" : ""} onClick={() => setTab("browse")}>
              出品一覧
            </button>
            <button class={tab() === "sell" ? "active" : ""} onClick={() => setTab("sell")}>
              出品する
            </button>
          </div>
        </div>
      </div>

      <Show when={tab() === "browse"} fallback={<MarketSell />}>
        <MarketBrowse />
      </Show>
    </>
  );
};
