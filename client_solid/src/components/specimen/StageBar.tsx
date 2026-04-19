// StageBar.tsx — 卵 → 成虫 のライフサイクル進捗バー
// horizontal (default) は時系列バー、vertical は縦リスト形式。
import { For, Show } from "solid-js";

const STAGES = ["卵", "幼虫1齢", "幼虫2齢", "幼虫3齢", "前蛹", "蛹", "成虫"];

const stageIdx = (stage: string): number => {
  if (stage.includes("卵")) return 0;
  if (stage.includes("1齢")) return 1;
  if (stage.includes("2齢")) return 2;
  if (stage.includes("3齢")) return 3;
  if (stage.includes("前蛹")) return 4;
  if (stage.includes("蛹")) return 5;
  if (stage.includes("成虫")) return 6;
  return 0;
};

export const StageBar = (p: { stage: string; progress: number; eta: number | null; vertical?: boolean }) => {
  const currentIdx = () => stageIdx(p.stage);

  return (
    <Show
      when={!p.vertical}
      fallback={
        <div style={{ display: "flex", "flex-direction": "column", gap: 0 }}>
          <For each={STAGES}>
            {(st, i) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "10px",
                  padding: "8px 0",
                  opacity: i() <= currentIdx() ? 1 : 0.4,
                }}
              >
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    "border-radius": "50%",
                    background:
                      i() < currentIdx()
                        ? "var(--accent-forest)"
                        : i() === currentIdx()
                          ? "var(--accent-amber)"
                          : "var(--line-strong)",
                  }}
                />
                <span class="mono" style={{ "font-size": "12px" }}>
                  {st}
                </span>
                <Show when={i() === currentIdx()}>
                  <span class="chip amber" style={{ "margin-left": "auto" }}>
                    現在
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
      }
    >
      <div>
        <div style={{ display: "flex", gap: "4px", "margin-bottom": "8px" }}>
          <For each={STAGES}>
            {(_, i) => (
              <div
                style={{
                  flex: 1,
                  height: "6px",
                  "border-radius": "2px",
                  background:
                    i() < currentIdx()
                      ? "var(--accent-forest)"
                      : i() === currentIdx()
                        ? "var(--accent-amber)"
                        : "var(--line-strong)",
                }}
              />
            )}
          </For>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <For each={STAGES}>
            {(st, i) => (
              <div style={{ flex: 1, "text-align": "center" }}>
                <div
                  class="mono"
                  style={{
                    "font-size": "10px",
                    color: i() <= currentIdx() ? "var(--ink)" : "var(--ink-faint)",
                    "font-weight": i() === currentIdx() ? 600 : 400,
                  }}
                >
                  {st}
                </div>
              </div>
            )}
          </For>
        </div>
        <Show when={p.eta !== null && p.eta !== undefined}>
          <div
            style={{
              "margin-top": "12px",
              padding: "8px 12px",
              background: "var(--accent-amber-soft)",
              "border-radius": "var(--r-md)",
              "font-size": "12px",
              color: "oklch(0.4 0.1 70)",
            }}
          >
            <span class="mono" style={{ "font-size": "11px", "margin-right": "6px" }}>
              T-{p.eta}d
            </span>
            羽化予測日: 次のステージへ進行中
          </div>
        </Show>
      </div>
    </Show>
  );
};
