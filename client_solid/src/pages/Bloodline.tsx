// Bloodline.tsx — 血統系図
import { createSignal, For, type JSX } from "solid-js";

interface NodeData {
  id: string;
  label: string;
  meta: string;
  tone?: string;
  parents?: string[];
  highlight?: boolean;
}

const TREE: Record<string, NodeData[]> = {
  gen0: [
    { id: "#DHH-WILD-A", label: "WILD ♂", meta: "グアドループ産 2019", tone: "ink" },
    { id: "#DHH-WILD-B", label: "WILD ♀", meta: "グアドループ産 2019", tone: "ink" },
  ],
  gen1: [
    { id: "#DHH-0198", label: "CBF1 ♂", meta: "148mm · 2022", parents: ["#DHH-WILD-A", "#DHH-WILD-B"] },
    { id: "#DHH-0204", label: "CBF1 ♀", meta: "68mm · 2022", parents: ["#DHH-WILD-A", "#DHH-WILD-B"] },
  ],
  gen2: [
    { id: "#DHH-0213", label: "CBF2 ♂", meta: "152mm · 2024", parents: ["#DHH-0198", "#DHH-0204"] },
    { id: "#DHH-0244", label: "マリア ♀", meta: "66mm · 2023", parents: ["#DHH-0198", "#DHH-0204"] },
  ],
  gen3: [
    {
      id: "#DHH-0271",
      label: "黒曜 ♂",
      meta: "CBF3 · 蛹 · T-15d",
      parents: ["#DHH-0213", "#DHH-0244"],
      highlight: true,
    },
    { id: "#DHH-0272", label: "CBF3 ♂", meta: "146mm · 2025", parents: ["#DHH-0213", "#DHH-0244"] },
    { id: "#DHH-0273", label: "CBF3 ♀", meta: "65mm · 2025", parents: ["#DHH-0213", "#DHH-0244"] },
  ],
};

const AUDIT_LOG = [
  { d: "2025-11-18", ev: "羽化予測登録", actor: "system" },
  { d: "2025-11-03", ev: "所有権移転 ANCHOR→徹", actor: "event" },
  { d: "2024-08-12", ev: "個体登録 CBF3", actor: "ANCHOR" },
  { d: "2024-08-10", ev: "交配記録 0213×0244", actor: "ANCHOR" },
];

export const BloodlinePage = () => {
  const [selected, setSelected] = createSignal("#DHH-0271");

  const Node = (props: { n: NodeData }) => (
    <div
      onClick={() => setSelected(props.n.id)}
      class="card"
      style={{
        padding: "10px 14px",
        cursor: "pointer",
        "min-width": "160px",
        background: props.n.highlight
          ? "var(--accent-amber-soft)"
          : selected() === props.n.id
            ? "var(--bg-inverse)"
            : "var(--bg-raised)",
        color: selected() === props.n.id && !props.n.highlight ? "var(--ink-inverse)" : "var(--ink)",
        "border-color": props.n.highlight
          ? "var(--accent-amber)"
          : selected() === props.n.id
            ? "var(--ink)"
            : "var(--line)",
        transition: "all 0.15s ease",
      }}
    >
      <div class="mono" style={{ "font-size": "10px", opacity: 0.7 }}>
        {props.n.id}
      </div>
      <div style={{ "font-weight": 600, "font-size": "13px", "margin-top": "2px" }}>{props.n.label}</div>
      <div class="mono" style={{ "font-size": "10px", opacity: 0.65, "margin-top": "2px" }}>
        {props.n.meta}
      </div>
    </div>
  );

  const GenRow = (props: { label: string; year: string; children: JSX.Element }) => (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "24px",
        padding: "24px 0",
        position: "relative",
      }}
    >
      <div style={{ width: "120px", "flex-shrink": 0 }}>
        <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.1em" }}>
          GENERATION
        </div>
        <div class="serif" style={{ "font-size": "28px", "font-weight": 600 }}>
          {props.label}
        </div>
        <div class="mono" style={{ "font-size": "11px", color: "var(--ink-mute)" }}>
          {props.year}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", gap: "16px", "flex-wrap": "wrap" }}>{props.children}</div>
    </div>
  );

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">BLOODLINE · DYNASTES HERCULES LINE</div>
          <h1>血統系図</h1>
        </div>
        <div class="page-actions">
          <button class="btn">PDF出力（血統書）</button>
          <button class="btn primary">+ 交配記録</button>
        </div>
      </div>

      <div style={{ display: "grid", "grid-template-columns": "1fr 320px", gap: "24px" }}>
        <div class="card" style={{ padding: "8px 28px 28px", position: "relative", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              left: "200px",
              top: "40px",
              bottom: "40px",
              width: "1px",
              background: "var(--line-strong)",
            }}
          />

          <GenRow label="F₀" year="2019 · WILD">
            <For each={TREE.gen0}>{(n) => <Node n={n} />}</For>
          </GenRow>
          <hr class="hair" />
          <GenRow label="CBF1" year="2022">
            <For each={TREE.gen1}>{(n) => <Node n={n} />}</For>
          </GenRow>
          <hr class="hair" />
          <GenRow label="CBF2" year="2023-24">
            <For each={TREE.gen2}>{(n) => <Node n={n} />}</For>
          </GenRow>
          <hr class="hair" />
          <GenRow label="CBF3" year="2025-26 · 現世代">
            <For each={TREE.gen3}>{(n) => <Node n={n} />}</For>
          </GenRow>

          <div
            style={{
              position: "absolute",
              bottom: "16px",
              right: "20px",
              display: "flex",
              gap: "14px",
              "font-size": "11px",
              color: "var(--ink-mute)",
            }}
          >
            <span>
              <span class="dot" style={{ color: "var(--accent-amber)" }} />
              選択個体
            </span>
            <span>
              <span class="dot" style={{ color: "var(--ink)" }} />
              祖先
            </span>
            <span>
              <span class="dot" style={{ color: "var(--ink-faint)" }} />
              WILD
            </span>
          </div>
        </div>

        <div>
          <div class="card" style={{ padding: "20px" }}>
            <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}>
              SELECTED
            </div>
            <div class="serif" style={{ "font-size": "20px", "font-weight": 600, "margin-bottom": "2px" }}>
              黒曜
            </div>
            <div class="mono" style={{ "font-size": "11px", color: "var(--ink-mute)" }}>
              {selected()}
            </div>
            <div style={{ display: "flex", gap: "6px", "margin-top": "10px", "flex-wrap": "wrap" }}>
              <span class="chip amber">CBF3</span>
              <span class="chip forest">蛹</span>
              <span class="chip indigo">血統書付</span>
            </div>

            <div
              style={{
                "margin-top": "14px",
                padding: "12px",
                background: "var(--bg-sunken)",
                "border-radius": "var(--r-md)",
                "font-size": "12px",
              }}
            >
              <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                ANCESTRY
              </div>
              <div style={{ "margin-top": "4px" }}>F₀ WILD から 3世代</div>
              <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)", "margin-top": "2px" }}>
                近交係数 0.083
              </div>
            </div>
          </div>

          <div class="card" style={{ padding: "20px", "margin-top": "12px" }}>
            <div
              class="mono"
              style={{
                "font-size": "10px",
                color: "var(--ink-faint)",
                "letter-spacing": "0.12em",
                "margin-bottom": "10px",
              }}
            >
              AUDIT LOG
            </div>
            <For each={AUDIT_LOG}>
              {(e, i) => (
                <div
                  style={{
                    display: "grid",
                    "grid-template-columns": "70px 1fr",
                    gap: "8px",
                    "font-size": "11px",
                    padding: "6px 0",
                    "border-bottom": i() < AUDIT_LOG.length - 1 ? "1px dashed var(--line)" : "none",
                  }}
                >
                  <span class="mono" style={{ color: "var(--ink-faint)" }}>
                    {e.d.slice(5)}
                  </span>
                  <div>
                    <div>{e.ev}</div>
                    <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                      by {e.actor}
                    </div>
                  </div>
                </div>
              )}
            </For>
            <div
              class="mono"
              style={{
                "font-size": "10px",
                color: "var(--accent-forest)",
                "margin-top": "10px",
                "padding-top": "10px",
                "border-top": "1px solid var(--line)",
              }}
            >
              ✓ イベントログで改ざん検知済
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
