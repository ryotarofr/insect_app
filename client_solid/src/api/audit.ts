// api/audit.ts — 個体の変更履歴 (イベントログ) の取得 (P4-21)
//
// Bloodline 右ペインの「変更履歴」セクション用。従来は Bloodline.tsx 内に
// ハードコードされた AUDIT_LOG 定数を固定表示していたが、
// 個体ごとに意味のある履歴を返す api に差し替える。
//
// 方針:
//   - 「本物のイベントストア」は POC では持たない。Specimen の登録日/羽化予測日/
//     世代などから、それっぽい履歴を決定論的に組み立てて返す。
//   - Bloodline は Individual (拡張 seed) と Specimen (実データ) の ID が一部
//     重なるが、Specimen 未登録の個体 (F0/CBF1 の先祖など) もあるため、
//     getAuditLog は id を受け取って「知っている分だけ」返す。
//   - 未知の ID でも少なくとも 1 行 (「参照記録」) は返し、UI 側の "履歴なし"
//     分岐を不要にする。
//
// 型は将来的にバックエンド (event store) と差し替えてもブレないよう
// 最小限にとどめる (date / event / actor)。
import { APP_DATA, type Specimen } from "../data";

export interface AuditLogEntry {
  /** YYYY-MM-DD */
  date: string;
  /** イベント本文 (例: "羽化予測登録", "個体登録 CBF3") */
  event: string;
  /** 主語 (system / event / ユーザー名) */
  actor: string;
}

const OWNER = "ANCHOR"; // POC の自分 (getCurrentUser().name を将来参照)

/** Date → YYYY-MM-DD (local) */
const iso = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** n 日前の Date */
const daysAgo = (n: number, base: Date): Date => {
  const t = new Date(base);
  t.setDate(t.getDate() - n);
  return t;
};

/** id の末尾 4 桁 (ハイフン区切り) — 交配記録の仮想親 ID を組み立てるのに使う */
const tailDigits = (id: string): string => {
  const m = id.match(/(\d{3,4})$/);
  return m ? m[1] : "0000";
};

/** id をシード化した pseudo-random (0 <= x < 1)。決定論的かつ安定。 */
const seedRand = (id: string, salt: number): number => {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 32bit → [0, 1)
  return ((h >>> 0) % 10000) / 10000;
};

const getSpecimen = (id: string): Specimen | undefined =>
  APP_DATA.specimens.find((s) => s.id === id);

/**
 * 個体の変更履歴を返す。新しい順 (降順) でソートされた配列。
 *
 * Specimen (APP_DATA) に登録のある個体は、その登録日/購入日/羽化予測日を
 * 元に 3〜5 件のイベントを合成する。未登録の個体は "参照記録" として
 * 系譜のみを返す。
 *
 * @param id       Individual ID (例: "#DHH-0276")
 * @param today    テスト注入用 (既定: 現在時刻)
 */
export const getAuditLog = (
  id: string,
  today: Date = new Date(),
): AuditLogEntry[] => {
  const spec = getSpecimen(id);
  const entries: AuditLogEntry[] = [];

  if (spec) {
    // 1) 個体登録 (購入日 or 登録日)
    entries.push({
      date: spec.purchasedAt,
      event: `個体登録 ${spec.generation}`,
      actor: OWNER,
    });

    // 2) 交配記録 (親が明記されている場合のみ)
    const hasParents = spec.bloodline.father && spec.bloodline.mother;
    if (hasParents) {
      // 購入日の 2 日前 = 交配記録日 (POC) — 父×母 の末尾 4 桁で疑似表示
      const matingDate = daysAgo(2, new Date(spec.purchasedAt));
      entries.push({
        date: iso(matingDate),
        event: `交配記録 ${tailDigits(spec.bloodline.father)}×${tailDigits(
          spec.bloodline.mother,
        )}`,
        actor: OWNER,
      });
    }

    // 3) 羽化予測登録 (eclosionETA がある個体のみ)
    if (spec.eclosionETA) {
      // 予測登録日 = 購入日の 30 日後 (POC) or 未来なら今日から 90 日前、どちらか新しい方
      const registeredAt = daysAgo(90, today);
      const candidate = new Date(spec.purchasedAt);
      candidate.setDate(candidate.getDate() + 30);
      const evDate = candidate > registeredAt ? registeredAt : candidate;
      // 未来日付を避ける (購入日 +30d が未来になる極端なケース)
      const final = evDate > today ? today : evDate;
      entries.push({
        date: iso(final),
        event: "羽化予測登録",
        actor: "system",
      });
    }

    // 4) 所有権移転 (F2 以降で 30% 確率で発生 — 決定論的)
    const r = seedRand(id, 17);
    const isLateGen = /CBF2|CBF3|F2|F3/.test(spec.generation);
    if (isLateGen && r < 0.3) {
      const daysBack = 10 + Math.floor(seedRand(id, 29) * 40); // 10-49 日前
      entries.push({
        date: iso(daysAgo(daysBack, today)),
        event: `所有権移転 ${OWNER}→${["徹", "蓮", "翔太", "航"][Math.floor(
          seedRand(id, 41) * 4,
        )]}`,
        actor: "event",
      });
    }

    // 5) サイズ測定 (20% の個体で表示)
    if (seedRand(id, 53) < 0.2) {
      const daysBack = 3 + Math.floor(seedRand(id, 61) * 10); // 3-12 日前
      entries.push({
        date: iso(daysAgo(daysBack, today)),
        event: `体重測定 ${spec.weightG}g`,
        actor: OWNER,
      });
    }
  } else {
    // Specimen 未登録 (F0 祖先 / 譲渡済などの仮想個体) の保険表示
    entries.push({
      date: iso(daysAgo(120, today)),
      event: "系譜参照記録",
      actor: "system",
    });
    entries.push({
      date: iso(daysAgo(365, today)),
      event: "個体登録",
      actor: OWNER,
    });
  }

  // 新しい順 (日付降順)
  return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
};
