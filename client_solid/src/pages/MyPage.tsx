// MyPage.tsx — マイページ（所有個体一覧 + サマリー）
//
// P2-6: Hero 4 枚の KPI カードを api.getUserMetrics() + createMemo で算出。
//   - 従来はハードコード (今月のログ 28 件 / 血統ライン 4 等)。
//   - 実データからのカウントに変更し、ログ追加 / メモ更新に reactive に追従。
import { createMemo, For, Show } from "solid-js";
import { type RouteKey } from "../data";
import {
  getCurrentUser,
  getUpcomingActions,
  getUserMetrics,
  listSpecimens,
  listUrgentEclosion,
  type ActionKind,
  type UpcomingAction,
} from "../api";
import { Icons } from "../components/Icons";
import { Tooltip } from "../components/Tooltip";

interface MyPageProps {
  setRoute: (r: RouteKey) => void;
  setSelectedSpecimen: (id: string) => void;
}

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

export const MyPage = (props: MyPageProps) => {
  // reactive 版 — ログ追加や所有個体の変動に連動してカードが更新される
  const metrics = createMemo(() => getUserMetrics());
  // 下部一覧 / 羽化レーダーは個体リストをそのまま使う
  const specs = createMemo(() => listSpecimens());
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
          <div class="cat">マイページ · 登録 {getCurrentUser().since} より</div>
          <h1>{getCurrentUser().name}</h1>
        </div>
        <div class="page-actions">
          <button class="btn" onClick={() => props.setRoute("log")}>
            {Icons.plus()} ログを記録
          </button>
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

      {/* P4-9: 次のケア (エサ / マット / 体重) — 7日以内の予定と超過分 */}
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
        <span class="meta">{specs().length} 体 / 最終更新 今日 21:40</span>
      </div>

      <div style={{ display: "grid", "grid-template-columns": "repeat(3, 1fr)", gap: "16px" }}>
        <For each={specs()}>
          {(s) => (
            <div
              class="card"
              style={{ cursor: "pointer", overflow: "hidden", transition: "transform 0.15s ease, box-shadow 0.15s ease" }}
              onClick={() => {
                props.setSelectedSpecimen(s.id);
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
