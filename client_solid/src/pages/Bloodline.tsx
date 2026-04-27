// Bloodline.tsx — 血統マインドマップ (= editorial / pan-zoom canvas)
//
// docs/bloodline-mindmap-mockup.html (= 設計プロト) を Solid に移植したページ。
// 旧 3 世代フォーカス + 俯瞰タブの実装は pages/Bloodline.legacy.tsx に退避済み。
//
// **構成**:
//   - SVG キャンバス (viewBox 0 0 1700 1200) を pan / zoom で動かす
//   - 種別ごとに「Section」(章見出し + ノード群) を 4 象限に配置
//   - ノード = 個体カルテ 1 枚。クリックで右ペインに詳細を出す
//   - エッジ = 親子線。ペアごとに「両親 → ジョイン棒 → 各子」の elbow connector
//
// **データ層**:
//   現状は本ファイル内の `NODES` / `PAIRS` / `SECTIONS` 固定 fixture (= MVP)。
//   本実装は Phase 9.D 完了後に GET /api/v1/bloodline/me 経由で server-driven 化する想定。
//   その時は computeLayout(individuals) → { nodes, pairs, sections } を切り出して
//   server-driven な座標生成に切り替える。
//
// **MatingRecordModal 互換**:
//   旧 Bloodline.tsx が export していた `Individual` / `Sex` / `listBloodlineIndividuals` /
//   `getBloodlineIndividual` を後方互換として残す。中身は本ファイルの NODES / PAIRS から
//   合成する (= MatingRecordModal は import 元を変えずに動く)。

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import type { RouteKey } from "../data";
import { specimenExists, type LifeStatus } from "../api";
import { specimenUrl } from "../router";
import { showToast } from "../store/toast";
import { MatingRecordModal } from "../components/bloodline/MatingRecordModal";
import { SpecimenCarteModal } from "../components/bloodline/SpecimenCarteModal";
import "../styles/bloodline.css";

// ─── 後方互換 type 定義 (= MatingRecordModal が import する) ────────────
export type Sex = "m" | "f";

/**
 * 血統表現用の個体型。`pages/Bloodline.legacy.tsx` の `Individual` から
 * 移管。`generation` は legacy 時代の `GenKey` enum を string に緩めた。
 * 実値は "F0" / "F1" / "F1 (CBF1)" / "CBF2" 等。
 */
export interface Individual {
  id: string;
  name: string;
  sex: Sex;
  generation: string;
  year?: string;
  sizeMm?: number;
  parents: string[];
  isWild: boolean;
  lifeStatus?: LifeStatus;
  lifeStatusDate?: string;
}

// ─── 種別 ──────────────────────────────────────────────────────────────
type Sp = "dhh" | "cat" | "nat" | "neo";
/**
 * 種別ラベルのデフォルト値。
 *
 * **ユーザがリネーム可能**: 実行時は `customLabels` signal でユーザ独自の表示名に
 * 上書きできる。`labelOf(sp)` 経由でアクセスし、未設定 / 空文字なら本デフォルトに倒す。
 * 永続化は `localStorage[LABEL_STORAGE_KEY]` (= JSON object)。
 */
const DEFAULT_SP_LABELS: Record<Sp, string> = {
  dhh: "ヘラクレス",
  cat: "コーカサス",
  nat: "国産",
  neo: "ネプチューン",
};

/** localStorage キー (= ユーザカスタム ラベル保存用)。 */
const LABEL_STORAGE_KEY = "kochu:bloodline:sp-labels";

const SP_LIST = ["dhh", "cat", "nat", "neo"] as const;

/**
 * localStorage から custom ラベルを読む。失敗時は空オブジェクト。
 *   - localStorage 不在 (= SSR / private mode) → {}
 *   - JSON parse 失敗 → {}
 *   - 空文字 / 非 string は除外 (= "壊れた値" はデフォルトに倒す)
 */
const loadCustomLabels = (): Partial<Record<Sp, string>> => {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LABEL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<Sp, string>> = {};
    for (const sp of SP_LIST) {
      const v = parsed[sp];
      if (typeof v === "string" && v.trim().length > 0) out[sp] = v;
    }
    return out;
  } catch {
    return {};
  }
};
type FilterSp = "all" | Sp;

// ─── ノード (描画用 fixture) ───────────────────────────────────────────
//
// **座標は手動配置**。
//   左上 = ヘラクレス (3 世代), 左下 = コーカサス (2 世代),
//   右上 = 国産 (2 世代), 右下 = ネプチューン (2 世代).
//   将来 API 化する時は { sp, generation, parents } から自動配置する関数に差し替える。
interface BlNode {
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

const NODES: BlNode[] = [
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
interface BlPair { a: string; b: string; children: string[] }
const PAIRS: BlPair[] = [
  { a: "#DHH-0150", b: "#DHH-0204", children: ["#DHH-0213"] },
  { a: "#DHH-0213", b: "#DHH-0244", children: ["#DHH-0271", "#DHH-0272", "#DHH-0273"] },
  { a: "#CAT-0091", b: "#CAT-0097", children: ["#CAT-0118", "#CAT-0089"] },
  { a: "#NAT-0341", b: "#NAT-0355", children: ["#NAT-0402", "#NAT-0480", "#NAT-0481", "#NAT-0420"] },
  { a: "#NEO-0011", b: "#NEO-0024", children: ["#NEO-0058"] },
];

// 種別ごとの章見出し位置
interface BlSection { sp: Sp; num: string; title: string; sub: string; x: number; y: number; x2: number }
const SECTIONS: BlSection[] = [
  { sp: "dhh", num: "I",   title: "ヘラクレス",   sub: "3 GEN · 7 SPECIMENS", x: 80,   y: 110, x2: 680  },
  { sp: "cat", num: "II",  title: "コーカサス",   sub: "2 GEN · 4 SPECIMENS", x: 80,   y: 730, x2: 560  },
  { sp: "nat", num: "III", title: "国産",         sub: "2 GEN · 6 SPECIMENS", x: 1000, y: 110, x2: 1660 },
  { sp: "neo", num: "IV",  title: "ネプチューン", sub: "2 GEN · 3 SPECIMENS", x: 1040, y: 730, x2: 1620 },
];

const NODE_W = 168;
const NODE_H = 78;

/**
 * SVG の viewBox は `0 0 1700 1200` 固定。中心座標 (= 850, 600) を `centerOn` /
 * filter 適用時 / リセット時で共有する。viewBox を変えるなら 1 箇所いじれば済む。
 */
const VIEW_CX = 850;
const VIEW_CY = 600;

const findNode = (id: string): BlNode | undefined => NODES.find((n) => n.id === id);

// ─── 後方互換 export ───────────────────────────────────────────────────
//
// 旧 Bloodline.tsx の関数シグネチャを維持。
// 中身は NODES / PAIRS から `Individual` 形に再構成する。
const buildIndividualMap = (): Map<string, Individual> => {
  const m = new Map<string, Individual>();
  // 親情報は PAIRS から逆引き
  const parentsOf = new Map<string, string[]>();
  PAIRS.forEach((p) => {
    p.children.forEach((cid) => parentsOf.set(cid, [p.a, p.b]));
  });
  NODES.forEach((n) => {
    if (n.sex === "u") return; // mating modal は ♂♀ しか扱わないので除外
    const parents = parentsOf.get(n.id) ?? [];
    const lifeStatus: LifeStatus | undefined =
      n.end === "deceased" ? "deceased" :
      n.end === "transferred" ? "transferred" :
      "active";
    m.set(n.id, {
      id: n.id,
      name: n.name,
      sex: n.sex,
      generation: n.gen,
      sizeMm: parseFloat(n.size),
      parents,
      isWild: n.from.startsWith("野生") || n.from.startsWith("野外"),
      lifeStatus,
    });
  });
  return m;
};
const INDIVIDUALS_MAP = buildIndividualMap();
const INDIVIDUALS_LIST = Array.from(INDIVIDUALS_MAP.values());

export const listBloodlineIndividuals = (): Individual[] => INDIVIDUALS_LIST;
export const getBloodlineIndividual = (id: string): Individual | undefined => INDIVIDUALS_MAP.get(id);

// ─── ペア / 同腹リレーション計算 ───────────────────────────────────────
/**
 * 1 個体に紐づく血統リレーション。
 *
 * - `pairs` は **配列**: 1 個体が複数のペアに属するケース (= 同個体が複数の異性と
 *   再交配する) を表現するため。固定 fixture の現状は 1 ペアのみだが、サーバ駆動化
 *   したときに自然に多重ペアを表せる。
 * - `parents` / `children` / `siblings` は重複排除済み (= 同じ id が複数の経路で
 *   入ってくる場合は最初の 1 つだけ)。
 */
interface Relations {
  parents: BlNode[];
  pairs: BlNode[];
  children: BlNode[];
  siblings: BlNode[];
}
const findRelations = (id: string): Relations => {
  const out: Relations = { parents: [], pairs: [], children: [], siblings: [] };
  const seen = new Set<string>();
  const push = (arr: BlNode[], n: BlNode | undefined, kind: string) => {
    if (!n) return;
    const key = `${kind}:${n.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    arr.push(n);
  };
  PAIRS.forEach((p) => {
    if (p.children.includes(id)) {
      push(out.parents, findNode(p.a), "p");
      push(out.parents, findNode(p.b), "p");
      p.children.forEach((cid) => {
        if (cid === id) return;
        push(out.siblings, findNode(cid), "s");
      });
    }
    if (p.a === id || p.b === id) {
      const partnerId = p.a === id ? p.b : p.a;
      push(out.pairs, findNode(partnerId), "x");
      p.children.forEach((cid) => push(out.children, findNode(cid), "c"));
    }
  });
  return out;
};

// ─── BloodlinePage ────────────────────────────────────────────────────
interface BloodlinePageProps {
  setRoute: (r: RouteKey) => void;
  setSelectedSpecimen: (id: string) => void;
}

const sexGlyph = (sex: BlNode["sex"]): string =>
  sex === "m" ? "♂" : sex === "f" ? "♀" : "–";
const sexLabel = (sex: BlNode["sex"]): string =>
  sex === "m" ? "オス" : sex === "f" ? "メス" : "未確定";

/**
 * URL pathname (= /bloodline か /bloodline/<id>) から id を抽出。
 * 該当 NODE が無ければ undefined を返し、呼び出し側で fallback。
 */
const extractIdFromPath = (pathname: string): string | undefined => {
  const normalized = pathname.replace(/\/+$/, "");
  if (!normalized.startsWith("/bloodline")) return undefined;
  const rest = normalized.slice("/bloodline".length).replace(/^\//, "");
  if (!rest) return undefined;
  try {
    const decoded = decodeURIComponent(rest.split("/")[0] ?? "");
    return findNode(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
};

export const BloodlinePage = (_props: BloodlinePageProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  // 初期選択: URL に id が乗っていればそれを優先、無ければ "黒曜" (= 設計の主役個体)。
  const initialId = extractIdFromPath(location.pathname) ?? "#DHH-0271";
  const [selectedId, setSelectedId] = createSignal<string>(initialId);
  // パン / ズーム
  const [tx, setTx] = createSignal(0);
  const [ty, setTy] = createSignal(0);
  const [scale, setScale] = createSignal(1);
  // フィルタ dropdown 開閉 + 選択
  const [filterOpen, setFilterOpen] = createSignal(false);
  const [filterSp, setFilterSp] = createSignal<FilterSp>("all");
  // 交配記録モーダル
  const [matingOpen, setMatingOpen] = createSignal(false);
  // v2.3: カルテモーダル (= /specimen への navigate を avoid)
  const [carteOpen, setCarteOpen] = createSignal(false);
  // v2.1: サイドパネル折り畳み state (= ] キーまたは右端 chevron でトグル)
  const [panelCollapsed, setPanelCollapsed] = createSignal(false);

  // ───── 種別ラベルの custom 化 (= 「ヘラクレス」等を自由にリネーム) ───────
  // 起動時に localStorage から読み込み、変更時に書き戻す。
  // labelOf() 経由で全表示箇所が動的に追従する (= section title / filter menu /
  // panel eyebrow / node aria-label すべて)。
  const [customLabels, setCustomLabels] = createSignal<Partial<Record<Sp, string>>>(
    loadCustomLabels(),
  );
  const labelOf = (sp: Sp): string =>
    customLabels()[sp] ?? DEFAULT_SP_LABELS[sp];

  /** 1 種別の custom ラベルを更新 (空 or default 一致なら custom 解除)。 */
  const setLabel = (sp: Sp, value: string) => {
    const trimmed = value.trim();
    const next: Partial<Record<Sp, string>> = { ...customLabels() };
    if (trimmed.length === 0 || trimmed === DEFAULT_SP_LABELS[sp]) {
      delete next[sp];
    } else {
      next[sp] = trimmed;
    }
    setCustomLabels(next);
    try {
      if (typeof localStorage === "undefined") return;
      if (Object.keys(next).length === 0) {
        localStorage.removeItem(LABEL_STORAGE_KEY);
      } else {
        localStorage.setItem(LABEL_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      /* private mode 等で書き込み失敗 → in-memory にのみ反映 (= warn しない) */
    }
  };

  // ラベル編集ダイアログの開閉
  const [labelEditOpen, setLabelEditOpen] = createSignal(false);

  const SCALE_MIN = 0.25; // v2.1: 25% まで縮小可
  const SCALE_MAX = 4;    // v2.1: 400% まで拡大可

  // 選択中ノードを取り出す。NODES が空のケース (= 将来 server-driven 化時の loading 中)
  // に備え、null 許容。サイドパネルは <Show when={selectedNode()}> で吸収する。
  const selectedNode = createMemo<BlNode | undefined>(
    () => findNode(selectedId()) ?? NODES[0],
  );
  // v2.1: 「カルテを開く」が成立する個体か (= specimens に登録済み)。
  // disabled プロパティで使う。fixture のみの血統個体は false → 押せない。
  const carteAvailable = createMemo<boolean>(() => specimenExists(selectedId()));
  const relations = createMemo<Relations>(() =>
    selectedNode() ? findRelations(selectedNode()!.id) : { parents: [], pairs: [], children: [], siblings: [] },
  );

  // ───── パン / ズーム アニメーション ────────────────────
  // ── fit-to-content (= ノード bbox を canvas にぴったり収める) ──
  // viewBox `0 0 1700 1200` は静的だが、実コンテンツは y=110..1060 程度に
  // 収まっており、上下に空白が出やすい。マウント直後と `0` キー押下時に
  // bbox を計算して scale + translate を「ピッタリ収まる値」に置く。
  // 横方向もコンテンツが viewBox 幅 1700 のうち x=80..1660 くらいしか使わないので、
  // fit するとデスクトップ幅で 10〜20% 視認サイズが上がる。
  const computeFit = (): { tx: number; ty: number; scale: number } | null => {
    if (!canvasEl) return null;
    const rect = canvasEl.getBoundingClientRect();
    const canvasW = rect.width;
    const canvasH = rect.height;
    if (canvasW <= 0 || canvasH <= 0) return null;

    // コンテンツ bbox (= 全ノード + 全セクション heading) + 軽い padding
    const PAD = 24;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of NODES) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + NODE_W > maxX) maxX = n.x + NODE_W;
      if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
    }
    for (const sec of SECTIONS) {
      if (sec.x < minX) minX = sec.x;
      if (sec.y < minY) minY = sec.y;
      if (sec.x2 > maxX) maxX = sec.x2;
      if (sec.y + 16 > maxY) maxY = sec.y + 16;
    }
    minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) return null;

    // SVG は viewBox 1700x1200 を preserveAspectRatio="xMidYMid meet" で fit
    // 済み。canvas pixel ↔ SVG unit の比率を求めて、その上で「コンテンツが
    // canvas 全体に収まる」ような user-side scale を逆算する。
    const vbScale = Math.min(canvasW / 1700, canvasH / 1200);
    const targetEffective = Math.min(canvasW / contentW, canvasH / contentH) * 0.96;
    const scaleRaw = targetEffective / vbScale;
    // v2.4: content が viewBox 内に収まるように cap (= clipping 防止)。
    // content が viewBox より大きい状態で scale > 1 にすると、content が
    // viewBox 端を超えてクリップされる。下記の cap で「content が viewBox に
    // ぴったり収まる scale」を上限にする。overflow="visible" で多少救済済みだが
    // 念のため計算側でも保険を入れる。
    const noOverflow = Math.min(1700 / contentW, 1200 / contentH);
    const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, noOverflow, scaleRaw));

    // content 中心 → viewBox 中心 (= VIEW_CX, VIEW_CY) にマッピング
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return {
      tx: VIEW_CX - cx * newScale,
      ty: VIEW_CY - cy * newScale,
      scale: newScale,
    };
  };

  /** 即座にフィット (アニメ無し)。マウント直後 / リサイズ直後に使う。 */
  const fitToContentImmediate = () => {
    const f = computeFit();
    if (!f) return;
    setTx(f.tx); setTy(f.ty); setScale(f.scale);
  };
  /** アニメ付きフィット。`0` キー / 「リセット」相当で使う。 */
  const fitToContentAnimated = () => {
    const f = computeFit();
    if (!f) return;
    animateTo(f.tx, f.ty, f.scale);
  };

  let animFrame: number | null = null;
  const animateTo = (targetTx: number, targetTy: number, targetScale: number) => {
    if (animFrame !== null) cancelAnimationFrame(animFrame);
    const startTx = tx(), startTy = ty(), startScale = scale();
    const dur = 320;
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const k = ease(t);
      setTx(startTx + (targetTx - startTx) * k);
      setTy(startTy + (targetTy - startTy) * k);
      setScale(startScale + (targetScale - startScale) * k);
      if (t < 1) animFrame = requestAnimationFrame(step);
      else animFrame = null;
    };
    animFrame = requestAnimationFrame(step);
  };

  /**
   * 指定ノードを viewport 中心 (= VIEW_CX, VIEW_CY) に持ってくる。
   * 既に画面中央近く (= 旧位置と新位置のスクリーン距離が NODE_W 半分以内) なら
   * アニメをスキップ (= ユーザの操作中に視点を奪わない)。
   * `force=true` で閾値を無視 (関係カードからのジャンプ等)。
   */
  const centerOn = (id: string, force = false) => {
    const n = findNode(id);
    if (!n) return;
    const cx = n.x + NODE_W / 2;
    const cy = n.y + NODE_H / 2;
    const targetScale = Math.max(scale(), 0.95);
    const targetTx = VIEW_CX - cx * targetScale;
    const targetTy = VIEW_CY - cy * targetScale;
    if (!force) {
      const dx = targetTx - tx();
      const dy = targetTy - ty();
      if (Math.hypot(dx, dy) < NODE_W * 0.5) return;
    }
    animateTo(targetTx, targetTy, targetScale);
  };

  /** ノード自身クリック時: distance 閾値を尊重 (= 既に中央近くなら動かさない)。 */
  const selectNode = (id: string) => {
    setSelectedId(id);
    centerOn(id, false);
  };
  /** 関係カード等から飛ぶとき: 強制的にセンタリングする。 */
  const jumpToNode = (id: string) => {
    setSelectedId(id);
    centerOn(id, true);
  };

  // ───── canvas ref + pointer / wheel handlers ───────────
  //
  // pointermove は 1 動作で 60〜144 回発火する。setSignal を全回叩くと SVG
  // <g transform> 文字列の再生成が同 tick に大量に走るため、直近座標を queue して
  // rAF で 1 回だけ反映する (= "rAF throttle")。ホイールは離散イベントなので非 throttle。
  let canvasEl!: SVGSVGElement;
  let dragging = false;
  let sx = 0, sy = 0;
  let pendingPx = 0, pendingPy = 0;
  let panRaf: number | null = null;

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width  * 1700;
    const py = (e.clientY - rect.top)  / rect.height * 1200;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale() * factor));
    setTx(px - (px - tx()) * (next / scale()));
    setTy(py - (py - ty()) * (next / scale()));
    setScale(next);
  };

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element | null)?.closest(".bl-node")) return;
    dragging = true;
    canvasEl.classList.add("bl-dragging");
    sx = e.clientX - tx();
    sy = e.clientY - ty();
    canvasEl.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    pendingPx = e.clientX - sx;
    pendingPy = e.clientY - sy;
    if (panRaf !== null) return;
    panRaf = requestAnimationFrame(() => {
      panRaf = null;
      setTx(pendingPx);
      setTy(pendingPy);
    });
  };
  const onPointerUp = () => {
    dragging = false;
    canvasEl.classList.remove("bl-dragging");
    if (panRaf !== null) {
      cancelAnimationFrame(panRaf);
      panRaf = null;
    }
  };
  // pointercancel: タッチ操作中にシステム gesture (戻る swipe 等) が割り込んだ際に
  // 来る。setPointerCapture が外れて dragging が true のまま残るのを避ける。
  const onPointerCancel = () => onPointerUp();

  // ───── タッチ pinch zoom (v2.1) ────────────────────────
  // pointers Map で同時タッチ点を管理。2 本目が来た瞬間に基準距離 / scale を保存し、
  // 以後 pointermove のたびに距離比をかけて scale を更新する。
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let pinchStartScale = 1;

  onMount(() => {
    // 初期 fit-to-content。canvas dimension が DOM に反映されるのを 1 frame 待つ。
    // この呼び出しが scale / tx / ty を更新する。
    requestAnimationFrame(() => fitToContentImmediate());

    // window resize: canvas-wrap 幅が変わるので再フィット。debounce 簡易版。
    let resizeTimer: number | null = null;
    const onResize = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        fitToContentImmediate();
      }, 120);
    };
    window.addEventListener("resize", onResize);

    canvasEl.addEventListener("wheel", onWheel, { passive: false });
    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    canvasEl.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("pointerleave", onPointerUp);
    canvasEl.addEventListener("pointercancel", onPointerCancel);

    // タッチ 2 本指 pinch ハンドラ (= touch 専用、mouse は wheel に任せる)
    const onTouchDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStartScale = scale();
      }
    };
    const onTouchMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const factor = d / pinchDist;
        setScale(Math.min(SCALE_MAX, Math.max(SCALE_MIN, pinchStartScale * factor)));
      }
    };
    const clearTouch = (e: PointerEvent) => { pointers.delete(e.pointerId); };
    canvasEl.addEventListener("pointerdown", onTouchDown);
    canvasEl.addEventListener("pointermove", onTouchMove);
    canvasEl.addEventListener("pointerup", clearTouch);
    canvasEl.addEventListener("pointercancel", clearTouch);
    canvasEl.addEventListener("pointerleave", clearTouch);

    // フィルタドロップダウンの outside-click は filter 自身に scope する。
    // document 全体に attach すると CommandPalette 等のグローバルイベントと
    // 順序が予測できなくなるため、open 時のみ + bl-filter jail 外 click のみ拾う。
    const onDocClick = (ev: MouseEvent) => {
      if (!filterOpen()) return;
      const tgt = ev.target as Element | null;
      if (!tgt?.closest(".bl-filter")) setFilterOpen(false);
    };
    document.addEventListener("click", onDocClick);

    // ───── グローバルキーボード (v2.1) ─────────────────────
    //   Esc: フィルタを閉じる
    //   0  : 表示をリセット
    //   ]  : サイドパネル折り畳みトグル
    //   ↑↓←→: 80px ぶん pan
    //   +/-: ズーム
    //   入力欄 (input/textarea/contentEditable) では発動しない。
    const onGlobalKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement) return;
      if (target instanceof HTMLTextAreaElement) return;
      if (target?.isContentEditable) return;

      if (e.key === "Escape") {
        if (filterOpen()) {
          setFilterOpen(false);
          e.preventDefault();
          return;
        }
      }
      if (e.key === "0") { fitToContentAnimated(); return; }
      if (e.key === "]") { setPanelCollapsed(!panelCollapsed()); return; }
      const PAN_STEP = 80;
      if (e.key === "ArrowLeft")  { setTx(tx() + PAN_STEP); e.preventDefault(); return; }
      if (e.key === "ArrowRight") { setTx(tx() - PAN_STEP); e.preventDefault(); return; }
      if (e.key === "ArrowUp")    { setTy(ty() + PAN_STEP); e.preventDefault(); return; }
      if (e.key === "ArrowDown")  { setTy(ty() - PAN_STEP); e.preventDefault(); return; }
      if (e.key === "+" || e.key === "=") { setScale(Math.min(SCALE_MAX, scale() * 1.2)); return; }
      if (e.key === "-") { setScale(Math.max(SCALE_MIN, scale() / 1.2)); return; }
    };
    document.addEventListener("keydown", onGlobalKey);

    onCleanup(() => {
      canvasEl.removeEventListener("wheel", onWheel);
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      canvasEl.removeEventListener("pointermove", onPointerMove);
      canvasEl.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("pointerleave", onPointerUp);
      canvasEl.removeEventListener("pointercancel", onPointerCancel);
      canvasEl.removeEventListener("pointerdown", onTouchDown);
      canvasEl.removeEventListener("pointermove", onTouchMove);
      canvasEl.removeEventListener("pointerup", clearTouch);
      canvasEl.removeEventListener("pointercancel", clearTouch);
      canvasEl.removeEventListener("pointerleave", clearTouch);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onGlobalKey);
      window.removeEventListener("resize", onResize);
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      if (animFrame !== null) cancelAnimationFrame(animFrame);
      if (panRaf !== null) cancelAnimationFrame(panRaf);
    });
  });

  // ───── フィルタ ───────────────────────────────────────
  const setFilter = (sp: FilterSp) => {
    setFilterSp(sp);
    setFilterOpen(false);
    if (sp !== "all") {
      const section = SECTIONS.find((s) => s.sp === sp);
      if (section) {
        const cx = (section.x + section.x2) / 2;
        const cy = section.y + 200;
        // フィルタはあくまで pan 操作。ズームはユーザの現在値を維持する。
        const targetScale = scale();
        animateTo(VIEW_CX - cx * targetScale, VIEW_CY - cy * targetScale, targetScale);
      }
    }
  };

  /** ノード / エッジの可視化レベル (= フィルタ外は薄く落とす)。
   *  選んだ種だけ通常表示、それ以外は全部 0.13 (ノード) / 0.08 (エッジ) で「奥に引く」。 */
  const opacityFor = (sp: Sp): string => {
    const f = filterSp();
    return f === "all" || f === sp ? "" : "0.13";
  };
  const edgeOpacityFor = (sp: Sp): string => {
    const f = filterSp();
    return f === "all" || f === sp ? "" : "0.08";
  };
  const pairJoinOpacity = (): string => {
    const f = filterSp();
    return f === "all" ? "" : "0.08";
  };

  // ───── 「カルテを開く」ボタン挙動 ─────────────────────
  //   v2.3: ページ遷移ではなくモーダル表示に切替 (= 戻る操作を不要に)。
  //   モーダル内に「詳細ページへ」リンクがあるので、フル画面で見たい場合は
  //   そこから navigate する。disabled は呼び出し側で carteAvailable() ガード済。
  //   万一 disabled が外れた状態で呼ばれた場合のために toast で吸収。
  const openCarte = () => {
    const id = selectedId();
    if (!specimenExists(id)) {
      showToast({
        message: `${id} は飼育カルテに未登録の血統個体です`,
        tone: "warn",
      });
      return;
    }
    setCarteOpen(true);
  };

  // ───── elbow connector path 生成 ──────────────────────
  const elbowPath = (x1: number, y1: number, x2: number, y2: number, midY: number) =>
    `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`;

  return (
    <>
      <div
        class="bl-app"
        data-bloodline-mindmap
        data-panel={panelCollapsed() ? "collapsed" : "expanded"}
      >
        {/* ── キャンバス (v2.1: ヘッダ無し / overlay は Filter + Panel toggle のみ) ── */}
        <div class="bl-canvas-wrap">
          {/* Species フィルタ — canvas 左上 floating */}
          <div
            class="bl-filter"
            data-open={filterOpen() ? "true" : "false"}
          >
            <button
              type="button"
              class="bl-filter-trigger"
              aria-haspopup="listbox"
              aria-expanded={filterOpen() ? "true" : "false"}
              onClick={(e) => {
                e.stopPropagation();
                setFilterOpen(!filterOpen());
              }}
            >
              <span class="bl-label-prefix">Species</span>
              <span class="bl-current">
                {filterSp() === "all" ? "すべて" : labelOf(filterSp() as Sp)}
              </span>
              <span class="bl-caret">▾</span>
            </button>
            <div class="bl-filter-menu" role="listbox">
              <div class="bl-menu-label">表示する種</div>
              <FilterMenuItem
                current={filterSp()} sp="all"
                label="すべて" count={NODES.length}
                onPick={setFilter}
              />
              <div class="bl-menu-sep" />
              <For each={(["dhh", "cat", "nat", "neo"] as const)}>
                {(sp) => (
                  <FilterMenuItem
                    current={filterSp()} sp={sp}
                    label={labelOf(sp)}
                    count={NODES.filter((n) => n.sp === sp).length}
                    onPick={setFilter}
                  />
                )}
              </For>
              {/* v2.2: 種別ラベルをユーザがリネームできるエントリ */}
              <div class="bl-menu-sep" />
              <button
                type="button"
                class="bl-menu-edit"
                onClick={(e) => {
                  e.stopPropagation();
                  setFilterOpen(false);
                  setLabelEditOpen(true);
                }}
              >
                <span class="bl-menu-edit-icon" aria-hidden="true">✎</span>
                ラベルを編集...
              </button>
            </div>
          </div>

          <svg
            ref={(el) => (canvasEl = el)}
            class="bl-canvas"
            viewBox="0 0 1700 1200"
            preserveAspectRatio="xMidYMid meet"
            /* v2.4: overflow=visible で viewBox 外にも描画させる。
               fit-to-content で content scale > 1 になると content が viewBox 端を
               超える可能性があるため。canvas-wrap 側に overflow:hidden があるので
               最終的なクリップは canvas-wrap 端で発生する。 */
            overflow="visible"
          >
            <g transform={`translate(${tx()},${ty()}) scale(${scale()})`}>
              {/* ── セクション (= 章見出し) ── */}
              <g class="bl-sections">
                <For each={SECTIONS}>
                  {(s) => (
                    <g style={{ opacity: opacityFor(s.sp) }}>
                      <text class="bl-section-num" x={s.x} y={s.y}>{s.num}</text>
                      <text class="bl-section-label" x={s.x + 28} y={s.y}>{labelOf(s.sp)}</text>
                      <text class="bl-section-sub" x={s.x2} y={s.y} text-anchor="end">{s.sub}</text>
                      <line class="bl-section-rule" x1={s.x} y1={s.y + 12} x2={s.x2} y2={s.y + 12} />
                      <line class="bl-section-rule-hair" x1={s.x} y1={s.y + 16} x2={s.x2} y2={s.y + 16} />
                    </g>
                  )}
                </For>
              </g>

              {/* ── エッジ ── */}
              <g class="bl-edges">
                <For each={PAIRS}>
                  {(p) => {
                    const a = findNode(p.a)!;
                    const b = findNode(p.b)!;
                    const ax = a.x + NODE_W / 2;
                    const ay = a.y + NODE_H;
                    const bx = b.x + NODE_W / 2;
                    const by = b.y + NODE_H;
                    const joinY = Math.max(ay, by) + 32;
                    const mx = (ax + bx) / 2;
                    return (
                      <>
                        {/* 両親 → ジョイン棒 */}
                        <path class="bl-pair-join"
                          style={{ opacity: pairJoinOpacity() }}
                          d={`M ${ax} ${ay} V ${joinY}`} />
                        <path class="bl-pair-join"
                          style={{ opacity: pairJoinOpacity() }}
                          d={`M ${bx} ${by} V ${joinY}`} />
                        <path class="bl-pair-join"
                          style={{ opacity: pairJoinOpacity() }}
                          d={`M ${Math.min(ax, bx)} ${joinY} H ${Math.max(ax, bx)}`} />
                        {/* ジョイン点 → 各子 */}
                        <For each={p.children}>
                          {(cid) => {
                            const c = findNode(cid);
                            if (!c) return null;
                            const cx = c.x + NODE_W / 2;
                            const cy = c.y;
                            const busY = joinY + Math.max(48, (cy - joinY) / 2);
                            return (
                              <path
                                class="bl-edge"
                                data-sp={c.sp}
                                style={{ opacity: edgeOpacityFor(c.sp) }}
                                d={elbowPath(mx, joinY, cx, cy, busY)}
                              />
                            );
                          }}
                        </For>
                      </>
                    );
                  }}
                </For>
              </g>

              {/* ── ノード ── */}
              <g class="bl-nodes">
                <For each={NODES}>
                  {(n) => (
                    <g
                      class={`bl-node${selectedId() === n.id ? " bl-selected" : ""}`}
                      data-id={n.id}
                      data-sp={n.sp}
                      data-end={n.end ?? "active"}
                      transform={`translate(${n.x},${n.y})`}
                      style={{ opacity: opacityFor(n.sp) }}
                      role="button"
                      // v2.1: 故 / 譲渡個体は Tab 経路から外す (= 巡回を短縮)。
                      tabindex={n.end ? -1 : 0}
                      aria-label={`${labelOf(n.sp)} ${n.name} ${n.id} (${n.gen}, ${n.size})`}
                      aria-pressed={selectedId() === n.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectNode(n.id);
                      }}
                      onKeyDown={(e: KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectNode(n.id);
                        }
                      }}
                    >
                      <rect class="bl-bg" x={0} y={0} width={NODE_W} height={NODE_H} rx={2} ry={2} />
                      <rect class="bl-accent" x={0} y={0} width={NODE_W} height={1.5} />
                      {/* accent dot top-right (緊急ノードはここに置き換え) */}
                      <Show when={!n.urgent}>
                        <circle class="bl-accent-dot" cx={NODE_W - 10} cy={14} r={2} />
                      </Show>
                      {/* gen tag (top-left) */}
                      <text class="bl-gen-tag" x={14} y={18}>{n.gen}</text>
                      {/* name */}
                      <text class="bl-name" x={14} y={42}>{n.name}</text>
                      {/* sex (right) */}
                      <text class="bl-sex" x={NODE_W - 14} y={42} text-anchor="end">
                        {sexGlyph(n.sex)}
                      </text>
                      {/* hairline divider */}
                      <line class="bl-divider" x1={14} y1={52} x2={NODE_W - 14} y2={52} />
                      {/* ID + size */}
                      <text class="bl-id" x={14} y={67}>{n.id}</text>
                      <text class="bl-meta" x={NODE_W - 14} y={67} text-anchor="end">{n.size}</text>

                      {/* 緊急マーカー (= 右上 ドット + eyebrow テキスト) */}
                      <Show when={n.urgent}>
                        <circle class="bl-urgent-dot" cx={NODE_W - 10} cy={14} r={2.5} />
                        <text class="bl-urgent-tx" x={NODE_W - 18} y={18} text-anchor="end">
                          {n.urgent}
                        </text>
                      </Show>
                      {/* 故 / 譲渡 (緊急が無い時のみ。緊急と end は通常両立しない) */}
                      <Show when={!n.urgent && n.end === "deceased"}>
                        <text class="bl-end-mark" x={NODE_W - 18} y={18} text-anchor="end">故</text>
                      </Show>
                      <Show when={!n.urgent && n.end === "transferred"}>
                        <text class="bl-end-mark" x={NODE_W - 18} y={18} text-anchor="end">譲渡</text>
                      </Show>
                    </g>
                  )}
                </For>
              </g>
            </g>
          </svg>

          {/* ── サイドパネル折り畳みトグル (= ] キーでも操作可) ── */}
          <button
            type="button"
            class="bl-panel-toggle"
            aria-label={panelCollapsed() ? "サイドパネルを開く" : "サイドパネルを閉じる"}
            onClick={() => setPanelCollapsed(!panelCollapsed())}
          >
            {panelCollapsed() ? "‹" : "›"}
          </button>
        </div>

        {/* ── サイドパネル ─────────────── */}
        <aside class="bl-panel">
          <Show when={selectedNode()} fallback={<div class="bl-sub">個体が見つかりません</div>}>
            {(n) => {
              // sex==="u" (= 幼虫で性別未確定) は MatingRecordModal の親候補に
              // 上がらないので「交配記録」ボタンを disabled にする。
              const matingDisabled = () => n().sex === "u";
              const isOrigin = () =>
                relations().parents.length === 0 &&
                relations().pairs.length === 0 &&
                relations().children.length === 0;
              return (
                <>
                  <div class="bl-eyebrow">{`${labelOf(n().sp)} · ${n().gen}`}</div>
                  <h3>
                    {n().name}
                    <span class="bl-sex-glyph">{sexGlyph(n().sex)}</span>
                  </h3>
                  <div class="bl-sub">{n().id}</div>

                  <div class="bl-specs">
                    <div class="bl-kv"><span class="bl-k">Sex</span><span class="bl-leader" /><span class="bl-v">{sexLabel(n().sex)}</span></div>
                    <div class="bl-kv"><span class="bl-k">Gen</span><span class="bl-leader" /><span class="bl-v bl-mono">{n().gen}</span></div>
                    <div class="bl-kv"><span class="bl-k">Size</span><span class="bl-leader" /><span class="bl-v bl-mono">{n().size}</span></div>
                    <div class="bl-kv"><span class="bl-k">State</span><span class="bl-leader" /><span class="bl-v">{
                      (n().urgent ? `${n().urgent} · ` : "") + n().state
                    }</span></div>
                    <div class="bl-kv"><span class="bl-k">From</span><span class="bl-leader" /><span class="bl-v">{n().from}</span></div>
                  </div>

                  <section class="bl-section">
                    <div class="bl-section-heading"><span class="bl-num">I.</span> 親 · ペア · 子</div>
                    <div class="bl-relations">
                      <Show when={isOrigin()}>
                        <button type="button" class="bl-relation" disabled>
                          <span class="bl-role">起点</span>
                          <span class="bl-nm">F0 起点個体</span>
                        </button>
                      </Show>
                      <For each={relations().parents}>
                        {(p) => (
                          <button type="button" class="bl-relation" onClick={() => jumpToNode(p.id)}>
                            <span class="bl-role">{p.sex === "m" ? "父 ♂" : "母 ♀"}</span>
                            <span class="bl-nm">{p.name}</span>
                            <span class="bl-id">{p.id}</span>
                          </button>
                        )}
                      </For>
                      <For each={relations().pairs}>
                        {(pair) => (
                          <button type="button" class="bl-relation" onClick={() => jumpToNode(pair.id)}>
                            <span class="bl-role">ペア</span>
                            <span class="bl-nm">{pair.name}</span>
                            <span class="bl-id">{pair.id}</span>
                          </button>
                        )}
                      </For>
                      <For each={relations().children}>
                        {(c) => (
                          <button type="button" class="bl-relation" onClick={() => jumpToNode(c.id)}>
                            <span class="bl-role">子</span>
                            <span class="bl-nm">{c.name}</span>
                            <span class="bl-id">{c.id}</span>
                          </button>
                        )}
                      </For>
                      <For each={relations().siblings}>
                        {(s) => (
                          <button type="button" class="bl-relation" onClick={() => jumpToNode(s.id)}>
                            <span class="bl-role">同腹</span>
                            <span class="bl-nm">{s.name}</span>
                            <span class="bl-id">{s.id}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </section>

                  <section class="bl-section">
                    <div class="bl-section-heading"><span class="bl-num">II.</span> 血統メモ</div>
                    <div class="bl-memo">{n().memo || "—"}</div>
                  </section>

                  <div class="bl-actions">
                    <button
                      type="button"
                      class="bl-btn-primary"
                      disabled={!carteAvailable()}
                      title={!carteAvailable() ? "飼育カルテに未登録の血統個体です" : undefined}
                      onClick={openCarte}
                    >
                      カルテを開く
                    </button>
                    <button
                      type="button"
                      class="bl-btn-ghost"
                      disabled={matingDisabled()}
                      title={matingDisabled() ? "性別未確定の個体は交配相手として登録できません" : undefined}
                      onClick={() => setMatingOpen(true)}
                    >
                      交配記録
                    </button>
                  </div>
                </>
              );
            }}
          </Show>
        </aside>
      </div>

      {/* ── 交配記録モーダル ─────────────── */}
      <MatingRecordModal
        open={matingOpen()}
        onClose={() => setMatingOpen(false)}
        seedSelectedId={selectedId()}
      />

      {/* ── カルテモーダル (v2.3) ─────────────── */}
      <SpecimenCarteModal
        open={carteOpen()}
        specimenId={selectedId()}
        onClose={() => setCarteOpen(false)}
      />

      {/* ── 種別ラベル編集ダイアログ (v2.2) ─────────── */}
      <Show when={labelEditOpen()}>
        <LabelEditDialog
          customLabels={customLabels()}
          onSave={(values) => {
            // 4 種すべてを 1 度に保存 (= 個別 setLabel を 4 回呼ぶ)
            for (const sp of SP_LIST) setLabel(sp, values[sp] ?? "");
            setLabelEditOpen(false);
          }}
          onCancel={() => setLabelEditOpen(false)}
        />
      </Show>
    </>
  );
};

// ─── 内部: filter dropdown 1 行 ────────────────────────────────────────
function FilterMenuItem(props: {
  current: FilterSp;
  sp: FilterSp;
  label: string;
  count: number;
  onPick: (sp: FilterSp) => void;
}) {
  // sp に対応する swatch 色を出す。"all" は破線の透明 swatch。
  const swStyle = (): { background?: string; border?: string } => {
    if (props.sp === "all") return { background: "transparent", border: "1px dashed var(--bl-line-strong)" };
    const m: Record<Sp, string> = {
      dhh: "var(--bl-sp-dhh)",
      cat: "var(--bl-sp-cat)",
      nat: "var(--bl-sp-nat)",
      neo: "var(--bl-sp-neo)",
    };
    return { background: m[props.sp as Sp] };
  };
  return (
    <button
      type="button"
      aria-pressed={props.current === props.sp}
      onClick={() => props.onPick(props.sp)}
    >
      <span class="bl-check">✓</span>
      <span class="bl-sw" style={swStyle()} />
      {props.label}
      <span class="bl-count">{props.count}</span>
    </button>
  );
}

// ─── 種別ラベル編集ダイアログ ────────────────────────────────────────
//
// 4 種の表示名 (ヘラクレス / コーカサス / 国産 / ネプチューン) を一括編集する。
// 中身は controlled inputs。Save 押下で親に { dhh, cat, nat, neo } を返し、親が
// `setLabel` を 4 回呼んで signal + localStorage に書き込む。
//
// 入力欄を空にすると default に戻す扱い (= setLabel 側で空文字を解除と解釈)。
// Esc / 背景クリックで cancel、Enter で save。
function LabelEditDialog(props: {
  customLabels: Partial<Record<Sp, string>>;
  onSave: (values: Partial<Record<Sp, string>>) => void;
  onCancel: () => void;
}) {
  // 現在値 = custom があれば custom、無ければ default を初期 input に置く。
  const init = (sp: Sp): string =>
    props.customLabels[sp] ?? DEFAULT_SP_LABELS[sp];
  const [vDhh, setVDhh] = createSignal(init("dhh"));
  const [vCat, setVCat] = createSignal(init("cat"));
  const [vNat, setVNat] = createSignal(init("nat"));
  const [vNeo, setVNeo] = createSignal(init("neo"));

  const submit = () => {
    props.onSave({
      dhh: vDhh(),
      cat: vCat(),
      nat: vNat(),
      neo: vNeo(),
    });
  };
  const resetOne = (sp: Sp) => {
    const def = DEFAULT_SP_LABELS[sp];
    if (sp === "dhh") setVDhh(def);
    if (sp === "cat") setVCat(def);
    if (sp === "nat") setVNat(def);
    if (sp === "neo") setVNeo(def);
  };

  // Esc キーで cancel
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onCancel();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => document.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions));
  });

  type Row = { sp: Sp; value: () => string; setValue: (v: string) => void };
  const rows: Row[] = [
    { sp: "dhh", value: vDhh, setValue: setVDhh },
    { sp: "cat", value: vCat, setValue: setVCat },
    { sp: "nat", value: vNat, setValue: setVNat },
    { sp: "neo", value: vNeo, setValue: setVNeo },
  ];

  return (
    <div class="bl-dialog-backdrop" onClick={props.onCancel}>
      <div
        class="bl-dialog"
        role="dialog"
        aria-label="種別ラベルを編集"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 class="bl-dialog-title">種別ラベルを編集</h3>
        <p class="bl-dialog-sub">
          各種の表示名を変更できます。空にして保存するとデフォルトに戻ります。
        </p>
        <form
          class="bl-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <For each={rows}>
            {(r) => (
              <label class="bl-dialog-row">
                <span class="bl-dialog-default">{DEFAULT_SP_LABELS[r.sp]}</span>
                <input
                  class="bl-dialog-input"
                  type="text"
                  maxLength={32}
                  value={r.value()}
                  onInput={(e) => r.setValue(e.currentTarget.value)}
                  placeholder={DEFAULT_SP_LABELS[r.sp]}
                />
                <button
                  type="button"
                  class="bl-dialog-reset"
                  onClick={() => resetOne(r.sp)}
                  title="既定に戻す"
                  aria-label={`${DEFAULT_SP_LABELS[r.sp]} を既定に戻す`}
                >
                  ↺
                </button>
              </label>
            )}
          </For>
          <div class="bl-dialog-actions">
            <button type="button" class="bl-btn-ghost" onClick={props.onCancel}>
              キャンセル
            </button>
            <button type="submit" class="bl-btn-primary">
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
