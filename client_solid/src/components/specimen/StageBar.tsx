// StageBar.tsx — 卵 → 成虫 のライフサイクル進捗バー
//
// 改善: 「現在どの段階か」を一目で分かるように再設計
//  - 旧: 細い7セグメントバー + 下にラベル (現在地が色だけで表現されていた)
//  - 新: 現在ステージをスポットライトカードで大きく見せ、
//        その下に 7 段階のミニタイムラインを配置。
//        現在ステージは ▼ ポインタ + 塗りドット + 進捗リング で強調する。
//
// vertical=true は個体カルテの旧レイアウト向け縦リスト (テスト互換のため維持)。
import { For, Show } from "solid-js";

const STAGES = ["卵", "幼虫1齢", "幼虫2齢", "幼虫3齢", "前蛹", "蛹", "成虫"];

/** 各段階を 1 文字絵文字アイコンで表す */
const STAGE_ICONS = ["🥚", "🐛", "🐛", "🐛", "🛋", "🛋", "🦋"];

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

export const StageBar = (p: {
  stage: string;
  /** 0-100 の進捗。現状は目測ベースのため UI には表示しない (API 互換維持)。 */
  progress?: number;
  eta: number | null;
  vertical?: boolean;
}) => {
  const currentIdx = () => stageIdx(p.stage);
  const currentStage = () => STAGES[currentIdx()];
  const nextStage = () => STAGES[currentIdx() + 1] ?? null;
  const currentIcon = () => STAGE_ICONS[currentIdx()];

  // ポインタ / 塗り切り位置 = 現ステージの中心
  // (進捗は目測なので「だいたい今このへん」に揃え、精度の錯覚を避ける)
  const segCenter = () => {
    const segW = 100 / STAGES.length;
    return segW * currentIdx() + segW / 2;
  };

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
      <div class="stage-wrap">
        {/* Spotlight: 現在どのステージかを大きく提示 */}
        <div class="stage-spot" role="group" aria-label="現在のライフサイクル">
          <div class="stage-spot-ico" aria-hidden="true">
            {currentIcon()}
          </div>
          <div class="stage-spot-body">
            <div class="stage-spot-row">
              <span class="stage-spot-eyebrow mono">現在 · {currentIdx() + 1} / {STAGES.length}</span>
              <Show when={p.eta !== null && p.eta !== undefined}>
                <span class="stage-spot-eta mono">あと {p.eta} 日</span>
              </Show>
            </div>
            <div class="stage-spot-name serif">{currentStage()}</div>
            <div class="stage-spot-meta">
              <Show
                when={nextStage()}
                fallback={<span style={{ color: "var(--ink-mute)" }}>最終段階</span>}
              >
                <span>
                  次: <b>{nextStage()}</b>
                </span>
                <Show when={p.eta !== null && p.eta !== undefined}>
                  <span style={{ color: "var(--ink-mute)" }}>· あと {p.eta} 日</span>
                </Show>
              </Show>
            </div>
          </div>
        </div>

        {/* 7 段階ミニタイムライン */}
        <div class="stage-track" aria-hidden="true">
          <div class="stage-track-line" />
          <div class="stage-track-fill" style={{ width: `${segCenter()}%` }} />
          <div class="stage-track-marker" style={{ left: `${segCenter()}%` }}>
            <span class="stage-track-caret">▼</span>
          </div>
          <div class="stage-track-steps">
            <For each={STAGES}>
              {(st, i) => {
                const state = () =>
                  i() < currentIdx()
                    ? "past"
                    : i() === currentIdx()
                      ? "now"
                      : "future";
                return (
                  <div class={`stage-step is-${state()}`}>
                    <span class="dot">
                      <Show when={state() === "past"}>
                        <span class="check">✓</span>
                      </Show>
                    </span>
                    <span class="lbl">{st}</span>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
};
