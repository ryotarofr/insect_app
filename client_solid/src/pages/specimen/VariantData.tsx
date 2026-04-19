// VariantData.tsx — V3: データリッチ
// ヘッダ + 7週体重チャート + BIOMETRICS + IDENTITY + LIFECYCLE
import { For } from "solid-js";
import type { Specimen } from "../../api";
import { SpecDL } from "../../components/specimen/SpecDL";
import { StageBar } from "../../components/specimen/StageBar";

export const VariantData = (p: { s: Specimen }) => {
  const series = [18.2, 19.8, 22.1, 24.6, 26.3, 27.5, 28.4];
  const max = Math.max(...series);
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "2fr 1fr 1fr",
        gap: "1px",
        background: "var(--line)",
        border: "1px solid var(--line)",
        "border-radius": "var(--r-lg)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: "var(--bg-raised)",
          padding: "22px",
          "grid-column": "1 / 4",
          display: "flex",
          "align-items": "center",
          gap: "18px",
        }}
      >
        <div class="ph forest" style={{ width: "120px", height: "120px", "flex-shrink": 0 }}>
          <span class="ph-label">{p.s.sex}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div class="mono" style={{ "font-size": "11px", color: "var(--ink-faint)" }}>
            {p.s.id} · {p.s.generation}
          </div>
          <div class="serif" style={{ "font-size": "26px", "font-weight": 600 }}>
            {p.s.name}
          </div>
          <div style={{ display: "flex", gap: "6px", "margin-top": "6px", "flex-wrap": "wrap" }}>
            <span class="chip amber">
              <span class="dot" />
              {p.s.stage}
            </span>
            <span class="chip">{p.s.species}</span>
            <span class="chip forest">{p.s.shop}</span>
          </div>
        </div>
        <div style={{ "text-align": "right" }}>
          <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
            NEXT ECLOSION
          </div>
          <div class="serif" style={{ "font-size": "34px", "font-weight": 600, color: "oklch(0.45 0.1 70)" }}>
            {p.s.eclosionInDays ?? "—"}
            <span style={{ "font-size": "14px", color: "var(--ink-mute)" }}> days</span>
          </div>
        </div>
      </div>

      <div style={{ background: "var(--bg-raised)", padding: "22px" }}>
        <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}>
          WEIGHT (g) · 7 WEEKS
        </div>
        <div style={{ display: "flex", "align-items": "flex-end", gap: "4px", height: "160px", "margin-top": "14px" }}>
          <For each={series}>
            {(v, i) => (
              <div
                style={{
                  flex: 1,
                  height: "100%",
                  display: "flex",
                  "flex-direction": "column",
                  "align-items": "center",
                  "justify-content": "flex-end",
                  gap: "4px",
                }}
              >
                <div class="mono" style={{ "font-size": "10px", color: "var(--ink-mute)" }}>
                  {v}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: `${(v / max) * 100}%`,
                    background: "var(--accent-forest)",
                    "border-radius": "2px 2px 0 0",
                  }}
                />
                <div class="mono" style={{ "font-size": "9px", color: "var(--ink-faint)" }}>
                  W{i() + 1}
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <div style={{ background: "var(--bg-raised)", padding: "22px" }}>
        <div
          class="mono"
          style={{
            "font-size": "10px",
            color: "var(--ink-faint)",
            "letter-spacing": "0.12em",
            "margin-bottom": "10px",
          }}
        >
          BIOMETRICS
        </div>
        <For
          each={[
            ["SIZE", `${p.s.sizeMm}mm`, "+2mm / 週"],
            ["WEIGHT", `${p.s.weightG}g`, "+0.9g / 週"],
            ["TEMP", "22.4°C", "安定"],
            ["HUMID", "68%", "良好"],
          ]}
        >
          {([k, v, d]) => (
            <div
              style={{
                display: "grid",
                "grid-template-columns": "60px 1fr auto",
                "align-items": "baseline",
                gap: "8px",
                padding: "8px 0",
                "border-bottom": "1px dashed var(--line)",
              }}
            >
              <span class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                {k}
              </span>
              <span class="mono serif" style={{ "font-size": "18px", "font-weight": 600 }}>
                {v}
              </span>
              <span class="mono" style={{ "font-size": "10px", color: "var(--accent-forest)" }}>
                {d}
              </span>
            </div>
          )}
        </For>
      </div>

      <div style={{ background: "var(--bg-raised)", padding: "22px" }}>
        <div
          class="mono"
          style={{
            "font-size": "10px",
            color: "var(--ink-faint)",
            "letter-spacing": "0.12em",
            "margin-bottom": "10px",
          }}
        >
          IDENTITY
        </div>
        <SpecDL s={p.s} />
      </div>

      <div style={{ background: "var(--bg-raised)", padding: "22px", "grid-column": "1 / 4" }}>
        <div
          class="mono"
          style={{
            "font-size": "10px",
            color: "var(--ink-faint)",
            "letter-spacing": "0.12em",
            "margin-bottom": "14px",
          }}
        >
          LIFECYCLE
        </div>
        <StageBar stage={p.s.stage} progress={p.s.stageProgress} eta={p.s.eclosionInDays} />
      </div>
    </div>
  );
};
