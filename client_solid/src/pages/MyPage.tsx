// MyPage.tsx — マイページ（所有個体一覧 + サマリー）
import { For, Show } from "solid-js";
import { type RouteKey } from "../data";
import { getCurrentUser, listSpecimens, listUrgentEclosion } from "../api";
import { Icons } from "../components/Icons";

interface MyPageProps {
  setRoute: (r: RouteKey) => void;
  setSelectedSpecimen: (id: string) => void;
}

const stageColor = (stage: string): string => {
  if (stage.includes("幼虫")) return "forest";
  if (stage.includes("蛹") || stage.includes("前蛹")) return "amber";
  if (stage.includes("成虫")) return "indigo";
  return "ink";
};

/** 期限の符号で優先度トーンを決める。
 *  - 超過 → danger (赤)
 *  - 当日 → warn (橙)
 *  - 余裕 → ok (緑) */
type DueTone = "danger" | "warn" | "ok";
const dueTone = (a: UpcomingAction): DueTone => {
  if (a.dueInDays < 0) return "danger";
  if (a.dueInDays === 0) return "warn";
  return "ok";
};
const TONE_COLOR: Record<DueTone, string> = {
  danger: "var(--accent-rose, oklch(0.55 0.13 25))",
  warn: "var(--accent-amber, oklch(0.55 0.13 70))",
  ok: "var(--accent-forest, oklch(0.45 0.08 150))",
};

export const MyPage = (props: MyPageProps) => {
  const specs = listSpecimens();
  const eclosionSoon = listUrgentEclosion(60).sort(
    (a, b) => a.eclosionInDays - b.eclosionInDays,
  );

  const cards = [
    { label: "所有個体", value: specs.length, sub: "生存中", tone: "forest" },
    { label: "羽化予定（60日以内）", value: eclosionSoon.length, sub: "うち7日以内 1体", tone: "amber" },
    { label: "血統ライン", value: 4, sub: "最深 CBF4", tone: "indigo" },
    { label: "今月の飼育ログ", value: 28, sub: "+6 vs 前月", tone: "ink" },
  ];

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">マイページ · 登録 {getCurrentUser().since} より</div>
          <h1>{getCurrentUser().name}</h1>
        </div>
        <div class="page-actions">
          <button class="btn" onClick={() => props.setRoute("log")}>
            {Icons.plus()} ログを記録
          </button>
          <button class="btn primary" onClick={() => props.setRoute("products")}>
            {Icons.plus()} 新しい個体を探す
          </button>
        </div>
      </div>

      <div style={{ display: "grid", "grid-template-columns": "repeat(4, 1fr)", gap: "16px", "margin-bottom": "28px" }}>
        <For each={cards}>
          {(s) => (
            <div class="card" style={{ padding: "18px" }}>
              <div class="label">{s.label}</div>
              <div style={{ display: "flex", "align-items": "baseline", gap: "8px", "margin-top": "4px" }}>
                <span class="serif" style={{ "font-size": "34px", "font-weight": 600, "letter-spacing": "-0.02em" }}>
                  {s.value}
                </span>
                <span class="chip" style={{ "margin-left": "4px" }}>
                  {s.sub}
                </span>
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={eclosionSoon.length > 0}>
        <div
          class="card"
          style={{
            padding: 0,
            "margin-bottom": "28px",
            overflow: "hidden",
            background: "var(--accent-amber-soft)",
            "border-color": "transparent",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "16px", padding: "14px 20px" }}>
            <div class="mono" style={{ "font-size": "11px", color: "oklch(0.45 0.1 70)", "letter-spacing": "0.1em" }}>
              羽化レーダー
            </div>
            <div style={{ "font-size": "13px", color: "oklch(0.35 0.08 70)" }}>
              もうすぐ羽化する個体があります。温度と湿度を確認してください。
            </div>
            <button class="btn sm" style={{ "margin-left": "auto" }} onClick={() => props.setRoute("eclosion")}>
              予測ダッシュボードを開く →
            </button>
          </div>
          <hr class="hair" />
          <div
            style={{
              display: "grid",
              "grid-template-columns": `repeat(${Math.min(eclosionSoon.length, 4)}, 1fr)`,
              gap: 0,
            }}
          >
            <For each={eclosionSoon.slice(0, 4)}>
              {(s, i) => (
                <div
                  onClick={() => {
                    props.setSelectedSpecimen(s.id);
                    props.setRoute("specimen");
                  }}
                  style={{
                    padding: "14px 20px",
                    "border-right": i() < 3 ? "1px solid oklch(0.9 0.04 70)" : "none",
                    cursor: "pointer",
                    background: "oklch(0.98 0.02 70 / 0.5)",
                  }}
                >
                  <div class="mono" style={{ "font-size": "10px", color: "oklch(0.55 0.08 70)" }}>
                    {s.id}
                  </div>
                  <div style={{ "font-weight": 500, "margin-top": "2px" }}>{s.name}</div>
                  <div style={{ display: "flex", "align-items": "baseline", gap: "6px", "margin-top": "6px" }}>
                    <span class="serif" style={{ "font-size": "22px", "font-weight": 600, color: "oklch(0.35 0.1 70)" }}>
                      {s.eclosionInDays}
                    </span>
                    <span style={{ "font-size": "11px", color: "var(--ink-mute)" }}>日後</span>
                    <span
                      class="mono"
                      style={{ "font-size": "10px", color: "var(--ink-faint)", "margin-left": "auto" }}
                    >
                      {s.eclosionETA}
                    </span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div class="sec-head">
        <span class="num">§01</span>
        <h2>所有個体</h2>
        <span class="meta">{specs.length} 体 / 最終更新 今日 21:40</span>
      </div>

      <div style={{ display: "grid", "grid-template-columns": "repeat(3, 1fr)", gap: "16px" }}>
        <For each={specs}>
          {(s) => (
            <div
              class="card"
              style={{ cursor: "pointer", overflow: "hidden", transition: "transform 0.15s ease, box-shadow 0.15s ease" }}
              onClick={() => {
                props.setSelectedSpecimen(s.id);
                props.setRoute("specimen");
              }}
            >
              <div
                class="ph forest"
                style={{ height: "140px", "border-radius": 0, "border-left": 0, "border-right": 0, "border-top": 0 }}
              >
                <span class="ph-label">
                  {s.species} · {s.sex}
                </span>
              </div>
              <div style={{ padding: "14px" }}>
                <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                  <span class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                    {s.id}
                  </span>
                  <span class={`chip ${stageColor(s.stage)}`}>
                    <span class="dot" />
                    {s.stage}
                  </span>
                </div>
                <div style={{ "font-weight": 600, "font-size": "15px", "margin-top": "4px" }}>{s.name}</div>
                <div
                  class="mono"
                  style={{ "font-size": "10px", color: "var(--ink-faint)", "font-style": "italic", "margin-top": "2px" }}
                >
                  {s.sci}
                </div>
                <div style={{ display: "flex", gap: "18px", "margin-top": "12px", "font-size": "12px" }}>
                  <div>
                    <div style={{ "font-size": "10px", color: "var(--ink-faint)" }}>サイズ</div>
                    <div class="mono">
                      <b>{s.sizeMm}</b>mm
                    </div>
                  </div>
                  <div>
                    <div style={{ "font-size": "10px", color: "var(--ink-faint)" }}>体重</div>
                    <div class="mono">
                      <b>{s.weightG}</b>g
                    </div>
                  </div>
                  <div>
                    <div style={{ "font-size": "10px", color: "var(--ink-faint)" }}>累代</div>
                    <div class="mono">
                      <b>{s.generation}</b>
                    </div>
                  </div>
                  <Show when={s.eclosionInDays !== null}>
                    <div style={{ "margin-left": "auto", "text-align": "right" }}>
                      <div style={{ "font-size": "10px", color: "var(--ink-faint)" }}>羽化</div>
                      <div class="mono">
                        <b>{s.eclosionInDays}</b>日
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  );
};
