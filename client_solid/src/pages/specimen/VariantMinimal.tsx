// VariantMinimal.tsx — V5: ミニマル図鑑
// 紙の図鑑ページ風、センタリングされたプレートレイアウト
import { For } from "solid-js";
import type { Specimen } from "../../api";

export const VariantMinimal = (p: { s: Specimen }) => (
  <div style={{ "max-width": "720px", margin: "40px auto 0", "text-align": "center" }}>
    <div class="mono" style={{ "font-size": "11px", color: "var(--ink-faint)", "letter-spacing": "0.3em" }}>
      {p.s.id}
    </div>
    <h1
      class="serif"
      style={{ "font-size": "40px", "font-weight": 400, margin: "8px 0 4px", "font-style": "italic" }}
    >
      {p.s.sci}
    </h1>
    <div style={{ "font-size": "14px", color: "var(--ink-mute)" }}>
      {p.s.name} · {p.s.species}
    </div>

    <div class="ph forest" style={{ height: "380px", margin: "32px 0", "border-radius": 0 }}>
      <span class="ph-label">Plate — {p.s.id}</span>
    </div>

    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(4, 1fr)",
        gap: "20px",
        "text-align": "left",
        "border-top": "1px solid var(--ink)",
        "border-bottom": "1px solid var(--ink)",
        padding: "20px 0",
      }}
    >
      <For
        each={[
          ["Size", `${p.s.sizeMm}mm`],
          ["Weight", `${p.s.weightG}g`],
          ["Stage", p.s.stage],
          ["Generation", p.s.generation],
        ]}
      >
        {([k, v]) => (
          <div>
            <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
              {k}
            </div>
            <div class="serif" style={{ "font-size": "18px", "margin-top": "4px" }}>
              {v}
            </div>
          </div>
        )}
      </For>
    </div>

    <p
      class="serif"
      style={{
        "margin-top": "32px",
        "font-size": "15px",
        "line-height": 1.9,
        color: "var(--ink)",
        "text-align": "left",
        "max-width": "600px",
        "margin-left": "auto",
        "margin-right": "auto",
      }}
    >
      {p.s.purchasedAt} に {p.s.shop} より迎え入れられた{p.s.species}。{p.s.notes}
      <br />
      現在ステージ《{p.s.stage}》、次の変態まで {p.s.eclosionInDays ?? "—"} 日の見込み。
    </p>

    <div
      class="mono"
      style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.2em", "margin-top": "48px" }}
    >
      ———— KOCHŪ 図鑑 · No.{p.s.id.replace(/\D/g, "")} ————
    </div>
  </div>
);
