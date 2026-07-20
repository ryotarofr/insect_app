#!/usr/bin/env python3
"""LLMハーネス — 成功指標1「LLM生成 definition の validate 通過率」の計測。

パイプライン: スキーマ読込 → タスクごとに Claude API 1回 → `validate` バイナリで判定
→ 失敗を分類 → results/<日時>/report.md に集計。生出力は raw/ に全保存。

使い方:
  python run.py --dry-run                    # fixtures でパイプライン検証(APIキー不要)
  python run.py --dry-run --hydrate-gate     # + 第二ゲート(API http://127.0.0.1:3001 起動時)
  set ANTHROPIC_API_KEY=... (Windows) / export ANTHROPIC_API_KEY=... (Unix)
  python run.py                              # 実測: 全タスク × 条件A/B(既定)
  python run.py --condition B --n 10 --model claude-sonnet-4-5 --temperature 1.0

条件: A = スキーマのみ / B = スキーマ + l2_rules.md(L2ルール文書)。
生成モード(--gen-mode auto): structured outputs → 失敗時 tool強制 → prompt埋め込み。
注: 本スキーマは oneOf / pattern / $defs を含み structured outputs のサポート範囲外の
可能性が高い(その場合 auto が tool へフォールバックし、使用モードをレポートに記録する)。

依存: pip install -r requirements.txt(anthropic, requests)。Windows でも動作
(validate.exe を自動検出。文字化けする場合は `set PYTHONUTF8=1`)。
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent  # harness/
REPO = ROOT.parent
SCHEMA_PATH = REPO / "schema" / "page_definition.schema.json"
API_DIR = REPO / "api"
TOOL_NAME = "submit_page_definition"

# ── 判定器(既存の Rust バイナリ)────────────────────────────


def find_validate() -> pathlib.Path:
    exe = "validate.exe" if os.name == "nt" else "validate"
    path = API_DIR / "target" / "debug" / exe
    if not path.exists():
        print("validate バイナリが無いためビルドします(初回のみ)…")
        subprocess.run(["cargo", "build", "--bin", "validate"], cwd=API_DIR, check=True)
    return path


def load_schema() -> dict:
    if not SCHEMA_PATH.exists():
        print("schema が無いため dump_schema を実行します…")
        subprocess.run(["cargo", "run", "--bin", "dump_schema"], cwd=API_DIR, check=True)
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def run_validate(validate_bin: pathlib.Path, text: str) -> tuple[bool, str]:
    proc = subprocess.run(
        [str(validate_bin)], input=text.encode("utf-8"), capture_output=True, timeout=60
    )
    return proc.returncode == 0, proc.stderr.decode("utf-8", "replace").strip()


# ── 失敗の分類 ───────────────────────────────────────────────
#
# validate の stderr(DefinitionError の Display)をパースする。
# L1 = 構造(serde)、L2 = 意味検証、L0 = そもそもJSONでない。
# schema_gap = JSON Schema は通るが serde が拒否する設計上の隙間(brand.rs 参照)。

SITE_PATH_RE = re.compile(r"invalid site path.*?\): \"(.*?)\"")


def classify(stderr: str) -> str:
    body = stderr.removeprefix("INVALID:").strip()
    if body.startswith("structural:"):
        d = body.removeprefix("structural:").strip()
        if "unknown field" in d:
            return "L1:unknown_field"
        if "unknown variant" in d:
            return "L1:unknown_variant"
        if "missing field" in d:
            return "L1:missing_field"
        if "invalid block key" in d:
            return "L1:brand_block_key"
        if "invalid site path" in d:
            m = SITE_PATH_RE.search(d)
            p = m.group(1) if m else ""
            if p.startswith("/") and not p.startswith("//") and len(p) <= 512:
                return "L1:schema_gap_site_path"
            return "L1:brand_site_path"
        if "invalid type" in d or "expected" in d:
            return "L1:type_mismatch"
        return "L1:other"
    if "schemaVersion" in body:
        return "L2:schema_version"
    if "duplicate key" in body:
        return "L2:duplicate_key"
    if "headline blocks" in body:
        return "L2:multiple_headlines"
    if "out of range" in body:
        return "L2:limit_out_of_range"
    if "exceeds max" in body:
        return "L2:markdown_too_long"
    if "cards (max" in body:
        return "L2:too_many_cards"
    if "blocks (max" in body:
        return "L2:too_many_blocks"
    return "L2:other"


# ── モデル出力の正規化 ───────────────────────────────────────


def extract_json(text: str) -> tuple[str | None, bool]:
    """出力から最初のJSONオブジェクトを取り出す。(json文字列, 抽出が必要だったか)"""
    s = text.strip()
    try:
        json.loads(s)
        return s, False
    except Exception:
        pass
    # コードフェンスや前置きを剥がして最初の '{' から raw_decode
    s2 = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.M)
    start = s2.find("{")
    if start < 0:
        return None, True
    try:
        obj, _ = json.JSONDecoder().raw_decode(s2[start:])
        return json.dumps(obj, ensure_ascii=False), True
    except Exception:
        return None, True


# ── 生成(Claude API)─────────────────────────────────────────


def build_prompts(task: dict, condition: str, schema_text: str, gen_mode: str) -> tuple[str, str]:
    system = (
        "あなたは insect_app_r2 のSDUI画面定義(PageDefinition)を書くエージェントです。"
        "出力は PageDefinition の JSON 1個のみ。説明文やコードフェンスは出力しません。"
    )
    if condition == "B":
        l2 = (ROOT / "l2_rules.md").read_text(encoding="utf-8")
        system += "\n\n" + l2
    if gen_mode == "prompt":
        system += (
            "\n\n出力が従うべき JSON Schema:\n```json\n" + schema_text + "\n```"
        )
    user = task["instruction"]
    if task["mode"] == "edit":
        base = (ROOT / task["base_def"]).read_text(encoding="utf-8")
        user = f"現在の画面定義(page_key: {task['page_key']}):\n{base}\n\n指示: {user}"
    else:
        user = f"page_key「{task['page_key']}」の画面定義を新規に書いてください。\n指示: {user}"
    return system, user


def generate(client, args, schema: dict, task: dict, condition: str) -> dict:
    """1タスク分の生成。戻り値: {text, used_mode, usage, error}"""
    schema_text = json.dumps(schema, ensure_ascii=False)
    modes = {"auto": ["structured", "tool", "prompt"]}.get(args.gen_mode, [args.gen_mode])
    last_err = None
    for mode in modes:
        system, user = build_prompts(task, condition, schema_text, mode)
        common = dict(
            model=args.model,
            max_tokens=args.max_tokens,
            temperature=args.temperature,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        for attempt in (1, 2):  # APIエラーは1回だけリトライ
            try:
                if mode == "structured":
                    resp = client.messages.create(
                        **common,
                        output_config={"format": {"type": "json_schema", "schema": schema}},
                    )
                    text = "".join(b.text for b in resp.content if b.type == "text")
                elif mode == "tool":
                    resp = client.messages.create(
                        **common,
                        tools=[{
                            "name": TOOL_NAME,
                            "description": "完成した画面定義(PageDefinition)を提出する",
                            "input_schema": schema,
                        }],
                        tool_choice={"type": "tool", "name": TOOL_NAME},
                    )
                    tool_blocks = [b for b in resp.content if b.type == "tool_use"]
                    if not tool_blocks:
                        raise RuntimeError("tool_use ブロックが無い")
                    text = json.dumps(tool_blocks[0].input, ensure_ascii=False)
                else:  # prompt
                    resp = client.messages.create(**common)
                    text = "".join(b.text for b in resp.content if b.type == "text")
                usage = {
                    "input_tokens": getattr(resp.usage, "input_tokens", None),
                    "output_tokens": getattr(resp.usage, "output_tokens", None),
                }
                return {"text": text, "used_mode": mode, "usage": usage, "error": None}
            except TypeError as e:
                # SDK が output_config 未対応(古い)等 → このモードは不成立、次のモードへ
                last_err = f"{mode}: {e}"
                break
            except Exception as e:  # BadRequest(schema too complex 等)・一時エラー
                last_err = f"{mode}: {type(e).__name__}: {e}"
                transient = "overloaded" in str(e).lower() or "rate" in str(e).lower() \
                    or "529" in str(e) or "timeout" in str(e).lower()
                if transient and attempt == 1:
                    time.sleep(5)
                    continue
                break  # 非一時エラー → 次のモードへフォールバック
    return {"text": None, "used_mode": None, "usage": {}, "error": last_err}


# ── 第二ゲート: hydrate(任意)────────────────────────────────


class HydrateGate:
    """PUT /api/pages/harness_test → GET。validate 通過 ≠ 配信可能、の隙間を測る。
    コンテキスト必須ブロック(specimen_* 等)の誤配置は GET 400 として現れる。"""

    def __init__(self, base: str):
        import requests  # 遅延import(ゲート未使用なら不要)

        self.rq = requests
        self.s = requests.Session()
        self.base = base.rstrip("/")
        email, pw = "harness@example.com", "harness-pass-123"
        r = self.s.post(f"{self.base}/api/auth/login", json={"email": email, "password": pw})
        if r.status_code == 401:
            r = self.s.post(
                f"{self.base}/api/auth/register",
                json={"email": email, "password": pw, "displayName": "harness"},
            )
        r.raise_for_status()

    def check(self, def_text: str) -> dict:
        put = self.s.put(f"{self.base}/api/pages/harness_test", data=def_text.encode("utf-8"))
        if put.status_code != 204:
            return {"put": put.status_code, "get": None}
        get = self.s.get(f"{self.base}/api/pages/harness_test")
        return {"put": put.status_code, "get": get.status_code}


# ── レポート ─────────────────────────────────────────────────


def write_report(outdir: pathlib.Path, args, rows: list[dict], dry: bool) -> str:
    total = len(rows)
    passed = sum(1 for r in rows if r["category"] == "pass")
    lines = [
        "# ハーネス実行レポート" + "(dry-run)" if dry else "# ハーネス実行レポート(指標1)",
        "",
        f"- 実行: {outdir.name} / モデル: {args.model} / temperature: {args.temperature} / gen-mode: {args.gen_mode}",
        f"- **validate 通過率: {passed}/{total} = {passed / total * 100:.0f}%**(目標 90%)" if total else "- タスクなし",
        "",
    ]
    for cond in sorted({r["condition"] for r in rows}):
        sub = [r for r in rows if r["condition"] == cond]
        p = sum(1 for r in sub if r["category"] == "pass")
        label = {"A": "A(スキーマのみ)", "B": "B(スキーマ+L2ルール)", "-": "-"}.get(cond, cond)
        lines.append(f"- 条件{label}: {p}/{len(sub)} = {p / len(sub) * 100:.0f}%")
    for mode in ("generate", "edit"):
        sub = [r for r in rows if r["task_mode"] == mode]
        if sub:
            p = sum(1 for r in sub if r["category"] == "pass")
            lines.append(f"- {mode}: {p}/{len(sub)}")
    fails: dict[str, int] = {}
    for r in rows:
        if r["category"] != "pass":
            fails[r["category"]] = fails.get(r["category"], 0) + 1
    if fails:
        lines += ["", "## 失敗タクソノミ", ""]
        for k, v in sorted(fails.items(), key=lambda kv: -kv[1]):
            lines.append(f"- {k}: {v}件")
    lines += ["", "## 明細", "", "| task | 条件 | 生成モード | 判定 | hydrate | tokens(in/out) |", "|---|---|---|---|---|---|"]
    for r in rows:
        hyd = "-"
        if r.get("hydrate"):
            hyd = f"PUT {r['hydrate']['put']} / GET {r['hydrate']['get']}"
        u = r.get("usage") or {}
        tok = f"{u.get('input_tokens', '-')}/{u.get('output_tokens', '-')}"
        mark = "✔ pass" if r["category"] == "pass" else f"✘ {r['category']}"
        lines.append(
            f"| {r['id']} | {r['condition']} | {r.get('used_mode') or '-'} | {mark} | {hyd} | {tok} |"
        )
    lines += ["", f"生出力: raw/ 配下に task ごとに保存。", ""]
    report = "\n".join(lines)
    (outdir / "report.md").write_text(report, encoding="utf-8")
    return report


def save_raw(outdir: pathlib.Path, rid: str, payload: dict) -> None:
    raw = outdir / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    (raw / f"{rid}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ── メイン ───────────────────────────────────────────────────


def judge(validate_bin, text: str) -> tuple[str, str, bool]:
    """(category, stderr, extracted) を返す。category: 'pass' | 'L0:not_json' | 分類名"""
    js, extracted = extract_json(text)
    if js is None:
        return "L0:not_json", "", extracted
    ok, stderr = run_validate(validate_bin, js)
    return ("pass" if ok else classify(stderr)), stderr, extracted


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="fixtures でパイプライン検証(API不要)")
    ap.add_argument("--n", type=int, default=None, help="実行タスク数の上限(既定: 全件)")
    ap.add_argument("--condition", choices=["A", "B", "AB"], default="AB")
    ap.add_argument("--model", default="claude-sonnet-4-5")
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--gen-mode", choices=["auto", "structured", "tool", "prompt"], default="auto")
    ap.add_argument("--hydrate-gate", action="store_true", help="PUT/GET の第二ゲート(APIが必要)")
    ap.add_argument("--api-base", default="http://127.0.0.1:3001")
    args = ap.parse_args()

    validate_bin = find_validate()
    outdir = ROOT / "results" / datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir.mkdir(parents=True, exist_ok=True)
    gate = None
    if args.hydrate_gate:
        try:
            gate = HydrateGate(args.api_base)
        except Exception as e:
            print(f"hydrate-gate を無効化({e})")

    rows: list[dict] = []

    if args.dry_run:
        manifest = json.loads((ROOT / "fixtures" / "manifest.json").read_text(encoding="utf-8"))
        mismatches = []
        for m in manifest:
            text = (ROOT / "fixtures" / m["file"]).read_text(encoding="utf-8")
            category, stderr, _ = judge(validate_bin, text)
            row = {
                "id": m["file"], "condition": "-", "task_mode": "fixture",
                "used_mode": "fixture", "category": category, "usage": {},
            }
            ok = category == m["expected"]
            hyd_ok = True
            if gate and category == "pass":
                row["hydrate"] = gate.check(text)
                exp = m.get("expected_hydrate")
                hyd_ok = exp is None or row["hydrate"]["get"] == exp
            if not (ok and hyd_ok):
                mismatches.append((m["file"], m["expected"], category, row.get("hydrate")))
            print(f"{'PASS' if ok and hyd_ok else 'FAIL'} {m['file']}: {category}"
                  + (f" hydrate={row.get('hydrate')}" if row.get("hydrate") else ""))
            save_raw(outdir, m["file"], {"fixture": m, "category": category, "stderr": stderr, "hydrate": row.get("hydrate")})
            rows.append(row)
        write_report(outdir, args, rows, dry=True)
        if mismatches:
            print(f"\ndry-run 不一致 {len(mismatches)} 件: {mismatches}")
            return 1
        print(f"\ndry-run 全 {len(manifest)} 件一致。レポート: {outdir / 'report.md'}")
        return 0

    # ── 実測 ──
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY が未設定です(--dry-run はキー無しで実行できます)")
        return 2
    import anthropic

    client = anthropic.Anthropic()
    schema = load_schema()
    tasks = json.loads((ROOT / "tasks.json").read_text(encoding="utf-8"))["tasks"]
    if args.n:
        tasks = tasks[: args.n]
    conditions = ["A", "B"] if args.condition == "AB" else [args.condition]
    print(f"実測: {len(tasks)}タスク × 条件{conditions} = API {len(tasks) * len(conditions)} 回 / model={args.model}")

    for cond in conditions:
        for i, task in enumerate(tasks, 1):
            print(f"[{cond} {i}/{len(tasks)}] {task['id']} … ", end="", flush=True)
            gen = generate(client, args, schema, task, cond)
            rid = f"{cond}-{task['id']}"
            if gen["text"] is None:
                row = {"id": task["id"], "condition": cond, "task_mode": task["mode"],
                       "used_mode": None, "category": "L0:generation_error", "usage": gen["usage"]}
                print(f"生成エラー: {gen['error']}")
            else:
                category, stderr, extracted = judge(validate_bin, gen["text"])
                row = {"id": task["id"], "condition": cond, "task_mode": task["mode"],
                       "used_mode": gen["used_mode"], "category": category, "usage": gen["usage"]}
                if gate and category == "pass":
                    js, _ = extract_json(gen["text"])
                    row["hydrate"] = gate.check(js)
                print(row["category"] + (f"(mode={gen['used_mode']})" if gen["used_mode"] != "structured" else ""))
                save_raw(outdir, rid, {"task": task, "condition": cond, **gen,
                                       "category": category, "stderr": stderr,
                                       "extracted": extracted, "hydrate": row.get("hydrate")})
            rows.append(row)

    report = write_report(outdir, args, rows, dry=False)
    print("\n" + report.split("## 明細")[0])
    print(f"レポート: {outdir / 'report.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
