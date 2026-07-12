import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { Show, createResource } from "solid-js";
import { isServer } from "solid-js/web";
import { SduiActionsContext } from "~/sdui/actions";
import { fetchPage } from "~/sdui/api";
import { PageRenderer } from "~/sdui/renderer";

/**
 * 出品詳細ページ(SDUI)。定義1枚(listing_detail)を ?listing={id} で解決。
 * ディープリンク可能な独立ページ(買い手に共有するURLになる面のため)。
 */
export default function ListingDetail() {
  const params = useParams();
  const [view, { refetch }] = createResource(
    () => (isServer ? undefined : params.id),
    id => fetchPage("listing_detail", { listing: id }),
  );

  return (
    <>
      <Title>出品詳細 | insect_app_r2</Title>
      <SduiActionsContext.Provider
        value={{
          pageKey: "listing_detail",
          refresh: () => void refetch(),
          refreshAll: () => void refetch(),
        }}
      >
        <Show
          when={!view.error}
          fallback={
            <p class="sd-status sd-status--error">
              出品が見つかりませんでした: {String(view.error)}
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
