import { MetaProvider, Title } from "@solidjs/meta";
import { A, Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Show, Suspense, createResource } from "solid-js";
import { isServer } from "solid-js/web";
import { authLogout, authMe } from "~/sdui/api";
import "./app.css";

/**
 * 固定シェル(コード管理の領域)。ヘッダー+上部ナビのみで、<main> の中身が
 * SDUI(DB管理)。ビジュアルは「昆蟲圖鑑」風のライトテーマ。
 */
export default function App() {
  const [me] = createResource(
    () => (isServer ? undefined : "me"),
    () => authMe(),
  );

  const logout = async () => {
    try {
      await authLogout();
    } finally {
      window.location.href = "/";
    }
  };

  return (
    <Router
      root={props => (
        <MetaProvider>
          <Title>insect_app_r2</Title>
          <div class="shell">
            <header class="shell__header">
              <a class="shell__brand" href="/">
                insect_app_r2 <span class="shell__brand-tag">INSECTARIUM MARKET</span>
              </a>
              <nav class="shell__nav">
                <A class="shell__nav-item" activeClass="shell__nav-item--active" href="/" end>
                  ホーム
                </A>
                <A class="shell__nav-item" activeClass="shell__nav-item--active" href="/care">
                  飼育管理
                </A>
              </nav>
              <div class="shell__user">
                <Show
                  when={me.latest}
                  fallback={
                    <A class="shell__nav-item" activeClass="shell__nav-item--active" href="/login">
                      ログイン
                    </A>
                  }
                >
                  {u => (
                    <>
                      <span class="shell__user-name">{u().displayName}</span>
                      <button class="sd-btn sd-btn--ghost" onClick={() => void logout()}>
                        ログアウト
                      </button>
                    </>
                  )}
                </Show>
              </div>
            </header>
            <main class="shell__main">
              <Suspense>{props.children}</Suspense>
            </main>
          </div>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
