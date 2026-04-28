// specimen/index.tsx — 個体カルテ詳細
//
// レイアウト: 1 Hero + 3 Tabs (概要 / ログ / 血統)
// - V1〜V5 のバリアント切替は廃止。UXモックアップ (docs/ux-proposal-mockup.html) に準拠。
// - 「＋ ログを追加」は QuickLogSheet を specimenId プリセットで起動。
// - メモは SpecimenMemoCard (自動保存) に委譲。
import { createMemo, createSignal, For, Show } from "solid-js";
import { type RouteKey } from "../../data";
import {
  getSpecimen,
  listSpecimens,
  listLogsBySpecimen,
  type LogEntry,
  type LogType,
  type Specimen,
} from "../../api";
// Phase 9.D サーバ連携: login 中なら所有個体・ログを **server を真値** として描画する。
//   anonymous / 取得失敗時は従来 mock (= APP_DATA + listLogsBySpecimen) にフォールバック。
import { isLoggedIn } from "../../store/auth";
import {
  findServerSpecimenByPublicId,
  serverSpecimens,
} from "../../store/specimens";
import {
  refreshLogsForSpecimen,
  serverLogsErrorFor,
  serverLogsFor,
  toLogEntry,
} from "../../store/specimenLogs";
import type { SpecimenView } from "../../sdui/api";
import { onMount, createEffect } from "solid-js";
import { Icons } from "../../components/Icons";
import { SpecDL } from "../../components/specimen/SpecDL";
import { StageBar } from "../../components/specimen/StageBar";
import { LifeStatusBadge } from "../../components/specimen/LifeStatusBadge";
import { SpecimenMemoCard } from "../../components/specimen/SpecimenMemoCard";
import { LogTimeline } from "../../components/log/LogTimeline";
import { QuickLogSheet } from "../../components/log/QuickLogSheet";
import { LOG_TYPES } from "../../components/log/types";
// NOTE: 体重チャート (WEIGHT · 7 WEEKS) は UX レビューで削除。
// ヒーローのWEIGHT KPIと前回比デルタで十分に役割を果たせているため。

type Tab = "overview" | "log" | "bloodline";

const TAB_LABELS: Record<Tab, string> = {
  overview: "概要",
  log: "ログ",
  bloodline: "血統",
};

interface SpecimenDetailProps {
  specimenId: string;
  setRoute: (r: RouteKey) => void;
  /** UX-2: 所有個体一覧を前後にめくるための個体選択ハンドラ */
  setSelectedSpecimen?: (id: string) => void;
}

const SuggestedActions = (p: { s: Specimen }) => (
  <div class="suggest-card">
    <div class="title">おすすめの世話</div>
    <ul>
      <Show when={p.s.stage.includes("幼虫")}>
        <li>⚖ 体重が順調に推移。次週も定点計測を。</li>
      </Show>
      <Show when={p.s.eclosionInDays !== null && p.s.eclosionInDays < 45}>
        <li>🌱 羽化が近づいています。蛹室の乾燥に注意。</li>
      </Show>
      <li>⛰ マット点検から2週間 ── 表面の乾燥と劣化を確認。</li>
    </ul>
  </div>
);

const OverviewTab = (p: { s: Specimen }) => (
  <div class="carte-overview">
    <div>
      <div class="u-eyebrow">
        計測値
      </div>
      <SpecDL s={p.s} />

      <div style={{ "margin-top": "28px" }}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "10px",
            "margin-bottom": "10px",
          }}
        >
          <div class="u-eyebrow">
            ライフサイクル
          </div>
          {/* P4-2: StageBar 横に終了バッジ */}
          <LifeStatusBadge status={p.s.lifeStatus} detail={p.s.lifeStatusDetail} />
        </div>
        <StageBar stage={p.s.stage} progress={p.s.stageProgress} eta={p.s.eclosionInDays} />
      </div>
    </div>

    <div>
      <SpecimenMemoCard specimenId={p.s.id} />
      <SuggestedActions s={p.s} />
    </div>
  </div>
);

const LogTab = (p: {
  s: Specimen;
  logs: LogEntry[];
  onAdd: () => void;
}) => (
  <div>
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "12px",
        "margin-bottom": "14px",
      }}
    >
      <div class="u-eyebrow">
        タイムライン · この個体
      </div>
      <span style={{ "font-size": "12px", color: "var(--ink-mute)" }}>
        {p.logs.length} 件
      </span>
      <button
        type="button"
        class="btn primary sm"
        style={{ "margin-left": "auto" }}
        onClick={p.onAdd}
      >
        {Icons.plus()} 記録を追加
      </button>
    </div>
    <LogTimeline logs={p.logs} hideSpecimen emptyMessage="この個体の記録はまだありません。" />
  </div>
);

const BloodlineTab = (p: { s: Specimen; setRoute: (r: RouteKey) => void }) => (
  <div class="carte-overview">
    <div class="card" style={{ padding: "22px" }}>
      <div class="u-eyebrow">
        血統
      </div>
      <div class="serif" style={{ "font-size": "20px", "font-weight": 600, margin: "4px 0 8px" }}>
        親世代
      </div>
      <div class="bloodline-pair">
        <div class="p">
          <span class="role">♂ 父</span>
          {p.s.bloodline.father}
        </div>
        <div class="x">×</div>
        <div class="p">
          <span class="role">♀ 母</span>
          {p.s.bloodline.mother}
        </div>
      </div>
      <button
        type="button"
        class="btn block"
        onClick={() => p.setRoute("bloodline")}
      >
        系図を開く →
      </button>
    </div>

    <div class="card" style={{ padding: "22px" }}>
      <div class="u-eyebrow">
        累代情報
      </div>
      <div class="serif" style={{ "font-size": "20px", "font-weight": 600, margin: "4px 0 10px" }}>
        累代情報
      </div>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "80px 1fr",
          gap: "10px",
          "font-size": "13px",
        }}
      >
        <span style={{ color: "var(--ink-mute)" }}>累代</span>
        <span class="mono">{p.s.generation}</span>
        <span style={{ color: "var(--ink-mute)" }}>由来</span>
        <span>{p.s.shop}</span>
        <span style={{ color: "var(--ink-mute)" }}>入手日</span>
        <span class="mono">{p.s.purchasedAt}</span>
      </div>
    </div>
  </div>
);

export const SpecimenDetail = (props: SpecimenDetailProps) => {
  // ── server 個体が cache にあれば、その属性で mock を上書きした表示用 Specimen を作る。
  //    bloodline / shop / sci など server に無い項目は mock 既存値か placeholder で埋める。
  const serverView = createMemo<SpecimenView | undefined>(() => {
    if (!isLoggedIn()) return undefined;
    return findServerSpecimenByPublicId(props.specimenId);
  });

  const mergeWithServer = (mock: Specimen, sv: SpecimenView): Specimen => ({
    ...mock,
    // server 真値で上書き (= 名前 / sex / stage / 各計測値 / 累代 / 羽化 ETA)。
    id: sv.publicId,
    name: sv.name,
    sex: sv.sex,
    stage: sv.stage,
    stageProgress: sv.stageProgress,
    sizeMm: sv.sizeMm ?? mock.sizeMm,
    weightG: sv.weightG ?? mock.weightG,
    purchasedAt: sv.purchasedAt ?? mock.purchasedAt,
    generation: sv.generation ?? mock.generation,
    eclosionETA: sv.eclosionEta ?? mock.eclosionETA,
    // 軽量 view: species 表示は speciesId をそのまま (= 翻訳テーブル対応は後続)。
    species: sv.speciesId,
  });

  // mock fallback: 旧来の APP_DATA 経由。anonymous / 未取得 / cache miss で必ず使える。
  const fallbackMock = (): Specimen =>
    getSpecimen(props.specimenId) ?? listSpecimens()[0];

  const s = createMemo<Specimen>(() => {
    const sv = serverView();
    const mock = fallbackMock();
    return sv ? mergeWithServer(mock, sv) : mock;
  });

  // server 個体が cache にあるなら logs もサーバ取得を試行 (= UUID は SpecimenView.id)。
  //   onMount は new specimen への navigation で 1 回しか走らないので、
  //   serverView の変化に追従する createEffect で呼ぶ。
  createEffect(() => {
    const sv = serverView();
    if (!sv) return;
    refreshLogsForSpecimen(sv.id).catch((err: unknown) => {
      // 5xx / network はストア内 error にも詰まっているのでここでは log のみ。
      // eslint-disable-next-line no-console
      console.warn("specimen logs refresh failed:", err);
    });
  });

  const logs = createMemo<LogEntry[]>(() => {
    const sv = serverView();
    if (sv) {
      const cached = serverLogsFor(sv.id);
      if (cached) {
        // server logs を mock LogEntry shape に変換 (= LogTimeline は LogEntry を期待)。
        // displaySpecimenId = mock 側の Specimen.id (= publicId / 表示用) で揃える。
        return cached.map((v) => toLogEntry(v, sv.publicId));
      }
    }
    // anonymous / 未取得 / 取得失敗 → mock fallback。
    return listLogsBySpecimen(s().id);
  });

  // server logs 取得失敗の banner 用 (= LogTab が表示)。
  const logsError = createMemo<string | undefined>(() => {
    const sv = serverView();
    return sv ? serverLogsErrorFor(sv.id) : undefined;
  });
  void logsError; // 現状未使用 (= 後続で LogTab に banner を足す時に拾う)
  const [tab, setTab] = createSignal<Tab>("overview");
  const [sheetOpen, setSheetOpen] = createSignal(false);
  // P4-10: どの種別で QuickLogSheet を開くか。5 ボタンショートカットで設定。
  const [quickLogType, setQuickLogType] = createSignal<LogType>("weight");
  const openQuickLog = (t: LogType) => {
    setQuickLogType(t);
    setSheetOpen(true);
  };

  // UX-2: 所有個体一覧の前後個体への navigation。
  //   listSpecimens() の並びを source-of-truth にし、現在位置の前後を計算する。
  //   先頭/末尾では disabled になる (これ自体が「リストの端にいる」サイン)。
  const orderedIds = createMemo<string[]>(() => listSpecimens().map((x) => x.id));
  const currentIndex = createMemo<number>(() => orderedIds().indexOf(s().id));
  const prevId = createMemo<string | null>(() => {
    const i = currentIndex();
    return i > 0 ? orderedIds()[i - 1] : null;
  });
  const nextId = createMemo<string | null>(() => {
    const i = currentIndex();
    const ids = orderedIds();
    return i >= 0 && i < ids.length - 1 ? ids[i + 1] : null;
  });
  const goPrev = () => {
    const id = prevId();
    if (id) props.setSelectedSpecimen?.(id);
  };
  const goNext = () => {
    const id = nextId();
    if (id) props.setSelectedSpecimen?.(id);
  };

  // 体重差分 (直近2件のweightログから算出)
  const weightDelta = createMemo<number | null>(() => {
    const weights = logs().filter((l) => l.type === "weight");
    if (weights.length < 2) return null;
    const match = (body: string) => {
      const m = body.match(/(\d+\.?\d*)/);
      return m ? parseFloat(m[1]) : null;
    };
    const latest = match(weights[0].body);
    const prev = match(weights[1].body);
    if (latest === null || prev === null) return null;
    return Math.round((latest - prev) * 10) / 10;
  });

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">個体カルテ · {s().id}</div>
          <h1>{s().name}</h1>
        </div>
        {/* UX-2: 所有個体一覧の前後個体へめくる stepper。
            先頭 / 末尾では disabled。disabled 状態が「端にいる」サインになる。 */}
        <div class="page-actions head-stepper" aria-label="個体ナビゲーション">
          <button
            type="button"
            class="btn ghost sm"
            onClick={goPrev}
            disabled={prevId() === null}
            aria-label="前の個体"
            title={prevId() ? `前の個体へ` : "これ以上前の個体はありません"}
          >
            ← 前
          </button>
          <button
            type="button"
            class="btn ghost sm"
            onClick={goNext}
            disabled={nextId() === null}
            aria-label="次の個体"
            title={nextId() ? `次の個体へ` : "これ以上後ろの個体はありません"}
          >
            次 →
          </button>
        </div>
      </div>

      {/* HERO */}
      <div class="carte-hero">
        <div
          class="main-photo ph forest"
          role="img"
          aria-label={`${s().name} ${s().sex} 最新写真 (プレースホルダ)`}
        >
          <span class="ph-label">{s().id} · 最新写真</span>
        </div>
        <div>
          <div class="eyebrow">{s().sci}</div>
          <h1>{s().name}</h1>
          <div class="sci">{s().species} · {s().sex}</div>

          <div class="chips">
            <span class="chip amber">
              <span class="dot" />
              {s().stage}
            </span>
            <span class="chip forest">{s().shop}</span>
            <span class="chip">{s().generation}</span>
          </div>

          <div class="kpi-row">
            <div class="kpi">
              <div class="k-label">体重</div>
              <div class="k-value">
                {s().weightG}
                <small>g</small>
              </div>
              <Show when={weightDelta() !== null}>
                <div class={"k-delta" + ((weightDelta() ?? 0) >= 0 ? "" : " muted")}>
                  {(weightDelta() ?? 0) >= 0 ? "＋" : ""}
                  {weightDelta()} / 前回比
                </div>
              </Show>
            </div>
            <div class="kpi">
              <div class="k-label">サイズ</div>
              <div class="k-value">
                {s().sizeMm}
                <small>mm</small>
              </div>
              <div class="k-delta muted">{s().stage}</div>
            </div>
            <div class="kpi accent">
              <div class="k-label">次の羽化</div>
              <Show
                when={s().eclosionInDays !== null}
                fallback={
                  <div class="k-value" style={{ color: "var(--ink-faint)" }}>
                    —
                  </div>
                }
              >
                <div class="k-value">
                  {s().eclosionInDays}
                  <small>日後</small>
                </div>
                <div class="k-delta muted">{s().eclosionETA} ±5日</div>
              </Show>
            </div>
          </div>

          {/* P4-10: 次のログ候補 5 ボタン (体重/給餌/観察/脱皮/マット) */}
          <div class="quicklog-row" role="group" aria-label="記録の追加">
            <For each={LOG_TYPES}>
              {(t) => (
                <button
                  type="button"
                  class="quicklog-btn"
                  aria-label={`${t.label}を記録`}
                  onClick={() => openQuickLog(t.key)}
                >
                  <span class="ico" aria-hidden="true">{t.icon}</span>
                  <span class="lbl">{t.label}</span>
                </button>
              )}
            </For>
          </div>
          <div class="actions">
            <button type="button" class="btn">
              {Icons.camera()} 写真
            </button>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div class="carte-tabs" role="tablist" aria-label="個体カルテ タブ">
        <For each={["overview", "log", "bloodline"] as Tab[]}>
          {(key) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab() === key}
              class={tab() === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {TAB_LABELS[key]}
              <Show when={key === "log"}>
                <span class="count">· {logs().length}</span>
              </Show>
            </button>
          )}
        </For>
      </div>

      <Show when={tab() === "overview"}>
        <OverviewTab s={s()} />
      </Show>
      <Show when={tab() === "log"}>
        <LogTab s={s()} logs={logs()} onAdd={() => openQuickLog("weight")} />
      </Show>
      <Show when={tab() === "bloodline"}>
        <BloodlineTab s={s()} setRoute={props.setRoute} />
      </Show>

      {/* Quick Log Sheet (P4-10: initialType で 5 ボタン起動に対応) */}
      <QuickLogSheet
        open={sheetOpen()}
        onClose={() => setSheetOpen(false)}
        specimenId={s().id}
        initialType={quickLogType()}
      />
    </>
  );
};
