import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";
import { Show, Suspense, createResource } from "solid-js";
import { isServer } from "solid-js/web";
import { SduiActionsContext } from "~/sdui/actions";
import { fetchPage } from "~/sdui/api";
import { PageRenderer } from "~/sdui/renderer";

/**
 * 飼育管理ページ(SDUI)。個体詳細は一覧行直下のアコーディオン展開。
 *
 * ちらつき対策:
 * - `view.latest` / `detail.latest` で読む — 再fetch中も旧値を返すためサスペンドせず、
 *   ページ全体が app.tsx の Suspense へ落ちない
 * - Show は非キー形式 — 再fetchで子ツリーを再マウントしない(展開状態・タブ選択が保持される)
 * - 詳細の初回fetchは行内のローカル <Suspense> に閉じ込める
 */
export default function Care() {
  const [view, { refetch }] = createResource(
    () => (isServer ? undefined : "care"),
    key => fetchPage(key),
  );

  return (
    <>
      <Title>飼育管理 | insect_app_r2</Title>
      <SduiActionsContext.Provider
        value={{
          pageKey: "care",
          refresh: () => void refetch(),
          refreshAll: () => void refetch(),
          renderSpecimenDetail: id => (
            <InlineSpecimenDetail specimenId={id} refreshList={() => void refetch()} />
          ),
        }}
      >
        <Show
          when={!view.error}
          fallback={
            <Show
              when={String(view.error ?? "").includes("401")}
              fallback={
                <p class="sd-status sd-status--error">
                  読み込みに失敗しました(apiは起動していますか?): {String(view.error)}
                </p>
              }
            >
              <div class="auth-page">
                <section class="sd-card">
                  <h2 class="sd-text sd-text--headline">飼育管理</h2>
                  <p class="sd-text">
                    飼育データはアカウントごとに管理されます。ログインしてご利用ください。
                  </p>
                  <A class="sd-cta sd-cta--primary" href="/login">
                    ログイン / 新規登録へ
                  </A>
                </section>
              </div>
            </Show>
          }
        >
          <Show when={view.latest} fallback={<p class="sd-status">読み込み中…</p>}>
            <PageRenderer view={view.latest!} />
          </Show>
        </Show>
      </SduiActionsContext.Provider>
    </>
  );
}

/** 行直下に展開する個体詳細。ローディングはこの中のSuspenseに閉じる */
function InlineSpecimenDetail(props: { specimenId: string; refreshList: () => void }) {
  const [detail, { refetch }] = createResource(
    () => props.specimenId,
    id => fetchPage("specimen_detail", { specimen: id }),
  );
  return (
    <SduiActionsContext.Provider
      value={{
        pageKey: "specimen_detail",
        refresh: () => void refetch(),
        refreshAll: () => {
          void refetch();
          props.refreshList();
        },
      }}
    >
      <Suspense fallback={<p class="sd-status">読み込み中…</p>}>
        <Show
          when={!detail.error}
          fallback={
            <p class="sd-status sd-status--error">
              詳細の読み込みに失敗しました: {String(detail.error)}
            </p>
          }
        >
          <Show when={detail.latest}>
            <PageRenderer view={detail.latest!} />
          </Show>
        </Show>
      </Suspense>
    </SduiActionsContext.Provider>
  );
}
