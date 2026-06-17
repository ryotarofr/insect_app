// pwa.ts — Service Worker 登録。dev (import.meta.env.DEV) では登録しない。
//
// 開発中の Vite HMR と SW のキャッシュはしばしば衝突するため、
// prod ビルドでのみ SW を登録する。ローカルで SW を試したいときは
// VITE_ENABLE_SW_DEV=1 で `vite` を起動すると有効化される。

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  const enableInDev = import.meta.env.VITE_ENABLE_SW_DEV === "1";
  if (import.meta.env.DEV && !enableInDev) return;

  // load 後に登録 (初回表示を遅延させないため)
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      // 更新検出: 1時間ごとに明示的に checkForUpdates
      setInterval(() => void reg.update(), 60 * 60 * 1000);
    } catch (err) {
      console.warn("[pwa] SW register failed:", err);
    }
  };

  if (document.readyState === "complete") {
    void register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
