#!/usr/bin/env node
//
// SDUI i18n キー網羅チェッカー (Phase 9 前 / M5)
//
// 詳細: docs/sdui-three-layer-model-v6.md §13.5
//
// **目的**:
//   本番環境で「i18n キー解決失敗 → 空文字フォールバック」事故が発生しないよう、
//   deploy 前に Rust source / fixtures / TS source 中の `I18nKey` 参照と
//   locale 辞書 (client_solid/src/sdui/i18n/dict.ts の `SDUI_DICT_JA`) の
//   キー集合を突き合わせて差分を検出する。
//
// **使い方**:
//   $ node scripts/check-i18n-keys.mjs            # 通常モード (missing は fail / extra は warn)
//   $ node scripts/check-i18n-keys.mjs --strict   # extra も fail (= 死んだ翻訳の検出)
//   $ node scripts/check-i18n-keys.mjs --json     # 機械可読出力 (CI 用)
//
// **抽出対象**:
//   1. Rust source: `i18n("key")` / `I18nKey::new("key")` の関数呼び出し
//   2. Rust source: `Localizable::I18n { key: "...".into() ... }` 様の inline literal
//   3. fixtures (*.json): `{ "source": "i18n", "key": "..." }`
//   4. TS source: `{ source: "i18n", key: "..." }` (= 主にテスト fixture)
//
// **ロケール辞書の所在**:
//   - `client_solid/src/sdui/i18n/dict.ts` の `SDUI_DICT_JA` (= ja のみ MVP)
//   - 将来 multi-locale 化したら `Record<Locale, Record<string, string>>` に拡張し、
//     本スクリプトも各 locale を順に検証するよう拡張する。
//
// **CI 統合**:
//   `npm run check:i18n` で実行。非 0 終了で CI fail。
//   pre-commit hook にも組み込み推奨 (= local で気付ける)。
//
// **例外**:
//   - design book (`docs/sdui-three-layer-model-v6.md`) は仕様書なので scan 対象外。
//   - `validation_error` で server が動的に組み立てるキーは将来 server 側で enum 網羅。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ── パス解決 ─────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..");
const SERVER_DIR = resolve(REPO_ROOT, "server");
const DICT_PATH = resolve(
  CLIENT_ROOT,
  "src",
  "sdui",
  "i18n",
  "dict.ts",
);

// ── 引数 ──────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const STRICT = args.has("--strict");
const AS_JSON = args.has("--json");

// ── 抽出 regex ────────────────────────────────────────────────────────
//
// Rust:
//   i18n("badge.featured")               — handlers/cards.rs の helper
//   I18nKey::new("...")                  — テストや helper
//   Localizable::I18n { key: "...".into() } — 直書き
//
// 全部 "key" 部分の文字列リテラルを取り出すだけなので、共通の regex で OK。
//
// JSON / TSX:
//   { "source": "i18n", "key": "..." } / { source: "i18n", key: "..." }
const RUST_KEY_PATTERNS = [
  /\bi18n\(\s*"([a-z][a-z0-9_.]*)"\s*\)/g,
  /\bI18nKey::new\(\s*"([a-z][a-z0-9_.]*)"\s*\)/g,
  /Localizable::I18n\s*\{\s*key:\s*[^"]*"([a-z][a-z0-9_.]*)"/g,
];

const JSON_KEY_PATTERN =
  /"source"\s*:\s*"i18n"\s*,\s*"key"\s*:\s*"([a-z][a-z0-9_.]*)"/g;

const TS_KEY_PATTERNS = [
  // { source: "i18n", key: "..." }
  /source\s*:\s*"i18n"\s*,\s*key\s*:\s*"([a-z][a-z0-9_.]*)"/g,
  // asI18nKey("...") (= テスト fixture)
  /\basI18nKey\(\s*"([a-z][a-z0-9_.]*)"\s*\)/g,
];

// ── ファイル走査 ─────────────────────────────────────────────────────
function walk(root, exts, skip) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (skip(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (exts.some((x) => e.name.endsWith(x))) {
        out.push(p);
      }
    }
  }
  return out;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "target",
  "dist",
  ".git",
  ".vscode",
  "bindings",
  "generated",
]);

const skip = (name) => SKIP_DIRS.has(name) || name.startsWith(".");

// ── キー抽出 ──────────────────────────────────────────────────────────
function extractKeys() {
  /** @type {Map<string, Set<string>>} key -> Set<file> */
  const referenced = new Map();
  const addRef = (key, file) => {
    if (!referenced.has(key)) referenced.set(key, new Set());
    referenced.get(key).add(file);
  };

  // Rust
  const rustFiles = walk(SERVER_DIR, [".rs"], skip);
  for (const f of rustFiles) {
    const txt = readFileSync(f, "utf8");
    for (const re of RUST_KEY_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt)) !== null) addRef(m[1], relative(REPO_ROOT, f));
    }
  }

  // JSON fixtures (server / client 両方を一律スキャン)
  const jsonFiles = [
    ...walk(SERVER_DIR, [".json"], skip),
    ...walk(resolve(CLIENT_ROOT, "src"), [".json"], skip),
  ];
  for (const f of jsonFiles) {
    const txt = readFileSync(f, "utf8");
    JSON_KEY_PATTERN.lastIndex = 0;
    let m;
    while ((m = JSON_KEY_PATTERN.exec(txt)) !== null)
      addRef(m[1], relative(REPO_ROOT, f));
  }

  // TS source (= 主にテスト fixture)
  const tsFiles = walk(
    resolve(CLIENT_ROOT, "src"),
    [".ts", ".tsx"],
    skip,
  ).filter((f) => !f.endsWith("dict.ts")); // 辞書本体は対象外
  for (const f of tsFiles) {
    const txt = readFileSync(f, "utf8");
    for (const re of TS_KEY_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt)) !== null) addRef(m[1], relative(REPO_ROOT, f));
    }
  }

  return referenced;
}

// ── 辞書 (dict.ts) のキー抽出 ────────────────────────────────────────
//
// `SDUI_DICT_JA: Record<string, string> = { "key": "value", ... };` を regex で
// 解析する。多 locale 化の暁には眼の数だけ走らせる。
function readDictKeys() {
  const txt = readFileSync(DICT_PATH, "utf8");
  // SDUI_DICT_JA = { ... }; のブロックを見つけて、その中の "key": の出現を取る
  const blockMatch = txt.match(
    /SDUI_DICT_JA[^{]*\{([\s\S]*?)\n\};?/m,
  );
  if (!blockMatch) {
    throw new Error(`failed to parse SDUI_DICT_JA in ${DICT_PATH}`);
  }
  const body = blockMatch[1];
  const keys = new Set();
  // 行頭にコメントが無い (= "//" で始まらない) "key": をマッチさせる
  const re = /^(?!\s*\/\/)\s*"([a-z][a-z0-9_.]*)"\s*:/gm;
  let m;
  while ((m = re.exec(body)) !== null) keys.add(m[1]);
  return keys;
}

// ── main ──────────────────────────────────────────────────────────────
function main() {
  const referenced = extractKeys();
  const dict = readDictKeys();

  const missing = [];
  const extra = [];

  for (const key of referenced.keys()) {
    if (!dict.has(key)) missing.push(key);
  }
  for (const key of dict) {
    if (!referenced.has(key)) extra.push(key);
  }

  missing.sort();
  extra.sort();

  if (AS_JSON) {
    const result = {
      referenced: Object.fromEntries(
        [...referenced].map(([k, files]) => [k, [...files].sort()]),
      ),
      dict: [...dict].sort(),
      missing,
      extra,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(missing.length > 0 || (STRICT && extra.length > 0) ? 1 : 0);
  }

  console.log(
    `[i18n] referenced: ${referenced.size} keys, dict: ${dict.size} keys`,
  );

  if (missing.length > 0) {
    console.error(
      `\n❌ MISSING ${missing.length} key(s) referenced but not in SDUI_DICT_JA:`,
    );
    for (const k of missing) {
      const files = [...(referenced.get(k) ?? [])].sort();
      console.error(`  - "${k}"`);
      for (const f of files) console.error(`      ${f}`);
    }
    console.error(
      `\n→ 本番で空文字フォールバックが起きます。${relative(REPO_ROOT, DICT_PATH)} に追加してください。`,
    );
  }

  if (extra.length > 0) {
    const banner = STRICT
      ? `\n❌ EXTRA ${extra.length} key(s) in dict but unused (strict mode):`
      : `\n⚠️  EXTRA ${extra.length} key(s) in dict but unused (= 死んだ翻訳の可能性):`;
    console.error(banner);
    for (const k of extra) console.error(`  - "${k}"`);
  }

  if (missing.length === 0 && (extra.length === 0 || !STRICT)) {
    console.log("✓ i18n keys: OK");
    process.exit(0);
  }
  process.exit(1);
}

main();
