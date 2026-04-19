// page-mypage.jsx — マイページ（所有個体一覧 + サマリー）
const MyPage = ({ setRoute, setSelectedSpecimen }) => {
  const specs = APP_DATA.specimens;
  const eclosionSoon = specs.filter(s => s.eclosionInDays !== null && s.eclosionInDays < 60)
                           .sort((a, b) => a.eclosionInDays - b.eclosionInDays);

  const stageColor = (stage) => {
    if (stage.includes("幼虫")) return "forest";
    if (stage.includes("蛹") || stage.includes("前蛹")) return "amber";
    if (stage.includes("成虫")) return "indigo";
    return "ink";
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="cat">MY PAGE · MEMBER SINCE {APP_DATA.user.since}</div>
          <h1>{APP_DATA.user.name}</h1>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setRoute("log")}>
            {Icons.plus} ログを記録
          </button>
          <button className="btn primary" onClick={() => setRoute("products")}>
            {Icons.plus} 新しい個体を探す
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
        {[
          { label: "所有個体", value: specs.length, sub: "生存中", tone: "forest" },
          { label: "羽化予定（60日以内）", value: eclosionSoon.length, sub: "うち7日以内 1体", tone: "amber" },
          { label: "血統ライン", value: 4, sub: "最深 CBF4", tone: "indigo" },
          { label: "今月の飼育ログ", value: 28, sub: "+6 vs 前月", tone: "ink" }
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: 18 }}>
            <div className="label">{s.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span className="serif" style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>{s.value}</span>
              <span className="chip" style={{ marginLeft: 4 }}>{s.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 近づく羽化 (band) */}
      {eclosionSoon.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 28, overflow: "hidden", background: "var(--accent-amber-soft)", borderColor: "transparent" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 20px" }}>
            <div className="mono" style={{ fontSize: 11, color: "oklch(0.45 0.1 70)", letterSpacing: "0.1em" }}>
              ECLOSION RADAR
            </div>
            <div style={{ fontSize: 13, color: "oklch(0.35 0.08 70)" }}>
              もうすぐ羽化する個体があります。温度と湿度を確認してください。
            </div>
            <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setRoute("eclosion")}>
              予測ダッシュボードを開く →
            </button>
          </div>
          <hr className="hair" />
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(eclosionSoon.length, 4)}, 1fr)`, gap: 0 }}>
            {eclosionSoon.slice(0, 4).map((s, i) => (
              <div
                key={s.id}
                onClick={() => { setSelectedSpecimen(s.id); setRoute("specimen"); }}
                style={{
                  padding: "14px 20px",
                  borderRight: i < 3 ? "1px solid oklch(0.9 0.04 70)" : "none",
                  cursor: "pointer",
                  background: "oklch(0.98 0.02 70 / 0.5)"
                }}
              >
                <div className="mono" style={{ fontSize: 10, color: "oklch(0.55 0.08 70)" }}>{s.id}</div>
                <div style={{ fontWeight: 500, marginTop: 2 }}>{s.name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
                  <span className="serif" style={{ fontSize: 22, fontWeight: 600, color: "oklch(0.35 0.1 70)" }}>
                    {s.eclosionInDays}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>日後</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", marginLeft: "auto" }}>{s.eclosionETA}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 所有個体一覧 */}
      <div className="sec-head">
        <span className="num">§01</span>
        <h2>所有個体</h2>
        <span className="meta">{specs.length} 体 / 最終更新 今日 21:40</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {specs.map(s => (
          <div
            key={s.id}
            className="card"
            style={{ cursor: "pointer", overflow: "hidden", transition: "transform 0.15s ease, box-shadow 0.15s ease" }}
            onClick={() => { setSelectedSpecimen(s.id); setRoute("specimen"); }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "var(--shadow-md)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = ""; e.currentTarget.style.transform = ""; }}
          >
            <div className="ph forest" style={{ height: 140, borderRadius: 0, borderLeft: 0, borderRight: 0, borderTop: 0 }}>
              <span className="ph-label">{s.species} · {s.sex}</span>
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{s.id}</span>
                <span className={`chip ${stageColor(s.stage)}`}><span className="dot" />{s.stage}</span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 15, marginTop: 4 }}>{s.name}</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", fontStyle: "italic", marginTop: 2 }}>{s.sci}</div>
              <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>SIZE</div>
                  <div className="mono"><b>{s.sizeMm}</b>mm</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>WEIGHT</div>
                  <div className="mono"><b>{s.weightG}</b>g</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>GEN</div>
                  <div className="mono"><b>{s.generation}</b></div>
                </div>
                {s.eclosionInDays !== null && (
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>ECLOSION</div>
                    <div className="mono"><b>{s.eclosionInDays}</b>d</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

window.MyPage = MyPage;
