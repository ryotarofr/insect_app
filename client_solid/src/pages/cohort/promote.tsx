// pages/cohort/promote.tsx — 個体化モード本体
//
// **構成** (docs/cohort-implementation-plan.md §7、実機モック v3 準拠):
//   - status banner: 「LOT-XXX から個体化中」+ X / Y 匹完了
//   - 新規記録カード: 個体ID (mono large) + 体重/体長 spinner + 作業 chips + 個別メモ
//   - ボタン: 「個体化モードを終了する」 (outline) + 「完了 → 次の 1 匹」 (forest filled)
//   - 下: セッションタイムライン (このセッションで個体化された specimens)
//
// **動線**:
//   - Enter: 完了 → 次の 1 匹 (POST /promote)
//   - Esc: 個体化モードを終了確認ダイアログ
//   - 100/100 到達時: 自動で完了ダイアログ → 3 秒後 router.replace で群詳細へ
//   - 終了確認 → 終了する: router.replace で群詳細へ (current_count > 0、archived_at は null のまま)
//
// **ダイアログ多重表示防止**:
//   complete dialog 表示中に終了ボタンを再度押せないよう、ローカル state で管理。

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  cohortDetail,
  cohortDetailError,
  endPromoteSession,
  isCohortDetailLoading,
  loadCohortDetail,
  promoteFromCohort,
  promoteSession,
  recordPromotion,
  startPromoteSession,
} from "../../store/cohorts";
import { SpecimenSpinner } from "../../components/recording/SpecimenSpinner";
import { RecordingDialog } from "../../components/recording/RecordingDialog";
import { showToast } from "../../store/toast";
import { findSpeciesById } from "../../store/species";
import { cohortUrl } from "../../router";
import type { PromoteCohortRequest } from "../../types/cohort";

interface Props {
  cohortPublicId: string;
}

interface SessionStats {
  count: number;
  avg: number;
  stddev: number;
}

const computeStats = (
  values: number[],
): SessionStats => {
  if (values.length === 0) {
    return { count: 0, avg: 0, stddev: 0 };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const variance =
    values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  return {
    count: values.length,
    avg: Math.round(avg * 100) / 100,
    stddev: Math.round(Math.sqrt(variance) * 100) / 100,
  };
};

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

type DialogKind = null | "confirm-end" | "complete";

export const CohortPromotePage = (props: Props) => {
  const navigate = useNavigate();

  // ルートパラメータ変更で詳細を取得 (= cohort の current_count を読む必要)
  createEffect(() => {
    void loadCohortDetail(props.cohortPublicId);
  });

  // セッション初期化 (cohort 詳細が取れたタイミングで)
  let sessionStarted = false;
  createEffect(() => {
    const d = cohortDetail();
    if (!d || sessionStarted) return;
    if (d.publicId !== props.cohortPublicId) return;
    if (d.archivedAt) {
      // 既にアーカイブ済の cohort で /promote にアクセスされた → 群詳細にリダイレクト
      showToast({
        tone: "warn",
        message: `${d.publicId} は既にアーカイブ済みです`,
      });
      navigate(cohortUrl(d.publicId), { replace: true });
      return;
    }
    if (d.currentCount <= 0) {
      navigate(cohortUrl(d.publicId), { replace: true });
      return;
    }
    startPromoteSession(d.publicId, d.currentCount);
    sessionStarted = true;
  });

  // unmount でセッションクリア
  onCleanup(() => {
    endPromoteSession();
  });

  // ──────────────────────────────────────────────────────────────────
  // フォーム local state (= 1 匹分の入力)
  // ──────────────────────────────────────────────────────────────────
  const [weight, setWeight] = createSignal<number | undefined>(undefined);
  const [length, setLength] = createSignal<number | undefined>(undefined);
  const [memo, setMemo] = createSignal<string>("");
  const [worksChecked, setWorksChecked] = createSignal<Set<string>>(
    new Set(["container"]), // 個別容器 = デフォルト ON
  );
  const toggleWork = (key: string) => {
    const next = new Set(worksChecked());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setWorksChecked(next);
  };

  const [submitting, setSubmitting] = createSignal(false);
  const [dialog, setDialog] = createSignal<DialogKind>(null);
  const [errMsg, setErrMsg] = createSignal<string | null>(null);

  // ──────────────────────────────────────────────────────────────────
  // 派生値: 母数, 完了数, 残り, 統計
  // ──────────────────────────────────────────────────────────────────
  const denominator = createMemo(() => promoteSession()?.denominator ?? 0);
  const promotedCount = createMemo(() => promoteSession()?.promotedCount ?? 0);
  const remainingInCohort = createMemo(() =>
    Math.max(0, denominator() - promotedCount()),
  );
  const sessionRecent = createMemo(() => promoteSession()?.recentlyPromoted ?? []);
  const stats = createMemo(() =>
    computeStats(
      sessionRecent()
        .map((r) => r.weightG ?? null)
        .filter((v): v is number => v !== null),
    ),
  );

  // 次の個体 ID は採番済 mock (UI では「自動採番」と表記し具体値は表示しない方針)
  // 実際の採番値はサーバ応答に依存するので、ここでは「次の 1 匹」プレースホルダ表示。
  const nextLabel = createMemo(() => {
    const total = denominator();
    return `${promotedCount() + 1} / ${total} 匹目`;
  });

  // ──────────────────────────────────────────────────────────────────
  // 送信
  // ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (submitting()) return;
    if (dialog()) return;
    setSubmitting(true);
    setErrMsg(null);

    const payload: PromoteCohortRequest = {
      specimen: {
        weightG: weight(),
        sizeMm: length(),
        notes: memo().trim() || undefined,
      },
      log: {
        body: memo().trim() || undefined,
        metrics: {
          works: Array.from(worksChecked()),
        },
      },
    };

    try {
      const res = await promoteFromCohort(props.cohortPublicId, payload);
      recordPromotion(res);
      // フォームをリセット (次の 1 匹用)
      setWeight(undefined);
      setLength(undefined);
      setMemo("");
      // 作業 chips は前回値を保持 (連続作業前提)
      if (res.session.completed) {
        setDialog("complete");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // BE が返す技術的なエラー文字列 ("version conflict ..." 等) をユーザー向け
      // 日本語に翻訳 + 自動 recovery (= 群詳細へ戻る or 詳細を再取得)。
      // 想定される BE エラー (handlers/cohorts.rs の map_cohort_err):
      //   - "version conflict (expected N)"   → 二重タブ等で並列更新された
      //   - "cohort already archived"         → 既に archive 済 (= 通常は導線で防がれる)
      //   - "cohort is empty (current_count = 0)" → 全件個体化済
      const lower = msg.toLowerCase();
      if (lower.includes("version conflict")) {
        showToast({
          tone: "warn",
          message: "別の操作と競合しました。最新の状態を取得します。",
        });
        setErrMsg(null);
        // 詳細を再取得して current_count / archived_at を最新に。
        await loadCohortDetail(props.cohortPublicId);
      } else if (lower.includes("already archived")) {
        showToast({
          tone: "warn",
          message: "この群は既にアーカイブされています。",
        });
        navigate(cohortUrl(props.cohortPublicId), { replace: true });
      } else if (lower.includes("cohort is empty")) {
        showToast({
          tone: "info",
          message: "全ての個体を個体化済みです。群詳細に戻ります。",
        });
        navigate(`${cohortUrl(props.cohortPublicId)}?just_completed=true`, {
          replace: true,
        });
      } else {
        setErrMsg(msg);
        showToast({ tone: "error", message: `失敗: ${msg}` });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 終了確認ダイアログ
  const onTerminate = () => {
    if (dialog()) return;
    setDialog("confirm-end");
  };
  const onCancelTerminate = () => setDialog(null);
  const onConfirmTerminate = () => {
    setDialog(null);
    navigate(cohortUrl(props.cohortPublicId), { replace: true });
  };

  // 完了ダイアログ
  const onConfirmComplete = () => {
    setDialog(null);
    navigate(`${cohortUrl(props.cohortPublicId)}?just_completed=true`, {
      replace: true,
    });
  };

  // ──────────────────────────────────────────────────────────────────
  // キーボードショートカット (Esc → 終了確認)
  // ──────────────────────────────────────────────────────────────────
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      // ダイアログが自身で Esc を捌くのでスキップ
      if (dialog()) return;
      if (e.key === "Escape") {
        // 入力欄など focus 中の Esc は blur 動作優先 (= フォームに残る)
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        e.preventDefault();
        onTerminate();
      }
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  return (
    <>
      <Show when={isCohortDetailLoading() && !cohortDetail()}>
        <p class="cohort-empty-state">読み込み中…</p>
      </Show>

      <Show when={cohortDetailError() && !cohortDetail()}>
        <p class="cohort-empty-state cohort-empty-state--error">
          エラー: {cohortDetailError()}
        </p>
      </Show>

      <Show when={cohortDetail() && promoteSession() ? cohortDetail() : null}>
        {(d) => (
          <>
            {/* status banner */}
            <div class="promote-status">
              <div>
                <span class="promote-status__label">個体化中</span>
                <span class="promote-status__id mn">
                  {" "}{d().publicId}
                </span>
                {d().bloodlineName ? (
                  <span class="promote-status__bloodline">
                    {" "}· {d().bloodlineName}
                  </span>
                ) : null}
              </div>
              <div class="promote-status__count">
                <span class="ser">{promotedCount()}</span>
                <span class="promote-status__count-suffix">
                  {" "}/ {denominator()} 匹完了
                </span>
              </div>
            </div>

            {/* 新規記録カード */}
            <section class="card promote-form">
              <div class="promote-form__head">
                <p class="promote-form__eyebrow mn">
                  新規記録 · {nextLabel()}
                </p>
                <p class="promote-form__id mn">自動採番 (次の 1 匹)</p>
                <p class="promote-form__sub">
                  {d().speciesName ?? findSpeciesById(d().speciesId)?.name ?? d().speciesId}
                  {d().bloodlineName ? ` · ${d().bloodlineName}` : ""}
                  {d().parentMatingId ? " · 親継承" : ""}
                </p>
              </div>

              <div class="promote-form__row promote-form__row--measure">
                <div>
                  <label class="promote-form__label" for="weight-input">
                    体重{" "}
                    <span class="promote-form__unit">(g)</span>
                  </label>
                  <SpecimenSpinner
                    id="weight-input"
                    value={weight()}
                    onChange={setWeight}
                    step={0.1}
                    decimals={2}
                    min={0}
                    autoFocus
                    onSubmit={handleSubmit}
                  />
                </div>
                <div>
                  <label class="promote-form__label" for="length-input">
                    体長{" "}
                    <span class="promote-form__unit">(mm)</span>
                  </label>
                  <SpecimenSpinner
                    id="length-input"
                    value={length()}
                    onChange={setLength}
                    step={1}
                    min={0}
                    onSubmit={handleSubmit}
                  />
                </div>
              </div>

              <div class="promote-form__row">
                <p class="promote-form__label">作業</p>
                <div class="promote-form__chips">
                  {(
                    [
                      ["container", "個別容器"],
                      ["photo", "写真"],
                      ["label", "ラベル"],
                    ] as const
                  ).map(([key, label]) => {
                    const checked = () => worksChecked().has(key);
                    return (
                      <button
                        type="button"
                        class={
                          "chip work-chip" +
                          (checked()
                            ? " chip-forest"
                            : " chip-mute")
                        }
                        aria-pressed={checked()}
                        onClick={() => toggleWork(key)}
                      >
                        {checked() ? "☑ " : "☐ "}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div class="promote-form__row">
                <label class="promote-form__label" for="memo-input">
                  個別メモ
                </label>
                <input
                  id="memo-input"
                  type="text"
                  class="promote-form__memo"
                  placeholder="例: 兄弟より一回り大きい・前胸幅広め"
                  value={memo()}
                  onInput={(e) => setMemo(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSubmit();
                    }
                  }}
                />
              </div>

              <Show when={errMsg()}>
                <p class="promote-form__error">{errMsg()}</p>
              </Show>

              <div class="promote-form__actions">
                <button
                  type="button"
                  class="btn"
                  onClick={onTerminate}
                  disabled={submitting()}
                >
                  個体化モードを終了する
                </button>
                <button
                  type="button"
                  class="btn primary"
                  onClick={() => void handleSubmit()}
                  disabled={submitting()}
                >
                  {submitting() ? "送信中…" : "完了 → 次の 1 匹  ⏎"}
                </button>
              </div>
            </section>

            {/* セッションタイムライン */}
            <section class="promote-timeline">
              <div class="promote-timeline__head">
                <span class="mn promote-timeline__title">タイムライン</span>
                <span class="chip chip-forest">このセッション</span>
                <Show when={stats().count >= 1}>
                  <span class="promote-timeline__stats">
                    平均{" "}
                    <span class="mn">
                      {stats().avg.toFixed(1)} g
                    </span>
                    {" · σ "}
                    <span class="mn">{stats().stddev.toFixed(2)}</span>
                  </span>
                </Show>
              </div>
              <Show
                when={sessionRecent().length > 0}
                fallback={
                  <p class="cohort-empty-state cohort-empty-state--inline">
                    まだ個体化していません。最初の 1 匹を計測してください。
                  </p>
                }
              >
                <ul class="promote-timeline__list">
                  <For each={sessionRecent()}>
                    {(s) => (
                      <li class="promote-timeline__row">
                        <span class="mn promote-timeline__id">
                          {s.publicId}
                        </span>
                        <span class="chip chip-forest" style={{ "font-size": "9px" }}>
                          3 齢
                        </span>
                        <span class="promote-timeline__weight mn">
                          {s.weightG !== null ? `${s.weightG.toFixed(1)} g` : "—"}
                        </span>
                        <span class="promote-timeline__time mn">
                          {formatTime(s.promotedAt)}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            {/* ダイアログ */}
            <RecordingDialog
              kind="confirm-end"
              open={dialog() === "confirm-end"}
              onCancel={onCancelTerminate}
              onConfirm={onConfirmTerminate}
              body={
                <>
                  これまでに <strong>{promotedCount()} 匹</strong>{" "}
                  を個体化しました。
                  <br />
                  残りの {remainingInCohort()} 匹は群に残ります。
                </>
              }
            />
            <RecordingDialog
              kind="complete"
              open={dialog() === "complete"}
              onCancel={onConfirmComplete}
              onConfirm={onConfirmComplete}
              body={
                <>
                  {denominator()} 匹を個体化しました。
                  <br />
                  群詳細に戻ります。
                </>
              }
            />
          </>
        )}
      </Show>
    </>
  );
};
