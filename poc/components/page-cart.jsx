// page-cart.jsx — カート・チェックアウト
const CartPage = () => {
  const items = [
    { id: "i1", title: "ヘラクレスオオカブト ♂ 142mm", meta: "CBF2 · #DHH-0271", price: 48000, qty: 1, kind: "生体", tone: "forest" },
    { id: "i2", title: "高栄養ゼリー 17g × 50個", meta: "消耗品", price: 1480, qty: 2, kind: "用品", tone: "amber" }
  ];
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0);
  const shipping = 1800;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="cat">CHECKOUT</div>
          <h1>カートとお届け先</h1>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 32, alignItems: "start" }}>
        <div>
          <div className="sec-head"><span className="num">§01</span><h2>カート ({items.length} 点)</h2></div>
          {items.map(it => (
            <div key={it.id} className="card" style={{ padding: 14, display: "flex", gap: 14, marginBottom: 10 }}>
              <div className={`ph ${it.tone}`} style={{ width: 80, height: 80, flexShrink: 0 }}>
                <span className="mono" style={{ fontSize: 10 }}>{it.kind}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{it.title}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>{it.meta}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <div style={{ display: "flex", border: "1px solid var(--line-strong)", borderRadius: "var(--r-md)" }}>
                    <button style={{ padding: "4px 10px" }}>−</button>
                    <span className="mono" style={{ padding: "4px 10px", borderLeft: "1px solid var(--line)", borderRight: "1px solid var(--line)" }}>{it.qty}</span>
                    <button style={{ padding: "4px 10px" }}>＋</button>
                  </div>
                  <button className="btn sm ghost" style={{ color: "var(--ink-faint)" }}>削除</button>
                </div>
              </div>
              <div className="serif" style={{ fontSize: 20, fontWeight: 600, alignSelf: "center" }}>¥{(it.price * it.qty).toLocaleString()}</div>
            </div>
          ))}

          <div className="sec-head" style={{ marginTop: 28 }}><span className="num">§02</span><h2>お届け先</h2></div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label className="label">氏名</label><input className="input" defaultValue="山田 徹" /></div>
              <div><label className="label">電話</label><input className="input mono" defaultValue="080-0000-0000" /></div>
              <div><label className="label">郵便番号</label><input className="input mono" defaultValue="150-0001" /></div>
              <div><label className="label">都道府県</label><select className="select"><option>東京都</option></select></div>
              <div style={{ gridColumn: "1 / 3" }}><label className="label">住所</label><input className="input" defaultValue="渋谷区神宮前..." /></div>
            </div>
          </div>

          <div className="sec-head" style={{ marginTop: 28 }}><span className="num">§03</span><h2>配送方法</h2></div>
          <div className="card" style={{ padding: 0 }}>
            {[
              { name: "温度制御便（推奨）", sub: "生体含むため必須設定 · 15〜25℃", price: 1800, checked: true },
              { name: "通常便", sub: "用品のみの場合", price: 800, checked: false }
            ].map((o, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, borderBottom: i < 1 ? "1px solid var(--line)" : "none", cursor: "pointer" }}>
                <input type="radio" name="ship" defaultChecked={o.checked} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{o.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{o.sub}</div>
                </div>
                <span className="mono">¥{o.price.toLocaleString()}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="card" style={{ padding: 22, position: "sticky", top: 72 }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.12em" }}>ORDER SUMMARY</div>
          <div className="serif" style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>ご注文内容</div>

          {items.map(it => (
            <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, borderBottom: "1px dashed var(--line)" }}>
              <span style={{ color: "var(--ink-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>{it.title} × {it.qty}</span>
              <span className="mono">¥{(it.price * it.qty).toLocaleString()}</span>
            </div>
          ))}

          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--ink-mute)" }}>小計</span>
              <span className="mono">¥{subtotal.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--ink-mute)" }}>配送料 (温度制御)</span>
              <span className="mono">¥{shipping.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 4px", borderTop: "1px solid var(--ink)", marginTop: 8 }}>
              <span style={{ fontWeight: 600 }}>合計（税込）</span>
              <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>¥{(subtotal + shipping).toLocaleString()}</span>
            </div>
          </div>

          <div style={{ padding: 12, background: "var(--accent-forest-soft)", borderRadius: "var(--r-md)", fontSize: 11, marginTop: 12, color: "var(--accent-forest)" }}>
            ✓ 購入後、生体は自動でカルテに登録されます
          </div>

          <button className="btn primary lg block" style={{ marginTop: 14 }}>Stripeで決済 →</button>
        </div>
      </div>
    </>
  );
};

window.CartPage = CartPage;
