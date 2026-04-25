// Log.tsx — 飼育ログ (Quick Log バー + 1カラムタイムライン)
//
// 改善案: docs/ux-proposal-mockup.html に準拠
// - 旧: 左360px固定フォーム + 右タイムラインの2カラム
// - 新: 上部に折り畳み可能な Quick Log バー + 1カラムタイムライン
//        フィルタは種別 / 個体 / 期間 の3軸セグメント
import { createMemo, createSignal, For, Show } from "solid-js";
import {
  addLog,
  listLogs,
  listSpecimens,
  type LogEntry,
  type LogType,
} from "../api";
import { Icons } from "../components/Icons";
import { LOG_TYPES, buildLogTitle } from "../components/log/types";
import { LogTimeline } from "../components/log/LogTimeline";

type PeriodKey = "7" | "30" | "90" | "all";
const PERIODS: Array<{ key: PeriodKey; label: string; days: number | null }> = [
  { key: "7", label: "7日", days: 7 },
  { key: "30", label: "30日", days: 30 },
  { key: "90", label: "90日", days: 90 },
  { key: "all", label: "全期間", days: null },
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const weekdayJP = () => {
  const d = new Date();
  return "日月火水木金土"[d.getDay()];
};
const nowHM = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** 文字列 "2026-04-20" を epoch (day基準で比較可) に */
const dateToEpoch = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
};

const QuickLogBar = (p: {
  target: string;
  setTarget: (id: string) => void;
  onSaved: (msg: string) => void;
}) => {
  const specimens = listSpecimens();
  const [type, setType] = createSignal<LogType>("weight");
  // 初期値は空にし、プレースホルダ "28.4" のみを見せる。送信誤りを避ける。
  const [value, setValue] = createSignal("");
  const [memo, setMemo] = createSignal("");
  const [collapsed, setCollapsed] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const selectType = (t: LogType) => {
    setType(t);
    setValue("");
    setError(null);
  };

  const currentMeta = () => LOG_TYPES.find((t) => t.key === type())!;

  const submit = (e: Event) => {
    e.preventDefault();
    const t = type();
    const v = value().trim();
    if (!v) {
      setError("内容を入力してください");
      return;
    }
    addLog({
      type: t,
      title: buildLogTitle(t, v),
      body: memo().trim() || v,
      specimen: p.target,
    });
    setValue("");
    setMemo("");
    p.onSaved("記録を追加しました");
  };

  const targetSpec = () => specimens.find((s) => s.id === p.target);

  return (
    <form class="quick-bar" onSubmit={submit} aria-label="ログ追加">
      <div class="qb-top">
        <span class="u-eyebrow">
          新規記録
        </span>
        <span class="qb-target">
          <span style={{ color: "var(--ink-faint)" }}>対象:</span>
          <select
            class="select"
            style={{
              border: 0,
              padding: "2px 4px",
              background: "transparent",
              "font-weight": 600,
              "font-size": "12px",
              width: "auto",
            }}
            value={p.target}
            onChange={(e) => p.setTarget(e.currentTarget.value)}
            aria-label="対象個体"
          >
            <For each={specimens}>
              {(s) => (
                <option value={s.id}>
                  {s.id} · {s.name}
                </option>
              )}
            </For>
          </select>
        </span>
        <div class="qb-spacer" />
        <span class="qb-date">
          {todayISO()} · {weekdayJP()} · {nowHM()}
        </span>
        <button
          type="button"
          class="btn ghost sm"
          aria-expanded={!collapsed()}
          aria-label={collapsed() ? "フォームを展開" : "フォームを折り畳む"}
          onClick={() => setCollapsed(!collapsed())}
          style={{ padding: "4px 8px" }}
        >
          {collapsed() ? "＋ 記録を追加 ▾" : "折り畳む ▴"}
        </button>
      </div>

      <Show when={!collapsed()}>
        <div class="type-picker" role="tablist">
          <For each={LOG_TYPES}>
            {(t) => (
              <button
                type="button"
                class="tp"
                aria-pressed={type() === t.key}
                onClick={() => selectType(t.key)}
              >
                <span class="ico">{t.icon}</span>
                {t.label}
              </button>
            )}
          </For>
        </div>

        <div class="qb-input">
          <div class="field">
            <label class="label" for="qb-value">
              {currentMeta().inputLabel}
              <Show when={type() === "weight"}>
                <small>小数点1桁まで</small>
              </Show>
            </label>
            <Show
              when={type() === "weight"}
              fallback={
                <input
                  id="qb-value"
                  class="input"
                  placeholder={currentMeta().hint}
                  value={value()}
                  onInput={(e) => setValue(e.currentTarget.value)}
                />
              }
            >
              <input
                id="qb-value"
                class="input mono"
                type="number"
                step="0.1"
                placeholder="28.4"
                value={value()}
                onInput={(e) => setValue(e.currentTarget.value)}
              />
            </Show>
          </div>
          <div class="field">
            <span class="label">写真</span>
            <button type="button" class="btn" style={{ padding: "8px 14px" }}>
              {Icons.camera()} 撮影 / 添付
            </button>
          </div>
          <div class="field">
            <button type="submit" class="btn primary lg">
              {Icons.plus()} 記録する
            </button>
          </div>
        </div>

        <Show when={type() === "weight"}>
          <div style={{ "margin-top": "10px" }}>
            <input
              class="input"
              placeholder="メモ (任意) ・気付きを一言"
              value={memo()}
              onInput={(e) => setMemo(e.currentTarget.value)}
              aria-label="メモ"
            />
          </div>
        </Show>

        <Show when={error()}>
          <div
            role="alert"
            style={{
              "margin-top": "10px",
              padding: "8px 10px",
              "font-size": "12px",
              color: "var(--accent-rose)",
              background: "var(--accent-rose-soft)",
              "border-radius": "var(--r-md)",
            }}
          >
            {error()}
          </div>
        </Show>

        <Show when={p.target && targetSpec()}>
          <div
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--ink-faint)",
              "margin-top": "10px",
            }}
          >
            ↳ {targetSpec()!.id} · {targetSpec()!.name} ({targetSpec()!.species}) に記録されます
          </div>
        </Show>
      </Show>
    </form>
  );
};

export const LogPage = () => {
  const specimens = listSpecimens();
  const [target, setTarget] = createSignal(specimens[0]?.id ?? "");
  const [typeFilter, setTypeFilter] = createSignal<LogType | null>(null);
  const [specimenFilter, setSpecimenFilter] = createSignal<string | "all">("all");
  const [periodFilter, setPeriodFilter] = createSignal<PeriodKey>("30");
  const [saveMsg, setSaveMsg] = createSignal<string | null>(null);

  const onSaved = (msg: string) => {
    setSaveMsg(msg);
    window.setTimeout(() => setSaveMsg(null), 2400);
  };

  // フィルタ後のログ
  const filtered = createMemo<LogEntry[]>(() => {
    const all = listLogs();
    const t = typeFilter();
    const s = specimenFilter();
    const p = PERIODS.find((x) => x.key === periodFilter());
    const cutoff =
      p?.days != null ? Date.now() - p.days * 24 * 60 * 60 * 1000 : null;

    return all.filter((l) => {
      if (t !== null && l.type !== t) return false;
      if (s !== "all" && l.specimen !== s) return false;
      if (cutoff !== null && dateToEpoch(l.date) < cutoff) return false;
      return true;
    });
  });

  // 今週 / 今月のサマリ
  const totals = createMemo(() => {
    const all = listLogs();
    const now = Date.now();
    const week = all.filter(
      (l) => dateToEpoch(l.date) >= now - 7 * 24 * 60 * 60 * 1000,
    ).length;
    const month = all.filter(
      (l) => dateToEpoch(l.date) >= now - 30 * 24 * 60 * 60 * 1000,
    ).length;
    return { week, month };
  });

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">飼育ログ</div>
          <h1>飼育ログ</h1>
        </div>
        <div class="page-actions">
          <span style={{ "font-size": "12px", color: "var(--ink-mute)", "align-self": "center" }}>
            今週 <b>{totals().week}</b>件 · 今月 <b>{totals().month}</b>件
          </span>
        </div>
      </div>

      <QuickLogBar target={target()} setTarget={setTarget} onSaved={onSaved} />

      <Show when={saveMsg()}>
        <div
          role="status"
          aria-live="polite"
          style={{
            "margin-top": "10px",
            padding: "8px 12px",
            "border-radius": "var(--r-md)",
            background: "var(--accent-forest-soft)",
            color: "var(--accent-forest)",
            "font-size": "12px",
            display: "inline-block",
          }}
        >
          ✓ {saveMsg()}
        </div>
      </Show>

      {/* Filters — 3軸 */}
      <div class="filter-row">
        <span class="u-eyebrow">
          タイムライン
        </span>

        <div class="group" aria-label="種別フィルタ">
          <button
            type="button"
            class="f"
            aria-pressed={typeFilter() === null}
            onClick={() => setTypeFilter(null)}
          >
            全て
          </button>
          <For each={LOG_TYPES}>
            {(t) => (
              <button
                type="button"
                class="f"
                aria-pressed={typeFilter() === t.key}
                onClick={() => setTypeFilter(t.key)}
              >
                {t.label}
              </button>
            )}
          </For>
        </div>

        <div class="group" aria-label="個体フィルタ">
          <button
            type="button"
            class="f"
            aria-pressed={specimenFilter() === "all"}
            onClick={() => setSpecimenFilter("all")}
          >
            全個体
          </button>
          <select
            class="f"
            style={{
              border: 0,
              background: "transparent",
              "font-size": "12px",
              padding: "4px 8px",
              color: specimenFilter() === "all" ? "var(--ink-mute)" : "var(--ink)",
            }}
            value={specimenFilter()}
            onChange={(e) => setSpecimenFilter(e.currentTarget.value)}
            aria-label="個体を選択"
          >
            <option value="all">個体で絞る…</option>
            <For each={specimens}>
              {(s) => (
                <option value={s.id}>
                  {s.id} · {s.name}
                </option>
              )}
            </For>
          </select>
        </div>

        <div class="group" aria-label="期間フィルタ">
          <For each={PERIODS}>
            {(pd) => (
              <button
                type="button"
                class="f"
                aria-pressed={periodFilter() === pd.key}
                onClick={() => setPeriodFilter(pd.key)}
              >
                {pd.label}
              </button>
            )}
          </For>
        </div>

        <span class="count">{filtered().length} 件</span>
      </div>

      <LogTimeline
        logs={filtered()}
        emptyMessage="このフィルタに一致するログはありません。"
      />
    </>
  );
};
