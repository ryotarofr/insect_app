// EclosionForecast.tsx — Block.type === "eclosion_forecast" のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.10 (EclosionForecast)
//
// **構造**:
//   - days_ahead: 羽化までの日数 (正なら未来 / 0 で本日 / 負はオーバラン)
//   - date      : 予測日 (NaiveDate, ts-rs 上は string)
//   - tolerance : 誤差日数 (±tolerance)
//
// MVP 表示: 「羽化まで 15 日 (±5)  · 2026-05-04」のような 1 行。
// 緊急度に応じて軽く色分け:
//   - 7 日以内 → rose
//   - 30 日以内 → amber-ink
//   - それ以外  → ink-mute

import type { Block } from "../branded";

type EclosionBlock = Extract<Block, { type: "eclosion_forecast" }>;

const tone = (days: number): string => {
  if (days <= 7) return "var(--accent-rose)";
  if (days <= 30) return "var(--accent-amber-ink)";
  return "var(--ink-mute)";
};

const formatDays = (days: number): string => {
  if (days < 0) return `${Math.abs(days)} 日 超過`;
  if (days === 0) return "本日";
  return `${days} 日`;
};

export const EclosionForecastBlockView = (props: { block: EclosionBlock }) => {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "baseline",
        gap: "8px",
        "font-size": "12px",
        color: tone(props.block.daysAhead),
      }}
    >
      <span style={{ "font-weight": 500 }}>羽化まで {formatDays(props.block.daysAhead)}</span>
      <span style={{ color: "var(--ink-faint)" }}>(±{props.block.tolerance})</span>
      <span class="mono" style={{ color: "var(--ink-faint)", "margin-left": "auto" }}>
        {props.block.date}
      </span>
    </div>
  );
};
