// page-specimen.jsx — 個体カルテ詳細 (5 variations)
const SpecimenDetail = ({ specimenId, setRoute }) => {
  const s = APP_DATA.specimens.find(x => x.id === specimenId) || APP_DATA.specimens[0];
  const [variant, setVariant] = React.useState("V1");
  const specimenLogs = APP_DATA.logs.filter(l => l.specimen === s.id);

  const VariantPicker = () => (
    <div className="variants">
      {["V1", "V2", "V3", "V4", "V5"].map(v => (
        <button key={v} className={variant === v ? "active" : ""} onClick={() => setVariant(v)}>{v}</button>
      ))}
    </div>
  );

  const VariantLabel = {
    V1: "標準カルテ",
    V2: "博物誌レイアウト",
    V3: "データリッチ",
    V4: "タイムライン中心",
    V5: "ミニマル図鑑"
  }[variant];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="cat">INDIVIDUAL CARTE · {s.id}</div>
          <h1>{s.name}</h1>
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-mute)", fontStyle: "italic", marginTop: 4 }}>{s.sci}</div>
        </div>
        <div className="page-actions">
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", alignSelf: "center", marginRight: 8 }}>LAYOUT: {VariantLabel}</span>
          <VariantPicker />
          <button className="btn">{Icons.plus} ログ追加</button>
        </div>
      </div>

      {variant === "V1" && <VariantStandard s={s} logs={specimenLogs} setRoute={setRoute} />}
      {variant === "V2" && <VariantField s={s} logs={specimenLogs} />}
      {variant === "V3" && <VariantData s={s} logs={specimenLogs} />}
      {variant === "V4" && <VariantTimeline s={s} logs={specimenLogs} />}
      {variant === "V5" && <VariantMinimal s={s} logs={specimenLogs} />}
    </>
  );
};

// ---------- V1: 標準カルテ ----------
const VariantStandard = ({ s, logs, setRoute }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
    <div>
      <div className="ph forest" style={{ height: 360, borderRadius: "var(--r-lg)" }}>
        <span className="ph-label">{s.species} · {s.sex} · 最新写真</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 10 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="ph" style={{ height: 72 }}>
            <span className="mono" style={{ fontSize: 10 }}>04/{18 - i * 3}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 28 }}>
        <div className="sec-head">
          <span className="num">§01</span>
          <h2>ステージ進捗</h2>
          <span className="meta">現在: {s.stage}</span>
        </div>
        <StageBar stage={s.stage} progress={s.stageProgress} eta={s.eclosionInDays} />
      </div>

      <div style={{ marginTop: 28 }}>
        <div className="sec-head">
          <span className="num">§02</span>
          <h2>直近のログ</h2>
          <span className="meta">{logs.length} 件</span>
        </div>
        <LogList logs={logs.slice(0, 4)} compact />
      </div>
    </div>

    <div>
      <div className="card" style={{ padding: 20 }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>SPECIMEN CARTE</div>
        <div className="serif" style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>基本情報</div>
        <SpecDL s={s} />
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>BLOODLINE</div>
        <div className="serif" style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>血統</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>♂ 父</div>
          <code className="mono" style={{ fontSize: 12, padding: "3px 8px", background: "var(--bg-sunken)", borderRadius: 4 }}>{s.bloodline.father}</code>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>♀ 母</div>
          <code className="mono" style={{ fontSize: 12, padding: "3px 8px", background: "var(--bg-sunken)", borderRadius: 4 }}>{s.bloodline.mother}</code>
        </div>
        <button className="btn block" style={{ marginTop: 10 }} onClick={() => setRoute("bloodline")}>系図を開く →</button>
      </div>

      {s.eclosionInDays !== null && (
        <div className="card" style={{ padding: 20, marginTop: 16, background: "var(--accent-amber-soft)", borderColor: "transparent" }}>
          <div className="mono" style={{ fontSize: 10, color: "oklch(0.45 0.1 70)", letterSpacing: "0.12em" }}>ECLOSION FORECAST</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
            <span className="serif" style={{ fontSize: 42, fontWeight: 600, color: "oklch(0.35 0.1 70)" }}>{s.eclosionInDays}</span>
            <span style={{ color: "var(--ink-mute)" }}>日後に羽化予定</span>
          </div>
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 4 }}>{s.eclosionETA} ±5日</div>
        </div>
      )}
    </div>
  </div>
);

// ---------- V2: 博物誌レイアウト ----------
const VariantField = ({ s, logs }) => (
  <div className="card" style={{ padding: 40, background: "var(--bg-raised)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 48 }}>
      <div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.15em", borderBottom: "1px solid var(--ink)", paddingBottom: 4, display: "inline-block" }}>PLATE {s.id}</div>
        <h1 className="serif" style={{ fontSize: 44, fontWeight: 400, margin: "18px 0 6px", fontStyle: "italic", letterSpacing: "-0.01em" }}>{s.sci}</h1>
        <div style={{ fontSize: 16, color: "var(--ink-mute)" }}>「{s.name}」 · {s.species}</div>

        <div className="ph forest" style={{ height: 340, marginTop: 24, borderRadius: 4 }}>
          <span className="ph-label">Fig.1 · 側面写真</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div className="ph forest" style={{ height: 160 }}><span className="ph-label">Fig.2 · 頭角</span></div>
          <div className="ph forest" style={{ height: 160 }}><span className="ph-label">Fig.3 · 背面</span></div>
        </div>

        <p className="serif" style={{ marginTop: 28, fontSize: 14, lineHeight: 1.9, color: "var(--ink)", borderLeft: "2px solid var(--ink)", paddingLeft: 16, fontStyle: "italic" }}>
          {s.notes || "観察記録なし。"}
          蛹室の形状は良好、湿度管理に留意。室温は22℃前後を推奨。
        </p>
      </div>

      <div>
        <div style={{ borderTop: "2px solid var(--ink)", borderBottom: "1px solid var(--ink)", padding: "16px 0" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em", marginBottom: 12 }}>CLASSIFICATION</div>
          {[
            ["界", "動物界"],
            ["門", "節足動物門"],
            ["綱", "昆虫綱"],
            ["目", "コウチュウ目"],
            ["科", "コガネムシ科"],
            ["亜科", "カブトムシ亜科"]
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--ink-mute)" }}>{k}</span>
              <span className="serif">{v}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20 }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em", marginBottom: 8 }}>MEASUREMENTS</div>
          <SpecDL s={s} />
        </div>

        <div style={{ marginTop: 20, padding: 14, border: "1px solid var(--ink)", borderStyle: "dashed" }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: "0.12em" }}>COLLECTOR'S STAMP</div>
          <div className="serif" style={{ fontSize: 14, marginTop: 6 }}>{APP_DATA.user.name} · {s.purchasedAt}</div>
        </div>
      </div>
    </div>
  </div>
);

// ---------- V3: データリッチ ----------
const VariantData = ({ s, logs }) => {
  // fake weight series
  const series = [18.2, 19.8, 22.1, 24.6, 26.3, 27.5, 28.4];
  const max = Math.max(...series);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
      {/* row1 col1: header stack */}
      <div style={{ background: "var(--bg-raised)", padding: 22, gridColumn: "1 / 4", display: "flex", alignItems: "center", gap: 18 }}>
        <div className="ph forest" style={{ width: 120, height: 120, flexShrink: 0 }}>
          <span className="ph-label">{s.sex}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)" }}>{s.id} · {s.generation}</div>
          <div className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{s.name}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <span className="chip amber"><span className="dot" />{s.stage}</span>
            <span className="chip">{s.species}</span>
            <span className="chip forest">{s.shop}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>NEXT ECLOSION</div>
          <div className="serif" style={{ fontSize: 34, fontWeight: 600, color: "oklch(0.45 0.1 70)" }}>{s.eclosionInDays ?? "—"}<span style={{ fontSize: 14, color: "var(--ink-mute)" }}> days</span></div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ background: "var(--bg-raised)", padding: 22 }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>WEIGHT (g) · 7 WEEKS</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 160, marginTop: 14 }}>
          {series.map((v, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{v}</div>
              <div style={{ width: "100%", height: `${(v / max) * 100}%`, background: "var(--accent-forest)", borderRadius: "2px 2px 0 0" }}></div>
              <div className="mono" style={{ fontSize: 9, color: "var(--ink-faint)" }}>W{i + 1}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ background: "var(--bg-raised)", padding: 22 }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em", marginBottom: 10 }}>BIOMETRICS</div>
        {[
          ["SIZE", `${s.sizeMm}mm`, "+2mm / 週"],
          ["WEIGHT", `${s.weightG}g`, "+0.9g / 週"],
          ["TEMP", "22.4°C", "安定"],
          ["HUMID", "68%", "良好"]
        ].map(([k, v, d]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", alignItems: "baseline", gap: 8, padding: "8px 0", borderBottom: "1px dashed var(--line)" }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{k}</span>
            <span className="mono serif" style={{ fontSize: 18, fontWeight: 600 }}>{v}</span>
            <span className="mono" style={{ fontSize: 10, color: "var(--accent-forest)" }}>{d}</span>
          </div>
        ))}
      </div>

      {/* Spec */}
      <div style={{ background: "var(--bg-raised)", padding: 22 }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em", marginBottom: 10 }}>IDENTITY</div>
        <SpecDL s={s} />
      </div>

      {/* Stage bar */}
      <div style={{ background: "var(--bg-raised)", padding: 22, gridColumn: "1 / 4" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em", marginBottom: 14 }}>LIFECYCLE</div>
        <StageBar stage={s.stage} progress={s.stageProgress} eta={s.eclosionInDays} />
      </div>
    </div>
  );
};

// ---------- V4: タイムライン中心 ----------
const VariantTimeline = ({ s, logs }) => (
  <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 32 }}>
    <div style={{ position: "sticky", top: 72, alignSelf: "start" }}>
      <div className="ph forest" style={{ height: 220, marginBottom: 12 }}>
        <span className="ph-label">{s.name}</span>
      </div>
      <SpecDL s={s} />
      <hr className="hair" style={{ margin: "16px 0" }} />
      <StageBar stage={s.stage} progress={s.stageProgress} eta={s.eclosionInDays} vertical />
    </div>

    <div>
      <div className="sec-head">
        <span className="num">§</span>
        <h2>飼育タイムライン</h2>
        <span className="meta">{logs.length} 件 · 古い順 ↓</span>
      </div>
      <Timeline logs={[...logs].reverse()} />
    </div>
  </div>
);

// ---------- V5: ミニマル図鑑 ----------
const VariantMinimal = ({ s, logs }) => (
  <div style={{ maxWidth: 720, margin: "40px auto 0", textAlign: "center" }}>
    <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.3em" }}>{s.id}</div>
    <h1 className="serif" style={{ fontSize: 40, fontWeight: 400, margin: "8px 0 4px", fontStyle: "italic" }}>{s.sci}</h1>
    <div style={{ fontSize: 14, color: "var(--ink-mute)" }}>{s.name} · {s.species}</div>

    <div className="ph forest" style={{ height: 380, margin: "32px 0", borderRadius: 0 }}>
      <span className="ph-label">Plate — {s.id}</span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, textAlign: "left", borderTop: "1px solid var(--ink)", borderBottom: "1px solid var(--ink)", padding: "20px 0" }}>
      {[
        ["Size", `${s.sizeMm}mm`],
        ["Weight", `${s.weightG}g`],
        ["Stage", s.stage],
        ["Generation", s.generation]
      ].map(([k, v]) => (
        <div key={k}>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{k}</div>
          <div className="serif" style={{ fontSize: 18, marginTop: 4 }}>{v}</div>
        </div>
      ))}
    </div>

    <p className="serif" style={{ marginTop: 32, fontSize: 15, lineHeight: 1.9, color: "var(--ink)", textAlign: "left", maxWidth: 600, marginLeft: "auto", marginRight: "auto" }}>
      {s.purchasedAt} に {s.shop} より迎え入れられた{s.species}。
      {s.notes}<br />
      現在ステージ《{s.stage}》、次の変態まで {s.eclosionInDays ?? "—"} 日の見込み。
    </p>

    <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.2em", marginTop: 48 }}>
      ———— KOCHŪ 図鑑 · No.{s.id.replace(/\D/g, "")} ————
    </div>
  </div>
);

// ---------- shared subcomponents ----------
const SpecDL = ({ s }) => (
  <dl style={{ margin: 0 }}>
    <div className="spec"><dt>種</dt><dd>{s.species}</dd></div>
    <div className="spec"><dt>性別</dt><dd>{s.sex}</dd></div>
    <div className="spec"><dt>サイズ</dt><dd className="mono">{s.sizeMm} mm</dd></div>
    <div className="spec"><dt>体重</dt><dd className="mono">{s.weightG} g</dd></div>
    <div className="spec"><dt>累代</dt><dd className="mono">{s.generation}</dd></div>
    <div className="spec"><dt>羽化日</dt><dd className="mono">{s.birthDate}</dd></div>
    <div className="spec"><dt>購入日</dt><dd className="mono">{s.purchasedAt}</dd></div>
    <div className="spec"><dt>購入元</dt><dd>{s.shop}</dd></div>
  </dl>
);

const StageBar = ({ stage, progress, eta, vertical }) => {
  const stages = ["卵", "幼虫1齢", "幼虫2齢", "幼虫3齢", "前蛹", "蛹", "成虫"];
  const matchIdx = () => {
    if (stage.includes("卵")) return 0;
    if (stage.includes("1齢")) return 1;
    if (stage.includes("2齢")) return 2;
    if (stage.includes("3齢")) return 3;
    if (stage.includes("前蛹")) return 4;
    if (stage.includes("蛹")) return 5;
    if (stage.includes("成虫")) return 6;
    return 0;
  };
  const currentIdx = matchIdx();

  if (vertical) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {stages.map((st, i) => (
          <div key={st} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", opacity: i <= currentIdx ? 1 : 0.4 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: i < currentIdx ? "var(--accent-forest)" : i === currentIdx ? "var(--accent-amber)" : "var(--line-strong)" }}></div>
            <span className="mono" style={{ fontSize: 12 }}>{st}</span>
            {i === currentIdx && <span className="chip amber" style={{ marginLeft: "auto" }}>現在</span>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {stages.map((st, i) => (
          <div key={st} style={{ flex: 1, height: 6, borderRadius: 2, background: i < currentIdx ? "var(--accent-forest)" : i === currentIdx ? "var(--accent-amber)" : "var(--line-strong)" }}></div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {stages.map((st, i) => (
          <div key={st} style={{ flex: 1, textAlign: "center" }}>
            <div className="mono" style={{ fontSize: 10, color: i <= currentIdx ? "var(--ink)" : "var(--ink-faint)", fontWeight: i === currentIdx ? 600 : 400 }}>{st}</div>
          </div>
        ))}
      </div>
      {eta !== null && eta !== undefined && (
        <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--accent-amber-soft)", borderRadius: "var(--r-md)", fontSize: 12, color: "oklch(0.4 0.1 70)" }}>
          <span className="mono" style={{ fontSize: 11, marginRight: 6 }}>T-{eta}d</span>
          羽化予測日: 次のステージへ進行中
        </div>
      )}
    </div>
  );
};

const LogList = ({ logs, compact }) => (
  <div>
    {logs.map((l, i) => (
      <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 1fr auto", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line)", alignItems: "start" }}>
        <div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink)" }}>{l.date.slice(5)}</div>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{l.time}</div>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <LogTypeTag type={l.type} />
            <span style={{ fontWeight: 500 }}>{l.title}</span>
          </div>
          {!compact && <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 4 }}>{l.body}</div>}
        </div>
        {l.photo && <div className="ph" style={{ width: 60, height: 60 }}><span className="mono" style={{ fontSize: 9 }}>IMG</span></div>}
      </div>
    ))}
  </div>
);

const LogTypeTag = ({ type }) => {
  const map = {
    weight: { label: "体重", tone: "indigo" },
    feed: { label: "給餌", tone: "amber" },
    mat: { label: "マット", tone: "forest" },
    molt: { label: "脱皮", tone: "rose" },
    observation: { label: "観察", tone: "" }
  };
  const m = map[type] || { label: type, tone: "" };
  return <span className={`chip ${m.tone}`}>{m.label}</span>;
};

const Timeline = ({ logs }) => (
  <div style={{ position: "relative", paddingLeft: 28 }}>
    <div style={{ position: "absolute", left: 7, top: 8, bottom: 8, width: 2, background: "var(--line-strong)" }}></div>
    {logs.map((l, i) => (
      <div key={i} style={{ position: "relative", paddingBottom: 24 }}>
        <div style={{ position: "absolute", left: -28 + 2, top: 6, width: 12, height: 12, borderRadius: "50%", background: "var(--bg-raised)", border: "2px solid var(--ink)" }}></div>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", marginBottom: 4 }}>{l.date} {l.time}</div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <LogTypeTag type={l.type} />
            <span style={{ fontWeight: 500 }}>{l.title}</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>{l.body}</div>
          {l.photo && <div className="ph" style={{ height: 80, marginTop: 10 }}><span className="mono" style={{ fontSize: 10 }}>観察写真</span></div>}
        </div>
      </div>
    ))}
  </div>
);

window.SpecimenDetail = SpecimenDetail;
window.Timeline = Timeline;
window.LogList = LogList;
window.LogTypeTag = LogTypeTag;
window.StageBar = StageBar;
