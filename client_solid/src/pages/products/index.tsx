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

import { ErrorBoundary, For, Show, createMemo, createResource, createSignal } from "solid-js";
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
import { BloodlineSummary } from "../../components/products/BloodlineSummary";
import { BloodlineLineageModal } from "../../components/products/BloodlineLineageModal";
import { BloodlineCardChips } from "../../components/products/BloodlineCardChips";
import "../../styles/bloodline.css";
import "../../styles/product-bloodline.css";

interface ProductsListProps {
  setRoute: (r: RouteKey) => void;
  setSelectedProduct: (id: string) => void;
}

export const ProductsList = (props: ProductsListProps) => {
  const [searchParams] = useSearchParams();

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
      </div>

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
          <Show when={list()?.searchBox}>
            {(box) => <SearchBoxView box={box()} />}
          </Show>
          <Show when={list()?.filterBar}>
            {(bar) => <FilterBarView bar={bar()} />}
          </Show>
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
                  <ErrorBoundary
                    fallback={(err) => {
                      console.error(`[/products] outer boundary id=${card.id}`, err);
                      return null;
                    }}
                  >
                    <div
                      role="button"
                      tabindex={0}
                      class="pbl-card-wrap"
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
                      {/* Phase 2: 血統バッジを右下に重ねる (= 血統 fixture がある生体カードのみ).
                          pointer-events: none なのでカードクリックは透過する. */}
                      <BloodlineCardChips productId={card.id} />
                    </div>
                  </ErrorBoundary>
                )}
              </For>
            </div>
          </Show>
          <Show when={list()?.pagination}>
            {(p) => <PaginationView pagination={p()} />}
          </Show>
        </Show>
      </Show>
    </>
  );
};

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
  setRoute?: (r: RouteKey) => void;
}

export const ProductDetail = (props: ProductDetailProps) => {
  const [card, { refetch }] = createResource(
    () => props.productId,
    (id) => fetchProductDetailCard(id),
  );
  const [bloodlineModalOpen, setBloodlineModalOpen] = createSignal(false);

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
          <>
            <CardRenderer card={card()!} />
            <BloodlineSummary
              productId={props.productId}
              onOpenFull={() => setBloodlineModalOpen(true)}
            />
            <BloodlineLineageModal
              open={bloodlineModalOpen()}
              productId={props.productId}
              onClose={() => setBloodlineModalOpen(false)}
            />
          </>
        </ErrorBoundary>
      </Show>
    </Show>
  );
};

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
