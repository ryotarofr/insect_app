import { defineConfig } from "vite";
import { nitroV2Plugin as nitro } from "@solidjs/vite-plugin-nitro-2";

import { solidStart } from "@solidjs/start/config";

export default defineConfig({
  // SDUI POC は SPA モード(SSR時のfetch二重化・絶対URL問題を回避)
  plugins: [solidStart({ ssr: false }), nitro()],
  server: {
    // 開発時: /api を Rust api(127.0.0.1:3001)へ中継(CORS不要化)
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
