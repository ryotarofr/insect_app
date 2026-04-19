// page-eclosion.jsx — 羽化予測ダッシュボード
const EclosionPage = ({ setSelectedSpecimen, setRoute }) => {
  const all = APP_DATA.specimens.filter(s => s.eclosionInDays !== null)
                                .sort((a, b) => a.eclosionInDays - b.eclosionInDays);
  const urgent = all.filter(s => s.eclosionInDays <= 30);
  const soon = all.filter(s => s.eclosionInDays > 30 && s.eclosionInDays <= 180);
  const later = all.filter(s => s.eclosionInDays > 180);

  // horizon: max 365 days displayed
  const horizon = 365;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="cat">ECLOSION FORECAST · RULE-BASED v1</div>
          <h1>羽化予測</h1>
        </div>
        <div className="page-actions">
          <button className="btn">通知設定</button>
          <button className="btn primary">全てCSV出力</button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", overflow: "hidden", marginBottom: 32 }}>
        {[
          { label: "予測対象", val: all.length, sub: "体", tone: "" },
          { label: "30日以内", val: urgent.length, sub: "要観察", tone: "amber" },
          { label: "最短", val: all[0]?.eclosionInDays ?? "—", sub: "日後", tone: "amber" },
          { label: "平均誤差", val: "±5", sub: "日", tone: "" }
        ].map((x, i) => (
          <div key={i} style={{ background: "var(--bg-raised)", padding: 20 }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>{x.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
              <span className="serif" style={{ fontSize: 32, fontWeight: 600, color: x.tone === "amber" ? "oklch(0.45 0.1 70)" : "var(--ink)" }}>{x.val}</span>
              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{x.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Radar — linear horizon */}
      <div className="card" style={{ padding: 24, marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>RADAR · NEXT 365 DAYS</span>
          <span className="serif" style={{ fontSize: 18, fontWeight: 600 }}>羽化レーダー</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-mute)" }}>Today · {new Date().toISOString().slice(0, 10)}</span>
        </div>

        {/* Scale */}
        <div style={{ position: "relative", height: 40, borderBottom: "1px solid var(--line-strong)", marginBottom: 4 }}>
          {[0, 30, 90, 180, 270, 365].map(d => (
            <div key={d} style={{ position: "absolute", left: `${(d / horizon) * 100}%`, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <div style={{ width: 1, height: 8, background: "var(--line-strong)" }}></div>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", transform: "translateX(-50%)", whiteSpace: "nowrap" }}>T+{d}d</span>
            </div>
          ))}
          {/* urgent zone */}
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(30 / horizon) * 100}%`, background: "var(--accent-amber-soft)", borderLeft: "2px solid var(--accent-amber)" }}></div>
        </div>

        {/* Specimens on timeline */}
        <div style={{ position: "relative", height: all.length * 44 + 10, paddingTop: 10 }}>
          {all.map((s, i) => {
            const left = Math.min((s.eclosionInDays / horizon) * 100, 100);
            return (
              <div key={s.id} style={{ position: "absolute", left: 0, right: 0, top: i * 44, height: 40 }}>
                {/* Label (fixed left, short) */}
                <div style={{ position: "absolute", left: 0, top: 6, display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", width: 80 }}>{s.id}</span>
                  <span style={{ fontWeight: 500, width: 140 }}>{s.name}</span>
                </div>
                {/* Bar track */}
                <div style={{ position: "absolute", left: 230, right: 0, top: 18, height: 2, background: "var(--line)" }}></div>
                {/* Marker */}
                <div
                  onClick={() => { setSelectedSpecimen(s.id); setRoute("specimen"); }}
                  style={{
                    position: "absolute",
                    left: `calc(230px + ${left}% * (100% - 230px) / 100%)`,
                    left: `calc(230px + (100% - 230px) * ${left / 100})`,
                    top: 8,
                    transform: "translateX(-50%)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2
                  }}
                >
                  <div style={{
                    width: 22, height: 22,
                    borderRadius: "50%",
                    background: s.eclosionInDays <= 30 ? "var(--accent-amber)" : s.eclosionInDays <= 180 ? "var(--accent-forest)" : "var(--ink-faint)",
                    border: "2px solid var(--bg-raised)",
                    boxShadow: "0 0 0 1px var(--line-strong)"
                  }}></div>
                  <div className="mono" style={{ fontSize: 10, whiteSpace: "nowrap", background: "var(--bg-raised)", padding: "1px 6px", borderRadius: 3, border: "1px solid var(--line)" }}>
                    T-{s.eclosionInDays}d
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sections */}
      {[
        { title: "30日以内 · 要観察", items: urgent, tone: "amber" },
        { title: "180日以内 · 予測", items: soon, tone: "forest" },
        { title: "長期予測", items: later, tone: "" }
      ].map(sec => sec.items.length > 0 && (
        <div key={sec.title} style={{ marginBottom: 28 }}>
          <div className="sec-head">
            <span className="num">§</span>
            <h2>{sec.title}</h2>
            <span className="meta">{sec.items.length} 体</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {sec.items.map(s => (
              <div
                key={s.id}
                className="card"
                style={{ padding: 16, cursor: "pointer", transition: "box-shadow 0.15s ease" }}
                onClick={() => { setSelectedSpecimen(s.id); setRoute("specimen"); }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "var(--shadow-md)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = ""}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{s.id}</span>
                  <span className={`chip ${sec.tone}`}>{s.stage}</span>
                </div>
                <div style={{ fontWeight: 600, marginTop: 4 }}>{s.name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 10 }}>
                  <span className="serif" style={{ fontSize: 30, fontWeight: 600, color: sec.tone === "amber" ? "oklch(0.45 0.1 70)" : "var(--ink)" }}>{s.eclosionInDays}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>日後</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", marginLeft: "auto" }}>{s.eclosionETA}</span>
                </div>
                <div style={{ height: 4, background: "var(--bg-sunken)", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                  <div style={{ width: `${s.stageProgress * 100}%`, height: "100%", background: sec.tone === "amber" ? "var(--accent-amber)" : "var(--accent-forest)" }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
};

window.EclosionPage = EclosionPage;
