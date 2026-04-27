// Bloodline.legacy.tsx — 旧 血統系図 (= "フォーカス3G + 俯瞰ツリー" 二段タブ実装)
//
// **DEPRECATED (2026-04-27)**:
//   新しい editorial mindmap は `pages/Bloodline.tsx` に移行済み (= /bloodline)。
//   本ファイルは旧実装の参照用に保存している。tsconfig.json の
//   `exclude: ["src/**/*.legacy.tsx"]` で型チェック対象外。
//   現状 import している箇所は無し (= MatingRecordModal も新 Bloodline.tsx を参照)。
//   Phase 9.x の安定化が確認できたら削除予定。
//
// ── 旧実装の説明 ──
//
// 構成:
//   フォーカスモード (3 世代) をメインに、俯瞰ツリー (SVG 親子線) を切替タブで併設。
//   レビュー前の課題:
//     1) 親子線が描画されていない / ペアが見えない
//     2) 選択個体の祖先ルートがハイライトされない
//     3) 右パネルがハードコードで選択と連動しない
//     4) 縦に無限に伸びる
//     5) 性別の視覚差が弱い / カルテ導線が無い
//   本実装はすべてを解消する。
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { getAuditLog, specimenExists, type LifeStatus } from "../api";
import { type RouteKey } from "../data";
import { bloodlineUrl } from "../router";
import { LifeStatusBadge } from "../components/specimen/LifeStatusBadge";
import { MatingRecordModal } from "../components/bloodline/MatingRecordModal";
import { showToast } from "../store/toast";

// ============================================================================
//  Data model (flat lookup)
// ============================================================================

export type Sex = "m" | "f";
type GenKey = "F0" | "CBF1" | "CBF2" | "CBF3";

export interface Individual {
  id: string;
  name: string;
  sex: Sex;
  generation: GenKey;
  year: string;
  sizeMm?: number;
  parents: string[]; // [] (WILD) or [father, mother]
  isWild: boolean;
  status?: string;
  /** P4-3: ライフ状態。"deceased" の場合は系図で喪章表示 + opacity ダウン。 */
  lifeStatus?: LifeStatus;
  /** P4-3: 故個体の逝去日 (YYYY-MM-DD)。サイドパネルで参照。 */
  lifeStatusDate?: string;
  eclosionInDays?: number;
  /** Wright の近交係数。サンプルデータでは 親ペアの F と親同士の血縁から算出した値を手動設定。 */
  inbreedingCoef?: number;
  hasPedigreeCert?: boolean;
  origin?: string;
}

const GENS: Record<GenKey, { label: string; year: string }> = {
  F0: { label: "F₀", year: "2019 · 野生" },
  CBF1: { label: "CBF1", year: "2022" },
  CBF2: { label: "CBF2", year: "2023-24" },
  CBF3: { label: "CBF3", year: "2025-26 · 現世代" },
};

const GEN_ORDER: GenKey[] = ["F0", "CBF1", "CBF2", "CBF3"];

const INDIVIDUALS_LIST: Individual[] = [
  {
    id: "#DHH-WILD-A",
    name: "野生 ♂",
    sex: "m",
    generation: "F0",
    year: "2019",
    parents: [],
    isWild: true,
    origin: "グアドループ産 2019",
  },
  {
    id: "#DHH-WILD-B",
    name: "野生 ♀",
    sex: "f",
    generation: "F0",
    year: "2019",
    parents: [],
    isWild: true,
    origin: "グアドループ産 2019",
  },
  {
    id: "#DHH-0198",
    name: "月影",
    sex: "m",
    generation: "CBF1",
    year: "2022",
    sizeMm: 148,
    parents: ["#DHH-WILD-A", "#DHH-WILD-B"],
    isWild: false,
    inbreedingCoef: 0,
    /* P4-3: 2025-10-02 自然死。CBF2 (漆黒・マリア) を残して退場した初代父。
     * 系図では opacity 0.5 + 右上の喪章 (✝) バッジで識別。 */
    lifeStatus: "deceased",
    lifeStatusDate: "2025-10-02",
  },
  {
    id: "#DHH-0204",
    name: "花音",
    sex: "f",
    generation: "CBF1",
    year: "2022",
    sizeMm: 68,
    parents: ["#DHH-WILD-A", "#DHH-WILD-B"],
    isWild: false,
    inbreedingCoef: 0,
  },
  {
    id: "#DHH-0213",
    name: "漆黒",
    sex: "m",
    generation: "CBF2",
    year: "2024",
    sizeMm: 152,
    parents: ["#DHH-0198", "#DHH-0204"],
    isWild: false,
    inbreedingCoef: 0.25, // 全兄妹交配
  },
  {
    id: "#DHH-0244",
    name: "マリア",
    sex: "f",
    generation: "CBF2",
    year: "2023",
    sizeMm: 66,
    parents: ["#DHH-0198", "#DHH-0204"],
    isWild: false,
    inbreedingCoef: 0.25,
  },
  {
    id: "#DHH-0271",
    name: "黒曜",
    sex: "m",
    generation: "CBF3",
    year: "2025",
    parents: ["#DHH-0213", "#DHH-0244"],
    isWild: false,
    status: "蛹",
    eclosionInDays: 15,
    inbreedingCoef: 0.375,
    hasPedigreeCert: true,
  },
  {
    id: "#DHH-0272",
    name: "翠",
    sex: "m",
    generation: "CBF3",
    year: "2025",
    sizeMm: 146,
    parents: ["#DHH-0213", "#DHH-0244"],
    isWild: false,
    inbreedingCoef: 0.375,
  },
  {
    id: "#DHH-0273",
    name: "朔",
    sex: "f",
    generation: "CBF3",
    year: "2025",
    sizeMm: 65,
    parents: ["#DHH-0213", "#DHH-0244"],
    isWild: false,
    inbreedingCoef: 0.375,
  },
];

const INDIVIDUALS: Record<string, Individual> = Object.fromEntries(
  INDIVIDUALS_LIST.map((i) => [i.id, i]),
);

const allIndividuals = () => INDIVIDUALS_LIST;
const getIndividual = (id: string): Individual | undefined => INDIVIDUALS[id];

/** P4-22: MatingRecordModal から個体一覧を参照できるよう export。 */
export const listBloodlineIndividuals = (): Individual[] => INDIVIDUALS_LIST;
export const getBloodlineIndividual = (id: string): Individual | undefined =>
  INDIVIDUALS[id];

const getParentsOrdered = (
  id: string,
): [Individual | null, Individual | null] => {
  const ind = getIndividual(id);
  if (!ind || ind.parents.length === 0) return [null, null];
  const list = ind.parents
    .map((p) => getIndividual(p))
    .filter(Boolean) as Individual[];
  const father = list.find((p) => p.sex === "m") ?? null;
  const mother = list.find((p) => p.sex === "f") ?? null;
  return [father, mother];
};

const getChildren = (id: string): Individual[] =>
  allIndividuals().filter((i) => i.parents.includes(id));

const getSiblings = (id: string): Individual[] => {
  const ind = getIndividual(id);
  if (!ind || ind.parents.length === 0) return [];
  return allIndividuals().filter((i) => {
    if (i.id === id) return false;
    if (i.parents.length !== ind.parents.length) return false;
    return i.parents.every((p) => ind.parents.includes(p));
  });
};

const getAncestorIds = (id: string): Set<string> => {
  const acc = new Set<string>();
  const walk = (cur: string) => {
    const c = getIndividual(cur);
    if (!c) return;
    for (const p of c.parents) {
      if (!acc.has(p)) {
        acc.add(p);
        walk(p);
      }
    }
  };
  walk(id);
  return acc;
};

/** 近交係数を「安全 / 注意 / 濃い」のバンドに分類 */
const fBand = (
  f: number | undefined,
): { label: string; tone: "forest" | "amber" | "rose"; desc: string } => {
  const fc = f ?? 0;
  if (fc < 0.05)
    return {
      label: "安全",
      tone: "forest",
      desc: "近交係数は低く、血の多様性が保たれています。",
    };
  if (fc < 0.125)
    return {
      label: "注意",
      tone: "amber",
      desc: "やや血縁が濃いです。次代の交配では別系統を検討してください。",
    };
  return {
    label: "濃い",
    tone: "rose",
    desc: "近交係数が高めです。可能であれば異なる系統との交配を推奨します。",
  };
};

// P4-21: AUDIT_LOG は api.getAuditLog(id) に一元化。固定サンプルは削除。

// ============================================================================
//  Shared UI pieces
// ============================================================================

type CardVariant = "default" | "self" | "ancestor" | "dim";

const IndividualCard = (p: {
  ind: Individual;
  variant?: CardVariant;
  compact?: boolean;
  onClick?: () => void;
}) => {
  const v = () => p.variant ?? "default";
  return (
    <button
      type="button"
      class="ind-card"
      classList={{
        [`is-${v()}`]: true,
        [`sex-${p.ind.sex}`]: true,
        "is-wild": p.ind.isWild,
        "is-compact": !!p.compact,
        /* P4-3: 故個体を視覚的にトーンダウン + 喪章 (::after) */
        "is-deceased": p.ind.lifeStatus === "deceased",
      }}
      data-ind={p.ind.id}
      /* P3-20: 世代 / 野生・累代 で左ストライプを色分け (CSS 側で ::before) */
      data-gen={p.ind.generation}
      data-kind={p.ind.isWild ? "wild" : "cb"}
      /* P4-3: ライフ状態。CSS 側で喪章 / 色味を切替 */
      data-life={p.ind.lifeStatus ?? "active"}
      onClick={p.onClick}
      aria-label={
        p.ind.lifeStatus === "deceased"
          ? `${p.ind.name} ${p.ind.id} (故)`
          : `${p.ind.name} ${p.ind.id}`
      }
    >
      <div class="ind-head">
        <span class="ind-sex" aria-hidden="true">
          {p.ind.sex === "m" ? "♂" : "♀"}
        </span>
        <span class="ind-id mono">{p.ind.id}</span>
      </div>
      <div class="ind-name">{p.ind.name}</div>
      <div class="ind-meta mono">
        <Show
          when={p.ind.isWild}
          fallback={
            p.ind.sizeMm
              ? `${p.ind.sizeMm}mm · ${p.ind.year}`
              : `${p.ind.generation} · ${p.ind.year}`
          }
        >
          {p.ind.origin}
        </Show>
        <Show when={p.ind.status}>
          <span>{" · "}{p.ind.status}</span>
        </Show>
        <Show when={p.ind.eclosionInDays != null}>
          <span>{" · あと"}{p.ind.eclosionInDays}日</span>
        </Show>
        <Show when={p.ind.lifeStatus === "deceased"}>
          <span class="ind-memorial">
            {" · 故"}
            <Show when={p.ind.lifeStatusDate}>
              {" "}{p.ind.lifeStatusDate}
            </Show>
          </span>
        </Show>
      </div>
    </button>
  );
};

const EmptySlot = (p: { label?: string }) => (
  <div class="ind-slot" aria-label="記録なし">
    <span class="mono">{p.label ?? "未記録"}</span>
  </div>
);

// ============================================================================
//  Focus view (default) — 3 世代 + きょうだい + 子
// ============================================================================

const FocusView = (props: {
  selectedId: string;
  setSelectedId: (id: string) => void;
}) => {
  const self = () => getIndividual(props.selectedId);
  const parentsOrd = () => getParentsOrdered(props.selectedId);
  const father = () => parentsOrd()[0];
  const mother = () => parentsOrd()[1];
  const paternalGP = () =>
    father() ? getParentsOrdered(father()!.id) : ([null, null] as [null, null]);
  const maternalGP = () =>
    mother() ? getParentsOrdered(mother()!.id) : ([null, null] as [null, null]);
  const siblings = () => getSiblings(props.selectedId);
  const children = () => getChildren(props.selectedId);
  const hasParent = () => !!(father() || mother());

  const goTo = (id: string) => props.setSelectedId(id);

  return (
    <div class="focus-tree" aria-label="血統フォーカスビュー">
      <Show when={hasParent()}>
        <div class="focus-row gp-row">
          <div class="gp-pair" data-side="paternal">
            <Show when={paternalGP()[0]} fallback={<EmptySlot label="不明 ♂" />}>
              <IndividualCard
                ind={paternalGP()[0]!}
                compact
                variant="ancestor"
                onClick={() => goTo(paternalGP()[0]!.id)}
              />
            </Show>
            <span class="cross">×</span>
            <Show when={paternalGP()[1]} fallback={<EmptySlot label="不明 ♀" />}>
              <IndividualCard
                ind={paternalGP()[1]!}
                compact
                variant="ancestor"
                onClick={() => goTo(paternalGP()[1]!.id)}
              />
            </Show>
          </div>
          <div class="gp-pair" data-side="maternal">
            <Show when={maternalGP()[0]} fallback={<EmptySlot label="不明 ♂" />}>
              <IndividualCard
                ind={maternalGP()[0]!}
                compact
                variant="ancestor"
                onClick={() => goTo(maternalGP()[0]!.id)}
              />
            </Show>
            <span class="cross">×</span>
            <Show when={maternalGP()[1]} fallback={<EmptySlot label="不明 ♀" />}>
              <IndividualCard
                ind={maternalGP()[1]!}
                compact
                variant="ancestor"
                onClick={() => goTo(maternalGP()[1]!.id)}
              />
            </Show>
          </div>
        </div>
      </Show>

      <Show when={hasParent()}>
        <div class="focus-row parent-row">
          <Show when={father()} fallback={<EmptySlot label="父 不明" />}>
            <IndividualCard
              ind={father()!}
              variant="ancestor"
              onClick={() => goTo(father()!.id)}
            />
          </Show>
          <span class="cross big">×</span>
          <Show when={mother()} fallback={<EmptySlot label="母 不明" />}>
            <IndividualCard
              ind={mother()!}
              variant="ancestor"
              onClick={() => goTo(mother()!.id)}
            />
          </Show>
        </div>
      </Show>

      <div class="focus-row self-row">
        <div class="self-wrap">
          <div class="mono eyebrow">選択中</div>
          <Show when={self()}>
            <IndividualCard ind={self()!} variant="self" />
          </Show>
        </div>
        <Show when={siblings().length > 0}>
          <div class="sib-group">
            <div class="sib-label mono">きょうだい · {siblings().length}</div>
            <div class="sib-list">
              <For each={siblings()}>
                {(s) => (
                  <IndividualCard
                    ind={s}
                    compact
                    onClick={() => goTo(s.id)}
                  />
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      <Show when={children().length > 0}>
        <div class="focus-row children-row">
          <div class="ch-label mono">子 · {children().length}</div>
          <div class="ch-list">
            <For each={children()}>
              {(c) => (
                <IndividualCard
                  ind={c}
                  compact
                  onClick={() => goTo(c.id)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
//  Overview tree — 世代テーブル + SVG 親子線
// ============================================================================

interface TreeLine {
  type: "pair" | "child";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  highlight: boolean;
}

const TreeView = (props: {
  selectedId: string;
  setSelectedId: (id: string) => void;
}) => {
  let boardRef: HTMLDivElement | undefined;
  const [lines, setLines] = createSignal<TreeLine[]>([]);
  const [dims, setDims] = createSignal({ w: 0, h: 0 });

  const ancestors = () => getAncestorIds(props.selectedId);
  const onPath = (id: string) =>
    id === props.selectedId || ancestors().has(id);

  const measure = () => {
    if (!boardRef) return;
    const bRect = boardRef.getBoundingClientRect();
    setDims({ w: bRect.width, h: bRect.height });
    const result: TreeLine[] = [];
    const pairSeen = new Map<string, { p1: DOMRect; p2: DOMRect; hi: boolean }>();

    for (const ind of allIndividuals()) {
      if (ind.parents.length !== 2) continue;
      const childEl = boardRef.querySelector(
        `[data-ind="${CSS.escape(ind.id)}"]`,
      ) as HTMLElement | null;
      if (!childEl) continue;
      const cr = childEl.getBoundingClientRect();
      const parentEls = ind.parents
        .map(
          (pid) =>
            boardRef!.querySelector(
              `[data-ind="${CSS.escape(pid)}"]`,
            ) as HTMLElement | null,
        )
        .filter(Boolean) as HTMLElement[];
      if (parentEls.length !== 2) continue;
      const pRects = parentEls.map((el) => el.getBoundingClientRect());

      const key = [...ind.parents].sort().join("|");
      const childHi = onPath(ind.id);
      const existing = pairSeen.get(key);
      if (!existing) {
        pairSeen.set(key, { p1: pRects[0], p2: pRects[1], hi: childHi });
      } else if (childHi) {
        existing.hi = true;
      }

      // Child line: parent-pair midpoint → child top-center
      const p1c = {
        x: pRects[0].left + pRects[0].width / 2 - bRect.left,
        y: pRects[0].bottom - bRect.top,
      };
      const p2c = {
        x: pRects[1].left + pRects[1].width / 2 - bRect.left,
        y: pRects[1].bottom - bRect.top,
      };
      const midX = (p1c.x + p2c.x) / 2;
      const midY = Math.max(p1c.y, p2c.y) + 10;
      const cx = cr.left + cr.width / 2 - bRect.left;
      const cy = cr.top - bRect.top;
      result.push({
        type: "child",
        x1: midX,
        y1: midY,
        x2: cx,
        y2: cy,
        highlight: childHi,
      });
    }

    // Pair lines (horizontal under each crossing)
    for (const pair of pairSeen.values()) {
      const x1 = pair.p1.left + pair.p1.width / 2 - bRect.left;
      const x2 = pair.p2.left + pair.p2.width / 2 - bRect.left;
      const y = Math.max(pair.p1.bottom, pair.p2.bottom) + 10 - bRect.top;
      result.push({
        type: "pair",
        x1: Math.min(x1, x2),
        y1: y,
        x2: Math.max(x1, x2),
        y2: y,
        highlight: pair.hi,
      });
    }

    setLines(result);
  };

  onMount(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    if (boardRef) ro.observe(boardRef);
    onCleanup(() => ro.disconnect());
  });

  // 選択変更時にハイライト更新だけ再計算
  createEffect(() => {
    props.selectedId;
    queueMicrotask(measure);
  });

  return (
    <div ref={boardRef} class="tree-board">
      <svg
        class="tree-svg"
        width={dims().w}
        height={dims().h}
        aria-hidden="true"
      >
        <For each={lines()}>
          {(l) => (
            <Show
              when={l.type === "child"}
              fallback={
                <line
                  x1={l.x1}
                  y1={l.y1}
                  x2={l.x2}
                  y2={l.y2}
                  class={l.highlight ? "tw-line hi" : "tw-line"}
                />
              }
            >
              <path
                d={`M${l.x1},${l.y1} C${l.x1},${(l.y1 + l.y2) / 2
                  } ${l.x2},${(l.y1 + l.y2) / 2} ${l.x2},${l.y2}`}
                class={l.highlight ? "tw-line hi" : "tw-line"}
                fill="none"
              />
            </Show>
          )}
        </For>
      </svg>

      <For each={GEN_ORDER}>
        {(gen) => {
          const info = GENS[gen];
          return (
            <div class="tree-row">
              <div class="gen-label">
                <div class="mono eyebrow">世代</div>
                <div class="serif gen-title">{info.label}</div>
                <div class="mono gen-year">{info.year}</div>
              </div>
              <div class="gen-cards">
                <For
                  each={allIndividuals().filter((i) => i.generation === gen)}
                >
                  {(ind) => {
                    const variant = (): CardVariant =>
                      ind.id === props.selectedId
                        ? "self"
                        : ancestors().has(ind.id)
                          ? "ancestor"
                          : "dim";
                    return (
                      <IndividualCard
                        ind={ind}
                        variant={variant()}
                        onClick={() => props.setSelectedId(ind.id)}
                      />
                    );
                  }}
                </For>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
};

// ============================================================================
//  Side panel — reactive
// ============================================================================

const SidePanel = (props: {
  selectedId: string;
  setSelectedId: (id: string) => void;
  onOpenCarte?: (id: string) => void;
}) => {
  const ind = () => getIndividual(props.selectedId);
  const band = () => fBand(ind()?.inbreedingCoef);
  const ancestorCount = () => getAncestorIds(props.selectedId).size;
  const gen = () => ind()?.generation ?? "F0";
  const depth = () => GEN_ORDER.indexOf(gen());
  const kids = () => getChildren(props.selectedId);
  const carteAvailable = () => specimenExists(props.selectedId);
  // P4-21: 固定サンプルから api.getAuditLog() に差し替え
  const auditEntries = () => getAuditLog(props.selectedId);

  return (
    <div>
      <div class="card" style={{ padding: "20px" }}>
        <div class="mono eyebrow">選択中</div>
        <div
          class="serif"
          style={{
            "font-size": "20px",
            "font-weight": 600,
            "margin-bottom": "2px",
          }}
        >
          <Show when={ind()} fallback="—">
            {ind()!.name}
          </Show>
        </div>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            "flex-wrap": "wrap",
          }}
        >
          <span
            class="mono"
            style={{ "font-size": "11px", color: "var(--ink-mute)" }}
          >
            {props.selectedId}
          </span>
          {/* P4-3: 故個体はサイドパネル側にも LifeStatusBadge を表示 */}
          <Show when={ind()?.lifeStatus}>
            <LifeStatusBadge
              status={ind()!.lifeStatus}
              detail={
                ind()!.lifeStatusDate
                  ? { date: ind()!.lifeStatusDate! }
                  : undefined
              }
            />
          </Show>
        </div>

        <Show when={ind()}>
          <div
            style={{
              display: "flex",
              gap: "6px",
              "margin-top": "10px",
              "flex-wrap": "wrap",
            }}
          >
            <span class={`chip ${ind()!.sex === "m" ? "indigo" : "rose"}`}>
              {ind()!.sex === "m" ? "♂ 雄" : "♀ 雌"}
            </span>
            <span class="chip amber">{ind()!.generation}</span>
            <Show when={ind()!.status}>
              <span class="chip forest">{ind()!.status}</span>
            </Show>
            <Show when={ind()!.hasPedigreeCert}>
              <span class="chip indigo">血統書付</span>
            </Show>
            <Show when={ind()!.isWild}>
              <span class="chip">野生</span>
            </Show>
          </div>
        </Show>

        <Show when={ind() && !ind()!.isWild}>
          <div class="f-band">
            <div class="f-band-head">
              <span class="mono eyebrow">近交係数</span>
              <span class={`chip ${band().tone}`}>
                {band().label} · F={ind()!.inbreedingCoef?.toFixed(3)}
              </span>
            </div>
            <div class="f-band-desc">{band().desc}</div>
          </div>

          <div class="ancestry-box">
            <div class="mono eyebrow">祖先</div>
            <div>F₀ 野生個体から {depth()} 世代</div>
            <div
              class="mono"
              style={{
                "font-size": "10px",
                color: "var(--ink-faint)",
                "margin-top": "2px",
              }}
            >
              追跡可能な祖先 {ancestorCount()} 体
            </div>
          </div>
        </Show>

        <Show when={ind()}>
          <div style={{ "margin-top": "14px" }}>
            <button
              class="btn block"
              disabled={!carteAvailable()}
              onClick={() =>
                carteAvailable() && props.onOpenCarte?.(props.selectedId)
              }
              aria-disabled={!carteAvailable()}
            >
              <Show when={carteAvailable()} fallback={<>カルテ未登録</>}>
                カルテを開く →
              </Show>
            </button>
            <Show when={kids().length > 0}>
              <div
                class="mono"
                style={{
                  "font-size": "10px",
                  color: "var(--ink-faint)",
                  "margin-top": "8px",
                }}
              >
                この個体から {kids().length} 体の子が生まれています
              </div>
            </Show>
          </div>
        </Show>
      </div>

      <div class="card" style={{ padding: "20px", "margin-top": "12px" }}>
        <div class="mono eyebrow" style={{ "margin-bottom": "10px" }}>
          変更履歴
        </div>
        <Show
          when={auditEntries().length > 0}
          fallback={
            <div
              class="mono"
              style={{ "font-size": "11px", color: "var(--ink-faint)" }}
            >
              履歴がありません
            </div>
          }
        >
          <For each={auditEntries()}>
            {(e, i) => (
              <div
                class="audit-row"
                data-last={i() === auditEntries().length - 1}
              >
                <span class="mono date">{e.date.slice(5)}</span>
                <div>
                  <div>{e.event}</div>
                  <div class="mono actor">by {e.actor}</div>
                </div>
              </div>
            )}
          </For>
        </Show>
        <div class="audit-verified mono">✓ イベントログで改ざん検知済</div>
      </div>
    </div>
  );
};

// ============================================================================
//  Page root
// ============================================================================

interface BloodlinePageProps {
  setRoute?: (r: RouteKey) => void;
  setSelectedSpecimen?: (id: string) => void;
}

/** /bloodline/:id から id を抽出 (App と同等の処理を page 内で持つ) */
const extractBloodlineIdFromPath = (pathname: string): string | null => {
  const normalized = pathname.replace(/\/+$/, "");
  if (!normalized.startsWith("/bloodline/")) return null;
  const rest = normalized.slice("/bloodline/".length);
  if (!rest) return null;
  try {
    return decodeURIComponent(rest.split("/")[0]);
  } catch {
    return null;
  }
};

const DEFAULT_BLOODLINE_ID = "#DHH-0271";

export const BloodlinePage = (props: BloodlinePageProps) => {
  // P2-5: URL /bloodline/:id の id から selected を初期化する。
  //   - useParams は現状のフラットな wildcard ルーティングでは機能しないため、
  //     useLocation().pathname を自前で解釈する。
  //   - 個体選択 → URL 更新 の sync も両方向で行う。
  const location = useLocation();
  const navigate = useNavigate();

  const initialFromUrl = extractBloodlineIdFromPath(location.pathname);
  const initialId =
    initialFromUrl && getIndividual(initialFromUrl)
      ? initialFromUrl
      : DEFAULT_BLOODLINE_ID;

  const [selected, setSelected] = createSignal(initialId);
  const [mode, setMode] = createSignal<"focus" | "tree">("focus");

  // URL が外部で変わったら selected に反映
  const urlId = createMemo(() => extractBloodlineIdFromPath(location.pathname));
  createEffect(() => {
    const id = urlId();
    if (id && getIndividual(id) && id !== selected()) {
      setSelected(id);
    }
  });

  // 選択変更 → URL を静かに更新 (同一 URL への navigate はガード)
  createEffect(() => {
    const id = selected();
    const target = bloodlineUrl(id);
    if (target !== location.pathname) {
      navigate(target, { replace: true });
    }
  });

  const ind = () => getIndividual(selected());

  const openCarte = (id: string) => {
    props.setSelectedSpecimen?.(id);
    props.setRoute?.("specimen");
  };

  // P4-11: PDF出力ハンドラ。本格的な PDF 生成は後続で差替えるが、
  //   現状はブラウザの印刷ダイアログ (Save as PDF) で代替しつつ、
  //   トーストで操作の成立をフィードバックする。
  const handleExportPdf = () => {
    const indNow = ind();
    const label = indNow ? `${indNow.id} · ${indNow.name}` : "血統系図";
    showToast({
      message: `${label} を PDF 出力します`,
      tone: "info",
    });
    // setTimeout で一瞬待って、トースト描画後に印刷 UI を開く
    if (typeof window !== "undefined") {
      setTimeout(() => {
        try {
          window.print();
        } catch {
          /* 印刷 UI 非対応環境 (テスト等) では無視 */
        }
      }, 50);
    }
  };

  // P4-22: 「+ 交配記録」モーダル。選択中個体を seed に父 or 母を自動プリセット。
  const [matingOpen, setMatingOpen] = createSignal(false);
  const handleAddMating = () => setMatingOpen(true);

  // UX-3: page-head の個体ピッカー。
  //   選択中個体が「一覧の最初の要素 (デフォルト)」であることをユーザに明示し、
  //   かつ他個体への切り替えをワンタップで行えるようにする。
  //   世代でグループ化して認知コストを下げる。
  const groupedByGen = createMemo(() => {
    const map = new Map<GenKey, Individual[]>();
    for (const g of GEN_ORDER) map.set(g, []);
    for (const i of INDIVIDUALS_LIST) map.get(i.generation)!.push(i);
    return GEN_ORDER.map((g) => [g, map.get(g)!] as const).filter(
      ([, list]) => list.length > 0,
    );
  });

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">血統系図 · ヘラクレス系統</div>
          <h1>血統系図</h1>
        </div>
        <div class="page-actions">
          {/* UX-3: 個体ピッカー。サイドバーから個体カルテを外したため、
                ここで「いま誰の系図を見ているか」を明示する。 */}
          <label class="head-picker" aria-label="表示する個体を選択">
            <span class="mono head-picker-label">対象</span>
            <select
              class="select head-picker-select"
              value={selected()}
              onChange={(e) => setSelected(e.currentTarget.value)}
            >
              <For each={groupedByGen()}>
                {([gen, list]) => (
                  <optgroup label={`${GENS[gen].label} · ${GENS[gen].year}`}>
                    <For each={list}>
                      {(i) => (
                        <option value={i.id}>
                          {i.id} · {i.name} {i.sex === "m" ? "♂" : "♀"}
                        </option>
                      )}
                    </For>
                  </optgroup>
                )}
              </For>
            </select>
          </label>
          {/* P4-11: 見た目だけのボタンを排し、トースト + print dialog / 準備中トーストにつなぐ */}
          <button type="button" class="btn" onClick={handleExportPdf}>
            PDF出力
          </button>
          <button type="button" class="btn primary" onClick={handleAddMating}>
            + 交配記録
          </button>
        </div>
      </div>

      <div class="blood-grid">
        <div class="blood-main">
          <div class="blood-toolbar">
            <div class="mode-toggle" role="tablist" aria-label="表示モード">
              <button
                type="button"
                role="tab"
                aria-selected={mode() === "focus"}
                class={mode() === "focus" ? "active" : ""}
                onClick={() => setMode("focus")}
              >
                フォーカス <span class="mono">3G</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode() === "tree"}
                class={mode() === "tree" ? "active" : ""}
                onClick={() => setMode("tree")}
              >
                俯瞰ツリー
              </button>
            </div>
            <Show when={ind()}>
              <div class="blood-crumb mono">
                {ind()!.id} · {ind()!.name}
              </div>
            </Show>
          </div>

          <div class="card blood-board">
            <Show when={mode() === "focus"}>
              <FocusView selectedId={selected()} setSelectedId={setSelected} />
            </Show>
            <Show when={mode() === "tree"}>
              <TreeView selectedId={selected()} setSelectedId={setSelected} />
            </Show>
          </div>

          <div class="blood-legend mono">
            <span>
              <span class="lg-dot self" /> 選択個体
            </span>
            <span>
              <span class="lg-dot ancestor" /> 直接祖先
            </span>
            <span>
              <span class="lg-dot other" /> その他
            </span>
            <span>
              <span class="lg-dot wild" /> 野生個体
            </span>
          </div>
        </div>

        <SidePanel
          selectedId={selected()}
          setSelectedId={setSelected}
          onOpenCarte={openCarte}
        />
      </div>

      {/* P4-22: 交配記録モーダル */}
      <MatingRecordModal
        open={matingOpen()}
        onClose={() => setMatingOpen(false)}
        seedSelectedId={selected()}
      />
    </>
  );
};
