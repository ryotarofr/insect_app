// api/nextActions.ts — マイページに表示する「次にやるべき飼育ケア」の計算 (P4-9)
//
// 対象:
//   - エサ交換 (feed)         : 幼虫/成虫共通。前回から N 日経過で督促。
//   - マット交換 (mat)        : 幼虫のみ。30 日間隔。
//   - 体重測定 (weigh)        : 幼虫/成虫共通。14 日間隔。
//   - 羽化 (eclosion)         : eclosionInDays <= 7 の個体。
//
// 出力:
//   UpcomingAction[] — dueInDays 昇順 (最も緊急な順)。
//   7 日以内の予定 / 今日 / 超過 (overdue) を混ぜて返す。
//
// 除外:
//   lifeStatus === "deceased" / "transferred" / "escaped" の個体は対象外。
//   蛹 / 前蛹 / 卵 は feed/mat/weigh の対象外 (静置が正)。
import { listSpecimens } from "./specimens";
import { listLogsBySpecimen } from "./logs";
import type { LogType, Specimen } from "../data";

export type ActionKind = "feed" | "mat" | "weigh" | "eclosion";

export interface UpcomingAction {
  kind: ActionKind;
  specimenId: string;
  specimenName: string;
  specimenStage: string;
  /** 残り日数 (負なら超過日数, 0 は今日期限) */
  dueInDays: number;
  /** overdue = 超過 / today = 今日期限 / soon = 1-7 日以内 */
  priority: "overdue" | "today" | "soon";
  /** 日本語ラベル (エサ交換 / マット交換 / 体重測定 / 羽化間近) */
  label: string;
  /** 補足 (例: "前回 13日前") */
  hint?: string;
}

/** 各ケアの推奨間隔 (日数)。stage によって対象外になる場合は後述の isEligible で弾く。 */
const INTERVAL_DAYS: Record<Exclude<ActionKind, "eclosion">, number> = {
  feed: 7,
  mat: 30,
  weigh: 14,
};

const LABEL: Record<ActionKind, string> = {
  feed: "エサ交換",
  mat: "マット交換",
  weigh: "体重測定",
  eclosion: "羽化間近",
};

/** 蛹 / 前蛹 / 卵 は静置期。エサ/マット/体重 の対象外。 */
const isStillStage = (stage: string): boolean =>
  /蛹|前蛹|卵/.test(stage);

/** マットは幼虫のみ対象。成虫は産卵床を使うが、別カテゴリなので今回は除外。 */
const needsMatChange = (stage: string): boolean => /幼虫|初令|齢/.test(stage);

/** ある kind のケアが、その個体に対して意味があるか。 */
const isEligible = (kind: ActionKind, spec: Specimen): boolean => {
  if (kind === "eclosion") return spec.eclosionInDays !== null;
  if (isStillStage(spec.stage)) return false;
  if (kind === "mat") return needsMatChange(spec.stage);
  return true; // feed / weigh は動いている全個体で対象
};

const LOG_TYPE_FOR: Record<Exclude<ActionKind, "eclosion">, LogType> = {
  feed: "feed",
  mat: "mat",
  weigh: "weight",
};

/** "YYYY-MM-DD" を Date (ローカル 0:00) に。 */
const parseDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 今日 0:00 を基準に、iso date の「何日前 (整数)」を返す。 */
const daysAgo = (iso: string, today: Date): number => {
  const then = parseDate(iso).getTime();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.floor((t0 - then) / DAY_MS);
};

const priorityOf = (dueInDays: number): UpcomingAction["priority"] => {
  if (dueInDays < 0) return "overdue";
  if (dueInDays === 0) return "today";
  return "soon";
};

/**
 * 指定期間内に実施すべきケアのリスト。
 * @param horizonDays この日数以内の予定だけを返す (既定: 7 日)。
 *   既定値 7 は「羽化予定 7 日以内」と揃えた。
 */
export const getUpcomingActions = (
  horizonDays = 7,
  today: Date = new Date(),
): UpcomingAction[] => {
  const out: UpcomingAction[] = [];

  for (const s of listSpecimens()) {
    // 生存中以外は対象外。listSpecimens は既に deceased を除外しているが念のため明示。
    if (s.lifeStatus && s.lifeStatus !== "active") continue;

    // 羽化間近
    if (isEligible("eclosion", s) && s.eclosionInDays !== null) {
      const d = s.eclosionInDays;
      if (d <= horizonDays) {
        out.push({
          kind: "eclosion",
          specimenId: s.id,
          specimenName: s.name,
          specimenStage: s.stage,
          dueInDays: d,
          priority: priorityOf(d),
          label: LABEL.eclosion,
          hint: s.eclosionETA ?? undefined,
        });
      }
    }

    // feed / mat / weigh は最終ログからの経過日で判定
    (["feed", "mat", "weigh"] as const).forEach((kind) => {
      if (!isEligible(kind, s)) return;

      const logs = listLogsBySpecimen(s.id).filter(
        (l) => l.type === LOG_TYPE_FOR[kind],
      );
      // 一番新しいログの date を取る (ログは新→古で格納されている想定だが保険で max)
      let lastDaysAgo: number | null = null;
      for (const l of logs) {
        const d = daysAgo(l.date, today);
        if (lastDaysAgo === null || d < lastDaysAgo) lastDaysAgo = d;
      }

      // 未記録なら「期限超過」として扱う (安全側)
      const interval = INTERVAL_DAYS[kind];
      const elapsed = lastDaysAgo ?? interval + 1;
      const dueInDays = interval - elapsed;

      if (dueInDays <= horizonDays) {
        out.push({
          kind,
          specimenId: s.id,
          specimenName: s.name,
          specimenStage: s.stage,
          dueInDays,
          priority: priorityOf(dueInDays),
          label: LABEL[kind],
          hint:
            lastDaysAgo === null
              ? "記録なし"
              : lastDaysAgo === 0
                ? "今日"
                : `前回 ${lastDaysAgo}日前`,
        });
      }
    });
  }

  // 優先順: overdue → today → soon、同優先度内は dueInDays 昇順 (より古いほど上)
  return out.sort((a, b) => a.dueInDays - b.dueInDays);
};
