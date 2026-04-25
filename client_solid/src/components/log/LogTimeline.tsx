// LogTimeline.tsx — 日付グルーピング型の飼育ログタイムライン
// 飼育ログ画面 / 個体カルテのログタブの両方で使う共通コンポーネント
import { For, Show } from "solid-js";
import type { LogEntry } from "../../api";
import { LogTypeTag } from "../specimen/LogTypeTag";

interface LogTimelineProps {
  logs: LogEntry[];
  /** 個体IDを既に特定している場合は非表示にする */
  hideSpecimen?: boolean;
  /** 空状態のメッセージ */
  emptyMessage?: string;
}

export interface Group {
  date: string;
  items: LogEntry[];
  /** P3-23: 前のグループ (日付降順で一つ新しい) と月が変わる境界か */
  isMonthBoundary: boolean;
  /** P3-23: 0=日, 6=土。土日なら背景を薄く色付け */
  dow: number;
  /** 月見出しに表示する "2026-04" ラベル */
  yearMonth: string;
}

const MONTH_LABELS_JA = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
const DOW_LABELS_JA = ["日", "月", "火", "水", "木", "金", "土"];

const parseISO = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

export const groupByDate = (logs: LogEntry[]): Group[] => {
  const byDate: Record<string, LogEntry[]> = {};
  logs.forEach((l) => {
    byDate[l.date] = byDate[l.date] || [];
    byDate[l.date].push(l);
  });
  const sortedDates = Object.keys(byDate).sort().reverse();
  // P3-23: 月区切り検出 — 新しい順に走査し、前日 (= i-1) と月が変わるタイミングで境界。
  // 最初 (最新) の要素は常に境界とみなし、月見出しを先頭に必ず 1 本描く。
  return sortedDates.map((d, i) => {
    const date = parseISO(d);
    const prev = i > 0 ? parseISO(sortedDates[i - 1]) : null;
    const isMonthBoundary =
      prev === null ||
      prev.getFullYear() !== date.getFullYear() ||
      prev.getMonth() !== date.getMonth();
    return {
      date: d,
      items: byDate[d],
      isMonthBoundary,
      dow: date.getDay(),
      yearMonth: `${date.getFullYear()}年 ${MONTH_LABELS_JA[date.getMonth()]}`,
    };
  });
};

export const LogTimeline = (p: LogTimelineProps) => {
  const groups = () => groupByDate(p.logs);

  return (
    <Show
      when={p.logs.length > 0}
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
          {p.emptyMessage ?? "まだ記録がありません"}
        </div>
      }
    >
      <For each={groups()}>
        {(g) => (
          <>
            {/* P3-23: 月区切り — 新しい月に入るところに月見出しを挿入 */}
            <Show when={g.isMonthBoundary}>
              <div class="tl-month" aria-label={`月区切り: ${g.yearMonth}`}>
                <span class="tl-month-label mono">{g.yearMonth}</span>
              </div>
            </Show>
            <div
              class="tl-day"
              classList={{ "is-weekend": g.dow === 0 || g.dow === 6 }}
              data-dow={g.dow}
            >
              <div class="day-head">
                <span class="day">{g.date.slice(5).replace("-", "/")}</span>
                <span class="date-mono">
                  {g.date}
                  <span class="tl-dow" aria-hidden="true">
                    {" · "}{DOW_LABELS_JA[g.dow]}
                  </span>
                </span>
                <span class="count">{g.items.length} 件</span>
              </div>
            <For each={g.items}>
              {(l) => (
                <div class="tl-row">
                  <span class="time">{l.time}</span>
                  <span class="chip-col">
                    <LogTypeTag type={l.type} />
                  </span>
                  <div class="body">
                    <div style={{ "font-weight": 500 }}>{l.title}</div>
                    <div class="sub">
                      {l.body}
                      <Show when={!p.hideSpecimen}>
                        <> · </>
                        <span class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                          {l.specimen}
                        </span>
                      </Show>
                    </div>
                  </div>
                  <Show
                    when={l.photo}
                    fallback={<div class="thumb" aria-hidden="true" style={{ background: "transparent", border: 0 }} />}
                  >
                    <div class="thumb ph" aria-label="添付写真">
                      <span class="mono" style={{ "font-size": "9px" }}>写真</span>
                    </div>
                  </Show>
                </div>
              )}
            </For>
            </div>
          </>
        )}
      </For>
    </Show>
  );
};
