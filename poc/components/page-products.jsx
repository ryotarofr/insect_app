// page-products.jsx — 商品一覧 + 商品詳細
const ProductsList = ({ setRoute, setSelectedProduct }) => {
  const [tab, setTab] = React.useState("all");
  const items = APP_DATA.products.filter(p => tab === "all" || (tab === "live" ? p.kind === "生体" : p.kind === "用品"));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="cat">SHOP · ANCHOR BEETLE CO. + MIYAMA FARM</div>
          <h1>生体と用品</h1>
        </div>
        <div className="page-actions">
          <div className="variants">
            <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>ALL</button>
            <button className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}>生体</button>
            <button className={tab === "goods" ? "active" : ""} onClick={() => setTab("goods")}>用品</button>
          </div>
        </div>
      </div>

      {/* Filter strip */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.08em" }}>FILTER</span>
        {["ヘラクレス系", "コーカサス系", "ネプチューン系", "国産", "♂", "♀", "成虫", "幼虫", "CBF以上", "即決"].map(f => (
          <button key={f} className="chip" style={{ cursor: "pointer", padding: "4px 10px" }}>{f}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-mute)" }}>{items.length} 点 · 並び: <b>おすすめ</b></span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
        {items.map(p => (
          <div
            key={p.id}
            className="card"
            style={{ cursor: "pointer", overflow: "hidden" }}
            onClick={() => { setSelectedProduct(p.id); setRoute("product-detail"); }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = "var(--shadow-md)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow = ""}
          >
            <div className={`ph ${p.tone}`} style={{ height: 200, borderRadius: 0, border: "none", borderBottom: "1px solid var(--line)" }}>
              <span className="ph-label">{p.phLabel}</span>
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{p.kind.toUpperCase()} · {p.shop}</span>
                {p.badge && <span className={`chip ${p.tone}`}>{p.badge}</span>}
              </div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{p.title}</div>
              {p.sci && <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", fontStyle: "italic", marginTop: 2 }}>{p.sci}</div>}
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 10 }}>
                <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>¥{p.price.toLocaleString()}</span>
                <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>税込 / 送料別</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

const ProductDetail = ({ productId, setRoute }) => {
  const p = APP_DATA.products.find(x => x.id === productId) || APP_DATA.products[0];
  const [thumb, setThumb] = React.useState(0);
  const isLive = p.kind === "生体";

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 40, alignItems: "start" }}>
        <div>
          <div className={`ph ${p.tone}`} style={{ height: 480, borderRadius: "var(--r-lg)" }}>
            <span className="ph-label">{p.phLabel}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i}
                onClick={() => setThumb(i)}
                className={`ph ${p.tone}`}
                style={{ height: 72, width: 96, cursor: "pointer", borderColor: thumb === i ? "var(--ink)" : undefined, borderWidth: thumb === i ? 2 : 1 }}>
                <span className="mono" style={{ fontSize: 9 }}>0{i + 1}</span>
              </div>
            ))}
            <div className="ph amber" style={{ height: 72, width: 96, cursor: "pointer" }}>
              <span className="ph-label">▶ 開封動画</span>
            </div>
          </div>
        </div>

        <div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)", letterSpacing: "0.1em" }}>{p.shop}</div>
          <h1 className="serif" style={{ margin: "4px 0 4px", fontSize: 26, fontWeight: 600 }}>{p.title}</h1>
          {p.sci && <div className="mono" style={{ fontSize: 11, fontStyle: "italic", color: "var(--ink-mute)" }}>{p.sci}</div>}

          <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
            {isLive && <span className="chip forest"><span className="dot" />生体</span>}
            {p.badge && <span className="chip indigo">{p.badge}</span>}
            {isLive && <span className="chip amber">血統書付</span>}
            {isLive && <span className="chip">要温度制御便</span>}
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 22 }}>
            <span className="serif" style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em" }}>¥{p.price.toLocaleString()}</span>
            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>税込 / 配送料 ¥1,800〜</span>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button className="btn lg primary" style={{ flex: 2 }} onClick={() => setRoute("cart")}>
              カートに追加
            </button>
            <button className="btn lg" style={{ flex: 1 }}>ウォッチ</button>
          </div>

          <div className="card" style={{ marginTop: 20, padding: 16, background: "var(--bg-sunken)", borderColor: "transparent" }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 10, letterSpacing: "0.08em" }}>CARE GUARANTEE</div>
            <div style={{ display: "flex", gap: 18, fontSize: 12 }}>
              <div>✓ 死着補償（24h 自動返金）</div>
              <div>✓ 温度制御便</div>
              <div>✓ 購入後 自動カルテ生成</div>
            </div>
          </div>

          {isLive && (
            <div style={{ marginTop: 24 }}>
              <div className="sec-head">
                <span className="num">§</span>
                <h2>個体詳細</h2>
              </div>
              <dl style={{ margin: 0 }}>
                <div className="spec"><dt>サイズ</dt><dd className="mono">142mm (頭角含)</dd></div>
                <div className="spec"><dt>性別</dt><dd>♂ オス</dd></div>
                <div className="spec"><dt>羽化日</dt><dd className="mono">2025-11-18</dd></div>
                <div className="spec"><dt>累代</dt><dd className="mono">CBF2 · 父 #DHH-0198 / 母 #DHH-0204</dd></div>
                <div className="spec"><dt>産地</dt><dd>グアドループ産 (人工繁殖)</dd></div>
                <div className="spec"><dt>ブリーダー</dt><dd>ANCHOR BEETLE CO. <span className="chip indigo" style={{ marginLeft: 6 }}>認証済</span></dd></div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

window.ProductsList = ProductsList;
window.ProductDetail = ProductDetail;
