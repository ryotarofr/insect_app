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
  // Cohort Phase 1: 単独個体登録フォーム
  "specimen-new": "/specimens/new",
  // Cohort Phase 1: 飼育 (cohort) ナビ。「群」概念をユーザー向けに「飼育」と表示。
  cohort: "/cohorts",
  // Cohort Phase 1: 群詳細 (= 実際は /cohorts/:id を別途使用)
  "cohort-detail": "/cohorts",
  // Cohort Phase 1: 個体化モード (= /cohorts/:id/promote、id は別途)
  "cohort-promote": "/cohorts",
  // Cohort Phase 1: 群を作成
  "cohort-new": "/cohorts/new",
  eclosion: "/eclosion",
  bloodline: "/bloodline",
  // C2C pivot: cart は listing 入りの cart_items として再利用
  cart: "/cart",
  warranty: "/help/warranty",
  // Phase 9.G: login / register UI
  login: "/login",
  // C2C pivot: 「取引履歴」として運用 (注文履歴の UI ラベルだけ後続 PR で更新)
  orders: "/orders",
  "order-detail": "/orders",
  // C2C pivot: 出品作成ページ (= 個体カルテ「この個体を出品」/ /products から遷移)
  "listing-new": "/listings/new",
  // Phase 3: 自分の出品管理ページ (= タブ式の縦リスト全件)
  "my-listings": "/listings/me",
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

  // Cohort Phase 1: /specimens/new (単独個体登録) は specimen 詳細より先にマッチさせる。
  if (path === "/specimens/new") return "specimen-new";
  if (/^\/specimen(?:\/|$)/.test(path)) return "specimen";
  // Cohort Phase 1: 飼育 (cohort) 系ルート。
  //   /cohorts/new → cohort-new
  //   /cohorts/:id/promote → cohort-promote
  //   /cohorts/:id → cohort-detail
  //   /cohorts → cohort
  if (path === "/cohorts/new") return "cohort-new";
  if (/^\/cohorts\/[^/]+\/promote$/.test(path)) return "cohort-promote";
  if (/^\/cohorts\/[^/]+$/.test(path)) return "cohort-detail";
  if (path === "/cohorts") return "cohort";
  if (path === "/eclosion") return "eclosion";
  if (/^\/bloodline(?:\/|$)/.test(path)) return "bloodline";
  // C2C pivot: 旧 /shop, /market は廃止。/market は /products と統合済 → 404 に倒す。
  // 新規: /listings/new (= 出品作成ページ)
  if (path === "/listings/new") return "listing-new";
  // Phase 3: /listings/me (= マイ出品管理) は /listings/{public_id} より先に評価する。
  if (path === "/listings/me") return "my-listings";
  if (path === "/cart") return "cart";
  // Phase 9.1: 旧 /cart-sdui は /cart に正規化 (= 古いブックマークの救済)
  if (path === "/cart-sdui") return "cart";
  if (path === "/help/warranty") return "warranty";
  // Phase 9.G: login / register UI
  if (path === "/login") return "login";
  // Phase 9.G: 注文履歴 + 詳細
  // /orders/:id (= UUID 文字列) → order-detail / /orders → orders
  if (/^\/orders\/[^/]+/.test(path)) return "order-detail";
  if (path === "/orders") return "orders";

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
  // Cohort Phase 1: 飼育配下の派生ルートはサイドバー上「飼育」をハイライト
  if (
    route === "cohort-detail" ||
    route === "cohort-promote" ||
    route === "cohort-new"
  ) {
    return "cohort";
  }
  // 単独個体登録もサイドバー上は「飼育」配下扱い (= 飼育の CTA から到達するため)
  if (route === "specimen-new") return "cohort";
  // C2C pivot: 出品作成は /products (出品一覧) の派生としてハイライト
  if (route === "listing-new") return "products";
  // Phase 3: 取引詳細 (/orders/:id) はサイドバー上「取引履歴」をハイライト
  if (route === "order-detail") return "orders";
  return route;
};

/** product-detail を含む、id 付き URL 生成ヘルパー */
export const productUrl = (id: string): string =>
  `/products/${encodeURIComponent(id)}`;

export const specimenUrl = (id?: string): string =>
  id ? `/specimen/${encodeURIComponent(id)}` : "/specimen";

export const bloodlineUrl = (id?: string): string =>
  id ? `/bloodline/${encodeURIComponent(id)}` : "/bloodline";

/** Phase 9.G: 注文詳細 URL (= /orders/{id})。 */
export const orderUrl = (id: string): string =>
  `/orders/${encodeURIComponent(id)}`;

/** Cohort Phase 1: 群詳細 URL */
export const cohortUrl = (publicId: string): string =>
  `/cohorts/${encodeURIComponent(publicId)}`;

/** Cohort Phase 1: 個体化モード URL */
export const cohortPromoteUrl = (publicId: string): string =>
  `/cohorts/${encodeURIComponent(publicId)}/promote`;

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
  /** Cohort Phase 1: 群詳細 / 個体化モードのパンくず用 LOT ID */
  cohortPublicId?: string;
}

export const crumbFor = (route: RouteKey, ids: CrumbIds = {}): Crumb[] => {
  switch (route) {
    case "mypage":
      return [{ label: "マイページ", href: undefined }];
    case "products":
      // C2C pivot: 「ショップ」概念を廃止し、マーケット (= C2C 出品一覧) に統一
      return [{ label: "マーケット", href: undefined }, { label: "出品中の生体" }];
    case "product-detail":
      return [
        { label: "マーケット", href: "/products" },
        { label: "出品中の生体", href: "/products" },
        { label: ids.productTitle ?? "出品詳細" },
      ];
    case "listing-new":
      return [
        { label: "マーケット", href: "/products" },
        { label: "出品する" },
      ];
    case "my-listings":
      // Phase 3: 自分の出品管理ページ。マイページの子として位置づける。
      return [
        { label: "マイページ", href: "/" },
        { label: "マイ出品" },
      ];
    case "specimen":
      return [
        { label: "マイページ", href: "/" },
        { label: "所有個体", href: "/" },
        { label: ids.specimenName ?? ids.specimenId ?? "個体カルテ" },
      ];
    case "specimen-new":
      // Cohort Phase 1: 単独個体登録は飼育配下の枝
      return [
        { label: "飼育", href: "/cohorts" },
        { label: "個体登録" },
      ];
    case "cohort":
      return [{ label: "飼育" }];
    case "cohort-detail":
      return [
        { label: "飼育", href: "/cohorts" },
        { label: ids.cohortPublicId ?? "群詳細" },
      ];
    case "cohort-promote":
      return [
        { label: "飼育", href: "/cohorts" },
        {
          label: ids.cohortPublicId ?? "群詳細",
          href: ids.cohortPublicId
            ? `/cohorts/${encodeURIComponent(ids.cohortPublicId)}`
            : "/cohorts",
        },
        { label: "個体化" },
      ];
    case "cohort-new":
      return [
        { label: "飼育", href: "/cohorts" },
        { label: "群を作成" },
      ];
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
    case "cart":
      // C2C pivot: cart は listing の購入経路として再利用
      return [
        { label: "マーケット", href: "/products" },
        { label: "カート" },
      ];
    case "warranty":
      return [
        { label: "ヘルプ", href: undefined },
        { label: "安心保証" },
      ];
    case "login":
      // Phase 9.G: login / register の breadcrumb は単独 (= サイドバー上の親が無い)
      return [{ label: "ログイン" }];
    case "orders":
      // C2C pivot: 「取引履歴」(= 出品 / 入札 / 購入の履歴) として運用
      return [
        { label: "マイページ", href: "/" },
        { label: "取引履歴" },
        { label: "取引履歴" },
      ];
    case "order-detail":
      return [
        { label: "マイページ", href: "/" },
        { label: "取引履歴", href: "/orders" },
        { label: "取引詳細" },
      ];
    case "not-found":
      return [{ label: "ページが見つかりません" }];
    default:
      return [{ label: "マイページ" }];
  }
};
