// page-log.jsx — 飼育ログ入力 + タイムライン
const LogPage = () => {
  const [type, setType] = React.useState("weight");
  const [target, setTarget] = React.useState(APP_DATA.specimens[0].id);
  const [logs, setLogs] = React.useState(APP_DATA.logs);

  const types = [
    { key: "weight", label: "体重計測", hint: "グラム数値を入力", icon: "⚖" },
    { key: "feed", label: "給餌", hint: "エサ種別・量", icon: "🍯" },
    { key: "mat", label: "マット交換", hint: "種類・容量", icon: "⛰" },
    { key: "molt", label: "脱皮", hint: "頭幅・齢", icon: "✂" },
    { key: "observation", label: "観察", hint: "自由記述", icon: "👁" }
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="cat">HUSBANDRY LOG</div>
          <h1>飼育ログ</h1>
        </div>
        <div className="page-actions">
          <button className="btn">{Icons.camera} カメラ起動</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 32, alignItems: "start" }}>
        {/* Input form */}
        <div className="card" style={{ padding: 20, position: "sticky", top: 72 }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>NEW ENTRY</div>
          <div className="serif" style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>記録を追加</div>

          <label className="label">対象個体</label>
          <select className="select" value={target} onChange={e => setTarget(e.target.value)}>
            {APP_DATA.specimens.map(s => (
              <option key={s.id} value={s.id}>{s.id} · {s.name}</option>
            ))}
          </select>

          <label className="label" style={{ marginTop: 16 }}>エントリ種別</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {types.map(t => (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                className="btn sm"
                style={{
                  padding: "10px 12px",
                  justifyContent: "flex-start",
                  background: type === t.key ? "var(--bg-inverse)" : "var(--bg-raised)",
                  color: type === t.key ? "var(--ink-inverse)" : "var(--ink)",
                  borderColor: type === t.key ? "var(--ink)" : "var(--line)"
                }}
              >
                <span style={{ marginRight: 6 }}>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          <label className="label" style={{ marginTop: 16 }}>
            {type === "weight" ? "体重 (g)" : type === "feed" ? "エサ・量" : type === "mat" ? "マット種別" : type === "molt" ? "頭幅 / 齢" : "観察メモ"}
          </label>
          {type === "weight" ? (
            <input className="input mono" type="number" placeholder="28.4" defaultValue="28.4" />
          ) : (
            <textarea className="textarea" placeholder={types.find(t => t.key === type).hint} />
          )}

          <label className="label" style={{ marginTop: 16 }}>写真（最大4枚）</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            <div className="ph" style={{ height: 64, cursor: "pointer", borderStyle: "dashed" }}>
              <span className="mono" style={{ fontSize: 11 }}>+</span>
            </div>
            {[0, 1, 2].map(i => (
              <div key={i} className="ph" style={{ height: 64, opacity: 0.4 }}></div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button className="btn ghost" style={{ flex: 1 }}>下書き</button>
            <button className="btn primary" style={{ flex: 2 }}>記録する</button>
          </div>
        </div>

        {/* Timeline */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>TIMELINE</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["全て", "体重", "給餌", "マット", "脱皮", "観察"].map(f => (
                <button key={f} className="chip" style={{ cursor: "pointer", padding: "3px 8px" }}>{f}</button>
              ))}
            </div>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-mute)" }}>{logs.length} 件</span>
          </div>

          <TimelineGrouped logs={logs} />
        </div>
      </div>
    </>
  );
};

const TimelineGrouped = ({ logs }) => {
  // group by date
  const byDate = {};
  logs.forEach(l => {
    byDate[l.date] = byDate[l.date] || [];
    byDate[l.date].push(l);
  });
  const dates = Object.keys(byDate).sort().reverse();

  return (
    <div>
      {dates.map(date => (
        <div key={date} style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--line)" }}>
            <span className="serif" style={{ fontSize: 20, fontWeight: 600 }}>{date.slice(5).replace("-", "/")}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>{date}</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-mute)" }}>{byDate[date].length} 件</span>
          </div>
          {byDate[date].map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 90px 1fr auto", gap: 14, padding: "12px 8px", borderBottom: "1px solid var(--line)", alignItems: "center", transition: "background 0.1s ease" }}
                 onMouseEnter={e => e.currentTarget.style.background = "var(--bg-sunken)"}
                 onMouseLeave={e => e.currentTarget.style.background = ""}>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>{l.time}</span>
              <LogTypeTag type={l.type} />
              <div>
                <div style={{ fontWeight: 500 }}>{l.title}</div>
                <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2 }}>{l.body} · <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{l.specimen}</span></div>
              </div>
              {l.photo && <div className="ph" style={{ width: 54, height: 54 }}><span className="mono" style={{ fontSize: 9 }}>IMG</span></div>}
              {!l.photo && <div style={{ width: 54 }}></div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

window.LogPage = LogPage;
