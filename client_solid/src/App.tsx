// App.tsx — root component with signal-based routing
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { type RouteKey } from "./data";
import {
  listSpecimens,
  listProducts,
  listUrgentEclosion,
  specimenExists,
  productExists,
} from "./api";
import { Shell } from "./components/Shell";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { MyPage } from "./pages/MyPage";
import { ProductsList, ProductDetail } from "./pages/products";
import { SpecimenDetail } from "./pages/specimen";
import { LogPage } from "./pages/Log";
import { EclosionPage } from "./pages/Eclosion";
import { BloodlinePage } from "./pages/Bloodline";
import { ShopPage } from "./pages/Shop";
import { MarketPage } from "./pages/Market";
import { CartPage } from "./pages/Cart";
import { cartCount } from "./store/cart";

const CRUMBS: Record<RouteKey, string> = {
  mypage: "マイページ / 所有個体",
  products: "ショップ / 生体・用品",
  "product-detail": "ショップ / 商品詳細",
  specimen: "飼育 / 個体カルテ",
  log: "飼育 / 飼育ログ",
  eclosion: "飼育 / 羽化予測",
  bloodline: "飼育 / 血統系図",
  shop: "運営 / ショップ管理",
  market: "取引 / C2Cマーケット",
  cart: "EC / カート",
};

const SHORTCUT_MAP: Record<string, RouteKey> = {
  "1": "mypage",
  "2": "products",
  "3": "specimen",
  "4": "log",
  "5": "eclosion",
  "6": "bloodline",
  "7": "market",
  "8": "shop",
  "9": "cart",
};

const VALID_ROUTES: RouteKey[] = [
  "mypage",
  "products",
  "product-detail",
  "specimen",
  "log",
  "eclosion",
  "bloodline",
  "shop",
  "market",
  "cart",
];

const isRouteKey = (v: string | null): v is RouteKey =>
  v !== null && VALID_ROUTES.includes(v as RouteKey);

/** localStorage に残った ID が現在のデータに存在しなければフォールバック値を返す */
const pickValidId = (
  stored: string | null,
  exists: (id: string) => boolean,
  fallback: string,
): string => {
  if (stored && exists(stored)) return stored;
  return fallback;
};

const DEFAULT_SPECIMEN = "#DHH-0271";
const DEFAULT_PRODUCT = "p-hh-m-142";

export const App = () => {
  const storedRoute = localStorage.getItem("kochu:route");
  const initialRoute: RouteKey = isRouteKey(storedRoute) ? storedRoute : "mypage";

  const initialSpecimen = pickValidId(
    localStorage.getItem("kochu:specimen"),
    specimenExists,
    listSpecimens()[0]?.id ?? DEFAULT_SPECIMEN,
  );
  const initialProduct = pickValidId(
    localStorage.getItem("kochu:product"),
    productExists,
    listProducts()[0]?.id ?? DEFAULT_PRODUCT,
  );

  const [route, _setRoute] = createSignal<RouteKey>(initialRoute);
  const [selectedSpecimen, setSelectedSpecimen] = createSignal<string>(initialSpecimen);
  const [selectedProduct, setSelectedProduct] = createSignal<string>(initialProduct);

  const setRoute = (r: RouteKey) => {
    _setRoute(r);
    localStorage.setItem("kochu:route", r);
    window.scrollTo(0, 0);
  };

  createEffect(() => {
    localStorage.setItem("kochu:specimen", selectedSpecimen());
  });
  createEffect(() => {
    localStorage.setItem("kochu:product", selectedProduct());
  });

  // 60 日以内に羽化予定の個体数（サイドバーバッジ用）
  const eclosionCount = createMemo(() => listUrgentEclosion(60).length);

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const next = SHORTCUT_MAP[e.key];
      if (next) setRoute(next);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const crumb = () => {
    const s = CRUMBS[route()] ?? route();
    const parts = s.split(" / ");
    return (
      <>
        <span>{parts[0]}</span> / <b>{parts[1]}</b>
      </>
    );
  };

  return (
    <Shell
      current={route()}
      setRoute={setRoute}
      crumb={crumb()}
      cartCount={cartCount}
      eclosionCount={eclosionCount}
    >
      <AppErrorBoundary label={route()}>
        <Show when={route() === "mypage"}>
          <MyPage setRoute={setRoute} setSelectedSpecimen={setSelectedSpecimen} />
        </Show>
        <Show when={route() === "products"}>
          <ProductsList setRoute={setRoute} setSelectedProduct={setSelectedProduct} />
        </Show>
        <Show when={route() === "product-detail"}>
          <ProductDetail productId={selectedProduct()} setRoute={setRoute} />
        </Show>
        <Show when={route() === "specimen"}>
          <SpecimenDetail specimenId={selectedSpecimen()} setRoute={setRoute} />
        </Show>
        <Show when={route() === "log"}>
          <LogPage />
        </Show>
        <Show when={route() === "eclosion"}>
          <EclosionPage setRoute={setRoute} setSelectedSpecimen={setSelectedSpecimen} />
        </Show>
        <Show when={route() === "bloodline"}>
          <BloodlinePage
            setRoute={setRoute}
            setSelectedSpecimen={setSelectedSpecimen}
          />
        </Show>
        <Show when={route() === "shop"}>
          <ShopPage />
        </Show>
        <Show when={route() === "market"}>
          <MarketPage />
        </Show>
        <Show when={route() === "cart"}>
          <CartPage />
        </Show>
      </AppErrorBoundary>
    </Shell>
  );
};
