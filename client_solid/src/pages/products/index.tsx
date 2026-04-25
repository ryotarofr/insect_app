// pages/products/index.tsx — ProductsList + ProductDetail コンテナ
//
// **Strangler Fig 完成 (2026-04)**:
//   ProductsList のグリッド部分を SDUI 経由に切り替え。
//   - 旧: data.ts (`listProducts()`) → 静的 <ProductCard> の grid
//   - 新: GET /api/v1/cards/products → CardRenderer の grid
//
//   詳細: docs/sdui-three-layer-model-v5.md §11 (移行戦略)
//
// **TabSwitcher / SpeciesFilterBar の扱い**:
//   旧フィルタは Product 型に対する predicate に依存していた。
//   SDUI 側はまだ filter 用の query param を持たないため、フィルタ UI は一旦撤去。
//   サーバ側に `GET /cards/products?kind=specimen|supply&species=...` を追加してから
//   client-side で UI を復活させる予定 (Phase 2)。
//
// **クリック → 詳細遷移**:
//   旧 ProductCard の onClick → setSelectedProduct + setRoute("product-detail") を維持。
//   SDUI Card 自身は href を持たないので、ラップ div に onClick を載せる暫定対応。
//   将来は Card 内の `cta` block (intent: "tertiary", href: productUrl(id)) で
//   SDUI 駆動のナビゲーションに置き換える。
//
// **ProductDetail も SDUI 化 (2026-04 / Phase 2 MVP)**:
//   GET /api/v1/cards/products/:id/detail → product_detail テンプレートを CardRenderer で描画。
//   旧 ProductMediaGallery / ProductDetailContent は cleanup task #34 で TOMBSTONE 化済み
//   (ファイルは git rm 待ち、import は無し)。
//   保証 card / ウォッチボタン / カート連携は Phase 2.5 で復活させる。

import { ErrorBoundary, For, Show, createMemo, createResource } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import type { RouteKey } from "../../data";
import {
  fetchProductDetailCard,
  fetchProductList,
  SduiFetchError,
  type ProductListQuery,
} from "../../sdui/api";
import { CardRenderer } from "../../sdui/CardRenderer";
import { FilterBarView } from "../../sdui/FilterBar";
import { SortBarView } from "../../sdui/SortBar";
import { SearchBoxView } from "../../sdui/SearchBox";
import { PaginationView } from "../../sdui/Pagination";
import type { CardBlock } from "../../sdui/branded";
import { Hero } from "./Hero";

interface ProductsListProps {
  setRoute: (r: RouteKey) => void;
  setSelectedProduct: (id: string) => void;
}

export const ProductsList = (props: ProductsListProps) => {
  // Phase 4: URL search params を fetch にそのまま渡す。
  //   - ?category=live&difficulty=hard のような URL を server へ転送し、
  //     server 側で filter chip の selected / href を組み立ててもらう。
  //   - useSearchParams は signal getter なので、URL が変わると createResource
  //     が自動で再 fetch する → SPA で chip クリック → URL 書き換え → 再 fetch
  //     のループが破綻なく回る。
  const [searchParams] = useSearchParams();

  // ProductListQuery を URL から組み立てる (signal が依存に入るよう memo 経由)。
  // 配列で来たケース (`?category=a&category=b`) は先頭値だけ採用 — server 側も
  // single-select 想定なので 2 件目以降は破棄して「最後に勝つ」挙動を避ける。
  // Phase 5: `?sort=` も同じく forward する。
  // Phase 6: `?q=` / `?page=` / `?perPage=` も同じく forward する。
  //   - q は素朴に文字列 forward (trim/正規化はサーバ側に任せる = canonical 化を 1 か所に集約)。
  //   - page / perPage は数値化。NaN / 0 / 負値は undefined に倒す (= サーバの default を使う)。
  const query = createMemo<ProductListQuery>(() => {
    const pickFirst = (v: string | string[] | undefined): string | undefined => {
      if (!v) return undefined;
      return Array.isArray(v) ? v[0] : v;
    };
    const pickPositiveInt = (
      v: string | string[] | undefined,
    ): number | undefined => {
      const s = pickFirst(v);
      if (s == null) return undefined;
      const n = Number.parseInt(s, 10);
      if (!Number.isFinite(n) || n <= 0) return undefined;
      return n;
    };
    return {
      category: pickFirst(searchParams.category),
      difficulty: pickFirst(searchParams.difficulty),
      sort: pickFirst(searchParams.sort),
      q: pickFirst(searchParams.q),
      page: pickPositiveInt(searchParams.page),
      perPage: pickPositiveInt(searchParams.perPage),
    };
  });

  // createResource の source 引数に query() を渡すと、URL が変わるたびに
  // 再 fetch が走る。返り値は ProductListResponse (filterBar + cards)。
  const [list, { refetch }] = createResource(query, fetchProductList);

  const onCardClick = (card: CardBlock) => {
    props.setSelectedProduct(card.id);
    props.setRoute("product-detail");
  };

  return (
    <>
      <Hero setRoute={props.setRoute} />

      <div class="page-head">
        <div>
          <div class="cat">ショップ · ANCHOR BEETLE CO. + MIYAMA FARM</div>
          <h1>生体と用品</h1>
        </div>
        {/* Phase 4: filter chip 群は server-driven。下の <FilterBarView> が描画する。
            旧 ProductFilters.tsx (TOMBSTONE 化済み / cleanup task #34) は完全に置き換え済み。 */}
      </div>

      {/* loading / error / empty を Show で吸収 */}
      <Show
        when={!list.loading}
        fallback={
          <div
            style={{
              padding: "32px",
              "text-align": "center",
              color: "var(--ink-mute)",
            }}
          >
            読み込み中…
          </div>
        }
      >
        <Show when={!list.error} fallback={<GridErrorView error={list.error} onRetry={refetch} />}>
          {/* Phase 6: 検索 box は filter / sort より上に置く (= ユーザの目線移動の起点)。
              0 件マッチでも常に出す (= 検索を直す導線)。 */}
          <Show when={list()?.searchBox}>
            {(box) => <SearchBoxView box={box()} />}
          </Show>
          {/* filter bar はカード 0 件でも常に出す: ユーザが filter を解除して戻れる導線 */}
          <Show when={list()?.filterBar}>
            {(bar) => <FilterBarView bar={bar()} />}
          </Show>
          {/* Phase 5: sort bar も常に出す (= 0 件マッチでも sort UI は維持)。
              filterBar と sortBar は独立の信号源。サーバが sortBar 不在で返してきたら
              sort 機能 OFF として描かない。 */}
          <Show when={list()?.sortBar}>
            {(bar) => <SortBarView bar={bar()} />}
          </Show>

          <Show
            when={(list()?.cards ?? []).length > 0}
            fallback={
              <div
                style={{
                  padding: "32px",
                  "text-align": "center",
                  color: "var(--ink-mute)",
                  border: "1px dashed var(--line)",
                  "border-radius": "8px",
                }}
              >
                表示できる商品がありません
              </div>
            }
          >
            <div class="grid-cards-3">
              <For each={list()?.cards ?? []}>
                {(card) => (
                  // ErrorBoundary は CardRenderer 内にもあるが、
                  // 念のため二重にしてラッパ div の onClick まで保護する。
                  <ErrorBoundary
                    fallback={(err) => {
                      // eslint-disable-next-line no-console
                      console.error(`[/products] outer boundary id=${card.id}`, err);
                      return null;
                    }}
                  >
                    <div
                      role="button"
                      tabindex={0}
                      style={{ cursor: "pointer" }}
                      onClick={() => onCardClick(card)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onCardClick(card);
                        }
                      }}
                    >
                      <CardRenderer card={card} />
                    </div>
                  </ErrorBoundary>
                )}
              </For>
            </div>
          </Show>
          {/* Phase 6: pagination は cards の下 (= 結果集合の境界)。0 件でも shell は出す
              (server 側が totalPages>=1 にフロアしているので 1/1 として描かれる)。
              現在 page を超えた out-of-range は server 側が cards=[] で返す + page 番号は
              clamp 済みの選択候補として描画 (= 戻り導線になる)。 */}
          <Show when={list()?.pagination}>
            {(p) => <PaginationView pagination={p()} />}
          </Show>
        </Show>
      </Show>
    </>
  );
};

/** グリッド全体が壊れた時の表示。`SduiFetchError` か unknown を区別。 */
const GridErrorView = (props: { error: unknown; onRetry: () => void }) => {
  const e = props.error;
  return (
    <div
      style={{
        padding: "16px",
        border: "1px solid var(--accent-rose)",
        "border-radius": "8px",
        color: "var(--accent-rose)",
        display: "flex",
        gap: "12px",
        "align-items": "flex-start",
      }}
    >
      <div style={{ flex: 1 }}>
        <strong>商品一覧を取得できませんでした</strong>
        <div style={{ "font-size": "12px", "margin-top": "4px" }}>
          {e instanceof SduiFetchError
            ? `HTTP ${e.status} — ${e.message}`
            : `予期しないエラー: ${String(e)}`}
        </div>
      </div>
      <button
        type="button"
        onClick={props.onRetry}
        style={{
          padding: "6px 12px",
          border: "1px solid var(--accent-rose)",
          background: "transparent",
          color: "var(--accent-rose)",
          "border-radius": "6px",
          cursor: "pointer",
          "font-size": "12px",
        }}
      >
        再試行
      </button>
    </div>
  );
};

interface ProductDetailProps {
  productId: string;
  // setRoute は SDUI 化により内部からは使わなくなったが、
  // 呼び出し側 (App.tsx) のシグネチャを変えないために props に残しておく。
  // CTA から戻る場合は href ベースで遷移する想定 (cart 等)。
  setRoute?: (r: RouteKey) => void;
}

export const ProductDetail = (props: ProductDetailProps) => {
  // SDUI 化: id をキーに detail カードを取得する。
  // productId が変わったら createResource は自動で再取得する。
  const [card, { refetch }] = createResource(
    () => props.productId,
    (id) => fetchProductDetailCard(id),
  );

  return (
    <Show
      when={!card.loading}
      fallback={
        <div
          style={{
            padding: "32px",
            "text-align": "center",
            color: "var(--ink-mute)",
          }}
        >
          読み込み中…
        </div>
      }
    >
      <Show
        when={!card.error && card()}
        fallback={<DetailErrorView error={card.error} onRetry={refetch} />}
      >
        <ErrorBoundary
          fallback={(err) => {
            // eslint-disable-next-line no-console
            console.error(`[/products/${props.productId}] outer boundary`, err);
            return (
              <div
                style={{
                  padding: "16px",
                  border: "1px dashed var(--accent-rose)",
                  color: "var(--accent-rose)",
                  "font-size": "12px",
                }}
              >
                <strong>詳細ページの描画に失敗しました</strong>
              </div>
            );
          }}
        >
          <CardRenderer card={card()!} />
        </ErrorBoundary>
      </Show>
    </Show>
  );
};

/** 詳細取得失敗時の表示。404 / network / unknown を区別する。 */
const DetailErrorView = (props: { error: unknown; onRetry: () => void }) => {
  const e = props.error;
  const isNotFound = e instanceof SduiFetchError && e.status === 404;

  return (
    <div
      style={{
        padding: "16px",
        border: "1px solid var(--accent-rose)",
        "border-radius": "8px",
        color: "var(--accent-rose)",
        display: "flex",
        gap: "12px",
        "align-items": "flex-start",
      }}
    >
      <div style={{ flex: 1 }}>
        <strong>
          {isNotFound ? "商品が見つかりませんでした" : "商品詳細を取得できませんでした"}
        </strong>
        <div style={{ "font-size": "12px", "margin-top": "4px" }}>
          {e instanceof SduiFetchError
            ? `HTTP ${e.status} — ${e.message}`
            : `予期しないエラー: ${String(e)}`}
        </div>
      </div>
      <Show when={!isNotFound}>
        <button
          type="button"
          onClick={props.onRetry}
          style={{
            padding: "6px 12px",
            border: "1px solid var(--accent-rose)",
            background: "transparent",
            color: "var(--accent-rose)",
            "border-radius": "6px",
            cursor: "pointer",
            "font-size": "12px",
          }}
        >
          再試行
        </button>
      </Show>
    </div>
  );
};
