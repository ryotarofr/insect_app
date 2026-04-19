// LogTypeTag.tsx — ログ種別タグ (weight / feed / mat / molt / observation)
import type { LogType } from "../../api";

const LOG_TAGS: Record<LogType, { label: string; tone: string }> = {
  weight: { label: "体重", tone: "indigo" },
  feed: { label: "給餌", tone: "amber" },
  mat: { label: "マット", tone: "forest" },
  molt: { label: "脱皮", tone: "rose" },
  observation: { label: "観察", tone: "" },
};

export const LogTypeTag = (p: { type: LogType }) => {
  const m = LOG_TAGS[p.type] ?? { label: p.type, tone: "" };
  return <span class={`chip ${m.tone}`}>{m.label}</span>;
};
