// pages/cohort/index.tsx — 飼育 (cohort) 一覧ページ
//
// **構成**:
//   - .page-head: タイトル「飼育」+ サブタイトル + CTA 行
//   - タブ: アクティブ / アーカイブ済み
//   - カードグリッド (.grid-cards-2): CohortCard を並べる
//   - empty / loading / error 各状態
//
// **CTA**:
//   - 「+ 個体登録」 → /specimens/new (cohort_id 紐付け無し)
//   - 「+ 群を作成」 → /cohorts/new
//
// **タブ切替**:
//   URL クエリ `?archived=true` でアーカイブを表示。push state を使い、ブラウザ戻るで
//   タブ間を遷移できる。

import { createMemo, For, onMount, Show } from "solid-js";
import { A, useLocation, useNavigate } from "@solidjs/router";
import {
  activeCohorts,
  archivedCohorts,
  cohortListError,
  isCohortListLoading,
  refreshCohorts,
} from "../../store/cohorts";
import { CohortCard } from "../../components/cohort/CohortCard";

export const CohortListPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  onMount(() => {
    void refreshCohorts();
  });

  const showingArchived = createMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("archived") === "true";
  });

  const cohortsToShow = createMemo(() =>
    showingArchived() ? archivedCohorts() : activeCohorts(),
  );

  const switchTab = (archived: boolean) => {
    const target = archived ? "/cohorts?archived=true" : "/cohorts";
    if (location.pathname + location.search === target) return;
    navigate(target);
  };

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">飼育</div>
          <h1>飼育</h1>
          <p class="page-head-sub">
            アクティブ {activeCohorts().length} / アーカイブ {archivedCohorts().length}
          </p>
        </div>
        <div class="page-actions">
          <A href="/specimens/new" class="btn">
            + 個体登録
          </A>
          <A href="/cohorts/new" class="btn primary">
            + 群を作成
          </A>
        </div>
      </div>

      <nav class="cohort-tabs" aria-label="飼育一覧タブ">
        <button
          type="button"
          class={"cohort-tab" + (!showingArchived() ? " is-active" : "")}
          aria-pressed={!showingArchived()}
          onClick={() => switchTab(false)}
        >
          アクティブ <span class="cohort-tab__count mn">{activeCohorts().length}</span>
        </button>
        <button
          type="button"
          class={"cohort-tab" + (showingArchived() ? " is-active" : "")}
          aria-pressed={showingArchived()}
          onClick={() => switchTab(true)}
        >
          アーカイブ <span class="cohort-tab__count mn">{archivedCohorts().length}</span>
        </button>
      </nav>

      <Show when={isCohortListLoading()}>
        <p class="cohort-empty-state">読み込み中…</p>
      </Show>

      <Show when={cohortListError()}>
        <p class="cohort-empty-state cohort-empty-state--error">
          エラー: {cohortListError()}{" "}
          <button type="button" class="btn" onClick={() => void refreshCohorts()}>
            再試行
          </button>
        </p>
      </Show>

      <Show
        when={!isCohortListLoading() && !cohortListError() && cohortsToShow().length > 0}
        fallback={
          <Show when={!isCohortListLoading() && !cohortListError() && cohortsToShow().length === 0}>
            <p class="cohort-empty-state">
              {showingArchived()
                ? "アーカイブ済みの群はまだありません。"
                : "アクティブな群はまだありません。「+ 群を作成」から登録してください。"}
            </p>
          </Show>
        }
      >
        <div class="cohort-grid">
          <For each={cohortsToShow()}>
            {(c) => <CohortCard cohort={c} />}
          </For>
        </div>
      </Show>
    </>
  );
};
