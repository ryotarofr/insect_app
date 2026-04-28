/// <reference types="vitest" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
// /sessions の sandbox では dist / node_modules/.vite に書き込んだ古いファイルを
// 別プロセスから削除できないことがあるため、出力先とキャッシュを /tmp に逃がす。
const useTmp = process.env.VITE_USE_TMP_CACHE === "1";
export default defineConfig({
    plugins: [solid()],
    cacheDir: useTmp ? "/tmp/vite-cache" : "node_modules/.vite",
    build: {
        outDir: useTmp ? "/tmp/solid-dist" : "dist",
    },
    server: {
        port: 5173,
        proxy: {
            // SDUI バックエンド (axum, port 3000) に dev サーバから直接 fetch できるようにする。
            // 本番では同一オリジンに置く想定なので、フロントは常に `/api` 相対で叩けばよい。
            "/api": {
                target: "http://localhost:3000",
                changeOrigin: true,
            },
        },
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./src/test/setup.ts"],
        // Solid.js の vite-plugin-solid は test モードでは import 名を書き換える必要がある
        // 参考: https://github.com/solidjs/solid-testing-library
        deps: {
            optimizer: {
                web: {
                    include: ["solid-js"],
                },
            },
        },
    },
    resolve: {
        // vitest がブラウザ向け solid バンドルを解決できるよう、conditions を調整
        conditions: process.env.VITEST ? ["development", "browser"] : [],
    },
});
