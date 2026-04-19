// VariantStandard.tsx — V1: 標準カルテ
// 写真 + ステージ進捗 + 直近ログ / 右に基本情報・血統・羽化予測 + メモ
import { createEffect, createSignal, For, Show } from "solid-js";
import type { RouteKey } from "../../data";
import {
  getSpecimenMemo,
  updateSpecimenMemo,
  type LogEntry,
  type Specimen,
} from "../../api";
import { SpecDL } from "../../components/specimen/SpecDL";
import { StageBar } from "../../components/specimen/StageBar";
import { LogList } from "../../components/specimen/LogList";

const SpecimenMemoCard = (props: { specimenId: string }) => {
  const [draft, setDraft] = createSignal(getSpecimenMemo(props.specimenId));
  const [msg, setMsg] = createSignal<string | null>(null);

  // 個体を切り替えたらドラフトをリセット
  createEffect(() => {
    setDraft(getSpecimenMemo(props.specimenId));
    setMsg(null);
  });

  const dirty = () => draft() !== getSpecimenMemo(props.specimenId);

  const save = () => {
    updateSpecimenMemo(props.specimenId, draft());
    setMsg("保存しました");
    window.setTimeout(() => setMsg(null), 2400);
  };

  return (
    <div class="card" style={{ padding: "20px", "margin-top": "16px" }}>
      <div
        class="mono"
        style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}
      >
        NOTES
      </div>
      <div
        class="serif"
        style={{
          "font-size": "20px",
          "font-weight": 600,
          "margin-bottom": "8px",
          display: "flex",
          "align-items": "center",
          gap: "8px",
        }}
      >
        メモ
        <span
          class="mono"
          style={{ "font-size": "10px", color: "var(--ink-faint)", "font-weight": 400 }}
        >
          端末に保存
        </span>
      </div>
      <textarea
        class="textarea"
        aria-label="個体メモ"
        placeholder="観察メモ・世話メモ・気付き…"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        style={{ "min-height": "110px" }}
      />
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "margin-top": "10px",
        }}
      >
        <Show when={msg()}>
          <span
            role="status"
            aria-live="polite"
            class="mono"
            style={{ "font-size": "11px", color: "var(--accent-forest)" }}
          >
            ✓ {msg()}
          </span>
        </Show>
        <button
          type="button"
          class="btn primary sm"
          style={{ "margin-left": "auto" }}
          disabled={!dirty()}
          onClick={save}
        >
          保存
        </button>
      </div>
    </div>
  );
};

export const VariantStandard = (p: {
  s: Specimen;
  logs: LogEntry[];
  setRoute: (r: RouteKey) => void;
}) => (
  <div style={{ display: "grid", "grid-template-columns": "1.2fr 1fr", gap: "24px" }}>
    <div>
      <div class="ph forest" style={{ height: "360px", "border-radius": "var(--r-lg)" }}>
        <span class="ph-label">
          {p.s.species} · {p.s.sex} · 最新写真
        </span>
      </div>
      <div style={{ display: "grid", "grid-template-columns": "repeat(4, 1fr)", gap: "8px", "margin-top": "10px" }}>
        <For each={[0, 1, 2, 3]}>
          {(i) => (
            <div class="ph" style={{ height: "72px" }}>
              <span class="mono" style={{ "font-size": "10px" }}>
                04/{18 - i * 3}
              </span>
            </div>
          )}
        </For>
      </div>

      <div style={{ "margin-top": "28px" }}>
        <div class="sec-head">
          <span class="num">§01</span>
          <h2>ステージ進捗</h2>
          <span class="meta">現在: {p.s.stage}</span>
        </div>
        <StageBar stage={p.s.stage} progress={p.s.stageProgress} eta={p.s.eclosionInDays} />
      </div>

      <div style={{ "margin-top": "28px" }}>
        <div class="sec-head">
          <span class="num">§02</span>
          <h2>直近のログ</h2>
          <span class="meta">{p.logs.length} 件</span>
        </div>
        <LogList logs={p.logs.slice(0, 4)} compact />
      </div>
    </div>

    <div>
      <div class="card" style={{ padding: "20px" }}>
        <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}>
          SPECIMEN CARTE
        </div>
        <div class="serif" style={{ "font-size": "20px", "font-weight": 600, "margin-bottom": "12px" }}>
          基本情報
        </div>
        <SpecDL s={p.s} />
      </div>

      <div class="card" style={{ padding: "20px", "margin-top": "16px" }}>
        <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}>
          BLOODLINE
        </div>
        <div class="serif" style={{ "font-size": "20px", "font-weight": 600, "margin-bottom": "12px" }}>
          血統
        </div>
        <div style={{ display: "flex", "align-items": "center", gap: "12px", padding: "10px 0" }}>
          <div class="mono" style={{ "font-size": "11px", color: "var(--ink-faint)" }}>
            ♂ 父
          </div>
          <code
            class="mono"
            style={{ "font-size": "12px", padding: "3px 8px", background: "var(--bg-sunken)", "border-radius": "4px" }}
          >
            {p.s.bloodline.father}
          </code>
        </div>
        <div style={{ display: "flex", "align-items": "center", gap: "12px", padding: "10px 0" }}>
          <div class="mono" style={{ "font-size": "11px", color: "var(--ink-faint)" }}>
            ♀ 母
          </div>
          <code
            class="mono"
            style={{ "font-size": "12px", padding: "3px 8px", background: "var(--bg-sunken)", "border-radius": "4px" }}
          >
            {p.s.bloodline.mother}
          </code>
        </div>
        <button class="btn block" style={{ "margin-top": "10px" }} onClick={() => p.setRoute("bloodline")}>
          系図を開く →
        </button>
      </div>

      <SpecimenMemoCard specimenId={p.s.id} />

      <Show when={p.s.eclosionInDays !== null}>
        <div
          class="card"
          style={{
            padding: "20px",
            "margin-top": "16px",
            background: "var(--accent-amber-soft)",
            "border-color": "transparent",
          }}
        >
          <div
            class="mono"
            style={{ "font-size": "10px", color: "oklch(0.45 0.1 70)", "letter-spacing": "0.12em" }}
          >
            ECLOSION FORECAST
          </div>
          <div style={{ display: "flex", "align-items": "baseline", gap: "6px", "margin-top": "6px" }}>
            <span
              class="serif"
              style={{ "font-size": "42px", "font-weight": 600, color: "oklch(0.35 0.1 70)" }}
            >
              {p.s.eclosionInDays}
            </span>
            <span style={{ color: "var(--ink-mute)" }}>日後に羽化予定</span>
          </div>
          <div class="mono" style={{ "font-size": "12px", color: "var(--ink-mute)", "margin-top": "4px" }}>
            {p.s.eclosionETA} ±5日
          </div>
        </div>
      </Show>
    </div>
  </div>
);
