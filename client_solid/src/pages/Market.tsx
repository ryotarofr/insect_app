// Market.tsx — C2Cマーケットプレイス
//
// P2-12: 出品ドラフトの商品説明 textarea を signal 化し、
//   選択中個体のカルテから templateFor(s) で自動流し込みする。
//     - 個体選択直後: signal を template に上書き
//     - ユーザー編集後: 上書きしない (isEdited フラグで追跡)
//     - 別個体に切替: isEdited をリセットし再生成
//   これにより「プレースホルダは書き換え不可 / value 固定」問題を解消する。
import { createEffect, createSignal, For, Show } from "solid-js";
import { getSpecimen, listMarketListings, listSpecimens } from "../api";
import type { Listing, Specimen } from "../data";

type Tab = "browse" | "sell";
type SellMode = "auction" | "fixed";

/** P3-22: 出品カードの「状態」を 3 分類し、左ボーダーで色分けする。
 *   - ending-soon: オークションで 24h 以内 (rose)
 *   - auction    : オークションで 1 日以上あり (amber)
 *   - buynow     : 即決のみ (forest)
 * endsIn の文字列は「2日 14h / 18h / 4h 32m / 即決のみ」など雑多なので、
 * "日" を含むかで 24h+ を判定し、含まない場合は短時間とみなす。 */
type ListingState = "ending-soon" | "auction" | "buynow";
export const deriveListingState = (l: Listing): ListingState => {
  if (!l.auction) return "buynow";
  return l.endsIn.includes("日") ? "auction" : "ending-soon";
};

interface MarketBrowseProps {
  /** 出品0件時のCTA: 「出品する」タブに切替 */
  onSwitchToSell: () => void;
}

const MarketBrowse = (props: MarketBrowseProps) => {
  const listings = listMarketListings();
  return (
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

    <Show
      when={listings.length > 0}
      fallback={
        <div
          class="card"
          style={{
            padding: "32px 24px",
            "text-align": "center",
            color: "var(--ink-mute)",
            "font-size": "13px",
          }}
        >
          <div style={{ "font-weight": 600, color: "var(--ink)", "margin-bottom": "6px" }}>
            現在出品中の個体はありません
          </div>
          <div style={{ "margin-bottom": "16px" }}>
            あなたの所有個体を C2C マーケットに出品することができます。
          </div>
          <button class="btn primary" onClick={() => props.onSwitchToSell()}>
            出品する
          </button>
        </div>
      }
    >
    <div class="grid-cards-2">
      <For each={listings}>
        {(l) => (
          <div
            class="card market-card"
            data-state={deriveListingState(l)}
            style={{ display: "flex", gap: 0, overflow: "hidden", cursor: "pointer" }}
          >
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
              role="img"
              aria-label={`${l.title} 出品画像 (プレースホルダ)`}
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
                <span class="serif price" style={{ "font-size": "24px", "font-weight": 600 }}>
                  <span class="price-yen">¥</span>
                  {l.price.toLocaleString()}
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
    </Show>
  </>
  );
};

/**
 * カルテ情報から出品ドラフト本文を生成する。
 *   - サイズ・性別・累代・血統・産地(shop)・羽化目安を箇条書きで盛り込む
 *   - 累代未登録 (F0 / WILD) の場合は「野生個体」として文面を切替
 *   - photo / 死着補償 の案内は固定
 */
export const templateFor = (s: Specimen): string => {
  const size = s.sizeMm ? `${s.sizeMm}mm` : "サイズ未計測";
  const weight = s.weightG ? ` / ${s.weightG}g` : "";
  const gen = s.generation || "累代不明";
  const isWild = /WILD|F0/i.test(gen);
  const parents =
    s.bloodline && (s.bloodline.father || s.bloodline.mother)
      ? `父 ${s.bloodline.father || "—"} / 母 ${s.bloodline.mother || "—"}`
      : "親個体情報なし";
  const eclo = s.eclosionETA
    ? `羽化目安 ${s.eclosionETA} (あと約 ${s.eclosionInDays ?? "?"} 日)`
    : "羽化済み / 成虫";

  const head = `${s.name} (${s.sex})`;
  const lines = [
    head,
    "",
    `■ サイズ: ${size}${weight}`,
    `■ 累代: ${gen}${isWild ? " (野生個体)" : ""}`,
    `■ 血統: ${parents}`,
    `■ 産地: ${s.shop || "—"}`,
    `■ ステータス: ${s.stage} / ${eclo}`,
    "",
    "血統書付・認証ブリーダーによる累代管理個体です。",
    "死着補償および温度制御便に対応しております。",
  ];
  return lines.join("\n");
};

const MarketSell = () => {
  const [picked, setPicked] = createSignal<string | null>(null);
  const [mode, setMode] = createSignal<SellMode>("auction");
  const [desc, setDesc] = createSignal("");
  // ユーザーがテキストを編集したか (編集済み個体を切替えても上書きしないためのフラグ)
  const [descEdited, setDescEdited] = createSignal(false);
  const myStock = listSpecimens();
  const pickedSpec = () => {
    const id = picked();
    return id ? getSpecimen(id) : undefined;
  };

  // 個体選択が変わったらテンプレートを流し込む。
  // 編集済みフラグはリセットする (新しい個体の説明として書き直す前提)。
  createEffect(() => {
    const s = pickedSpec();
    if (!s) {
      setDesc("");
      setDescEdited(false);
      return;
    }
    setDesc(templateFor(s));
    setDescEdited(false);
  });

  const onDescInput = (e: InputEvent) => {
    const t = e.currentTarget as HTMLTextAreaElement;
    setDesc(t.value);
    setDescEdited(true);
  };

  // テンプレートへ手動で戻すボタン用
  const resetDesc = () => {
    const s = pickedSpec();
    if (!s) return;
    setDesc(templateFor(s));
    setDescEdited(false);
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
                  <div
                    class="ph forest"
                    style={{ width: "50px", height: "50px", "flex-shrink": 0 }}
                    role="img"
                    aria-label={`${s.name} ${s.sex} サムネイル (プレースホルダ)`}
                  />
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
        <div class="u-eyebrow">新規出品</div>
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

        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            "margin-top": "12px",
          }}
        >
          <label class="label" for="market-desc" style={{ margin: 0 }}>
            商品説明（自動生成 / 編集可）
          </label>
          <Show when={picked() && descEdited()}>
            <button
              type="button"
              class="btn sm ghost"
              onClick={resetDesc}
              style={{ "font-size": "11px", padding: "2px 8px" }}
              title="カルテから再生成してテンプレに戻す"
            >
              ↺ テンプレに戻す
            </button>
          </Show>
        </div>
        <textarea
          id="market-desc"
          class="textarea"
          rows={8}
          placeholder="左から個体を選択すると、カルテ情報から下書きを生成します"
          value={desc()}
          onInput={onDescInput}
          disabled={!picked()}
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
        <MarketBrowse onSwitchToSell={() => setTab("sell")} />
      </Show>
    </>
  );
};
