// Eclosion.tsx — 羽化予測ダッシュボード
import { For, Show } from "solid-js";
import { type RouteKey } from "../data";
import { listEclosionForecasts, type Specimen } from "../api";

interface EclosionPageProps {
  setRoute: (r: RouteKey) => void;
  setSelectedSpecimen: (id: string) => void;
}

type SpecimenWithEta = Specimen & { eclosionInDays: number };

const HORIZON = 365;

export const EclosionPage = (props: EclosionPageProps) => {
  const all: SpecimenWithEta[] = listEclosionForecasts();
  const urgent = all.filter((s) => s.eclosionInDays <= 30);
  const soon = all.filter((s) => s.eclosionInDays > 30 && s.eclosionInDays <= 180);
  const later = all.filter((s) => s.eclosionInDays > 180);

  const summary = [
    { label: "予測対象", val: all.length, sub: "体", tone: "" },
    { label: "30日以内", val: urgent.length, sub: "要観察", tone: "amber" },
    {
      label: "最短",
      val: all.length > 0 ? all[0].eclosionInDays : "—",
      sub: "日後",
      tone: "amber",
    },
    { label: "平均誤差", val: "±5", sub: "日", tone: "" },
  ];

  const scalePoints = [0, 30, 90, 180, 270, 365];

  const sections: Array<{ title: string; items: SpecimenWithEta[]; tone: string }> = [
    { title: "30日以内 · 要観察", items: urgent, tone: "amber" },
    { title: "180日以内 · 予測", items: soon, tone: "forest" },
    { title: "長期予測", items: later, tone: "" },
  ];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">ECLOSION FORECAST · RULE-BASED v1</div>
          <h1>羽化予測</h1>
        </div>
        <div class="page-actions">
          <button class="btn">通知設定</button>
          <button class="btn primary">全てCSV出力</button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          "grid-template-columns": "repeat(4, 1fr)",
          gap: "1px",
          background: "var(--line)",
          border: "1px solid var(--line)",
          "border-radius": "var(--r-lg)",
          overflow: "hidden",
          "margin-bottom": "32px",
        }}
      >
        <For each={summary}>
          {(x) => (
            <div style={{ background: "var(--bg-raised)", padding: "20px" }}>
              <div
                class="mono"
                style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}
              >
                {x.label}
              </div>
              <div style={{ display: "flex", "align-items": "baseline", gap: "4px", "margin-top": "4px" }}>
                <span
                  class="serif"
                  style={{
                    "font-size": "32px",
                    "font-weight": 600,
                    color: x.tone === "amber" ? "oklch(0.45 0.1 70)" : "var(--ink)",
                  }}
                >
                  {x.val}
                </span>
                <span style={{ "font-size": "12px", color: "var(--ink-mute)" }}>{x.sub}</span>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="card" style={{ padding: "24px", "margin-bottom": "32px" }}>
        <div style={{ display: "flex", "align-items": "baseline", gap: "12px", "margin-bottom": "20px" }}>
          <span
            class="mono"
            style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}
          >
            RADAR · NEXT 365 DAYS
          </span>
          <span class="serif" style={{ "font-size": "18px", "font-weight": 600 }}>
            羽化レーダー
          </span>
          <span style={{ "margin-left": "auto", "font-size": "12px", color: "var(--ink-mute)" }}>
            Today · {today}
          </span>
        </div>

        <div
          style={{
            position: "relative",
            height: "40px",
            "border-bottom": "1px solid var(--line-strong)",
            "margin-bottom": "4px",
          }}
        >
          <For each={scalePoints}>
            {(d, idx) => {
              const isFirst = idx() === 0;
              const isLast = idx() === scalePoints.length - 1;
              return (
                <div
                  style={{
                    position: "absolute",
                    left: `${(d / HORIZON) * 100}%`,
                    top: 0,
                    bottom: 0,
                    display: "flex",
                    "flex-direction": "column",
                    "justify-content": "flex-end",
                  }}
                >
                  <div style={{ width: "1px", height: "8px", background: "var(--line-strong)" }} />
                  <span
                    class="mono"
                    style={{
                      "font-size": "10px",
                      color: "var(--ink-faint)",
                      // 端のラベルが見切れないように揃える
                      transform: isFirst
                        ? "translateX(0)"
                        : isLast
                          ? "translateX(-100%)"
                          : "translateX(-50%)",
                      "white-space": "nowrap",
                    }}
                  >
                    T+{d}d
                  </span>
                </div>
              );
            }}
          </For>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${(30 / HORIZON) * 100}%`,
              background: "var(--accent-amber-soft)",
              "border-left": "2px solid var(--accent-amber)",
            }}
          />
        </div>

        <div style={{ position: "relative", height: `${all.length * 44 + 10}px`, "padding-top": "10px" }}>
          <For each={all}>
            {(s, i) => {
              const left = Math.min((s.eclosionInDays / HORIZON) * 100, 100);
              return (
                <div style={{ position: "absolute", left: 0, right: 0, top: `${i() * 44}px`, height: "40px" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "6px",
                      display: "flex",
                      "align-items": "center",
                      gap: "8px",
                      "font-size": "12px",
                    }}
                  >
                    <span
                      class="mono"
                      style={{ "font-size": "10px", color: "var(--ink-faint)", width: "80px" }}
                    >
                      {s.id}
                    </span>
                    <span style={{ "font-weight": 500, width: "140px" }}>{s.name}</span>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: "230px",
                      right: 0,
                      top: "18px",
                      height: "2px",
                      background: "var(--line)",
                    }}
                  />
                  <div
                    onClick={() => {
                      props.setSelectedSpecimen(s.id);
                      props.setRoute("specimen");
                    }}
                    style={{
                      position: "absolute",
                      left: `calc(230px + (100% - 230px) * ${left / 100})`,
                      top: "8px",
                      transform: "translateX(-50%)",
                      cursor: "pointer",
                      display: "flex",
                      "flex-direction": "column",
                      "align-items": "center",
                      gap: "2px",
                    }}
                  >
                    <div
                      style={{
                        width: "22px",
                        height: "22px",
                        "border-radius": "50%",
                        background:
                          s.eclosionInDays <= 30
                            ? "var(--accent-amber)"
                            : s.eclosionInDays <= 180
                              ? "var(--accent-forest)"
                              : "var(--ink-faint)",
                        border: "2px solid var(--bg-raised)",
                        "box-shadow": "0 0 0 1px var(--line-strong)",
                      }}
                    />
                    <div
                      class="mono"
                      style={{
                        "font-size": "10px",
                        "white-space": "nowrap",
                        background: "var(--bg-raised)",
                        padding: "1px 6px",
                        "border-radius": "3px",
                        border: "1px solid var(--line)",
                      }}
                    >
                      T-{s.eclosionInDays}d
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      <For each={sections}>
        {(sec) => (
          <Show when={sec.items.length > 0}>
            <div style={{ "margin-bottom": "28px" }}>
              <div class="sec-head">
                <span class="num">§</span>
                <h2>{sec.title}</h2>
                <span class="meta">{sec.items.length} 体</span>
              </div>
              <div style={{ display: "grid", "grid-template-columns": "repeat(3, 1fr)", gap: "12px" }}>
                <For each={sec.items}>
                  {(s) => (
                    <div
                      class="card"
                      style={{ padding: "16px", cursor: "pointer", transition: "box-shadow 0.15s ease" }}
                      onClick={() => {
                        props.setSelectedSpecimen(s.id);
                        props.setRoute("specimen");
                      }}
                    >
                      <div style={{ display: "flex", "justify-content": "space-between" }}>
                        <span class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                          {s.id}
                        </span>
                        <span class={`chip ${sec.tone}`}>{s.stage}</span>
                      </div>
                      <div style={{ "font-weight": 600, "margin-top": "4px" }}>{s.name}</div>
                      <div
                        style={{
                          display: "flex",
                          "align-items": "baseline",
                          gap: "6px",
                          "margin-top": "10px",
                        }}
                      >
                        <span
                          class="serif"
                          style={{
                            "font-size": "30px",
                            "font-weight": 600,
                            color: sec.tone === "amber" ? "oklch(0.45 0.1 70)" : "var(--ink)",
                          }}
                        >
                          {s.eclosionInDays}
                        </span>
                        <span style={{ "font-size": "12px", color: "var(--ink-mute)" }}>日後</span>
                        <span
                          class="mono"
                          style={{
                            "font-size": "10px",
                            color: "var(--ink-faint)",
                            "margin-left": "auto",
                          }}
                        >
                          {s.eclosionETA}
                        </span>
                      </div>
                      <div
                        style={{
                          height: "4px",
                          background: "var(--bg-sunken)",
                          "border-radius": "2px",
                          "margin-top": "10px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${s.stageProgress * 100}%`,
                            height: "100%",
                            background:
                              sec.tone === "amber" ? "var(--accent-amber)" : "var(--accent-forest)",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        )}
      </For>
    </>
  );
};
