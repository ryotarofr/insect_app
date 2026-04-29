#!/usr/bin/env node
//
// OpenAPI TypeScript 型生成パイプライン (Phase 1 / A1 / PR O-6)。
//
// 流れ:
//   1. `cargo run --bin dump_openapi` で OpenAPI 3.x spec を JSON で取得
//      (= server 起動不要 / spec 生成は純 Rust マクロ展開で完結)
//   2. その JSON を `bunx openapi-typescript` に流して TS 型を生成
//   3. `client_solid/src/generated/openapi.d.ts` に書き出す
//
// 使い方:
//   $ cd client_solid
//   $ bun run gen:openapi          # cargo build + 型生成
//   $ bun run gen:openapi -- --skip-cargo  # JSON dump だけ skip (= 既存 dump_openapi.exe を再利用)
//
// 運用ルール:
//   - `client_solid/src/generated/openapi.d.ts` は **手書き禁止 / 自動生成のみ**
//   - utoipa 属性が handler に増えたら本スクリプトを再実行する
//   - 既存の手書き型 (= `client_solid/src/sdui/api.ts`) は段階的に置換予定 (= PR O-2 以降)
//

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── パス解決 ─────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..");
const SERVER_DIR = resolve(REPO_ROOT, "server");
const TMP_JSON = resolve(CLIENT_ROOT, "node_modules", ".cache", "openapi.json");
const OUTPUT_PATH = resolve(CLIENT_ROOT, "src", "generated", "openapi.d.ts");

const args = new Set(process.argv.slice(2));
const skipCargo = args.has("--skip-cargo");

// ── Step 1: cargo run --bin dump_openapi で spec 取得 ────────────────
//
// `cargo run --bin dump_openapi` の標準出力を直接ファイルに書き出す。
// shell pipe を介さない (= Windows で動作差を回避) ため、Buffer で受けて自分で書く。
mkdirSync(dirname(TMP_JSON), { recursive: true });
if (!skipCargo) {
  console.log("[gen:openapi] running `cargo run --bin dump_openapi`...");
  const json = execSync("cargo run --quiet --bin dump_openapi", {
    cwd: SERVER_DIR,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024, // 16 MB
    stdio: ["ignore", "pipe", "inherit"],
  });
  writeFileSync(TMP_JSON, json, "utf8");
  console.log(`[gen:openapi] wrote ${TMP_JSON} (${json.length} bytes)`);
}

// ── Step 2: openapi-typescript で TS 型生成 ──────────────────────────
//
// `bunx openapi-typescript <input> -o <output>` で d.ts を生成。
// `bunx` 経由なので devDependencies に未登録でも自動 fetch される。
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
console.log("[gen:openapi] running `openapi-typescript`...");
execSync(`bunx openapi-typescript "${TMP_JSON}" -o "${OUTPUT_PATH}"`, {
  cwd: CLIENT_ROOT,
  stdio: "inherit",
});
console.log(`[gen:openapi] wrote ${OUTPUT_PATH}`);
