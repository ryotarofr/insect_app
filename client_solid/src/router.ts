// router.ts — 共通のルート定義 / path <-> RouteKey 変換
// App.tsx と Shell, BottomTabBar が共有する。
import type { RouteKey } from "./data";
import type { Crumb } from "./components/Breadcrumb";

/** RouteKey → 代表 path (URL 生成用) */
export const ROUTE_PATHS: Record<RouteKey, string> = {
  mypage: "/",
  products: "/products",
  "product-detail": "/products", // 実際には /products/:id を別途使用
  specimen: "/specimen",
  log: "/log",
  eclosion: "/eclosion",
  bloodline: "/bloodline",
  shop: "/shop",
  market: "/market",
  cart: "/cart",
  // Phase 7: SDUI 駆動カート (旧 /cart と並行運用)
  "cart-sdui": "/cart-sdui",
  warranty: "/help/warranty",
  // 404 は実際にはここから遷移しない (URL → RouteKey 経路でしか来ない)。
  // 何か理由があって setRoute("not-found") した時のために便宜上のパスを置く。
  "not-found": "/404",
};

/**
 * pathname から active RouteKey を判定する。
 * Router 環境外 (テスト等) からでも使えるよう純関数にする。
 */
export const pathnameToRouteKey = (pathname: string): RouteKey => {
  // 正規化: 末尾スラッシュを削除
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/mypage") return "mypage";

  // /products/:id → product-detail
  if (/^\/products\/[^/]+/.test(path)) return "product-detail";
  if (path === "/products") return "products";

  if (/^\/specimen(?:\/|$)/.test(path)) return "specimen";
  if (path === "/log") return "log";
  if (path === "/eclosion") return "eclosion";
  if (/^\/bloodline(?:\/|$)/.test(path)) return "bloodline";
  if (path === "/shop") return "shop";
  if (path === "/market") return "market";
  if (path === "/cart") return "cart";
  // Phase 7: SDUI 版カートは別 route として並行運用 (Strangler Fig)
  if (path === "/cart-sdui") return "cart-sdui";
  if (path === "/help/warranty") return "warranty";

  // どのルートにも一致しなければ 404 扱い。
  // 旧実装は mypage に倒していたが、SDUI 移行で /products-sdui のような
  // 廃止 URL に来た時に黙って "/" を出してしまう挙動が分かりにくかったため修正。
  return "not-found";
};

/**
 * UX-1: サイドバー / BottomTabBar のハイライト用に、現在ルートの「親」を返す。
 *   サイドバーから外した詳細ページ (specimen / product-detail) は、
 *   ナビゲーション上は親ページの子として扱い、親側をハイライトしたままにする。
 *   - specimen → mypage (マイページの所有個体カードから開く)
 *   - product-detail → products (商品一覧 → 詳細)
 *   それ以外は同じ RouteKey を返す。
 */
export const sidebarRouteKey = (route: RouteKey): RouteKey => {
  if (route === "specimen") return "mypage";
  if (route === "product-detail") return "products";
  return route;
};

/** product-detail を含む、id 付き URL 生成ヘルパー */
export const productUrl = (id: string): string =>
  `/products/${encodeURIComponent(id)}`;

export const specimenUrl = (id?: string): string =>
  id ? `/specimen/${encodeURIComponent(id)}` : "/specimen";

export const bloodlineUrl = (id?: string): string =>
  id ? `/bloodline/${encodeURIComponent(id)}` : "/bloodline";

/**
 * P2-14: RouteKey から階層パンくずを組み立てる。
 *   - 末尾 (現在地) は href を持たない = リンクにならない
 *   - 中間は親ページへの href を持つ
 *   - ids は specimen / product / bloodline など :id 付きページ用の補足情報
 */
export interface CrumbIds {
  specimenId?: string;
  productId?: string;
  bloodlineId?: string;
  productTitle?: string;
  specimenName?: string;
}

export const crumbFor = (route: RouteKey, ids: CrumbIds = {}): Crumb[] => {
  switch (route) {
    case "mypage":
      return [{ label: "マイページ", href: undefined }];
    case "products":
      return [{ label: "ショップ", href: undefined }, { label: "生体・用品" }];
    case "product-detail":
      return [
        { label: "ショップ", href: "/products" },
        { label: "生体・用品", href: "/products" },
        { label: ids.productTitle ?? "商品詳細" },
      ];
    case "specimen":
      return [
        { label: "マイページ", href: "/" },
        { label: "所有個体", href: "/" },
        { label: ids.specimenName ?? ids.specimenId ?? "個体カルテ" },
      ];
    case "log":
      return [{ label: "飼育", href: "/" }, { label: "飼育ログ" }];
    case "eclosion":
      return [{ label: "飼育", href: "/" }, { label: "羽化予測" }];
    case "bloodline":
      return [
        { label: "飼育", href: "/" },
        { label: "血統系図", href: "/bloodline" },
        ...(ids.bloodlineId
          ? [{ label: ids.bloodlineId } as Crumb]
          : []),
      ];
    case "shop":
      return [{ label: "運営", href: undefined }, { label: "ショップ管理" }];
    case "market":
      return [{ label: "取引", href: undefined }, { label: "C2Cマーケット" }];
    case "cart":
      return [
        { label: "ショップ", href: "/products" },
        { label: "カート" },
      ];
    case "cart-sdui":
      // Phase 7: SDUI 版は同じパンくずに "(SDUI)" のサフィックスを付けて
      // 並行運用中であることを明示する。テスター向けの目印。
      return [
        { label: "ショップ", href: "/products" },
        { label: "カート (SDUI)" },
      ];
    case "warranty":
      return [
        { label: "ヘルプ", href: undefined },
        { label: "安心保証" },
      ];
    case "not-found":
      return [{ label: "ページが見つかりません" }];
    default:
      return [{ label: "マイページ" }];
  }
};
