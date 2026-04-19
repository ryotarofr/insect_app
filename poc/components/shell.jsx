// shell.jsx — sidebar + topbar shell
const { useState, useEffect, useMemo, useRef } = React;

const Shell = ({ current, setRoute, children, crumb, topActions }) => {
  const nav = [
    { key: "products", label: "生体・用品", icon: Icons.grid, group: "EC" },
    { key: "product-detail", label: "商品詳細", icon: Icons.tag, group: "EC", hidden: true },
    { key: "cart", label: "カート", icon: Icons.cart, group: "EC", badge: "2" },
    { key: "mypage", label: "マイページ", icon: Icons.home, group: "飼育" },
    { key: "specimen", label: "個体カルテ", icon: Icons.card, group: "飼育" },
    { key: "log", label: "飼育ログ", icon: Icons.timeline, group: "飼育" },
    { key: "eclosion", label: "羽化予測", icon: Icons.bell, group: "飼育", badge: "3" },
    { key: "bloodline", label: "血統系図", icon: Icons.tree, group: "飼育" },
    { key: "market", label: "C2Cマーケット", icon: Icons.beetle, group: "取引" },
    { key: "shop", label: "ショップ管理", icon: Icons.shop, group: "運営" },
  ];

  const groups = ["EC", "飼育", "取引", "運営"];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">蟲</div>
          <div>
            <div className="brand-name">KOCHŪ</div>
            <div className="brand-sub">昆虫EC × CARE LOG</div>
          </div>
        </div>

        {groups.map(g => (
          <div className="nav-group" key={g}>
            <div className="nav-title">{g}</div>
            {nav.filter(n => n.group === g && !n.hidden).map(n => (
              <div
                key={n.key}
                className={"nav-item" + (current === n.key ? " active" : "")}
                onClick={() => setRoute(n.key)}
              >
                {n.icon}
                <span>{n.label}</span>
                {n.badge && <span className="nav-badge">{n.badge}</span>}
              </div>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          <div className="avatar">{APP_DATA.user.initial}</div>
          <div>
            <div className="user-name">{APP_DATA.user.name}</div>
            <div className="user-role">{APP_DATA.user.role}</div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumb">{crumb}</div>
          <div className="search">
            <svg className="sicon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            <input placeholder="個体ID・種名・商品を検索" />
            <span className="kbd skbd">⌘K</span>
          </div>
          {topActions}
        </header>
        <main className="content fade-enter" key={current}>
          {children}
        </main>
      </div>
    </div>
  );
};

window.Shell = Shell;
