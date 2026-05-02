// MyPage.tsx — マイページ（所有個体一覧 + サマリー）
//
// P2-6: Hero 4 枚の KPI カードを api.getUserMetrics() + createMemo で算出。
//   - 従来はハードコード (今月のログ 28 件 / 血統ライン 4 等)。
//   - 実データからのカウントに変更し、ログ追加 / メモ更新に reactive に追従。
//
// Phase 9.D 連携: login user の所有個体は **server (= /api/v1/specimens/me) を優先**。
//   anonymous / 取得前 / 取得失敗時は mock (`listSpecimens()`) にフォールバックする。
//   切り替えはカード描画用に `OwnedSpecimenCard` の最小 shape へ正規化してから
//   1 つの `<For>` に流し込む方式で、render 部の差分を出さない。
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { type RouteKey } from "../data";
import {
  getUpcomingActions,
  getUserMetrics,
  listSpecimens,
  listUrgentEclosion,
  type ActionKind,
  type UpcomingAction,
} from "../api";
import { Icons } from "../components/Icons";
import { Tooltip } from "../components/Tooltip";
import { currentUser, isLoggedIn } from "../store/auth";

/** ISO 8601 (= "2024-03-15T00:00:00Z") を「2024.03」形式に整形。
 *  「登録 YYYY.MM より」の表示用。`joinedAt` 未取得時は "—" を返す。 */
const formatJoinedAt = (iso: string | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}.${m}`;
};
import { serverSpecimens, serverSpecimensError } from "../store/specimens";
import type { SpecimenView } from "../sdui/api";

interface MyPageProps {
  setRoute: (r: RouteKey) => void;
  setSelectedSpecimen: (id: string) => void;
}

// ──────────────────────────────────────────────────────────────────────
// Cohort Phase 1: 「+ 新規 ▾」 dropdown
// ──────────────────────────────────────────────────────────────────────
//
// 「自分の手元に新しいレコードを作る」アクションを 1 dropdown に集約。
// 「+ 新しい個体を探す」(EC) は意味カテゴリが違うので別ボタンとして残す (上の親で並置)。
//
// 将来追加候補:
//   - 交配記録を作成 (mating_records 直接作成)
//   - PDF を取り込む (血統書 OCR)
// dropdown は項目追加で自然に拡張できる構造を維持する。

interface NewDropdownProps {
  setRoute: (r: RouteKey) => void;
}

const NewDropdown = (props: NewDropdownProps) => {
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  const close = () => setOpen(false);

  // click outside で閉じる
  onMount(() => {
    const onClick = (e: MouseEvent) => {
      if (!open()) return;
      if (!rootEl) return;
      if (e.target instanceof Node && !rootEl.contains(e.target)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open()) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  const select = (r: RouteKey) => {
    close();
    props.setRoute(r);
  };

  return (
    <div ref={rootEl} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        class="btn"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {Icons.plus()} 新規{" "}
        <span style={{ "margin-left": "2px", "font-size": "10px" }}>▾</span>
      </button>
      <Show when={open()}>
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            "min-width": "200px",
            background: "var(--bg-raised)",
            border: "1px solid var(--line)",
            "border-radius": "8px",
            "box-shadow": "0 4px 16px oklch(0 0 0 / 0.08)",
            "z-index": 30,
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            role="menuitem"
            class="dropdown-item"
            onClick={() => select("specimen-new")}
            style={{
              display: "block",
              width: "100%",
              padding: "9px 14px",
              "text-align": "left",
              background: "transparent",
              border: 0,
              "font-size": "12px",
              color: "var(--ink)",
              cursor: "pointer",
              "border-bottom": "1px solid var(--line)",
            }}
          >
            個体を登録
          </button>
          <button
            type="button"
            role="menuitem"
            class="dropdown-item"
            onClick={() => select("cohort-new")}
            style={{
              display: "block",
              width: "100%",
              padding: "9px 14px",
              "text-align": "left",
              background: "transparent",
              border: 0,
              "font-size": "12px",
              color: "var(--ink)",
              cursor: "pointer",
            }}
          >
            群を作成
          </button>
        </div>
      </Show>
    </div>
  );
};

const stageColor = (stage: string): string => {
  if (stage.includes("幼虫")) return "forest";
  if (stage.includes("蛹") || stage.includes("前蛹")) return "amber";
  if (stage.includes("成虫")) return "indigo";
  return "ink";
};

/** P4-9: UpcomingAction 表示用メタ。kind ごとに視覚トーンとアイコンを決める。 */
const ACTION_META: Record<
  ActionKind,
  { tone: "forest" | "amber" | "indigo" | "rose"; emoji: string }
> = {
  feed: { tone: "forest", emoji: "🌿" },
  mat: { tone: "amber", emoji: "🪵" },
  weigh: { tone: "indigo", emoji: "⚖" },
  eclosion: { tone: "rose", emoji: "⏳" },
};

/** 残り日数を短くローカライズ ("超過 2日", "今日", "あと 3日") */
const formatDue = (a: UpcomingAction): string => {
  if (a.dueInDays < 0) return `超過 ${Math.abs(a.dueInDays)}日`;
  if (a.dueInDays === 0) return "今日";
  return `あと ${a.dueInDays}日`;
};

/** 所有個体カードに描画するための最小フィールド集合。
 *  mock (`Specimen`) と server (`SpecimenView`) の両方をこの形に揃えてから render に渡す。 */
interface OwnedSpecimenCard {
  id: string;
  /** click 時に setSelectedSpecimen に渡す URL/state 用の id (= mock では Specimen.id、
   *  server では publicId)。 */
  selectId: string;
  name: string;
  species: string;
  sex: string;
  stage: string;
  sizeMm: number | string;
  weightG: number | string;
  generation: string;
  eclosionInDays: number | null;
  /** italic で表示する学名 / 補助テキスト。server には無いので speciesId を出す。 */
  sci: string;
}

/** server の SpecimenView をカード表示用の最小形に正規化する。 */
const fromServer = (v: SpecimenView): OwnedSpecimenCard => ({
  id: v.publicId,
  selectId: v.publicId,
  name: v.name,
  // 軽量 view: species 表示は speciesId をそのまま (= server に翻訳テーブル無し).
  // 翻訳が必要になったら repos::species::find_translation で埋める。
  species: v.speciesId,
  sex: v.sex,
  stage: v.stage,
  sizeMm: v.sizeMm ?? "—",
  weightG: v.weightG ?? "—",
  generation: v.generation ?? "—",
  // server は eclosionInDays を持たないので eclosionEta から逆算するのが正しいが、
  // MyPage の「羽化レーダー」は別 section で mock 起点、ここでは null に倒す。
  eclosionInDays: null,
  sci: v.speciesId,
});

export const MyPage = (props: MyPageProps) => {
  // reactive 版 — ログ追加や所有個体の変動に連動してカードが更新される
  const metrics = createMemo(() => getUserMetrics());

  // mock 起点の個体一覧 (= 羽化レーダー / 上部 KPI が依存)。
  const mockSpecs = createMemo(() => listSpecimens());

  // server-driven な所有個体一覧 (= login 中のみ存在)。
  // anonymous / ロード前 / 取得失敗時は null → 下部「所有個体」一覧は mock にフォールバック。
  // server 値が来たら **そちらを優先** してカードを描画する (= APP_DATA seed は使わない)。
  const ownedCards = createMemo<OwnedSpecimenCard[]>(() => {
    const sv = serverSpecimens();
    if (isLoggedIn() && sv) {
      return sv.map(fromServer);
    }
    return mockSpecs().map((s) => ({
      id: s.id,
      selectId: s.id,
      name: s.name,
      species: s.species,
      sex: s.sex,
      stage: s.stage,
      sizeMm: s.sizeMm,
      weightG: s.weightG,
      generation: s.generation,
      eclosionInDays: s.eclosionInDays,
      sci: s.sci,
    }));
  });

  /** 「サーバ取得済み」バッジを出すかの判定。 */
  const isServerBacked = createMemo(
    () => isLoggedIn() && serverSpecimens() !== null,
  );

  const eclosionSoon = createMemo(() =>
    listUrgentEclosion(60).sort((a, b) => a.eclosionInDays - b.eclosionInDays),
  );
  // P4-9: 次のケア (エサ / マット / 体重 / 羽化) — 7日以内の予定 + 超過分
  //       羽化レーダーと重複する eclosion は除外。
  const upcoming = createMemo(() =>
    getUpcomingActions(7).filter((a) => a.kind !== "eclosion"),
  );

  /** +6 / -3 のように符号付きで表示 */
  const formatDelta = (n: number): string =>
    n === 0 ? "±0" : n > 0 ? `+${n}` : `${n}`;

  const cards = createMemo(() => {
    const m = metrics();
    return [
      {
        label: "所有個体",
        value: m.specimenCount,
        unit: "体",
        sub: "生存中",
        tone: "forest",
        help: "所有個体 (生存中) の合計。\n死亡 / 譲渡済はカウント外。",
      },
      {
        label: "羽化予定（60日以内）",
        value: m.eclosionSoonCount,
        unit: "体",
        sub:
          m.eclosionUrgentCount > 0
            ? `うち7日以内 ${m.eclosionUrgentCount}体`
            : "直近7日内なし",
        tone: "amber",
        help: "今日から 60 日以内に羽化予定の個体数。\n日数は eclosionETA フィールド基準 (蛹化後経過日から推定)。",
      },
      {
        label: "血統ライン",
        value: m.bloodlineCount,
        unit: "本",
        sub: `最深 ${m.deepestGeneration}`,
        tone: "indigo",
        help: "所有個体の累代 (CBFn / WILD) のユニーク数。\n最深は CBF 数値の最大値。",
      },
      {
        label: "今月の飼育ログ",
        value: m.monthlyLogCount,
        unit: "件",
        sub: `${formatDelta(m.monthlyLogDelta)} vs 前月`,
        tone: "ink",
        help: "当月 (暦月) 1 日 00:00 〜 現在までに記録された飼育ログ件数。\n前月比は先月同期間との差。",
      },
    ];
  });

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">
            マイページ · 登録 {formatJoinedAt(currentUser()?.joinedAt)} より
          </div>
          <h1>{currentUser()?.name ?? "—"}</h1>
        </div>
        <div class="page-actions">
          {/* Cohort Phase 1: 「+ ログを記録」を「+ 新規 ▾」dropdown に置換。
              「+ 新しい個体を探す」(EC 動線) は別ボタンとして残す。 */}
          <NewDropdown setRoute={props.setRoute} />
          <button class="btn primary" onClick={() => props.setRoute("products")}>
            {Icons.plus()} 新しい個体を探す
          </button>
        </div>
      </div>

      <div style={{ display: "grid", "grid-template-columns": "repeat(4, 1fr)", gap: "16px", "margin-bottom": "28px" }}>
        <For each={cards()}>
          {(s) => (
            <div class="card" style={{ padding: "18px" }}>
              <div
                class="label"
                style={{ display: "flex", "align-items": "center", gap: "6px" }}
              >
                <span>{s.label}</span>
                <Tooltip content={s.help} label={`${s.label}の集計方法`} />
              </div>
              <div style={{ display: "flex", "align-items": "baseline", gap: "8px", "margin-top": "4px" }}>
                <span class="kpi-num" data-unit={s.unit}>
                  {s.value}
                </span>
                <span class="chip" style={{ "margin-left": "4px" }}>
                  {s.sub}
                </span>
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={eclosionSoon().length > 0}>
        <div
          class="card"
          style={{
            padding: 0,
            "margin-bottom": "28px",
            overflow: "hidden",
            background: "var(--accent-amber-soft)",
            "border-color": "transparent",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "16px", padding: "14px 20px" }}>
            <div class="mono" style={{ "font-size": "11px", color: "oklch(0.45 0.1 70)", "letter-spacing": "0.1em" }}>
              羽化レーダー
            </div>
            <div style={{ "font-size": "13px", color: "oklch(0.35 0.08 70)" }}>
              もうすぐ羽化する個体があります。温度と湿度を確認してください。
            </div>
            <button class="btn sm" style={{ "margin-left": "auto" }} onClick={() => props.setRoute("eclosion")}>
              予測ダッシュボードを開く →
            </button>
          </div>
          <hr class="hair" />
          <div
            style={{
              display: "grid",
              "grid-template-columns": `repeat(${Math.min(eclosionSoon().length, 4)}, 1fr)`,
              gap: 0,
            }}
          >
            <For each={eclosionSoon().slice(0, 4)}>
              {(s, i) => (
                <div
                  onClick={() => {
                    props.setSelectedSpecimen(s.id);
                    props.setRoute("specimen");
                  }}
                  style={{
                    padding: "14px 20px",
                    "border-right": i() < 3 ? "1px solid oklch(0.9 0.04 70)" : "none",
                    cursor: "pointer",
                    background: "oklch(0.98 0.02 70 / 0.5)",
                  }}
                >
                  <div class="mono" style={{ "font-size": "10px", color: "oklch(0.55 0.08 70)" }}>
                    {s.id}
                  </div>
                  <div style={{ "font-weight": 500, "margin-top": "2px" }}>{s.name}</div>
                  <div style={{ display: "flex", "align-items": "baseline", gap: "6px", "margin-top": "6px" }}>
                    <span class="serif" style={{ "font-size": "22px", "font-weight": 600, color: "oklch(0.35 0.1 70)" }}>
                      {s.eclosionInDays}
                    </span>
                    <span style={{ "font-size": "11px", color: "var(--ink-mute)" }}>日後</span>
                    <span
                      class="mono"
                      style={{ "font-size": "10px", color: "var(--ink-faint)", "margin-left": "auto" }}
                    >
                      {s.eclosionETA}
                    </span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div class="sec-head">
        <span class="num">§01</span>
        <h2>次のケア</h2>
        <span class="meta">
          <Show when={upcoming().length > 0} fallback="今週の予定なし">
            7日以内 {upcoming().length} 件
          </Show>
        </span>
      </div>

      <Show
        when={upcoming().length > 0}
        fallback={
          <div
            class="card"
            style={{
              padding: "18px 20px",
              "margin-bottom": "28px",
              "text-align": "center",
              color: "var(--ink-mute)",
              "font-size": "13px",
            }}
          >
            今週のエサ / マット / 体重ケアは全て最新です。
          </div>
        }
      >
        <div class="nextact-grid" style={{ "margin-bottom": "28px" }}>
          <For each={upcoming().slice(0, 6)}>
            {(a) => {
              const meta = ACTION_META[a.kind];
              return (
                <div
                  class="card nextact-card"
                  data-priority={a.priority}
                  onClick={() => {
                    props.setSelectedSpecimen(a.specimenId);
                    props.setRoute("specimen");
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <div class="nextact-head">
                    <span class={`chip ${meta.tone}`}>
                      <span aria-hidden="true">{meta.emoji}</span>
                      {a.label}
                    </span>
                    <span class="nextact-due mono" data-priority={a.priority}>
                      {formatDue(a)}
                    </span>
                  </div>
                  <div class="nextact-name">{a.specimenName}</div>
                  <div class="nextact-meta mono">
                    <span>{a.specimenStage}</span>
                    <Show when={a.hint}>
                      <span aria-hidden="true"> · </span>
                      <span>{a.hint}</span>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <div class="sec-head">
        <span class="num">§02</span>
        <h2>所有個体</h2>
        <span class="meta">
          {ownedCards().length}
          {" 体"}
          <Show when={isServerBacked()}>
            {" · "}
            <span class="mono">サーバ取得済み</span>
          </Show>
          <Show when={!isServerBacked()}>
            {" / 最終更新 今日 21:40"}
          </Show>
        </span>
      </div>

      <Show when={serverSpecimensError() !== null}>
        <div
          class="card"
          style={{
            padding: "12px 16px",
            "margin-bottom": "16px",
            background: "var(--accent-rose-soft, #fde8e8)",
            "font-size": "13px",
          }}
          role="alert"
        >
          {`サーバから所有個体を取得できませんでした (${serverSpecimensError()})。下記は前回値 / mock 表示です。`}
        </div>
      </Show>

      <div style={{ display: "grid", "grid-template-columns": "repeat(3, 1fr)", gap: "16px" }}>
        <For each={ownedCards()}>
          {(s) => (
            <div
              class="card"
              style={{ cursor: "pointer", overflow: "hidden", transition: "transform 0.15s ease, box-shadow 0.15s ease" }}
              onClick={() => {
                props.setSelectedSpecimen(s.selectId);
                props.setRoute("specimen");
              }}
            >
              <div
                class="ph forest"
                style={{ height: "140px", "border-radius": 0, "border-left": 0, "border-right": 0, "border-top": 0 }}
                role="img"
                aria-label={`${s.species} ${s.sex} ${s.name} 俯瞰 (プレースホルダ)`}
              >
                <span class="ph-label">
                  {s.species} · {s.sex}
                </span>
              </div>
              <div style={{ padding: "14px" }}>
                <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                  <span class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                    {s.id}
                  </span>
                  <span class={`chip ${stageColor(s.stage)}`}>
                    <span class="dot" />
                    {s.stage}
                  </span>
                </div>
                <div style={{ "font-weight": 600, "font-size": "15px", "margin-top": "4px" }}>{s.name}</div>
                <div
                  class="mono"
                  style={{ "font-size": "10px", color: "var(--ink-faint)", "font-style": "italic", "margin-top": "2px" }}
                >
                  {s.sci}
                </div>
                <div style={{ display: "flex", gap: "18px", "margin-top": "12px", "font-size": "12px" }}>
                  <div>
                    <div style={{ "font-size": "10px", color: "var(--ink-faint)" }}>サイズ</div>
                    <div class="mono">
                      <b>{s.sizeMm}</b>mm
                    </div>
                  </div>
                  <div>
                    <div style={{ "font-size": "10px", color: "var(--ink-faint)" }}>体重</div>
                    <div class="mono">
                      <b>{s.weightG}</b>g
                    </div>
                  </div>
                  <div>
                    <div style={{ "font-size": "10px", color: "var(--ink-faint)" }}>累代</div>
                    <div class="mono">
                      <b>{s.generation}</b>
                    </div>
                  </div>
                  <Show when={s.eclosionInDays !== null}>
                    <div style={{ "margin-left": "auto", "text-align": "right" }}>
                      <div style={{ "font-size": "10px", color: "var(--ink-faint)" }}>羽化</div>
                      <div class="mono">
                        <b>{s.eclosionInDays}</b>日
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  );
};
