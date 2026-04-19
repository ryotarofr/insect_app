// page-shop.jsx — ショップ管理ダッシュボード
const ShopPage = () => {
  const st = APP_DATA.shopStats;
  const maxRev = Math.max(...st.revenue7d);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="cat">SHOP ADMIN · ANCHOR BEETLE CO.</div>
          <h1>ショップ管理</h1>
        </div>
        <div className="page-actions">
          <button className="btn">個体を登録</button>
          <button className="btn primary">+ 商品追加</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", overflow: "hidden", marginBottom: 24 }}>
        {[
          { label: "本日の売上", val: `¥${st.todayRevenue.toLocaleString()}`, delta: "+38% vs 昨日", tone: "forest" },
          { label: "本日の注文", val: st.todayOrders, delta: "12 件", tone: "" },
          { label: "要発送", val: st.pendingShip, delta: "うち要温度制御 2", tone: "amber" },
          { label: "在庫僅少", val: st.lowStock, delta: "補充推奨", tone: "rose" }
        ].map((x, i) => (
          <div key={i} style={{ background: "var(--bg-raised)", padding: 20 }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>{x.label}</div>
            <div className="serif" style={{ fontSize: 30, fontWeight: 600, marginTop: 4, letterSpacing: "-0.01em" }}>{x.val}</div>
            <div className={`chip ${x.tone}`} style={{ marginTop: 6 }}>{x.delta}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }}>
        {/* Revenue chart */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 20 }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>REVENUE</span>
            <span className="serif" style={{ fontSize: 18, fontWeight: 600 }}>売上推移 (7日)</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <button className="btn sm" style={{ padding: "3px 8px", fontSize: 11 }}>7D</button>
              <button className="chip" style={{ padding: "3px 8px" }}>30D</button>
              <button className="chip" style={{ padding: "3px 8px" }}>90D</button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 180 }}>
            {st.revenue7d.map((v, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>¥{(v / 1000).toFixed(0)}k</div>
                <div style={{ width: "100%", height: `${(v / maxRev) * 100}%`, background: i === 6 ? "var(--ink)" : "var(--accent-forest)", borderRadius: "3px 3px 0 0" }}></div>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{["月", "火", "水", "木", "金", "土", "日"][i]}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Low stock */}
        <div className="card" style={{ padding: 24 }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em", marginBottom: 14 }}>LOW STOCK · 要補充</div>
          {[
            { name: "高栄養ゼリー 17g×50", qty: 12, threshold: 50, img: "amber" },
            { name: "完熟発酵マット 10L", qty: 4, threshold: 20, img: "amber" },
            { name: "菌糸ビン 1400cc", qty: 8, threshold: 30, img: "amber" }
          ].map((x, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < 2 ? "1px dashed var(--line)" : "none" }}>
              <div className={`ph ${x.img}`} style={{ width: 40, height: 40 }}></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{x.name}</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>残 {x.qty} / 閾値 {x.threshold}</div>
                <div style={{ height: 3, background: "var(--bg-sunken)", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                  <div style={{ width: `${(x.qty / x.threshold) * 100}%`, height: "100%", background: "var(--accent-rose)" }}></div>
                </div>
              </div>
              <button className="btn sm">補充</button>
            </div>
          ))}
        </div>
      </div>

      {/* Orders table */}
      <div style={{ marginTop: 28 }}>
        <div className="sec-head">
          <span className="num">§</span>
          <h2>注文一覧</h2>
          <span className="meta">本日 {st.todayOrders} 件</span>
        </div>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 120px 1fr 100px 110px 120px 80px", padding: "10px 16px", fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.1em", fontFamily: "var(--font-mono)", background: "var(--bg-sunken)", borderBottom: "1px solid var(--line)", textTransform: "uppercase" }}>
            <span>ORDER</span><span>BUYER</span><span>ITEMS</span><span>TOTAL</span><span>SHIPPING</span><span>STATUS</span><span></span>
          </div>
          {APP_DATA.orders.map((o, i) => (
            <div key={o.id} style={{ display: "grid", gridTemplateColumns: "140px 120px 1fr 100px 110px 120px 80px", padding: "12px 16px", fontSize: 13, alignItems: "center", borderBottom: i < APP_DATA.orders.length - 1 ? "1px solid var(--line)" : "none", transition: "background 0.1s ease" }}
                 onMouseEnter={e => e.currentTarget.style.background = "var(--bg-sunken)"}
                 onMouseLeave={e => e.currentTarget.style.background = ""}>
              <span className="mono" style={{ fontSize: 11 }}>{o.id}</span>
              <span>{o.buyer}</span>
              <span style={{ color: "var(--ink-mute)" }}>{o.items}</span>
              <span className="mono">¥{o.total.toLocaleString()}</span>
              <span className={`chip ${o.temp.includes("温度") ? "amber" : ""}`} style={{ fontSize: 10 }}>{o.temp}</span>
              <span className={`chip ${o.status === "要発送" ? "rose" : o.status === "発送済" ? "forest" : o.status === "入金待ち" ? "" : "indigo"}`}>{o.status}</span>
              <button className="btn sm ghost">詳細 →</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

window.ShopPage = ShopPage;
