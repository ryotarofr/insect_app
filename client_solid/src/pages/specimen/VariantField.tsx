// VariantField.tsx — V2: 博物誌レイアウト
// カード全面を標本プレートに見立てた紙資料風のレイアウト
import { For } from "solid-js";
import { getCurrentUser, type Specimen } from "../../api";
import { SpecDL } from "../../components/specimen/SpecDL";

export const VariantField = (p: { s: Specimen }) => (
  <div class="card" style={{ padding: "40px", background: "var(--bg-raised)" }}>
    <div style={{ display: "grid", "grid-template-columns": "1.5fr 1fr", gap: "48px" }}>
      <div>
        <div
          class="mono"
          style={{
            "font-size": "11px",
            color: "var(--ink-faint)",
            "letter-spacing": "0.15em",
            "border-bottom": "1px solid var(--ink)",
            "padding-bottom": "4px",
            display: "inline-block",
          }}
        >
          PLATE {p.s.id}
        </div>
        <h1
          class="serif"
          style={{
            "font-size": "44px",
            "font-weight": 400,
            margin: "18px 0 6px",
            "font-style": "italic",
            "letter-spacing": "-0.01em",
          }}
        >
          {p.s.sci}
        </h1>
        <div style={{ "font-size": "16px", color: "var(--ink-mute)" }}>
          「{p.s.name}」 · {p.s.species}
        </div>

        <div class="ph forest" style={{ height: "340px", "margin-top": "24px", "border-radius": "4px" }}>
          <span class="ph-label">Fig.1 · 側面写真</span>
        </div>

        <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "12px", "margin-top": "12px" }}>
          <div class="ph forest" style={{ height: "160px" }}>
            <span class="ph-label">Fig.2 · 頭角</span>
          </div>
          <div class="ph forest" style={{ height: "160px" }}>
            <span class="ph-label">Fig.3 · 背面</span>
          </div>
        </div>

        <p
          class="serif"
          style={{
            "margin-top": "28px",
            "font-size": "14px",
            "line-height": 1.9,
            color: "var(--ink)",
            "border-left": "2px solid var(--ink)",
            "padding-left": "16px",
            "font-style": "italic",
          }}
        >
          {p.s.notes || "観察記録なし。"} 蛹室の形状は良好、湿度管理に留意。室温は22℃前後を推奨。
        </p>
      </div>

      <div>
        <div
          style={{
            "border-top": "2px solid var(--ink)",
            "border-bottom": "1px solid var(--ink)",
            padding: "16px 0",
          }}
        >
          <div
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--ink-faint)",
              "letter-spacing": "0.12em",
              "margin-bottom": "12px",
            }}
          >
            CLASSIFICATION
          </div>
          <For
            each={[
              ["界", "動物界"],
              ["門", "節足動物門"],
              ["綱", "昆虫綱"],
              ["目", "コウチュウ目"],
              ["科", "コガネムシ科"],
              ["亜科", "カブトムシ亜科"],
            ]}
          >
            {([k, v]) => (
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  padding: "4px 0",
                  "font-size": "13px",
                }}
              >
                <span style={{ color: "var(--ink-mute)" }}>{k}</span>
                <span class="serif">{v}</span>
              </div>
            )}
          </For>
        </div>

        <div style={{ "margin-top": "20px" }}>
          <div
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--ink-faint)",
              "letter-spacing": "0.12em",
              "margin-bottom": "8px",
            }}
          >
            MEASUREMENTS
          </div>
          <SpecDL s={p.s} />
        </div>

        <div
          style={{
            "margin-top": "20px",
            padding: "14px",
            border: "1px solid var(--ink)",
            "border-style": "dashed",
          }}
        >
          <div class="mono" style={{ "font-size": "10px", "letter-spacing": "0.12em" }}>
            COLLECTOR'S STAMP
          </div>
          <div class="serif" style={{ "font-size": "14px", "margin-top": "6px" }}>
            {getCurrentUser().name} · {p.s.purchasedAt}
          </div>
        </div>
      </div>
    </div>
  </div>
);
