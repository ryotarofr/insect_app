// pages/bloodline/fixture.ts — 血統マインドマップの固定 fixture データ
//
// **座標は手動配置**。
//   左上 = ヘラクレス (3 世代), 左下 = コーカサス (2 世代),
//   右上 = 国産 (2 世代), 右下 = ネプチューン (2 世代).
//   将来 API 化する時は { sp, generation, parents } から自動配置する関数に差し替える
//   (Bloodline.tsx の server-driven 化で computeLayout に置換予定)。

/** 血統表現用の性別。MatingRecordModal も Bloodline.tsx 経由で参照する。 */
export type Sex = "m" | "f";

/** 種別。 */
export type Sp = "dhh" | "cat" | "nat" | "neo";

// ─── ノード (描画用 fixture) ───────────────────────────────────────────
export interface BlNode {
  id: string;
  name: string;
  sp: Sp;
  sex: Sex | "u";
  gen: string;
  size: string;
  from: string;
  state: string;
  memo: string;
  /** "deceased" / "transferred" の時はカードを薄色化。未指定 = active */
  end?: "deceased" | "transferred";
  /** 緊急マーク。"あと15日" のような短い文言で表示 */
  urgent?: string;
  x: number;
  y: number;
}

export const NODES: BlNode[] = [
  // ── ヘラクレス系統 (左上) ──────────────────────────────
  { id: "#DHH-0150", name: "月影", sp: "dhh", sex: "m", gen: "F0", size: "148mm",
    from: "野生 (中南米)", end: "deceased", state: "故 (2025-10-02)",
    memo: "父系の起点。2024 産卵の残り個体は 漆黒 のみ。",
    x: 120, y: 170 },
  { id: "#DHH-0204", name: "花音", sp: "dhh", sex: "f", gen: "F0", size: "68mm",
    from: "ANCHOR BEETLE CO.", state: "成虫 · 産卵終了",
    memo: "月影 とのペアリングは 2022 のみ。以降は単独飼育。",
    x: 320, y: 170 },
  { id: "#DHH-0244", name: "マリア", sp: "dhh", sex: "f", gen: "F0", size: "66mm",
    from: "ANCHOR BEETLE CO.", state: "成虫",
    memo: "漆黒 と組み合わせて F2 を 3 個体獲得。次サイクル候補。",
    x: 560, y: 170 },
  { id: "#DHH-0213", name: "漆黒", sp: "dhh", sex: "m", gen: "F1 (CBF1)", size: "152mm",
    from: "自家累代", state: "成虫",
    memo: "自己累代の最大個体。マリア との交配で黒曜・翠・朔を得た。",
    x: 340, y: 330 },
  { id: "#DHH-0271", name: "黒曜", sp: "dhh", sex: "m", gen: "F2 (CBF2)", size: "142mm",
    from: "自家累代", state: "蛹 · 進捗 72%", urgent: "あと15日",
    memo: "羽化監視中。羽化後は 朔 とのペアリングを検討。",
    x: 200, y: 520 },
  { id: "#DHH-0272", name: "翠", sp: "dhh", sex: "m", gen: "F2 (CBF2)", size: "146mm",
    from: "自家累代", state: "成虫 (2025) · 後食",
    memo: "後食開始済。次 F3 の主役候補。",
    x: 400, y: 520 },
  { id: "#DHH-0273", name: "朔", sp: "dhh", sex: "f", gen: "F2 (CBF2)", size: "65mm",
    from: "自家累代", state: "成虫 (2025) · 後食",
    memo: "♀ 1 個体目。黒曜 / 翠 のいずれかとペアリング予定。",
    x: 600, y: 520 },

  // ── コーカサス系統 (左下) ──────────────────────────────
  { id: "#CAT-0091", name: "嵐", sp: "cat", sex: "m", gen: "F0", size: "110mm",
    from: "KUWAGATA.jp", state: "成虫",
    memo: "輸入個体。蘭 とのペアリングで F1 ペアを獲得。",
    x: 120, y: 790 },
  { id: "#CAT-0097", name: "蘭", sp: "cat", sex: "f", gen: "F0", size: "60mm",
    from: "KUWAGATA.jp", state: "成虫 · 産卵終了",
    memo: "嵐 と組ませて 雷・雪 を獲得。3 齢突入後は単独。",
    x: 320, y: 790 },
  { id: "#CAT-0118", name: "雷", sp: "cat", sex: "m", gen: "F1", size: "95mm",
    from: "自家累代", state: "幼虫 3齢",
    memo: "次回マット交換は 5/3 予定。体重伸び良好。",
    x: 160, y: 970 },
  { id: "#CAT-0089", name: "雪", sp: "cat", sex: "f", gen: "F1", size: "50mm",
    from: "自家累代", state: "幼虫 2齢",
    memo: "♀ サイドの予備。幼虫期間が長いので春以降の管理に注意。",
    x: 340, y: 970 },

  // ── 国産系統 (右上) ────────────────────────────────────
  { id: "#NAT-0341", name: "武蔵", sp: "nat", sex: "m", gen: "F0", size: "82mm",
    from: "野外採集 (秋田)", state: "成虫 · 産卵セット中",
    memo: "地元採集個体。結 と組ませて 4 個体産卵 (1 譲渡済)。",
    x: 1040, y: 170 },
  { id: "#NAT-0355", name: "結", sp: "nat", sex: "f", gen: "F0", size: "45mm",
    from: "野外採集 (秋田)", state: "成虫",
    memo: "武蔵 とのペア相手。産卵終了済。",
    x: 1240, y: 170 },
  { id: "#NAT-0402", name: "小次郎", sp: "nat", sex: "m", gen: "F1", size: "78mm",
    from: "自家累代", state: "前蛹 · 進捗 88%", urgent: "あと33日",
    memo: "羽化期近づく。蛹室を崩さないよう静置中。",
    x: 1000, y: 380 },
  { id: "#NAT-0480", name: "陣", sp: "nat", sex: "u", gen: "F1", size: "42mm",
    from: "自家累代", state: "幼虫 2齢",
    memo: "性別未確定。次回計測は 4/30。",
    x: 1180, y: 380 },
  { id: "#NAT-0481", name: "勘助", sp: "nat", sex: "u", gen: "F1", size: "24mm",
    from: "自家累代", state: "幼虫 1齢",
    memo: "性別未確定。マット劣化注意。",
    x: 1340, y: 380 },
  { id: "#NAT-0420", name: "駿", sp: "nat", sex: "m", gen: "F1", size: "78mm",
    from: "自家累代", end: "transferred", state: "譲渡済 (2026-01-15)",
    memo: "友人へ譲渡。系統参考のため記録は残す。",
    x: 1500, y: 380 },

  // ── ネプチューン系統 (右下) ────────────────────────────
  { id: "#NEO-0011", name: "蒼", sp: "neo", sex: "m", gen: "F0", size: "125mm",
    from: "MIYAMA FARM", state: "成虫",
    memo: "購入個体。凜 とのペアリング検討中。",
    x: 1080, y: 790 },
  { id: "#NEO-0024", name: "凜", sp: "neo", sex: "f", gen: "F0", size: "68mm",
    from: "MIYAMA FARM", state: "成虫",
    memo: "購入個体。後食終了済。",
    x: 1280, y: 790 },
  { id: "#NEO-0058", name: "青嵐", sp: "neo", sex: "m", gen: "F1", size: "102mm",
    from: "自家累代", state: "幼虫 3齢",
    memo: "羽化予定 2026-08-30。マット交換頻度が鍵。",
    x: 1180, y: 970 },
];

// 親 × 親 → 子 N 体
export interface BlPair { a: string; b: string; children: string[] }
export const PAIRS: BlPair[] = [
  { a: "#DHH-0150", b: "#DHH-0204", children: ["#DHH-0213"] },
  { a: "#DHH-0213", b: "#DHH-0244", children: ["#DHH-0271", "#DHH-0272", "#DHH-0273"] },
  { a: "#CAT-0091", b: "#CAT-0097", children: ["#CAT-0118", "#CAT-0089"] },
  { a: "#NAT-0341", b: "#NAT-0355", children: ["#NAT-0402", "#NAT-0480", "#NAT-0481", "#NAT-0420"] },
  { a: "#NEO-0011", b: "#NEO-0024", children: ["#NEO-0058"] },
];

// 種別ごとの章見出し位置
export interface BlSection { sp: Sp; num: string; title: string; sub: string; x: number; y: number; x2: number }
export const SECTIONS: BlSection[] = [
  { sp: "dhh", num: "I",   title: "ヘラクレス",   sub: "3 GEN · 7 SPECIMENS", x: 80,   y: 110, x2: 680  },
  { sp: "cat", num: "II",  title: "コーカサス",   sub: "2 GEN · 4 SPECIMENS", x: 80,   y: 730, x2: 560  },
  { sp: "nat", num: "III", title: "国産",         sub: "2 GEN · 6 SPECIMENS", x: 1000, y: 110, x2: 1660 },
  { sp: "neo", num: "IV",  title: "ネプチューン", sub: "2 GEN · 3 SPECIMENS", x: 1040, y: 730, x2: 1620 },
];

export const NODE_W = 168;
export const NODE_H = 78;

/**
 * SVG の viewBox は `0 0 1700 1200` 固定。中心座標 (= 850, 600) を `centerOn` /
 * filter 適用時 / リセット時で共有する。viewBox を変えるなら 1 箇所いじれば済む。
 */
export const VIEW_CX = 850;
export const VIEW_CY = 600;

export const findNode = (id: string): BlNode | undefined =>
  NODES.find((n) => n.id === id);
