import { Title } from "@solidjs/meta";
import { A, useSearchParams } from "@solidjs/router";
import { Show, Suspense, createResource, createSignal } from "solid-js";
import { isServer } from "solid-js/web";
import { SduiActionsContext } from "~/sdui/actions";
import { fetchPage } from "~/sdui/api";
import { CardBuilder } from "~/sdui/builder";
import { PageRenderer } from "~/sdui/renderer";
import { Status, Text } from "~/sdui/primitives";
import { AddSpecimenModal, firstParam } from "~/sdui/specimen";

/**
 * 飼育管理ページ(SDUI)。個体詳細は一覧行直下のアコーディオン展開。
 *
 * このページは actions provider として閉じた動詞 `add_specimen` を実装する
 * (定義側の action_button ブロックが起動する。ボタンの存在・位置・文言は定義 = DB管理)。
 *
 * URL がページコンテキスト(Phase 2):
 * - `?group=` 選択タブ。リソースが連動して `GET /api/pages/care?group=` を再fetchし、
 *   選択の解決(無効値の既定フォールバック含む)はサーバが行う
 * - `?open=` 展開中の個体行(specimen_rows が参照)
 *
 * ちらつき対策:
 * - `view.latest` / `detail.latest` で読む — 再fetch中も旧値を返すためサスペンドせず、
 *   ページ全体が app.tsx の Suspense へ落ちない
 * - Show は非キー形式 — 再fetchで子ツリーを再マウントしない(展開状態・タブ選択が保持される)
 * - 詳細の初回fetchは行内のローカル <Suspense> に閉じ込める
 */
export default function Care() {
  const [params, setParams] = useSearchParams();
  const groupParam = () => firstParam(params.group);
  const [view, { refetch }] = createResource(
    () => (isServer ? undefined : ([groupParam() ?? ""] as const)),
    ([group]) => fetchPage("care", { group: group || undefined }),
  );
  // 再fetchでカード群のDOMが作り直されてもスクロール位置を保つ
  // (TODO追加・記録追加などの書込→refreshAll でページ先頭へ飛ばないように)
  const refetchKeepScroll = () => {
    const y = window.scrollY;
    void Promise.resolve(refetch()).finally(() => {
      requestAnimationFrame(() => window.scrollTo(0, y));
    });
  };
  // 個体追加モーダル(action_button の動詞 "add_specimen" が開く)
  const [adding, setAdding] = createSignal(false);
  // カードビルダー(動詞 "add_card" が開く)
  const [building, setBuilding] = createSignal(false);

  return (
    <>
      <Title>飼育管理 | insect_app_r2</Title>
      <SduiActionsContext.Provider
        value={{
          pageKey: "care",
          // care はユーザ毎ページ: 定義書込(文言編集・ビルダー・カード削除)は /mine へ
          pageScope: "mine",
          refresh: refetchKeepScroll,
          refreshAll: refetchKeepScroll,
          // care_alerts の行クリック等: タブ切替+行展開(URL更新)。
          // ビルダーのプレビューには渡らないため、プレビュー内クリックは実URLを動かさない
          revealSpecimen: (groupId, specimenId) =>
            setParams({ group: groupId, open: specimenId }),
          runAction: action => {
            // 閉じた動詞のみ。未知の動詞は no-op(落とさない契約)
            if (action === "add_specimen") setAdding(true);
            else if (action === "add_card") setBuilding(true);
            else console.warn("unknown ui action:", action);
          },
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
                <Status error>
                  読み込みに失敗しました(apiは起動していますか?): {String(view.error)}
                </Status>
              }
            >
              <div class="auth-page">
                <section class="sd-card">
                  <Text role="headline">飼育管理</Text>
                  <Text>
                    飼育データはアカウントごとに管理されます。ログインしてご利用ください。
                  </Text>
                  <A class="sd-cta sd-cta--primary" href="/login">
                    ログイン / 新規登録へ
                  </A>
                </section>
              </div>
            </Show>
          }
        >
          <Show when={view.latest} fallback={<Status>読み込み中…</Status>}>
            <PageRenderer view={view.latest!} />
          </Show>
        </Show>

        <Show when={adding()}>
          <AddSpecimenModal defaultGroupId={groupParam() ?? null} onClose={() => setAdding(false)} />
        </Show>

        <Show when={building()}>
          <CardBuilder pageKey="care" onClose={() => setBuilding(false)} />
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
      <Suspense fallback={<Status>読み込み中…</Status>}>
        <Show
          when={!detail.error}
          fallback={
            <Status error>詳細の読み込みに失敗しました: {String(detail.error)}</Status>
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
