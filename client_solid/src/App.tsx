// App.tsx — root component, URL-driven routing (@solidjs/router)
//
// Router integration (P2-1):
//   - useLocation() を経由し、pathname から RouteKey を判定する。
//   - useNavigate() を setRoute(r) にラップする。既存のページ API は互換を維持。
//   - /specimen/:id, /products/:id, /bloodline/:id の id は path から抽出する。
//     未指定時は localStorage フォールバック (P2-3 で廃止予定)。
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { type RouteKey } from "./data";
import {
  listSpecimens,
  listProducts,
  listUrgentEclosion,
  specimenExists,
  productExists,
  getSpecimen,
  getProduct,
} from "./api";
import { Shell } from "./components/Shell";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { QuickLogFab } from "./components/QuickLogFab";
import { QuickLogSheet } from "./components/log/QuickLogSheet";
import { ToastContainer } from "./components/Toast";
import { CommandPalette } from "./components/CommandPalette";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import {
  isCommandPaletteOpen,
  openCommandPalette,
  closeCommandPalette,
} from "./store/commandPalette";
import { toggleShortcutsHelp } from "./store/shortcutsHelp";
import { MyPage } from "./pages/MyPage";
import { ProductsList, ProductDetail } from "./pages/products";
import { SpecimenDetail } from "./pages/specimen";
import { LogPage } from "./pages/Log";
import { EclosionPage } from "./pages/Eclosion";
import { BloodlinePage } from "./pages/Bloodline";
import { ShopPage } from "./pages/Shop";
import { MarketPage } from "./pages/Market";
import { CartSduiPage } from "./pages/CartSdui";
import { WarrantyPage } from "./pages/help/Warranty";
import { NotFoundPage } from "./pages/NotFound";
import { cartCount } from "./store/cart";
import {
  ROUTE_PATHS,
  pathnameToRouteKey,
  specimenUrl,
  productUrl,
  bloodlineUrl,
  crumbFor,
} from "./router";
import { saveScroll, consumeScroll } from "./store/scrollMemory";

// UX-1: 個体カルテ (specimen) は詳細ビューなのでサイドバー / ショートカットから外す。
// マイページの所有個体カード等から id 付きで開く設計に統一。
// 数字キーは 1-8 で連番、9 は空き。
const SHORTCUT_MAP: Record<string, RouteKey> = {
  "1": "mypage",
  "2": "products",
  "3": "log",
  "4": "eclosion",
  "5": "bloodline",
  "6": "market",
  "7": "shop",
  "8": "cart",
};

/**
 * P2-13: input / textarea / select などのフォームフォーカス中は
 *   数字キーショートカットを発火させない。
 *   - INPUT の中でも type="button" / "submit" は文字入力ではないが、
 *     フォーム内で意図せず遷移してしまうのを避けるため一律で skip する。
 *   - contentEditable / role="textbox" もテキスト入力扱い。
 *   - sheet-backdrop / sheet-dialog (QuickLogSheet) が開いている間は
 *     モーダル背後でのルート遷移を避けるため skip。
 */
export const shouldSkipShortcut = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  // jsdom など isContentEditable が実装されていない環境のための属性フォールバック
  const ce = el.getAttribute?.("contenteditable");
  if (ce && ce !== "false" && ce !== "inherit") return true;
  if (el.getAttribute && el.getAttribute("role") === "textbox") return true;
  // モーダル (aria-modal) が開いていれば、その外側のショートカットは無効
  if (typeof document !== "undefined") {
    const modal = document.querySelector('[aria-modal="true"]');
    if (modal) return true;
  }
  return false;
};

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

/** /specimen/:id や /products/:id から id を取り出す。末尾 slash は無視。 */
const extractPathId = (pathname: string, prefix: string): string | null => {
  const normalized = pathname.replace(/\/+$/, "");
  if (!normalized.startsWith(prefix + "/")) return null;
  const rest = normalized.slice(prefix.length + 1);
  if (!rest) return null;
  try {
    return decodeURIComponent(rest.split("/")[0]);
  } catch {
    return null;
  }
};

export const App = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // URL -> RouteKey (memo)
  const route = createMemo<RouteKey>(() => pathnameToRouteKey(location.pathname));

  // P2-2 / UX-4: ルート遷移時のスクロール制御。
  //
  // 安定化のポイント (3点):
  //   1) ブラウザ標準の scrollRestoration を 'manual' に固定する。
  //      これを auto のままにしておくと、popstate 直後に「ブラウザが先に勝手に
  //      scrollTo した位置」を effect 内で読んでしまい、保存・復元の両方が壊れる。
  //   2) 離脱直前の scrollY は popstate よりも前に capture する。
  //      window.popstate ハンドラ内で「直前の pathname」のスクロール位置を保存し、
  //      その後 effect 側で復元する 2-phase 構造にする。
  //   3) 復元は requestAnimationFrame で「次のレイアウト確定後」に行い、
  //      まだ document.documentElement.scrollHeight が足りない場合は数フレーム
  //      リトライする (大きいリスト等が描画完了してから合わせる)。
  if (typeof window !== "undefined" && "scrollRestoration" in history) {
    try {
      history.scrollRestoration = "manual";
    } catch {
      /* 一部環境 (古い Safari 等) で setter が落ちる可能性があるので無視 */
    }
  }

  let isPopNav = false;
  let lastSeenPathname: string | null =
    typeof window !== "undefined" ? window.location.pathname : null;

  /** 一定フレーム数までリトライしながら scrollTo を実行 */
  const restoreScrollTo = (y: number): void => {
    if (typeof window === "undefined") return;
    if (y <= 0) {
      window.scrollTo(0, 0);
      return;
    }
    let attempts = 0;
    const MAX = 30; // 約 500ms (60fps 換算)
    const tick = () => {
      const maxY = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const target = Math.min(y, maxY);
      window.scrollTo(0, target);
      // まだ目的の y まで届かない (= ページがまだ伸びていない) ならリトライ
      if (target < y && attempts < MAX) {
        attempts++;
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  };

  if (typeof window !== "undefined") {
    // popstate は location.pathname が更新される「直前」に発火するため、
    // ここで「離れる側のスクロール位置」を保存する。effect 側ではもう手遅れ
    // (ブラウザは既に内部状態を進めている) なのでここで取るのが安定。
    const onPop = () => {
      if (lastSeenPathname !== null) {
        saveScroll(lastSeenPathname, window.scrollY);
      }
      isPopNav = true;
    };
    window.addEventListener("popstate", onPop);
    onCleanup(() => window.removeEventListener("popstate", onPop));
  }

  let prevRoute: RouteKey | null = null;
  let prevPathname: string | null = null;
  createEffect(() => {
    const r = route();
    const path = location.pathname;
    const pathChanged = prevPathname !== null && prevPathname !== path;
    const routeChanged = prevRoute !== null && prevRoute !== r;

    if (pathChanged) {
      // push 経由の時は離脱側の scrollY を effect 内で保存。
      //   pop 経由の時は既に popstate ハンドラ側で保存済みなので二重保存を避ける。
      if (
        !isPopNav &&
        prevPathname !== null &&
        typeof window !== "undefined"
      ) {
        saveScroll(prevPathname, window.scrollY);
      }
      const wasPop = isPopNav;
      isPopNav = false;
      if (wasPop) {
        // pop: 保存済み位置を復元 (なければ 0)
        const y = consumeScroll(path);
        restoreScrollTo(y ?? 0);
      } else if (routeChanged) {
        // 別ルートへの push: 先頭にスクロール
        if (typeof window !== "undefined") window.scrollTo(0, 0);
      }
      // 同一ルート内の push/replace (UX-2 stepper, UX-3 picker, Bloodline replace 等)
      //   は scrollTo を呼ばずに現状の位置を維持する。
    }
    prevRoute = r;
    prevPathname = path;
    lastSeenPathname = path;
  });

  // Selected specimen / product — URL 優先、なければ localStorage
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

  const [specimenFallback, setSpecimenFallback] = createSignal<string>(initialSpecimen);
  const [productFallback, setProductFallback] = createSignal<string>(initialProduct);
  const [fabSheetOpen, setFabSheetOpen] = createSignal(false);

  // URL に id が来たら、それを fallback にも保存する (次回は同じ個体にフォーカス)
  createEffect(() => {
    const id = extractPathId(location.pathname, "/specimen");
    if (id && specimenExists(id)) setSpecimenFallback(id);
  });
  // UX-1: /specimen (id 無し) は所有個体を選ぶ起点が無いのでマイページへ戻す。
  //   個体カルテはマイページの所有個体カード等から id 付きで開く設計に統一。
  createEffect(() => {
    const path = location.pathname.replace(/\/+$/, "");
    if (path === "/specimen") {
      navigate("/", { replace: true });
    }
  });
  createEffect(() => {
    const id = extractPathId(location.pathname, "/products");
    if (id && productExists(id)) setProductFallback(id);
  });

  // 現在の specimenId / productId (route ごとに URL or fallback を使い分け)
  const currentSpecimenId = createMemo<string>(() => {
    const fromUrl = extractPathId(location.pathname, "/specimen");
    if (fromUrl && specimenExists(fromUrl)) return fromUrl;
    const fromBlood = extractPathId(location.pathname, "/bloodline");
    if (fromBlood && specimenExists(fromBlood)) return fromBlood;
    return specimenFallback();
  });
  const currentProductId = createMemo<string>(() => {
    const fromUrl = extractPathId(location.pathname, "/products");
    if (fromUrl && productExists(fromUrl)) return fromUrl;
    return productFallback();
  });

  // localStorage へ永続化 (P2-3 で見直し)
  createEffect(() => {
    localStorage.setItem("kochu:specimen", specimenFallback());
  });
  createEffect(() => {
    localStorage.setItem("kochu:product", productFallback());
  });
  // P2-3: kochu:route は廃止。URL が唯一の真実。
  // マイグレーション用に一度だけ古い key を削除する (以降 effect には置かない)。
  try {
    localStorage.removeItem("kochu:route");
  } catch {
    /* private mode 等では無視 */
  }

  /** RouteKey ベースの setRoute: 内部で navigate */
  const setRoute = (r: RouteKey) => {
    const current = route();
    let target: string;
    switch (r) {
      case "specimen":
        target = specimenUrl(currentSpecimenId());
        break;
      case "product-detail":
        target = productUrl(currentProductId());
        break;
      case "products":
        target = "/products";
        break;
      case "bloodline":
        target = bloodlineUrl();
        break;
      default:
        target = ROUTE_PATHS[r];
    }
    // 同一 URL への navigate は pushState を増やすだけなのでガード
    if (target === location.pathname) return;
    navigate(target);
    // UX-4: scrollTo はルート変化 effect 側で一元管理 (popstate 復元と整合させるため)
    void current; // (lint 緩和用)
  };

  /** 個体選択 → /specimen/:id へ遷移 */
  const setSelectedSpecimen = (id: string) => {
    setSpecimenFallback(id);
    navigate(specimenUrl(id));
  };

  /** 商品選択 → /products/:id へ遷移 */
  const setSelectedProduct = (id: string) => {
    setProductFallback(id);
    navigate(productUrl(id));
  };

  // 60 日以内に羽化予定の個体数（サイドバーバッジ用）
  const eclosionCount = createMemo(() => listUrgentEclosion(60).length);

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      // P4-5: Cmd+K / Ctrl+K でコマンド パレットをトグル起動。
      //   フォーム内フォーカス中でも動作させる (コマンドパレット自体が目的)。
      //   ブラウザデフォルト (アドレスバー検索) を preventDefault で抑止。
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isCommandPaletteOpen()) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // P2-13: フォームフォーカス中 / モーダル表示中は 1-9 ショートカットを skip
      if (shouldSkipShortcut(e.target)) return;
      // document.activeElement も確認 (window listener なので e.target が body のことがある)
      if (
        typeof document !== "undefined" &&
        document.activeElement &&
        document.activeElement !== document.body &&
        shouldSkipShortcut(document.activeElement)
      ) {
        return;
      }
      // P4-19: ? キーでショートカット一覧モーダルをトグル。
      //   Shift+/ 起因の "?" と、直接 "?" が渡るケースの両方に対応。
      //   入力欄でないことは既に shouldSkipShortcut で保証済み。
      if (e.key === "?") {
        e.preventDefault();
        toggleShortcutsHelp();
        return;
      }
      const next = SHORTCUT_MAP[e.key];
      if (next) setRoute(next);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // P2-14: パンくずは構造化した Crumb[] を生成し Shell / Breadcrumb に渡す。
  // ページ毎の親ルートを href で指定することで、上階層へタップ/クリック一発で戻れる。
  const crumbs = createMemo(() => {
    const r = route();
    const ids = {
      specimenId: currentSpecimenId(),
      productId: currentProductId(),
      specimenName: (() => {
        const s = getSpecimen(currentSpecimenId());
        return s ? s.name : undefined;
      })(),
      productTitle: (() => {
        const p = getProduct(currentProductId());
        return p ? p.title : undefined;
      })(),
    };
    return crumbFor(r, ids);
  });

  return (
    <Shell
      current={route()}
      setRoute={setRoute}
      crumbs={crumbs()}
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
          <ProductDetail productId={currentProductId()} setRoute={setRoute} />
        </Show>
        <Show when={route() === "specimen"}>
          <SpecimenDetail
            specimenId={currentSpecimenId()}
            setRoute={setRoute}
            setSelectedSpecimen={setSelectedSpecimen}
          />
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
          {/* Phase 9.1: SDUI 駆動カートに統一 (Strangler Fig 段階 2 完了)。
              旧 CartPage は src/pages/Cart.legacy.tsx に退避済み (= 参照しない)。
              shipping/Stripe は CartSduiPage 経由で /api/v1/checkout/submit が叩く。 */}
          <CartSduiPage />
        </Show>
        <Show when={route() === "warranty"}>
          <WarrantyPage />
        </Show>
        <Show when={route() === "not-found"}>
          <NotFoundPage />
        </Show>
      </AppErrorBoundary>

      {/* モバイル専用 FAB + QuickLog シート (どのルートからでも起動可) */}
      <QuickLogFab onClick={() => setFabSheetOpen(true)} />
      <QuickLogSheet
        open={fabSheetOpen()}
        onClose={() => setFabSheetOpen(false)}
        specimenId={route() === "specimen" ? currentSpecimenId() : undefined}
      />

      {/* トースト通知 — どこからでも showToast() で起動可 */}
      <ToastContainer />

      {/* P4-5: ⌘K 検索モーダル — グローバルキーハンドラ経由で起動 */}
      <CommandPalette />

      {/* P4-19: ? キーのショートカット一覧 — グローバルキーハンドラ経由で起動 */}
      <ShortcutsHelp />
    </Shell>
  );
};
