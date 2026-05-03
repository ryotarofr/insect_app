// pages/cohort/index.tsx — 飼育 (cohort + 単独個体) 一覧ページ
//
// **構成**:
//   - .page-head: タイトル「飼育」+ サブタイトル + CTA 行
//   - タブ: アクティブ / アーカイブ済み
//   - カードグリッド (.cohort-grid): CohortCard と SpecimenSummaryCard を 1 グリッドに混在
//   - empty / loading / error 各状態
//
// **CTA**:
//   - 「+ 個体登録」 → /specimens/new (cohort_id 紐付け無し / 単独飼育)
//   - 「+ 群を作成」 → /cohorts/new
//
// **タブ切替**:
//   URL クエリ `?archived=true` でアーカイブを表示。push state を使い、ブラウザ戻るで
//   タブ間を遷移できる。
//
// **群 + 単独個体の混在表示** (Cohort UX fix):
//   この画面は「自分が今飼育中のもの」のハブとして cohort と specimen を両方見せる。
//   - cohort active : `archivedAt == null`
//   - specimen active: `isArchived === false`
//   - cohort archived : `archivedAt != null`
//   - specimen archived: `isArchived === true`
//   どちらも 1 つの `<For>` に concat して並べる。並び順は cohort 先 → specimen の順
//   (= 群飼育の方が情報量が多いので最初に視線が行くようにする)。

import { createMemo, For, onMount, Show } from "solid-js";
import { A, useLocation, useNavigate } from "@solidjs/router";
import {
  activeCohorts,
  archivedCohorts,
  cohortListError,
  isCohortListLoading,
  refreshCohorts,
} from "../../store/cohorts";
import {
  isSpecimensLoading,
  refreshMySpecimens,
  serverSpecimens,
  serverSpecimensError,
} from "../../store/specimens";
import { CohortCard } from "../../components/cohort/CohortCard";
import { SpecimenSummaryCard } from "../../components/cohort/SpecimenSummaryCard";
import type { CohortView } from "../../types/cohort";
import type { SpecimenView } from "../../sdui/api";

/** グリッドに混在させるためのタグ付き型。`<For>` 内で `kind` で分岐する。 */
type GridItem =
  | { kind: "cohort"; cohort: CohortView }
  | { kind: "specimen"; specimen: SpecimenView };

export const CohortListPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // 群と個体の両方を最新化する。
  // refreshMySpecimens は anonymous (= 401) を内部で握りつぶして null に倒すので、
  // ここでは fire-and-forget で良い (= App.tsx 側でも auth 連動 refresh が走る)。
  onMount(() => {
    void refreshCohorts();
    void refreshMySpecimens().catch(() => {
      /* error は store/specimens.ts 側で error signal に詰める */
    });
  });

  const showingArchived = createMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("archived") === "true";
  });

  // 個体の active / archived 派生 (= cohort 側と同じ命名)。
  // null (= 未取得 / anonymous) は空配列に倒す。
  const activeSpecimens = createMemo<SpecimenView[]>(() => {
    const list = serverSpecimens();
    if (!list) return [];
    return list.filter((s) => !s.isArchived);
  });
  const archivedSpecimens = createMemo<SpecimenView[]>(() => {
    const list = serverSpecimens();
    if (!list) return [];
    return list.filter((s) => s.isArchived);
  });

  // 表示用に cohort + specimen を 1 配列に concat (cohort 先, specimen 後)。
  const itemsToShow = createMemo<GridItem[]>(() => {
    const cohorts = showingArchived() ? archivedCohorts() : activeCohorts();
    const specimens = showingArchived() ? archivedSpecimens() : activeSpecimens();
    return [
      ...cohorts.map<GridItem>((c) => ({ kind: "cohort", cohort: c })),
      ...specimens.map<GridItem>((s) => ({ kind: "specimen", specimen: s })),
    ];
  });

  // ヘッダ / タブのカウントは cohort + specimen の合算。
  const activeTotal = createMemo(
    () => activeCohorts().length + activeSpecimens().length,
  );
  const archivedTotal = createMemo(
    () => archivedCohorts().length + archivedSpecimens().length,
  );

  const isLoading = createMemo(
    () => isCohortListLoading() || isSpecimensLoading(),
  );
  // どちらかにエラーがあれば代表値として表示する (両方ある場合は先に出た方)。
  const combinedError = createMemo(
    () => cohortListError() ?? serverSpecimensError(),
  );

  const switchTab = (archived: boolean) => {
    const target = archived ? "/cohorts?archived=true" : "/cohorts";
    if (location.pathname + location.search === target) return;
    navigate(target);
  };

  const retry = () => {
    void refreshCohorts();
    void refreshMySpecimens().catch(() => {
      /* swallow */
    });
  };

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">飼育</div>
          <h1>飼育</h1>
          <p class="page-head-sub">
            アクティブ {activeTotal()} / アーカイブ {archivedTotal()}
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
          アクティブ <span class="cohort-tab__count mn">{activeTotal()}</span>
        </button>
        <button
          type="button"
          class={"cohort-tab" + (showingArchived() ? " is-active" : "")}
          aria-pressed={showingArchived()}
          onClick={() => switchTab(true)}
        >
          アーカイブ <span class="cohort-tab__count mn">{archivedTotal()}</span>
        </button>
      </nav>

      <Show when={isLoading()}>
        <p class="cohort-empty-state">読み込み中…</p>
      </Show>

      <Show when={combinedError()}>
        <p class="cohort-empty-state cohort-empty-state--error">
          エラー: {combinedError()}{" "}
          <button type="button" class="btn" onClick={retry}>
            再試行
          </button>
        </p>
      </Show>

      <Show
        when={!isLoading() && !combinedError() && itemsToShow().length > 0}
        fallback={
          <Show when={!isLoading() && !combinedError() && itemsToShow().length === 0}>
            <p class="cohort-empty-state">
              {showingArchived()
                ? "アーカイブ済みはまだありません。"
                : "飼育中のレコードはまだありません。「+ 個体登録」または「+ 群を作成」から登録してください。"}
            </p>
          </Show>
        }
      >
        <div class="cohort-grid">
          <For each={itemsToShow()}>
            {(item) =>
              item.kind === "cohort" ? (
                <CohortCard cohort={item.cohort} />
              ) : (
                <SpecimenSummaryCard specimen={item.specimen} />
              )
            }
          </For>
        </div>
      </Show>
    </>
  );
};
