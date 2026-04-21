// LogList.tsx — 個体カルテ内の直近ログ一覧 (compact で詳細を省略)
import { For, Show } from "solid-js";
import type { LogEntry } from "../../api";
import { LogTypeTag } from "./LogTypeTag";

export const LogList = (p: { logs: LogEntry[]; compact?: boolean }) => (
  <div>
    <For each={p.logs}>
      {(l) => (
        <div
          style={{
            display: "grid",
            "grid-template-columns": "80px 1fr auto",
            gap: "12px",
            padding: "12px 0",
            "border-bottom": "1px solid var(--line)",
            "align-items": "start",
          }}
        >
          <div>
            <div class="mono" style={{ "font-size": "11px", color: "var(--ink)" }}>
              {l.date.slice(5)}
            </div>
            <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
              {l.time}
            </div>
          </div>
          <div>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <LogTypeTag type={l.type} />
              <span style={{ "font-weight": 500 }}>{l.title}</span>
            </div>
            <Show when={!p.compact}>
              <div style={{ "font-size": "12px", color: "var(--ink-mute)", "margin-top": "4px" }}>
                {l.body}
              </div>
            </Show>
          </div>
          <Show when={l.photo}>
            <div class="ph" style={{ width: "60px", height: "60px" }}>
              <span class="mono" style={{ "font-size": "9px" }}>
                写真
              </span>
            </div>
          </Show>
        </div>
      )}
    </For>
  </div>
);
