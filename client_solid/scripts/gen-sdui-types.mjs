#!/usr/bin/env node
//
// SDUI TypeScript 型生成パイプラインの集約スクリプト。
//
// 流れ:
//   1. server/ で `cargo test` を実行し、ts-rs に各型を `server/bindings/<TypeName>.ts` へ
//      書き出させる
//   2. `server/bindings/*.ts` を読み込み、per-file の `import type { X } from "./X"` を
//      取り除いて 1 ファイルに集約
//   3. `client_solid/src/generated/sdui.ts` に書き出す
//
// 使い方:
//   $ cd client_solid
//   $ npm run gen:sdui            # cargo test + 集約
//   $ npm run gen:sdui -- --skip-cargo  # 集約だけ (cargo test は手動で済ませた時)
//
// 運用ルール:
//   - `client_solid/src/generated/sdui.ts` は **手書き禁止 / 自動生成のみ**
//   - アプリコードはこのファイルを直接 import せず、`@/sdui/branded` 経由で参照する
//     (詳細: docs/sdui-three-layer-model-v5.md §7.5)
//

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── パス解決 ─────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..");
const SERVER_DIR = resolve(REPO_ROOT, "server");
const BINDINGS_DIR = resolve(SERVER_DIR, "bindings");
const OUTPUT_PATH = resolve(CLIENT_ROOT, "src", "generated", "sdui.ts");

const args = new Set(process.argv.slice(2));
const skipCargo = args.has("--skip-cargo");

// ── Step 1: cargo test (= ts-rs export) ─────────────────────────────
//
// `--lib --tests` で **メイン bin (`insect_app_server.exe`) をビルドしない**。
// ts-rs export を駆動しているのは
//   - `src/sdui/**/*.rs` の `#[cfg(test)]` ユニットテスト
//   - `tests/sdui_export.rs` の integration test
// だけなので main bin のリンクは不要。
//
// **Windows 対策**: `cargo run` で server を起動したまま `gen:sdui` を回しても、
// メイン bin を再リンクしようとせず "Access is denied" (os error 5) を回避できる。
// dev workflow で開発サーバを上げっぱなしのまま型生成できるようになる。
if (!skipCargo) {
  console.log(`[gen-sdui] running cargo test --lib --tests in ${SERVER_DIR}`);
  try {
    execSync("cargo test --lib --tests --quiet", {
      cwd: SERVER_DIR,
      stdio: "inherit",
    });
  } catch (e) {
    console.error("[gen-sdui] cargo test failed; aborting aggregation.");
    process.exit(1);
  }
}

// ── Step 2: bindings/*.ts を読み込んで集約 ───────────────────────────
let files;
try {
  files = readdirSync(BINDINGS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort();
} catch (e) {
  console.error(`[gen-sdui] cannot read ${BINDINGS_DIR}: ${e.message}`);
  console.error("[gen-sdui] did `cargo test` run? try without --skip-cargo");
  process.exit(1);
}

if (files.length === 0) {
  console.error(`[gen-sdui] no .ts files found in ${BINDINGS_DIR}`);
  process.exit(1);
}

console.log(`[gen-sdui] aggregating ${files.length} type files`);

// per-file の `import type { X } from "./X";` を削除する正規表現。
// シングルクォート / ダブルクォート両対応、相対パス `./` 始まりのみを対象。
const RELATIVE_IMPORT_RE =
  /^\s*import\s+type\s*\{[^}]+\}\s*from\s*["']\.\/[^"']+["'];?\s*$/gm;

// 各ファイルの中身を結合
const sections = files.map((filename) => {
  const filepath = join(BINDINGS_DIR, filename);
  const raw = readFileSync(filepath, "utf8");
  const stripped = raw.replace(RELATIVE_IMPORT_RE, "").trim();
  return `// ── ${filename} ${"─".repeat(60 - filename.length)}\n${stripped}\n`;
});

const header = `// ============================================================
// AUTO-GENERATED. DO NOT EDIT BY HAND.
//
// 生成元: server/src/sdui/  (Rust 側が型の Source of Truth)
// 生成手順: client_solid/scripts/gen-sdui-types.mjs
// 編集が必要な時は Rust 側を直し、\`npm run gen:sdui\` を実行する。
//
// 詳細: docs/sdui-three-layer-model-v5.md §7
// ============================================================

`;

const body = sections.join("\n");
const output = header + body;

// ── Step 3: 書き出し ──────────────────────────────────────────────────
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, output, "utf8");
console.log(`[gen-sdui] wrote ${OUTPUT_PATH}`);
console.log(`[gen-sdui] ${files.length} types aggregated.`);
