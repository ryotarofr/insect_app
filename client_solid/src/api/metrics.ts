// api/metrics.ts — マイページ Hero の KPI を算出
//
// P2-6: MyPage の KPI カードは従来ハードコード (28 件 / 4 ライン) だった。
// これを実データから算出し、createMemo で reactive に追従するようにする。
//
//   - 所有個体: listSpecimens().length
//   - 羽化予定(60日以内): listUrgentEclosion(60).length
//     うち7日以内: listUrgentEclosion(7).length
//   - 血統ライン: APP_DATA.specimens の `generation` のユニーク数 (最深も算出)
//   - 今月の飼育ログ: listLogs() のうち今月のものをカウント
//     前月比は昨月分との差を返す
import { APP_DATA } from "../data";
import { listSpecimens, listUrgentEclosion } from "./specimens";
import { listLogs } from "./logs";

export interface UserMetrics {
  /** 所有個体数 (生存中) */
  specimenCount: number;
  /** 羽化予定 60 日以内の個体数 */
  eclosionSoonCount: number;
  /** 羽化予定 7 日以内の個体数 (urgency 区別) */
  eclosionUrgentCount: number;
  /** 血統ライン (generation のユニーク数) */
  bloodlineCount: number;
  /** 最深の累代 (例: "CBF3") */
  deepestGeneration: string;
  /** 今月 (暦月) の飼育ログ件数 */
  monthlyLogCount: number;
  /** 先月比 (今月 - 先月) */
  monthlyLogDelta: number;
}

/** 月初 0:00 のタイムスタンプを返す (ローカル TZ) */
const startOfMonth = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), 1);

/** date "YYYY-MM-DD" を Date (ローカル 0:00) へ */
const parseDateISO = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/** 累代ラベル (CBF1 等) を数値へ。WILD/F0 は 0。 */
const generationDepth = (label: string): number => {
  // "CBF3" → 3
  const m = /CBF(\d+)/i.exec(label);
  if (m) return Number(m[1]);
  if (/F0|WILD/i.test(label)) return 0;
  return 0;
};

/** すべての関連 signal を読むので createMemo 内で呼ぶと reactive に追従する */
export const getUserMetrics = (): UserMetrics => {
  const specs = listSpecimens();
  const logs = listLogs();
  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
  );

  let thisMonthLogs = 0;
  let lastMonthLogs = 0;
  for (const l of logs) {
    const t = parseDateISO(l.date).getTime();
    if (t >= thisMonthStart.getTime()) thisMonthLogs += 1;
    else if (t >= lastMonthStart.getTime()) lastMonthLogs += 1;
  }

  // 血統ライン: APP_DATA.specimens の generation 値のユニーク数
  // (バックエンドがある前提なら Bloodline API から取る)
  const gens = new Set<string>();
  let deepestN = 0;
  let deepestLabel = "—";
  for (const s of APP_DATA.specimens) {
    const g = s.generation;
    if (g) gens.add(g);
    const d = generationDepth(g);
    if (d > deepestN) {
      deepestN = d;
      deepestLabel = g;
    }
  }

  return {
    specimenCount: specs.length,
    eclosionSoonCount: listUrgentEclosion(60).length,
    eclosionUrgentCount: listUrgentEclosion(7).length,
    bloodlineCount: gens.size,
    deepestGeneration: deepestLabel,
    monthlyLogCount: thisMonthLogs,
    monthlyLogDelta: thisMonthLogs - lastMonthLogs,
  };
};
