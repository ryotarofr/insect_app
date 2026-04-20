// log/types.ts — 飼育ログ種別のメタデータ
// 利用頻度順に並び替え: 体重 → 給餌 → 観察 → 脱皮 → マット
import type { LogType } from "../../api";

export interface LogTypeMeta {
  key: LogType;
  label: string;
  hint: string;
  /** 入力フィールドのラベル (種別ごとに変わる) */
  inputLabel: string;
  icon: string;
  /** タイムラインchipのトーン */
  tone: "indigo" | "amber" | "forest" | "rose" | "";
}

export const LOG_TYPES: LogTypeMeta[] = [
  { key: "weight", label: "体重", hint: "グラム", inputLabel: "体重 (g)", icon: "⚖", tone: "indigo" },
  { key: "feed", label: "給餌", hint: "エサ種別・量", inputLabel: "エサ・量", icon: "🍯", tone: "amber" },
  { key: "observation", label: "観察", hint: "自由記述", inputLabel: "観察メモ", icon: "👁", tone: "" },
  { key: "molt", label: "脱皮", hint: "頭幅・齢", inputLabel: "頭幅 / 齢", icon: "✂", tone: "rose" },
  { key: "mat", label: "マット", hint: "種類・容量", inputLabel: "マット種別", icon: "⛰", tone: "forest" },
];

export const LOG_TYPE_META: Record<LogType, LogTypeMeta> = Object.fromEntries(
  LOG_TYPES.map((t) => [t.key, t]),
) as Record<LogType, LogTypeMeta>;

/** 記録タイトルを生成 (addLog の title 用) */
export const buildLogTitle = (t: LogType, v: string): string => {
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
