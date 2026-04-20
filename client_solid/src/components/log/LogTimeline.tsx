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

interface Group {
  date: string;
  items: LogEntry[];
}

const groupByDate = (logs: LogEntry[]): Group[] => {
  const byDate: Record<string, LogEntry[]> = {};
  logs.forEach((l) => {
    byDate[l.date] = byDate[l.date] || [];
    byDate[l.date].push(l);
  });
  return Object.keys(byDate)
    .sort()
    .reverse()
    .map((d) => ({ date: d, items: byDate[d] }));
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
          <div class="tl-day">
            <div class="day-head">
              <span class="day">{g.date.slice(5).replace("-", "/")}</span>
              <span class="date-mono">{g.date}</span>
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
                      <span class="mono" style={{ "font-size": "9px" }}>IMG</span>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </Show>
  );
};
