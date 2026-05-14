// icons/stage/index.tsx — カブトムシのライフステージ 7 種アイコン (SVG)
//
// StageBar 用のライフステージ アイコンを専用 SVG で提供する。
// 全アイコンは:
//   - 24x24 viewBox で、大枠はタイトに 2-22 の内寸
//   - stroke: currentColor / fill: currentColor に統一し、CSS で色を乗せる
//   - 線画 + 要所を塗りつぶし (flat monochrome) で飼育書・標本ラベル的な質感
//   - 共通 props で size/class が指定可能
//
// デザインの統一感のために:
//   stroke-width 1.5, stroke-linecap round, stroke-linejoin round,
//   fill-rule evenodd をベースに揃えている。
import type { JSX } from "solid-js";

export type StageKey =
  | "egg"
  | "larva1"
  | "larva2"
  | "larva3"
  | "prepupa"
  | "pupa"
  | "adult";

interface StageIconProps {
  size?: number;
  class?: string;
  "aria-label"?: string;
}

const baseProps = (p: StageIconProps): JSX.SvgSVGAttributes<SVGSVGElement> => ({
  width: p.size ?? 24,
  height: p.size ?? 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.5,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  role: "img",
  "aria-label": p["aria-label"],
  class: p.class,
});

/** 卵 — 縦長楕円 */
export const EggIcon = (p: StageIconProps) => (
  <svg {...baseProps({ ...p, "aria-label": p["aria-label"] ?? "卵" })}>
    <ellipse cx="12" cy="12" rx="5.5" ry="7.5" />
    <path d="M9.5 9.5 Q10.5 8 11.5 9" />
  </svg>
);

/** 幼虫1齢 — 小さな C 字 + 体節 3 */
export const Larva1Icon = (p: StageIconProps) => (
  <svg {...baseProps({ ...p, "aria-label": p["aria-label"] ?? "幼虫1齢" })}>
    <path d="M7 14 Q7 8 12 8 Q17 8 17 13 Q17 16 14 16" />
    <circle cx="15.5" cy="10" r="0.8" fill="currentColor" stroke="none" />
    <path d="M9 13 L11 13 M11.5 14 L13 14" opacity="0.6" />
  </svg>
);

/** 幼虫2齢 — 中型 C 字 + 体節 5 */
export const Larva2Icon = (p: StageIconProps) => (
  <svg {...baseProps({ ...p, "aria-label": p["aria-label"] ?? "幼虫2齢" })}>
    <path d="M5.5 14 Q5.5 7 12 7 Q18.5 7 18.5 13 Q18.5 17 14.5 17 Q12 17 11.5 15" />
    <circle cx="17" cy="9.5" r="0.9" fill="currentColor" stroke="none" />
    <path d="M7.5 11 L9 11 M8.5 13 L10.5 13 M10.5 15 L12 15" opacity="0.55" />
  </svg>
);

/** 幼虫3齢 — 大きく肉厚な C 字 + 体節 7 + 脚 3 */
export const Larva3Icon = (p: StageIconProps) => (
  <svg {...baseProps({ ...p, "aria-label": p["aria-label"] ?? "幼虫3齢" })}>
    <path
      d="M4 14 Q4 5.5 12 5.5 Q20 5.5 20 13 Q20 18.5 14 18.5 Q10 18.5 10 15 Q10 13 12 13"
    />
    <circle cx="18.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
    <path
      d="M6 10 L8 10 M7 12 L9.5 12 M9 14 L11 14 M13.5 10.5 L15.5 10.5 M14 8 L16 8"
      opacity="0.5"
    />
    <path d="M5.5 15 L4.5 17 M7 16.5 L6.2 18.5 M8.5 17.5 L7.8 19.3" opacity="0.7" />
  </svg>
);

/** 前蛹 — 蛹室の空洞 + 軟化した C 字 */
export const PrepupaIcon = (p: StageIconProps) => (
  <svg {...baseProps({ ...p, "aria-label": p["aria-label"] ?? "前蛹" })}>
    {/* 蛹室 (楕円 cell) */}
    <ellipse cx="12" cy="13" rx="8" ry="6.5" stroke-dasharray="2 2" opacity="0.7" />
    {/* 中の軟化幼虫 */}
    <path d="M8 14 Q8 9.5 12 9.5 Q16 9.5 16 13 Q16 15 14 15.2" />
    <circle cx="15.2" cy="11" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

/** 蛹 — 頭角の膨らみ + 体節 */
export const PupaIcon = (p: StageIconProps) => (
  <svg {...baseProps({ ...p, "aria-label": p["aria-label"] ?? "蛹" })}>
    {/* 頭角 (horn) */}
    <path d="M12 3.5 Q10 5.5 12 6.5 Q14 5.5 12 3.5 Z" fill="currentColor" />
    {/* 頭部 */}
    <ellipse cx="12" cy="8.5" rx="3" ry="2.5" />
    {/* 胸部 + 腹部 */}
    <path d="M8.5 11 Q7.5 17.5 12 19.5 Q16.5 17.5 15.5 11 Z" />
    {/* 体節 */}
    <path d="M9 13.5 L15 13.5 M9.2 15.5 L14.8 15.5 M9.5 17 L14.5 17" opacity="0.5" />
  </svg>
);

/** 成虫 — カブトムシ俯瞰シルエット (頭角 + 胸角 + 鞘翅) */
export const AdultIcon = (p: StageIconProps) => (
  <svg {...baseProps({ ...p, "aria-label": p["aria-label"] ?? "成虫" })}>
    {/* 頭角 */}
    <path d="M12 2.5 L10.5 5.5 L12 5 L13.5 5.5 Z" fill="currentColor" />
    {/* 胸角 (pronotum horn) */}
    <path d="M10.5 6 L12 8.5 L13.5 6 Z" fill="currentColor" />
    {/* 頭部 */}
    <ellipse cx="12" cy="7" rx="2.2" ry="1.6" />
    {/* 前胸 */}
    <path d="M9 9 Q8 11 9 12 L15 12 Q16 11 15 9 Z" />
    {/* 鞘翅 (elytra) */}
    <path d="M8.5 12 Q7 18 10 20.5 L12 21 L14 20.5 Q17 18 15.5 12 Z" />
    {/* 中央分割線 */}
    <line x1="12" y1="12.5" x2="12" y2="20.5" opacity="0.5" />
    {/* 脚 (片側 3 本) */}
    <path
      d="M9 13 L6 12 M9 15.5 L5.5 15.5 M9.5 18 L6.5 19.5 M15 13 L18 12 M15 15.5 L18.5 15.5 M14.5 18 L17.5 19.5"
      opacity="0.7"
    />
  </svg>
);

/** ステージキー → アイコンの map */
export const STAGE_ICON_MAP: Record<StageKey, (p: StageIconProps) => JSX.Element> = {
  egg: EggIcon,
  larva1: Larva1Icon,
  larva2: Larva2Icon,
  larva3: Larva3Icon,
  prepupa: PrepupaIcon,
  pupa: PupaIcon,
  adult: AdultIcon,
};

/** 日本語ステージ名 → アイコンキー */
export const STAGE_NAME_TO_KEY: Record<string, StageKey> = {
  "卵": "egg",
  "幼虫1齢": "larva1",
  "幼虫2齢": "larva2",
  "幼虫3齢": "larva3",
  "前蛹": "prepupa",
  "蛹": "pupa",
  "成虫": "adult",
};

/** index 順に並んだステージアイコンの配列 (STAGES と対応) */
export const STAGE_ICON_ORDER: StageKey[] = [
  "egg",
  "larva1",
  "larva2",
  "larva3",
  "prepupa",
  "pupa",
  "adult",
];
