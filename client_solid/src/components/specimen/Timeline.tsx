// Timeline.tsx — 縦型の飼育タイムライン (Variant V4 で使用)
import { For, Show, type JSX } from "solid-js";
import type { LogEntry } from "../../api";
import { LogTypeTag } from "./LogTypeTag";

export const Timeline = (p: { logs: LogEntry[] }): JSX.Element => (
  <div style={{ position: "relative", "padding-left": "28px" }}>
    <div
      style={{
        position: "absolute",
        left: "7px",
        top: "8px",
        bottom: "8px",
        width: "2px",
        background: "var(--line-strong)",
      }}
    />
    <For each={p.logs}>
      {(l) => (
        <div style={{ position: "relative", "padding-bottom": "24px" }}>
          <div
            style={{
              position: "absolute",
              left: "-26px",
              top: "6px",
              width: "12px",
              height: "12px",
              "border-radius": "50%",
              background: "var(--bg-raised)",
              border: "2px solid var(--ink)",
            }}
          />
          <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)", "margin-bottom": "4px" }}>
            {l.date} {l.time}
          </div>
          <div class="card" style={{ padding: "14px" }}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "4px" }}>
              <LogTypeTag type={l.type} />
              <span style={{ "font-weight": 500 }}>{l.title}</span>
            </div>
            <div style={{ "font-size": "13px", color: "var(--ink-mute)" }}>{l.body}</div>
            <Show when={l.photo}>
              <div class="ph" style={{ height: "80px", "margin-top": "10px" }}>
                <span class="mono" style={{ "font-size": "10px" }}>
                  観察写真
                </span>
              </div>
            </Show>
          </div>
        </div>
      )}
    </For>
  </div>
);
