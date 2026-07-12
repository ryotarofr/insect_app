import { Title } from "@solidjs/meta";
import { Show, createResource } from "solid-js";
import { isServer } from "solid-js/web";
import { SduiActionsContext } from "~/sdui/actions";
import { fetchPage } from "~/sdui/api";
import { PageRenderer } from "~/sdui/renderer";

/**
 * SDUI コンテンツ面。このファイルは「どのページを表示するか(= page_key)」しか知らない。
 * `view.latest` + 非キーShow で再fetch時のサスペンド/再マウントを避ける(careと同じ方針)。
 */
export default function Home() {
  // SPAモード前提。仮にSSRで動いてもサーバ側でfetchしないようガード
  const [view, { refetch }] = createResource(
    () => (isServer ? undefined : "home"),
    key => fetchPage(key),
  );
  return (
    <>
      <Title>ホーム | insect_app_r2</Title>
      <SduiActionsContext.Provider
        value={{
          pageKey: "home",
          refresh: () => void refetch(),
          refreshAll: () => void refetch(),
        }}
      >
        <Show
          when={!view.error}
          fallback={
            <p class="sd-status sd-status--error">
              読み込みに失敗しました(apiは起動していますか?): {String(view.error)}
            </p>
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
