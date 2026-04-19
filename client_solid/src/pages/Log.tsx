// Log.tsx — 飼育ログ入力 + タイムライン
import { createMemo, createSignal, For, Show } from "solid-js";
import {
  addLog,
  listLogs,
  listLogsByType,
  listSpecimens,
  type LogEntry,
  type LogType,
} from "../api";
import { Icons } from "../components/Icons";

interface TypeMeta {
  key: LogType;
  label: string;
  hint: string;
  icon: string;
}

const TYPES: TypeMeta[] = [
  { key: "weight", label: "体重計測", hint: "グラム数値を入力", icon: "⚖" },
  { key: "feed", label: "給餌", hint: "エサ種別・量", icon: "🍯" },
  { key: "mat", label: "マット交換", hint: "種類・容量", icon: "⛰" },
  { key: "molt", label: "脱皮", hint: "頭幅・齢", icon: "✂" },
  { key: "observation", label: "観察", hint: "自由記述", icon: "👁" },
];

interface FilterDef {
  label: string;
  /** null は「全て」 */
  type: LogType | null;
}

const FILTERS: FilterDef[] = [
  { label: "全て", type: null },
  { label: "体重", type: "weight" },
  { label: "給餌", type: "feed" },
  { label: "マット", type: "mat" },
  { label: "脱皮", type: "molt" },
  { label: "観察", type: "observation" },
];

const LOG_TAG_TONES: Record<LogType, string> = {
  weight: "indigo",
  feed: "amber",
  mat: "forest",
  molt: "rose",
  observation: "",
};

const LOG_TAG_LABELS: Record<LogType, string> = {
  weight: "体重",
  feed: "給餌",
  mat: "マット",
  molt: "脱皮",
  observation: "観察",
};

const LogTypeTag = (props: { type: LogType }) => (
  <span class={`chip ${LOG_TAG_TONES[props.type]}`} style={{ "font-size": "10px" }}>
    {LOG_TAG_LABELS[props.type]}
  </span>
);

const TimelineGrouped = (props: { logs: LogEntry[] }) => {
  const grouped = () => {
    const byDate: Record<string, LogEntry[]> = {};
    props.logs.forEach((l) => {
      byDate[l.date] = byDate[l.date] || [];
      byDate[l.date].push(l);
    });
    const dates = Object.keys(byDate).sort().reverse();
    return dates.map((d) => ({ date: d, items: byDate[d] }));
  };

  return (
    <div>
      <For each={grouped()}>
        {(group) => (
          <div style={{ "margin-bottom": "28px" }}>
            <div
              style={{
                display: "flex",
                "align-items": "baseline",
                gap: "12px",
                "margin-bottom": "10px",
                "padding-bottom": "6px",
                "border-bottom": "1px solid var(--line)",
              }}
            >
              <span class="serif" style={{ "font-size": "20px", "font-weight": 600 }}>
                {group.date.slice(5).replace("-", "/")}
              </span>
              <span class="mono" style={{ "font-size": "11px", color: "var(--ink-faint)" }}>
                {group.date}
              </span>
              <span style={{ "margin-left": "auto", "font-size": "12px", color: "var(--ink-mute)" }}>
                {group.items.length} 件
              </span>
            </div>
            <For each={group.items}>
              {(l) => (
                <div
                  style={{
                    display: "grid",
                    "grid-template-columns": "60px 90px 1fr auto",
                    gap: "14px",
                    padding: "12px 8px",
                    "border-bottom": "1px solid var(--line)",
                    "align-items": "center",
                    transition: "background 0.1s ease",
                  }}
                >
                  <span class="mono" style={{ "font-size": "11px", color: "var(--ink-faint)" }}>
                    {l.time}
                  </span>
                  <LogTypeTag type={l.type} />
                  <div>
                    <div style={{ "font-weight": 500 }}>{l.title}</div>
                    <div style={{ "font-size": "12px", color: "var(--ink-mute)", "margin-top": "2px" }}>
                      {l.body} ·{" "}
                      <span class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                        {l.specimen}
                      </span>
                    </div>
                  </div>
                  <Show
                    when={l.photo}
                    fallback={<div style={{ width: "54px" }} />}
                  >
                    <div class="ph" style={{ width: "54px", height: "54px" }}>
                      <span class="mono" style={{ "font-size": "9px" }}>IMG</span>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
};

export const LogPage = () => {
  const [type, setType] = createSignal<LogType>("weight");
  const [target, setTarget] = createSignal(listSpecimens()[0].id);
  const [filter, setFilter] = createSignal<LogType | null>(null);
  const [value, setValue] = createSignal("28.4");
  const [saveMsg, setSaveMsg] = createSignal<string | null>(null);
  const logs = createMemo(() => {
    const t = filter();
    return t === null ? listLogs() : listLogsByType(t);
  });

  const inputLabel = () => {
    switch (type()) {
      case "weight":
        return "体重 (g)";
      case "feed":
        return "エサ・量";
      case "mat":
        return "マット種別";
      case "molt":
        return "頭幅 / 齢";
      default:
        return "観察メモ";
    }
  };

  const titleFor = (t: LogType, v: string): string => {
    const trimmed = v.trim();
    switch (t) {
      case "weight":
        return trimmed ? `体重 ${trimmed}g` : "体重計測";
      case "feed":
        return "給餌";
      case "mat":
        return "マット交換";
      case "molt":
        return "脱皮";
      case "observation":
        return "観察";
    }
  };

  const submit = (e: Event) => {
    e.preventDefault();
    const t = type();
    const v = value().trim();
    if (!v) {
      setSaveMsg("内容を入力してください");
      return;
    }
    addLog({
      type: t,
      title: titleFor(t, v),
      body: v,
      specimen: target(),
    });
    setValue(t === "weight" ? "28.4" : "");
    setSaveMsg("記録を追加しました");
    window.setTimeout(() => setSaveMsg(null), 2400);
  };

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">HUSBANDRY LOG</div>
          <h1>飼育ログ</h1>
        </div>
        <div class="page-actions">
          <button class="btn">{Icons.camera()} カメラ起動</button>
        </div>
      </div>

      <div style={{ display: "grid", "grid-template-columns": "360px 1fr", gap: "32px", "align-items": "start" }}>
        <form
          class="card"
          style={{ padding: "20px", position: "sticky", top: "72px" }}
          onSubmit={submit}
          aria-label="ログ追加フォーム"
        >
          <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}>
            NEW ENTRY
          </div>
          <div class="serif" style={{ "font-size": "20px", "font-weight": 600, "margin-bottom": "16px" }}>
            記録を追加
          </div>

          <label class="label" for="log-target">対象個体</label>
          <select
            id="log-target"
            class="select"
            value={target()}
            onChange={(e) => setTarget(e.currentTarget.value)}
          >
            <For each={listSpecimens()}>
              {(s) => (
                <option value={s.id}>
                  {s.id} · {s.name}
                </option>
              )}
            </For>
          </select>

          <label class="label" style={{ "margin-top": "16px" }}>
            エントリ種別
          </label>
          <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "6px" }}>
            <For each={TYPES}>
              {(t) => (
                <button
                  type="button"
                  onClick={() => {
                    setType(t.key);
                    setValue(t.key === "weight" ? "28.4" : "");
                  }}
                  class="btn sm"
                  aria-pressed={type() === t.key}
                  style={{
                    padding: "10px 12px",
                    "justify-content": "flex-start",
                    background: type() === t.key ? "var(--bg-inverse)" : "var(--bg-raised)",
                    color: type() === t.key ? "var(--ink-inverse)" : "var(--ink)",
                    "border-color": type() === t.key ? "var(--ink)" : "var(--line)",
                  }}
                >
                  <span style={{ "margin-right": "6px" }}>{t.icon}</span> {t.label}
                </button>
              )}
            </For>
          </div>

          <label class="label" for="log-value" style={{ "margin-top": "16px" }}>
            {inputLabel()}
          </label>
          <Show
            when={type() === "weight"}
            fallback={
              <textarea
                id="log-value"
                class="textarea"
                placeholder={TYPES.find((t) => t.key === type())?.hint ?? ""}
                value={value()}
                onInput={(e) => setValue(e.currentTarget.value)}
              />
            }
          >
            <input
              id="log-value"
              class="input mono"
              type="number"
              step="0.1"
              placeholder="28.4"
              value={value()}
              onInput={(e) => setValue(e.currentTarget.value)}
            />
          </Show>

          <label class="label" style={{ "margin-top": "16px" }}>
            写真（最大4枚）
          </label>
          <div style={{ display: "grid", "grid-template-columns": "repeat(4, 1fr)", gap: "6px" }}>
            <div class="ph" style={{ height: "64px", cursor: "pointer", "border-style": "dashed" }}>
              <span class="mono" style={{ "font-size": "11px" }}>+</span>
            </div>
            <For each={[0, 1, 2]}>
              {() => <div class="ph" style={{ height: "64px", opacity: 0.4 }} />}
            </For>
          </div>

          <Show when={saveMsg()}>
            <div
              role="status"
              aria-live="polite"
              style={{
                "margin-top": "14px",
                padding: "8px 10px",
                "border-radius": "var(--r-md)",
                background: "var(--accent-forest-soft)",
                color: "var(--accent-forest)",
                "font-size": "12px",
              }}
            >
              ✓ {saveMsg()}
            </div>
          </Show>

          <div style={{ display: "flex", gap: "8px", "margin-top": "20px" }}>
            <button type="button" class="btn ghost" style={{ flex: 1 }} disabled>
              下書き
            </button>
            <button type="submit" class="btn primary" style={{ flex: 2 }}>
              記録する
            </button>
          </div>
        </form>

        <div>
          <div style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "16px" }}>
            <div class="mono" style={{ "font-size": "11px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}>
              TIMELINE
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <For each={FILTERS}>
                {(f) => {
                  const isActive = () => filter() === f.type;
                  return (
                    <button
                      class={`chip ${isActive() ? "ink" : ""}`}
                      style={{ cursor: "pointer", padding: "3px 8px" }}
                      aria-pressed={isActive()}
                      onClick={() => setFilter(f.type)}
                    >
                      {f.label}
                    </button>
                  );
                }}
              </For>
            </div>
            <span style={{ "margin-left": "auto", "font-size": "12px", color: "var(--ink-mute)" }}>
              {logs().length} 件
            </span>
          </div>

          <Show
            when={logs().length > 0}
            fallback={
              <div
                class="card"
                style={{
                  padding: "40px 24px",
                  "text-align": "center",
                  color: "var(--ink-mute)",
                  "font-size": "13px",
                }}
              >
                このフィルタに一致するログはありません。
              </div>
            }
          >
            <TimelineGrouped logs={logs()} />
          </Show>
        </div>
      </div>
    </>
  );
};
