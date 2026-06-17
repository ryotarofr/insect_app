// MyPage.tsx — マイページ（KPI + 次のケア + 羽化レーダー）
//
// Hero 4 枚の KPI カードを api.getUserMetrics() + createMemo で算出。
// 実データからのカウントなので、ログ追加 / メモ更新に reactive に追従する。
//
// **所有個体カードについて**:
//   マイページは KPI / 羽化レーダー / 次のケア にフォーカスし、個別の specimen
//   カードは表示しない。所有個体の閲覧は飼育画面 → 個体カルテ から行う。
import { createMemo, createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { type RouteKey } from "../data";
import {
  getUpcomingActions,
  getUserMetrics,
  listUrgentEclosion,
  type ActionKind,
  type UpcomingAction,
} from "../api";
import { Icons } from "../components/Icons";
import { NewDropdown } from "../components/mypage/NewDropdown";
import { Tooltip } from "../components/Tooltip";
import { ROUTE_PATHS } from "../router";
import { currentUser } from "../store/auth";
import {
  myListingsByStatus,
  myListingsKpi,
} from "../store/myListings";
import type { ListingViewWithCounts } from "../sdui/api";

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

interface MyPageProps {
  setRoute: (r: RouteKey) => void;
  setSelectedSpecimen: (id: string) => void;
}

/** UpcomingAction 表示用メタ。kind ごとに視覚トーンとアイコンを決める。 */
const ACTION_META: Record<
  ActionKind,
  { tone: "forest" | "amber" | "indigo" | "rose"; emoji: string }
> = {
  feed: { tone: "forest", emoji: "🌿" },
  mat: { tone: "amber", emoji: "🪵" },
  weigh: { tone: "indigo", emoji: "⚖" },
  eclosion: { tone: "rose", emoji: "⏳" },
};

// ──────────────────────────────────────────────────────────────────────
// マイ出品サマリ
// ──────────────────────────────────────────────────────────────────────
//
// **責務**:
//   - store/myListings の派生 (`myListingsByStatus`) からタブ別の listings 配列を取り、
//     アクティブタブ 1 つの直近 3 件を表示する。
//   - 本コンポーネントは「サマリ」のみ。詳細 CRUD は `/listings/me` に逃がす。
//
// **設計判断**:
//   - タブの種類は `active / bidding / sold / canceledOrExpired` の 4 つ。
//     mockup の「出品中 / 入札中 / 売却済 / 取消・期限切れ」と一致。
//   - 各タブの件数バッジは store 派生 (`myListingsByStatus`) の length をそのまま表示。
//   - 出品が 0 件のときは「まだ出品がありません + 出品するリンク」を inline で出す。

type MyListingsTab = "active" | "bidding" | "sold" | "canceledOrExpired";

const TAB_LABEL: Record<MyListingsTab, string> = {
  active: "出品中",
  bidding: "入札中",
  sold: "売却済",
  canceledOrExpired: "取消・期限切れ",
};

const formatPrice = (l: ListingViewWithCounts): string => {
  // auction で入札がついていれば現在価格、それ以外は開始価格
  if (l.isAuction && l.currentPriceJpy != null) {
    return `¥${l.currentPriceJpy.toLocaleString("ja-JP")}`;
  }
  const base = `¥${l.startingPriceJpy.toLocaleString("ja-JP")}`;
  return l.isAuction ? `${base}〜` : base;
};

const STATUS_BADGE: Record<string, { label: string; tone: string }> = {
  active: { label: "出品中", tone: "forest" },
  sold: { label: "売却済", tone: "indigo" },
  canceled: { label: "取消", tone: "ink" },
  expired: { label: "期限切れ", tone: "ink" },
};

const MyListingsSummary = () => {
  const [tab, setTab] = createSignal<MyListingsTab>("active");
  const grp = myListingsByStatus;

  const activeRows = createMemo(() => grp()[tab()]);
  const totalCount = createMemo(() => grp().all.length);

  const tabs: MyListingsTab[] = ["active", "bidding", "sold", "canceledOrExpired"];

  return (
    <>
      <div class="sec-head">
        <span class="num">§01</span>
        <h2>マイ出品 と 取引</h2>
        <span class="meta" style={{ "margin-left": "auto" }}>
          {/* /listings/me (= MyListingsPage) への導線。 */}
          <A
            href={ROUTE_PATHS["my-listings"]}
            style={{
              color: "var(--accent-forest, oklch(0.45 0.08 150))",
              "font-size": "12px",
              "text-decoration": "none",
              "font-weight": 600,
            }}
          >
            すべて見る →
          </A>
        </span>
      </div>

      <div class="card" style={{ padding: 0, "margin-bottom": "28px", overflow: "hidden" }}>
        {/* タブ */}
        <div
          role="tablist"
          aria-label="マイ出品のステータスタブ"
          style={{
            display: "flex",
            gap: "4px",
            padding: "8px 14px 0",
            "border-bottom": "1px solid var(--line)",
            "overflow-x": "auto",
          }}
        >
          <For each={tabs}>
            {(t) => {
              const count = () => grp()[t].length;
              const isActive = () => tab() === t;
              return (
                <button
                  role="tab"
                  aria-selected={isActive()}
                  onClick={() => setTab(t)}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: "8px 12px",
                    "font-size": "13px",
                    "font-weight": 500,
                    "border-bottom": isActive()
                      ? "2px solid var(--accent-forest, oklch(0.45 0.08 150))"
                      : "2px solid transparent",
                    color: isActive()
                      ? "var(--accent-forest, oklch(0.45 0.08 150))"
                      : "var(--ink-mute)",
                    cursor: "pointer",
                    "white-space": "nowrap",
                    display: "inline-flex",
                    "align-items": "center",
                    gap: "6px",
                    "font-family": "inherit",
                  }}
                >
                  {TAB_LABEL[t]}
                  <span
                    class="mono"
                    style={{
                      "font-size": "10px",
                      padding: "0 6px",
                      "border-radius": "99px",
                      border: "1px solid var(--line)",
                      color: isActive() ? "var(--accent-forest)" : "var(--ink-faint)",
                      background: isActive()
                        ? "var(--accent-forest-soft, oklch(0.93 0.03 150))"
                        : "transparent",
                    }}
                  >
                    {count()}
                  </span>
                </button>
              );
            }}
          </For>
        </div>

        {/* リスト本体 */}
        <Show
          when={activeRows().length > 0}
          fallback={
            <div
              style={{
                padding: "26px 20px",
                "text-align": "center",
                color: "var(--ink-mute)",
                "font-size": "13px",
              }}
            >
              <Show
                when={totalCount() > 0}
                fallback={
                  <>
                    まだ出品がありません。
                    <A
                      href="/listings/new"
                      style={{
                        "margin-left": "8px",
                        color: "var(--accent-forest, oklch(0.45 0.08 150))",
                        "text-decoration": "none",
                        "font-weight": 600,
                      }}
                    >
                      出品する →
                    </A>
                  </>
                }
              >
                このステータスの出品はありません
              </Show>
            </div>
          }
        >
          <For each={activeRows().slice(0, 3)}>
            {(l) => {
              const badge = STATUS_BADGE[l.status] ?? { label: l.status, tone: "ink" };
              return (
                <A
                  href={`/products/${encodeURIComponent(l.publicId)}`}
                  style={{
                    display: "grid",
                    "grid-template-columns": "1fr auto auto auto",
                    gap: "12px",
                    "align-items": "center",
                    padding: "12px 18px",
                    "border-top": "1px solid var(--line)",
                    "text-decoration": "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ "min-width": 0 }}>
                    <div
                      style={{
                        "font-weight": 600,
                        "font-size": "13.5px",
                        "white-space": "nowrap",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                      }}
                    >
                      {l.title}
                    </div>
                    <div
                      class="mono"
                      style={{
                        "font-size": "11px",
                        color: "var(--ink-faint)",
                        "margin-top": "2px",
                      }}
                    >
                      {l.publicId}
                      <Show when={l.isVerified}>
                        <span
                          style={{
                            "margin-left": "8px",
                            color: "var(--accent-forest)",
                            "font-weight": 600,
                          }}
                        >
                          血統認証
                        </span>
                      </Show>
                    </div>
                  </div>
                  <div class="serif" style={{ "font-size": "15px", "font-weight": 600 }}>
                    {formatPrice(l)}
                  </div>
                  <div
                    style={{ "font-size": "11.5px", color: "var(--ink-mute)", "text-align": "right" }}
                  >
                    <div>
                      <b>{l.bidCount}</b> 入札
                    </div>
                    <div>
                      <b>{l.watcherCount}</b> watcher
                    </div>
                  </div>
                  <span class={`chip ${badge.tone}`}>{badge.label}</span>
                </A>
              );
            }}
          </For>

          <Show when={activeRows().length > 3}>
            <A
              href={ROUTE_PATHS["my-listings"]}
              style={{
                display: "block",
                padding: "10px 18px",
                "text-align": "center",
                color: "var(--accent-forest, oklch(0.45 0.08 150))",
                "font-size": "11.5px",
                "text-decoration": "none",
                "border-top": "1px solid var(--line)",
                "font-weight": 600,
              }}
            >
              ほか {activeRows().length - 3} 件をマイ出品ページで見る →
            </A>
          </Show>
        </Show>
      </div>
    </>
  );
};

/** 残り日数を短くローカライズ ("超過 2日", "今日", "あと 3日") */
const formatDue = (a: UpcomingAction): string => {
  if (a.dueInDays < 0) return `超過 ${Math.abs(a.dueInDays)}日`;
  if (a.dueInDays === 0) return "今日";
  return `あと ${a.dueInDays}日`;
};

/** 期限の符号で優先度トーンを決める。
 *  - 超過 → danger (赤)
 *  - 当日 → warn (橙)
 *  - 余裕 → ok (緑) */
type DueTone = "danger" | "warn" | "ok";
const dueTone = (a: UpcomingAction): DueTone => {
  if (a.dueInDays < 0) return "danger";
  if (a.dueInDays === 0) return "warn";
  return "ok";
};
const TONE_COLOR: Record<DueTone, string> = {
  danger: "var(--accent-rose, oklch(0.55 0.13 25))",
  warn: "var(--accent-amber, oklch(0.55 0.13 70))",
  ok: "var(--accent-forest, oklch(0.45 0.08 150))",
};

export const MyPage = (props: MyPageProps) => {
  // reactive 版 — ログ追加や所有個体の変動に連動してカードが更新される
  const metrics = createMemo(() => getUserMetrics());

  const eclosionSoon = createMemo(() =>
    listUrgentEclosion(60).sort((a, b) => a.eclosionInDays - b.eclosionInDays),
  );
  // 次のケア (エサ / マット / 体重 / 羽化) — 7日以内の予定 + 超過分
  //       羽化レーダーと重複する eclosion は除外。
  const upcoming = createMemo(() =>
    getUpcomingActions(7).filter((a) => a.kind !== "eclosion"),
  );

  /** +6 / -3 のように符号付きで表示 */
  const formatDelta = (n: number): string =>
    n === 0 ? "±0" : n > 0 ? `+${n}` : `${n}`;

  /** KPI の見せ方:
   *  - **飼育系 (forest/amber/indigo/ink)**: 既存 4 枚をそのまま維持。anonymous でも表示可。
   *  - **販売系 (shop)**: login user のみ表示し、anonymous は枚数 0 にする
   *    (= `cards()` の filter で除外)。
   *  - 表示順は飼育 → 販売の左→右。grid は md 以上で 4 列、xl で 6 列を目安。
   */
  const cards = createMemo(() => {
    const m = metrics();
    const baseBreedCards = [
      {
        label: "所有個体",
        value: m.specimenCount,
        unit: "体",
        sub: "生存中",
        tone: "forest" as const,
        category: "breed" as const,
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
        tone: "amber" as const,
        category: "breed" as const,
        help: "今日から 60 日以内に羽化予定の個体数。\n日数は eclosionETA フィールド基準 (蛹化後経過日から推定)。",
      },
      {
        label: "血統ライン",
        value: m.bloodlineCount,
        unit: "本",
        sub: m.bloodlineCount > 0 ? `最深 ${m.deepestGeneration}` : null,
        tone: "indigo" as const,
        category: "breed" as const,
        help: "所有個体の累代 (CBFn / WILD) のユニーク数。\n最深は CBF 数値の最大値。",
      },
      {
        label: "今月の飼育ログ",
        value: m.monthlyLogCount,
        unit: "件",
        sub: `${formatDelta(m.monthlyLogDelta)} vs 前月`,
        tone: "ink" as const,
        category: "breed" as const,
        help: "当月 (暦月) 1 日 00:00 〜 現在までに記録された飼育ログ件数。\n前月比は先月同期間との差。",
      },
    ];

    // 販売系は login user のみ表示。anonymous は store/myListings の cache が空なので
    // 追加しても 0 が並ぶだけだが、視覚的ノイズを避けるため currentUser() で gating する。
    if (!currentUser()) return baseBreedCards;

    const k = myListingsKpi();
    const shopCards = [
      {
        label: "出品中",
        value: k.activeCount,
        unit: "件",
        sub:
          k.auctionActiveCount > 0
            ? `うちオークション ${k.auctionActiveCount}`
            : null,
        tone: "shop" as const,
        category: "shop" as const,
        help: "現在 active な自分の出品件数。\n売却 / 取消 / 期限切れはカウント外。",
      },
      {
        label: "入札・ウォッチ",
        value: k.biddingCount,
        unit: "件",
        sub: k.watcherTotal > 0 ? `watcher 合計 ${k.watcherTotal}` : null,
        tone: "shop" as const,
        category: "shop" as const,
        help: "入札がある active 出品の件数。\nサブ表示は active 全体のウォッチャー合計。",
      },
      {
        label: "売却済",
        value: k.soldCount,
        unit: "件",
        sub: null,
        tone: "shop" as const,
        category: "shop" as const,
        help: "ステータスが sold の出品件数 (= 過去の販売実績)。\n金額集計は Phase 4 (販売側 orders) で追加予定。",
      },
    ];

    return [...baseBreedCards, ...shopCards];
  });

  return (
    <>
      <div class="page-head">
        <Show
          when={currentUser()}
          fallback={
            <>
              <div>
                <div class="cat">マイページ</div>
                <h1>ようこそ KOCHŪ へ</h1>
              </div>
              <div class="page-actions">
                <A class="btn primary" href={ROUTE_PATHS.login}>
                  ログイン / 新規登録
                </A>
              </div>
            </>
          }
        >
          {(u) => (
            <>
              <div>
                <div class="cat">
                  マイページ · 登録 {formatJoinedAt(u().joinedAt)} より
                </div>
                <h1>{u().name}</h1>
              </div>
              <div class="page-actions">
                {/* 「+ ログを記録」は「+ 新規 ▾」dropdown に集約。
                    「+ 新しい個体を探す」(EC 動線) は別ボタンとして残す。 */}
                <NewDropdown setRoute={props.setRoute} />
                <button class="btn primary" onClick={() => props.setRoute("products")}>
                  {Icons.plus()} 新しい個体を探す
                </button>
              </div>
            </>
          )}
        </Show>
      </div>

      {/* KPI grid を `auto-fit` 化して 4 枚 (anonymous) / 7 枚 (login) どちらでも
          自然に折り返すようにした。`minmax(176px, 1fr)` は localhost 1568px で 7 枚 1 行に
          収まり、~1280px 未満で 4+3 / 3+3+1 と段階的に折り返す。
          mobile では .kpi-strip クラスで横スクロールに切替
          (= 7 枚縦積み = 500px+ の縦スクロールを回避する swipe pattern)。 */}
      <div
        class="kpi-strip"
        style={{
          display: "grid",
          "grid-template-columns": "repeat(auto-fit, minmax(176px, 1fr))",
          gap: "16px",
          "margin-bottom": "28px",
        }}
      >
        <For each={cards()}>
          {(s) => (
            <div class="card" style={{ padding: "18px", display: "flex", "flex-direction": "column", gap: "4px" }}>
              {/* カテゴリ識別の小さい chip。飼育 (= forest/amber/indigo/ink) は灰系、
                  販売 (= shop) は primary tone で塗り分けて視線で分離する。 */}
              <span
                class="chip"
                data-category={s.category}
                style={{
                  "align-self": "flex-start",
                  "font-size": "10px",
                  "letter-spacing": "0.06em",
                  padding: "1px 7px",
                  ...(s.category === "shop"
                    ? {
                        background: "var(--accent-forest-soft, oklch(0.93 0.03 150))",
                        color: "var(--accent-forest, oklch(0.45 0.08 150))",
                      }
                    : {
                        background: "var(--bg-soft, oklch(0.96 0.006 80))",
                        color: "var(--ink-mute, oklch(0.48 0.01 80))",
                      }),
                }}
              >
                {s.category === "shop" ? "販売" : "飼育"}
              </span>
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
                <Show when={s.sub}>
                  <span class="chip" style={{ "margin-left": "4px" }}>
                    {s.sub}
                  </span>
                </Show>
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

      {/* マイ出品サマリ。login user 限定で表示し、anonymous は丸ごと非表示。
          詳細 CRUD は `/listings/me` (= MyListingsPage) に逃がし、
          ここではタブ + 直近 3 件 + 「すべて見る」リンクのみ。 */}
      <Show when={currentUser()}>
        <MyListingsSummary />
      </Show>

      <div class="sec-head">
        <span class="num">§02</span>
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

    </>
  );
};
