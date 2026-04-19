// pages/products/index.tsx — ProductsList + ProductDetail コンテナ
import { createMemo, createSignal, For } from "solid-js";
import type { RouteKey } from "../../data";
import { listProducts, getProduct } from "../../api";
import { ProductCard } from "./ProductCard";
import {
  SpeciesFilterBar,
  SPECIES_FILTERS,
  TabSwitcher,
  type Tab,
} from "./ProductFilters";
import { ProductMediaGallery } from "./ProductMediaGallery";
import { ProductDetailContent } from "./ProductDetailContent";
import { Hero } from "./Hero";

interface ProductsListProps {
  setRoute: (r: RouteKey) => void;
  setSelectedProduct: (id: string) => void;
}

export const ProductsList = (props: ProductsListProps) => {
  const [tab, setTab] = createSignal<Tab>("all");
  const [activeSpecies, setActiveSpecies] = createSignal<string | null>(null);

  const items = createMemo(() => {
    const sp = activeSpecies();
    const speciesPredicate = sp
      ? SPECIES_FILTERS.find((f) => f.label === sp)?.match
      : undefined;
    return listProducts().filter((p) => {
      const kindOk =
        tab() === "all" || (tab() === "live" ? p.kind === "生体" : p.kind === "用品");
      const speciesOk = !speciesPredicate || speciesPredicate(p);
      return kindOk && speciesOk;
    });
  });

  return (
    <>
      <Hero setRoute={props.setRoute} />

      <div class="page-head">
        <div>
          <div class="cat">SHOP · ANCHOR BEETLE CO. + MIYAMA FARM</div>
          <h1>生体と用品</h1>
        </div>
        <div class="page-actions">
          <TabSwitcher tab={tab()} setTab={setTab} />
        </div>
      </div>

      <SpeciesFilterBar
        activeSpecies={activeSpecies()}
        setActiveSpecies={setActiveSpecies}
        resultCount={items().length}
      />

      <div class="grid-cards-3">
        <For each={items()}>
          {(p) => (
            <ProductCard
              product={p}
              onClick={() => {
                props.setSelectedProduct(p.id);
                props.setRoute("product-detail");
              }}
            />
          )}
        </For>
      </div>
    </>
  );
};

interface ProductDetailProps {
  productId: string;
  setRoute: (r: RouteKey) => void;
}

export const ProductDetail = (props: ProductDetailProps) => {
  const p = () => getProduct(props.productId) ?? listProducts()[0];

  return (
    <div class="grid-detail">
      <ProductMediaGallery product={p()} />
      <ProductDetailContent product={p()} setRoute={props.setRoute} />
    </div>
  );
};
