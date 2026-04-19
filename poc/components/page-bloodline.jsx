// page-bloodline.jsx — 血統系図
const BloodlinePage = () => {
  const [selected, setSelected] = React.useState("#DHH-0271");

  // fabricated tree data for ヘラクレス line
  const tree = {
    gen0: [
      { id: "#DHH-WILD-A", label: "WILD ♂", meta: "グアドループ産 2019", tone: "ink" },
      { id: "#DHH-WILD-B", label: "WILD ♀", meta: "グアドループ産 2019", tone: "ink" }
    ],
    gen1: [
      { id: "#DHH-0198", label: "CBF1 ♂", meta: "148mm · 2022", parents: ["#DHH-WILD-A", "#DHH-WILD-B"] },
      { id: "#DHH-0204", label: "CBF1 ♀", meta: "68mm · 2022", parents: ["#DHH-WILD-A", "#DHH-WILD-B"] }
    ],
    gen2: [
      { id: "#DHH-0213", label: "CBF2 ♂", meta: "152mm · 2024", parents: ["#DHH-0198", "#DHH-0204"] },
      { id: "#DHH-0244", label: "マリア ♀", meta: "66mm · 2023", parents: ["#DHH-0198", "#DHH-0204"] }
    ],
    gen3: [
      { id: "#DHH-0271", label: "黒曜 ♂", meta: "CBF3 · 蛹 · T-15d", parents: ["#DHH-0213", "#DHH-0244"], highlight: true },
      { id: "#DHH-0272", label: "CBF3 ♂", meta: "146mm · 2025", parents: ["#DHH-0213", "#DHH-0244"] },
      { id: "#DHH-0273", label: "CBF3 ♀", meta: "65mm · 2025", parents: ["#DHH-0213", "#DHH-0244"] }
    ]
  };

  const Node = ({ n, sel }) => (
    <div
      onClick={() => setSelected(n.id)}
      className="card"
      style={{
        padding: "10px 14px",
        cursor: "pointer",
        minWidth: 160,
        background: n.highlight ? "var(--accent-amber-soft)" : sel === n.id ? "var(--bg-inverse)" : "var(--bg-raised)",
        color: sel === n.id && !n.highlight ? "var(--ink-inverse)" : "var(--ink)",
        borderColor: n.highlight ? "var(--accent-amber)" : sel === n.id ? "var(--ink)" : "var(--line)",
        transition: "all 0.15s ease"
      }}
    >
      <div className="mono" style={{ fontSize: 10, opacity: 0.7 }}>{n.id}</div>
      <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{n.label}</div>
      <div className="mono" style={{ fontSize: 10, opacity: 0.65, marginTop: 2 }}>{n.meta}</div>
    </div>
  );

  const GenRow = ({ label, year, children }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "24px 0", position: "relative" }}>
      <div style={{ width: 120, flexShrink: 0 }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.1em" }}>GENERATION</div>
        <div className="serif" style={{ fontSize: 28, fontWeight: 600 }}>{label}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>{year}</div>
      </div>
      <div style={{ flex: 1, display: "flex", gap: 16, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="cat">BLOODLINE · DYNASTES HERCULES LINE</div>
          <h1>血統系図</h1>
        </div>
        <div className="page-actions">
          <button className="btn">PDF出力（血統書）</button>
          <button className="btn primary">+ 交配記録</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
        <div className="card" style={{ padding: "8px 28px 28px", position: "relative", overflow: "hidden" }}>
          {/* vertical connecting line */}
          <div style={{ position: "absolute", left: 200, top: 40, bottom: 40, width: 1, background: "var(--line-strong)" }}></div>

          <GenRow label="F₀" year="2019 · WILD">
            {tree.gen0.map(n => <Node key={n.id} n={n} sel={selected} />)}
          </GenRow>
          <hr className="hair" />
          <GenRow label="CBF1" year="2022">
            {tree.gen1.map(n => <Node key={n.id} n={n} sel={selected} />)}
          </GenRow>
          <hr className="hair" />
          <GenRow label="CBF2" year="2023-24">
            {tree.gen2.map(n => <Node key={n.id} n={n} sel={selected} />)}
          </GenRow>
          <hr className="hair" />
          <GenRow label="CBF3" year="2025-26 · 現世代">
            {tree.gen3.map(n => <Node key={n.id} n={n} sel={selected} />)}
          </GenRow>

          {/* legend */}
          <div style={{ position: "absolute", bottom: 16, right: 20, display: "flex", gap: 14, fontSize: 11, color: "var(--ink-mute)" }}>
            <span><span className="dot" style={{ color: "var(--accent-amber)" }} />選択個体</span>
            <span><span className="dot" style={{ color: "var(--ink)" }} />祖先</span>
            <span><span className="dot" style={{ color: "var(--ink-faint)" }} />WILD</span>
          </div>
        </div>

        {/* Sidebar */}
        <div>
          <div className="card" style={{ padding: 20 }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>SELECTED</div>
            <div className="serif" style={{ fontSize: 20, fontWeight: 600, marginBottom: 2 }}>黒曜</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>{selected}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <span className="chip amber">CBF3</span>
              <span className="chip forest">蛹</span>
              <span className="chip indigo">血統書付</span>
            </div>

            <div style={{ marginTop: 14, padding: 12, background: "var(--bg-sunken)", borderRadius: "var(--r-md)", fontSize: 12 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>ANCESTRY</div>
              <div style={{ marginTop: 4 }}>F₀ WILD から 3世代</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>近交係数 0.083</div>
            </div>
          </div>

          <div className="card" style={{ padding: 20, marginTop: 12 }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em", marginBottom: 10 }}>AUDIT LOG</div>
            {[
              { d: "2025-11-18", ev: "羽化予測登録", actor: "system" },
              { d: "2025-11-03", ev: "所有権移転 ANCHOR→徹", actor: "event" },
              { d: "2024-08-12", ev: "個体登録 CBF3", actor: "ANCHOR" },
              { d: "2024-08-10", ev: "交配記録 0213×0244", actor: "ANCHOR" }
            ].map((e, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, fontSize: 11, padding: "6px 0", borderBottom: i < 3 ? "1px dashed var(--line)" : "none" }}>
                <span className="mono" style={{ color: "var(--ink-faint)" }}>{e.d.slice(5)}</span>
                <div>
                  <div>{e.ev}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>by {e.actor}</div>
                </div>
              </div>
            ))}
            <div className="mono" style={{ fontSize: 10, color: "var(--accent-forest)", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
              ✓ イベントログで改ざん検知済
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

window.BloodlinePage = BloodlinePage;
