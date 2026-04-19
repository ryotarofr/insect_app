// page-market.jsx — C2Cマーケットプレイス
const MarketPage = () => {
  const [tab, setTab] = React.useState("browse");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="cat">C2C MARKETPLACE</div>
          <h1>個体を探す / 出品する</h1>
        </div>
        <div className="page-actions">
          <div className="variants">
            <button className={tab === "browse" ? "active" : ""} onClick={() => setTab("browse")}>出品一覧</button>
            <button className={tab === "sell" ? "active" : ""} onClick={() => setTab("sell")}>出品する</button>
          </div>
        </div>
      </div>

      {tab === "browse" ? <MarketBrowse /> : <MarketSell />}
    </>
  );
};

const MarketBrowse = () => (
  <>
    <div className="card" style={{ padding: 16, marginBottom: 20, display: "flex", alignItems: "center", gap: 12, background: "var(--bg-sunken)", borderColor: "transparent" }}>
      <span className="chip indigo">BLOODLINE 認証</span>
      <span style={{ fontSize: 13, color: "var(--ink-mute)" }}>
        このバッジは、イベントログで累代を検証済の個体に付与されます。
      </span>
      <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-faint)" }}>Stripe Connect エスクロー適用</span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
      {APP_DATA.listings.map(l => (
        <div key={l.id} className="card" style={{ display: "flex", gap: 0, overflow: "hidden", cursor: "pointer" }}
             onMouseEnter={e => e.currentTarget.style.boxShadow = "var(--shadow-md)"}
             onMouseLeave={e => e.currentTarget.style.boxShadow = ""}>
          <div className="ph forest" style={{ width: 180, minHeight: 180, borderRadius: 0, flexShrink: 0, border: "none", borderRight: "1px solid var(--line)" }}>
            <span className="ph-label">出品画像</span>
          </div>
          <div style={{ padding: 16, flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{l.id}</span>
              <span className={`chip ${l.auction ? "amber" : "forest"}`}>{l.auction ? `AUCTION · 残 ${l.endsIn}` : "即決のみ"}</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{l.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: "var(--ink-mute)" }}>
              <span>出品者: <b style={{ color: "var(--ink)" }}>{l.seller}</b></span>
              {l.verified && <span className="chip indigo" style={{ padding: "1px 6px", fontSize: 10 }}>✓ 認証ブリーダー</span>}
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: "auto", paddingTop: 14 }}>
              <span className="serif" style={{ fontSize: 24, fontWeight: 600 }}>¥{l.price.toLocaleString()}</span>
              <span style={{ fontSize: 11, color: "var(--ink-mute)", marginLeft: 4 }}>{l.auction ? "現在価格" : "即決"}</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 11, color: "var(--ink-mute)" }}>
                {l.bids !== null && <span>入札 <b className="mono" style={{ color: "var(--ink)" }}>{l.bids}</b></span>}
                <span>👁 {l.watchers}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              {l.auction && <button className="btn sm" style={{ flex: 1 }}>入札</button>}
              <button className="btn sm primary" style={{ flex: 1 }}>{l.auction ? "即決購入" : "購入する"}</button>
              <button className="btn sm ghost">♡</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  </>
);

const MarketSell = () => {
  const [picked, setPicked] = React.useState(null);
  const [mode, setMode] = React.useState("auction");
  const myStock = APP_DATA.specimens;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      {/* Left: pick specimen */}
      <div>
        <div className="sec-head">
          <span className="num">§01</span>
          <h2>出品する個体を選ぶ</h2>
          <span className="meta">カルテから自動引用</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {myStock.map(s => (
            <div key={s.id}
                 onClick={() => setPicked(s.id)}
                 className="card"
                 style={{
                   padding: 12,
                   cursor: "pointer",
                   borderColor: picked === s.id ? "var(--ink)" : "var(--line)",
                   borderWidth: picked === s.id ? 2 : 1
                 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div className="ph forest" style={{ width: 50, height: 50, flexShrink: 0 }}></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{s.id}</div>
                  <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <span className="chip" style={{ fontSize: 9, padding: "1px 5px" }}>{s.generation}</span>
                    <span className="chip" style={{ fontSize: 9, padding: "1px 5px" }}>{s.sex}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: listing form */}
      <div className="card" style={{ padding: 24, position: "sticky", top: 72, alignSelf: "start" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>NEW LISTING</div>
        <div className="serif" style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>出品情報</div>

        {picked ? (
          <div style={{ marginBottom: 14, padding: 12, background: "var(--accent-forest-soft)", borderRadius: "var(--r-md)" }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--accent-forest)" }}>SELECTED</div>
            <div style={{ fontWeight: 500 }}>{APP_DATA.specimens.find(s => s.id === picked)?.name}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>カルテ情報が自動反映されます</div>
          </div>
        ) : (
          <div style={{ marginBottom: 14, padding: 12, border: "1px dashed var(--line-strong)", borderRadius: "var(--r-md)", color: "var(--ink-faint)", fontSize: 12, textAlign: "center" }}>
            ← 左から個体を選択してください
          </div>
        )}

        <label className="label">販売方式</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
          <button className={"btn sm"} onClick={() => setMode("auction")}
            style={{ background: mode === "auction" ? "var(--bg-inverse)" : "var(--bg-raised)", color: mode === "auction" ? "var(--ink-inverse)" : "var(--ink)" }}>
            オークション
          </button>
          <button className={"btn sm"} onClick={() => setMode("fixed")}
            style={{ background: mode === "fixed" ? "var(--bg-inverse)" : "var(--bg-raised)", color: mode === "fixed" ? "var(--ink-inverse)" : "var(--ink)" }}>
            即決のみ
          </button>
        </div>

        <label className="label">{mode === "auction" ? "開始価格" : "即決価格"}</label>
        <div style={{ position: "relative" }}>
          <span className="mono" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-mute)" }}>¥</span>
          <input className="input mono" style={{ paddingLeft: 28 }} defaultValue="45,000" />
        </div>

        {mode === "auction" && (
          <>
            <label className="label" style={{ marginTop: 12 }}>終了期間</label>
            <select className="select">
              <option>3日</option><option>5日</option><option>7日</option>
            </select>
          </>
        )}

        <label className="label" style={{ marginTop: 12 }}>商品説明（自動生成 / 編集可）</label>
        <textarea className="textarea" defaultValue={picked ? `ヘラクレスオオカブト ♂ 142mm。CBF3個体。父 #DHH-0213、母 #DHH-0244。血統書付、認証ブリーダーによる累代。蛹期を経ての出品、状態良好。` : ""} />

        <div style={{ padding: 12, background: "var(--bg-sunken)", borderRadius: "var(--r-md)", marginTop: 14, fontSize: 11, color: "var(--ink-mute)", lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>手数料と保護</div>
          販売手数料 10% / Stripe決済手数料 3.6% / エスクロー購入者保護 / 死着自動返金
        </div>

        <button className="btn primary lg block" style={{ marginTop: 14 }} disabled={!picked}>出品する</button>
      </div>
    </div>
  );
};

window.MarketPage = MarketPage;
