// pages/cohort/detail.tsx — 群詳細ページ
//
// **構成** (実機モック v3 と整合):
//   - .page-head: 「飼育 #LOT」+ 種名 + 系統 + 状態 badge + 「個体化を開始」CTA
//   - KPI 行 (4 カード): 生存数 / 経過日数 / ステージ / 想定羽化
//   - タブ: 概要 / ログ / 由来
//   - 概要: 直近の群ログ + (将来) 推定ロット成績
//   - ログ: 詳細タイムライン (placeholder, Phase 4 で本実装)
//   - 由来: 親交配 / 由来種別 (placeholder)
//
// **active / archived 表示分岐**:
//   - active: 「個体化を開始」「一括ログ」 CTA
//   - archived: アーカイブ済み badge + 「個体一覧 (X 匹)」リンク
//   - URL ?just_completed=true 時はトースト風サマリ表示

import { A, useLocation } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  cohortDetail,
  cohortDetailError,
  isCohortDetailLoading,
  loadCohortDetail,
} from "../../store/cohorts";
import { STAGE_LABEL } from "../../api/cohorts";
import { CohortStatusBadge } from "../../components/cohort/CohortStatusBadge";
import { cohortPromoteUrl } from "../../router";
import type { CohortDetailView, CohortLogView } from "../../types/cohort";

interface Props {
  cohortPublicId: string;
}

const daysSince = (iso: string): number => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86400000));
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}`;
};

const LOG_TYPE_LABEL: Record<CohortLogView["logType"], string> = {
  feed: "餌",
  mat: "マット",
  death: "死亡",
  observation: "観察",
};

const LOG_TYPE_TONE: Record<
  CohortLogView["logType"],
  "forest" | "amber" | "rose" | "indigo"
> = {
  feed: "forest",
  mat: "forest",
  death: "rose",
  observation: "indigo",
};

type Tab = "overview" | "log" | "origin";

export const CohortDetailPage = (props: Props) => {
  const location = useLocation();
  const [tab, setTab] = createSignal<Tab>("overview");

  // ルートパラメータ変更 / ?just_completed=true 反映のために effect で fetch
  createEffect(() => {
    void loadCohortDetail(props.cohortPublicId);
  });

  const justCompleted = createMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("just_completed") === "true";
  });

  return (
    <>
      <Show when={isCohortDetailLoading() && !cohortDetail()}>
        <p class="cohort-empty-state">読み込み中…</p>
      </Show>

      <Show when={cohortDetailError()}>
        <p class="cohort-empty-state cohort-empty-state--error">
          エラー: {cohortDetailError()}{" "}
          <button
            type="button"
            class="btn"
            onClick={() => void loadCohortDetail(props.cohortPublicId)}
          >
            再試行
          </button>
        </p>
      </Show>

      <Show when={cohortDetail()}>
        {(d) => (
          <>
            <Show when={justCompleted() && d().archivedAt}>
              <div class="cohort-completed-banner" role="status">
                <strong>個体化が完了しました</strong> — {d().publicId} から
                {d().promotedSpecimensCount} 匹を個体化しました。群はアーカイブに移動しました。
              </div>
            </Show>

            <div class="page-head">
              <div>
                <div class="cat">飼育 · 由来 {d().parentMatingId ?? "—"}</div>
                <h1>{d().speciesName ?? d().speciesId}</h1>
                <p class="page-head-sub">
                  <span class="mn">#{d().publicId}</span>
                  {d().bloodlineName ? ` · ${d().bloodlineName}` : ""}
                </p>
              </div>
              <div class="page-actions">
                <CohortStatusBadge archivedAt={d().archivedAt} />
                <Show
                  when={!d().archivedAt}
                  fallback={
                    <A
                      href={`/specimens?cohort_id=${encodeURIComponent(d().publicId)}`}
                      class="btn"
                    >
                      個体一覧 ({d().promotedSpecimensCount} 匹) →
                    </A>
                  }
                >
                  <button class="btn" type="button">
                    一括ログ
                  </button>
                  <A href={cohortPromoteUrl(d().publicId)} class="btn primary">
                    {d().currentCount < d().initialCount
                      ? "個体化を再開 →"
                      : "個体化を開始 →"}
                  </A>
                </Show>
              </div>
            </div>

            <div class="cohort-kpi-row">
              <div class="cohort-kpi card">
                <p class="cohort-kpi__label">生存数</p>
                <div class="cohort-kpi__value">
                  <span class="kpi-num">{d().currentCount}</span>
                  <span class="cohort-kpi__unit">/ {d().initialCount}</span>
                </div>
              </div>
              <div class="cohort-kpi card">
                <p class="cohort-kpi__label">経過</p>
                <div class="cohort-kpi__value">
                  <span class="kpi-num">{daysSince(d().startDate)}</span>
                  <span class="cohort-kpi__unit">日</span>
                </div>
              </div>
              <div class="cohort-kpi card">
                <p class="cohort-kpi__label">ステージ</p>
                <div class="cohort-kpi__value">
                  <span class="kpi-num cohort-kpi__stage">
                    {STAGE_LABEL[d().stage]}
                  </span>
                </div>
              </div>
              <div class="cohort-kpi card">
                <p class="cohort-kpi__label">個体化済</p>
                <div class="cohort-kpi__value">
                  <span class="kpi-num">{d().promotedSpecimensCount}</span>
                  <span class="cohort-kpi__unit">匹</span>
                </div>
              </div>
            </div>

            <nav class="cohort-tabs" aria-label="群詳細タブ">
              <button
                type="button"
                class={"cohort-tab" + (tab() === "overview" ? " is-active" : "")}
                aria-pressed={tab() === "overview"}
                onClick={() => setTab("overview")}
              >
                概要
              </button>
              <button
                type="button"
                class={"cohort-tab" + (tab() === "log" ? " is-active" : "")}
                aria-pressed={tab() === "log"}
                onClick={() => setTab("log")}
              >
                ログ <span class="cohort-tab__count mn">{d().recentLogs.length}</span>
              </button>
              <button
                type="button"
                class={"cohort-tab" + (tab() === "origin" ? " is-active" : "")}
                aria-pressed={tab() === "origin"}
                onClick={() => setTab("origin")}
              >
                由来
              </button>
            </nav>

            <Show when={tab() === "overview"}>
              <CohortOverview detail={d()} />
            </Show>
            <Show when={tab() === "log"}>
              <CohortLogTab detail={d()} />
            </Show>
            <Show when={tab() === "origin"}>
              <CohortOriginTab detail={d()} />
            </Show>
          </>
        )}
      </Show>
    </>
  );
};

// ──────────────────────────────────────────────────────────────────────
// 概要タブ — 直近の群ログ + (placeholder) 推定ロット成績
// ──────────────────────────────────────────────────────────────────────

const CohortOverview = (props: { detail: CohortDetailView }) => (
  <div class="cohort-overview">
    <section class="card cohort-section">
      <p class="cohort-section__label">直近の群ログ</p>
      <Show
        when={props.detail.recentLogs.length > 0}
        fallback={
          <p class="cohort-empty-state cohort-empty-state--inline">
            まだログがありません。
          </p>
        }
      >
        <ul class="cohort-loglist">
          <For each={props.detail.recentLogs.slice(0, 5)}>
            {(log) => (
              <li class="cohort-loglist__row">
                <span class="cohort-loglist__date mn">
                  {formatDate(log.loggedAt)}
                </span>
                <span class={`chip chip-${LOG_TYPE_TONE[log.logType]}`}>
                  {LOG_TYPE_LABEL[log.logType]}
                </span>
                <span class="cohort-loglist__body">{log.body ?? "—"}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
    <section class="card cohort-section">
      <p class="cohort-section__label">推定ロット成績 (Phase 4 以降)</p>
      <dl class="cohort-stats">
        <div class="cohort-stats__row">
          <dt>想定羽化</dt>
          <dd class="mn">2026.9 (推定)</dd>
        </div>
        <div class="cohort-stats__row">
          <dt>餌コスト/匹</dt>
          <dd class="mn">¥— (Phase 4 で算出)</dd>
        </div>
        <div class="cohort-stats__row">
          <dt>類似ロット平均生存率</dt>
          <dd class="mn">— (Phase 4 で算出)</dd>
        </div>
      </dl>
    </section>
  </div>
);

// ──────────────────────────────────────────────────────────────────────
// ログタブ
// ──────────────────────────────────────────────────────────────────────

const CohortLogTab = (props: { detail: CohortDetailView }) => (
  <section class="card cohort-section">
    <p class="cohort-section__label">群ログ ({props.detail.recentLogs.length} 件)</p>
    <Show
      when={props.detail.recentLogs.length > 0}
      fallback={
        <p class="cohort-empty-state cohort-empty-state--inline">
          まだログがありません。「一括ログ」で記録してください。
        </p>
      }
    >
      <ul class="cohort-loglist">
        <For each={props.detail.recentLogs}>
          {(log) => (
            <li class="cohort-loglist__row">
              <span class="cohort-loglist__date mn">
                {formatDate(log.loggedAt)}
              </span>
              <span class={`chip chip-${LOG_TYPE_TONE[log.logType]}`}>
                {LOG_TYPE_LABEL[log.logType]}
              </span>
              <span class="cohort-loglist__body">{log.body ?? "—"}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  </section>
);

// ──────────────────────────────────────────────────────────────────────
// 由来タブ
// ──────────────────────────────────────────────────────────────────────

const ORIGIN_LABEL: Record<CohortDetailView["originKind"], string> = {
  egg_lay: "産卵 (自家繁殖)",
  purchase: "購入",
  field_collected: "自己採集",
};

const CohortOriginTab = (props: { detail: CohortDetailView }) => (
  <section class="card cohort-section">
    <p class="cohort-section__label">由来情報</p>
    <dl class="cohort-stats">
      <div class="cohort-stats__row">
        <dt>由来種別</dt>
        <dd>{ORIGIN_LABEL[props.detail.originKind]}</dd>
      </div>
      <div class="cohort-stats__row">
        <dt>親交配</dt>
        <dd class="mn">{props.detail.parentMatingId ?? "—"}</dd>
      </div>
      <div class="cohort-stats__row">
        <dt>系統</dt>
        <dd>{props.detail.bloodlineName ?? "—"}</dd>
      </div>
      <div class="cohort-stats__row">
        <dt>開始日</dt>
        <dd class="mn">{props.detail.startDate}</dd>
      </div>
      <Show when={props.detail.notes}>
        <div class="cohort-stats__row">
          <dt>備考</dt>
          <dd>{props.detail.notes}</dd>
        </div>
      </Show>
    </dl>
  </section>
);
