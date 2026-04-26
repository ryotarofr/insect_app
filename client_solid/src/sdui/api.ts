// api.ts — SDUI 用の最小 fetch ラッパ
//
// 詳細: docs/sdui-three-layer-model-v5.md §14 (HTTP / バックエンド契約)
//
// **責務**:
//   - `/api/v1/cards/products/:id` を叩いて `CardBlock` (branded) を返す
//   - 4xx / 5xx を `SduiFetchError` に正規化する (画面側で `instanceof` で分岐できる)
//   - レスポンス Content-Type が JSON でない / パース失敗を区別する
//
// **dev / prod 両対応**:
//   ベース URL は常に `/api/v1`。
//   - dev: vite.config.ts の proxy で localhost:3000 にフォワード
//   - prod: 同一オリジンに backend を置く想定
//   ここで `import.meta.env.VITE_API_BASE` を読まないのは、環境ごとの分岐を
//   "Vite 設定 1 か所" に集約するため (#17 で proxy を入れたのと同じ理由)。
//
// **branded 型との関係**:
//   サーバから来る JSON は本来 plain string だが、`as CardBlock` で branded 化する。
//   ts-rs 生成型は branded の付け替えを branded.ts 側で済ませているので、
//   ここでは「signature が branded を返す」ことで呼び出し側に強制できる。
//   実行時 validation が必要になったら fetch 後に zod / valibot を挟む。

import type { CardBlock, ProductListResponse } from "./branded";

/** API ベース URL (dev では vite proxy 経由)。 */
const API_BASE = "/api/v1";

/** SDUI fetch エラー。HTTP ステータスとレスポンスボディ (あれば) を持つ。
 *  画面側は `error instanceof SduiFetchError` で分岐し、`status` で表示を切り替える。 */
export class SduiFetchError extends Error {
  readonly status: number;
  readonly body: string | null;

  constructor(message: string, status: number, body: string | null) {
    super(message);
    this.name = "SduiFetchError";
    this.status = status;
    this.body = body;
  }
}

/** 共通 JSON fetch (内部用)。 */
const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // ネットワーク自体の失敗 (CORS / DNS / オフライン)。status は 0 扱い。
    const msg = e instanceof Error ? e.message : String(e);
    throw new SduiFetchError(`network error: ${msg}`, 0, null);
  }

  if (!res.ok) {
    // body は 1 度しか読めないので text() に倒す。JSON エラーレスポンスは
    // body 文字列として保持し、呼び出し側の判断に委ねる。
    let body: string | null = null;
    try {
      body = await res.text();
    } catch {
      /* body 読み取り失敗は致命的ではない */
    }
    throw new SduiFetchError(
      `HTTP ${res.status} on ${path}`,
      res.status,
      body,
    );
  }

  // Content-Type が JSON でなくても json() を試みる (axum は常に json を返す前提)。
  try {
    return (await res.json()) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new SduiFetchError(`invalid JSON: ${msg}`, res.status, null);
  }
};

/** 204 No Content を期待する fetch。レスポンスボディは読まない。
 *  失敗時は `SduiFetchError` を throw する。 */
const fetchNoContent = async (path: string, init?: RequestInit): Promise<void> => {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new SduiFetchError(`network error: ${msg}`, 0, null);
  }
  if (!res.ok) {
    let body: string | null = null;
    try {
      body = await res.text();
    } catch {
      /* noop */
    }
    throw new SduiFetchError(
      `HTTP ${res.status} on ${path}`,
      res.status,
      body,
    );
  }
};

/** `GET /api/v1/cards/products/:id` を叩いて 1 枚の CardBlock を取得する。
 *  - id は URL エンコード済みでも生でも OK (内部で encodeURIComponent)。
 *  - 失敗時は `SduiFetchError` を throw する。
 *  - 返ってくる template は `product_feature` (商品ハイライト) 想定。 */
export const fetchProductCard = async (id: string): Promise<CardBlock> => {
  const safe = encodeURIComponent(id);
  return fetchJson<CardBlock>(`/cards/products/${safe}`);
};

/** `GET /api/v1/cards/products/:id/detail` を叩いて詳細ページ用の CardBlock を取得する。
 *  - 一覧用 (`fetchProductCard`) と同じ id でも、別 template (`product_detail`)
 *    が返る。region 構成が違うので呼び出し先も分ける。
 *  - 失敗時は `SduiFetchError` を throw する。 */
export const fetchProductDetailCard = async (id: string): Promise<CardBlock> => {
  const safe = encodeURIComponent(id);
  return fetchJson<CardBlock>(`/cards/products/${safe}/detail`);
};

/** Phase 4 + 5 + 6: filter chip + sort + 検索 + pagination クエリ。
 *  - filter (category / difficulty) は各 group につき 0 件 or 1 件 (single-select)。
 *  - sort は単一値 (`name` / `price_asc` / `price_desc` / `new`)。
 *  - q は検索キーワード (前後 trim はサーバ側でも実施)。
 *  - page / perPage は 1 始まりのページング。サーバ側で default (page=1, perPage=20) / 上限 (perPage<=100) に正規化。
 *  - 未知 / undefined はサーバ側で default にフォールバック (壊れない)。
 *  - undefined / 空文字なら絞り込み無し (全件) / default 順。
 */
export interface ProductListQuery {
  category?: string;
  difficulty?: string;
  /** Phase 5: 並び替えキー。サーバ側 SORT_OPTIONS と同じ文字列を渡す。 */
  sort?: string;
  /** Phase 6: 検索キーワード (前後空白はサーバ側で trim される)。 */
  q?: string;
  /** Phase 6: 1 始まりのページ番号。1 (= default) なら省略推奨 (canonical URL)。 */
  page?: number;
  /** Phase 6: 1 ページあたり件数。20 (= default) なら省略推奨 (canonical URL)。 */
  perPage?: number;
}

/** `GET /api/v1/cards/products?q=&category=&difficulty=&sort=&page=&perPage=` を叩いて
 *  filter bar + sort bar + search box + pagination 付きのページシェルを取得する (Phase 4-6)。
 *
 *  - サーバ側 (handlers::cards::list_product_cards) が filter → search → sort → paginate の順で適用して返す。
 *  - 失敗時は `SduiFetchError` を throw する。
 *  - 0 件マッチでも cards = [] と shell (filterBar / sortBar / searchBox / pagination) は返る。
 *  - クエリの `''` (空文字) は付与しない (= 「未指定」と区別する)。
 *  - パラメータ順は (q, category, difficulty, sort, page, perPage) で固定 →
 *    URL 文字列等価性 (テスト容易性 / canonical URL 一貫性)。これは server 側 `build_list_href` と揃える。
 *  - page=1 / perPage=20 は default なので URL から省略する (canonical URL)。
 */
export const fetchProductList = async (
  query: ProductListQuery = {},
): Promise<ProductListResponse> => {
  const params = new URLSearchParams();
  if (query.q && query.q.length > 0) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.difficulty) params.set("difficulty", query.difficulty);
  if (query.sort) params.set("sort", query.sort);
  // page / perPage は default (1 / 20) を URL に乗せない。
  // 0 / 負値 / NaN はサーバが default にフォールバックするので素直に弾いておく。
  if (query.page != null && query.page > 1) {
    params.set("page", String(Math.floor(query.page)));
  }
  if (query.perPage != null && query.perPage > 0 && query.perPage !== 20) {
    params.set("perPage", String(Math.floor(query.perPage)));
  }
  const qs = params.toString();
  const path = qs ? `/cards/products?${qs}` : `/cards/products`;
  return fetchJson<ProductListResponse>(path);
};

/** @deprecated Phase 4 で `fetchProductList` に置き換え予定。
 *  互換目的で `cards` だけを返すラッパとして残してある。
 *  - 内部で `fetchProductList()` を呼んで `.cards` を返す。
 *  - filter chip を表示しない場面 (= ホームの「おすすめ」枠など) で使う想定。 */
export const fetchProductCardList = async (): Promise<CardBlock[]> => {
  const resp = await fetchProductList();
  return resp.cards;
};

// ──────────────────────────────────────────────────────────────────────
// SDUI Action endpoints (Phase 2.5)
//
// CtaBlockView (sdui/blocks/Cta.tsx) が `block.action` を見て呼び分ける。
// レスポンスは camelCase JSON。サーバ側 DTO と完全に対応している。
// ──────────────────────────────────────────────────────────────────────

/** `POST /api/v1/cart` のレスポンス。Toast の Undo に使う。 */
export interface AddToCartResponse {
  /** 追加後のカート総点数 (将来 cart バッジに反映予定)。 */
  cartCount: number;
  /** Undo に必要なトークン (`DELETE /cart/items/:token`)。 */
  undoToken: string;
}

/** `POST /api/v1/cart` — カートに商品を追加し、Undo トークンを取得する。
 *
 *  - 失敗時は `SduiFetchError` を throw。
 *  - body は `{ productId, qty }` の camelCase JSON。`qty` 省略時 1。 */
export const postCartAdd = async (
  productId: string,
  qty = 1,
): Promise<AddToCartResponse> => {
  return fetchJson<AddToCartResponse>(`/cart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, qty }),
  });
};

/** `DELETE /api/v1/cart/items/:token` — Undo (Toast から発火)。
 *
 *  - 成功時は 204 No Content。
 *  - 既に削除済み (二重 Undo) → 404 → `SduiFetchError(status=404)` を throw。 */
export const deleteCartItem = async (token: string): Promise<void> => {
  const safe = encodeURIComponent(token);
  await fetchNoContent(`/cart/items/${safe}`, { method: "DELETE" });
};

/** `POST /api/v1/watch/:productId` のレスポンス。 */
export interface ToggleWatchResponse {
  /** トグル後の状態 (true = 今 watching に入った / false = 解除された)。 */
  watching: boolean;
}

/** `POST /api/v1/watch/:productId` — ウォッチ状態をトグルする。
 *
 *  - 失敗時は `SduiFetchError` を throw。
 *  - watching 状態は server-side が真値 (クライアントは投げ返された値を信用)。 */
export const postWatchToggle = async (
  productId: string,
): Promise<ToggleWatchResponse> => {
  const safe = encodeURIComponent(productId);
  return fetchJson<ToggleWatchResponse>(`/watch/${safe}`, {
    method: "POST",
  });
};

// ──────────────────────────────────────────────────────────────────────
// Phase 7: Cart card endpoints
//
// /cart 画面用の SDUI 取得 + LineItem 内 +/- ボタンが叩く PATCH。
// ──────────────────────────────────────────────────────────────────────

/** `GET /api/v1/cards/cart` — 現在のカート画面 SDUI を取得する (Phase 7)。
 *
 *  - 1 ユーザにつき 1 枚しかないので path に id を取らない。
 *  - 返り値の template は常に `cart`。
 *  - 失敗時は `SduiFetchError` を throw する。
 *  - 空カートでも 200 + `regions.items = []` で返る (= 例外的状態ではない)。 */
export const fetchCartCard = async (): Promise<CardBlock> => {
  return fetchJson<CardBlock>(`/cards/cart`);
};

/** `PATCH /api/v1/cart/items/:token` のレスポンス (Phase 7)。 */
export interface PatchCartItemResponse {
  /** 更新後のカート総点数 (= 全エントリ qty の sum)。バッジに反映予定。 */
  cartCount: number;
}

/** `PATCH /api/v1/cart/items/:token` — qty を直接書き換える (Phase 7)。
 *
 *  - LineItem の +/- ボタン (LineItemAction::SetQty) が叩く。
 *  - サーバ側で `1 <= qty <= 99` をチェック。0 を投げたい時は `deleteCartItem` を使う。
 *  - 失敗時は `SduiFetchError` を throw。
 *  - 冪等 (PATCH RFC 7231 準拠): 同じ qty を 2 回投げても結果は同じ。 */
export const patchCartItemQty = async (
  token: string,
  qty: number,
): Promise<PatchCartItemResponse> => {
  const safe = encodeURIComponent(token);
  return fetchJson<PatchCartItemResponse>(`/cart/items/${safe}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qty }),
  });
};

/** `PATCH /api/v1/checkout/shipping_field/:name` のレスポンス (Phase 8)。 */
export interface PatchShippingFieldResponse {
  /** 設定後の value (= echo back)。trim 等のサーバ側正規化結果。 */
  value: string;
}

/** `PATCH /api/v1/checkout/shipping_field/:name` — 配送先 1 フィールドを更新 (Phase 8)。
 *
 *  - FormField (CheckoutFieldAction::PatchField) が叩く。
 *  - `name` は `Block::FormField.name` (= camelCase, addressName / addressTel / etc.)。
 *  - サーバ側で ALLOWED_FIELDS 外の name は 400、200 文字超 value も 400。
 *  - 空文字 value は「明示的にクリア」として受け付ける (= None ではない)。
 *  - 成功後は呼び出し側 (= FormField view) が cart card を再 fetch する責務。 */
export const patchCheckoutShippingField = async (
  name: string,
  value: string,
): Promise<PatchShippingFieldResponse> => {
  const safe = encodeURIComponent(name);
  return fetchJson<PatchShippingFieldResponse>(
    `/checkout/shipping_field/${safe}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );
};

/** `PATCH /api/v1/checkout/shipping_method` のレスポンス (Phase 8)。 */
export interface PatchShippingMethodResponse {
  /** 設定後の shipping method id (= echo back)。 */
  id: string;
}

/** `PATCH /api/v1/checkout/shipping_method` — 配送方法を切り替え (Phase 8)。
 *
 *  - ShippingMethodPicker (CheckoutMethodAction::PatchMethod) が叩く。
 *  - `id` は server 側 SHIPPING_METHODS の id ("cold" / "normal" 等) のいずれか。未知は 400。
 *  - 成功後は呼び出し側が cart card を再 fetch する (= shipping_amount / total が変わるため)。 */
export const patchCheckoutShippingMethod = async (
  id: string,
): Promise<PatchShippingMethodResponse> => {
  return fetchJson<PatchShippingMethodResponse>(`/checkout/shipping_method`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
};

/** `POST /api/v1/checkout/submit` のレスポンス (Phase 9.1)。
 *
 *  クライアントは `window.location.href = sessionUrl` で Stripe Hosted Checkout
 *  (もしくは mock landing) に遷移する。orderId は orders テーブルの UUID で、
 *  Webhook 後の order tracking / debug に使う。 */
export interface CheckoutSubmitResponse {
  orderId: string;
  sessionUrl: string;
}

/** `POST /api/v1/checkout/submit` — Stripe Checkout Session を作成する (Phase 9.1)。
 *
 *  - 空カート / 配送先不完全は 400 を投げる (= toast でユーザに通知)
 *  - body は不要 (= server 側 cart_store + checkout_store の snapshot を参照)
 *  - 成功時はレスポンスの sessionUrl で navigate
 *  - 失敗時は SduiFetchError を throw */
export const postCheckoutSubmit = async (): Promise<CheckoutSubmitResponse> => {
  return fetchJson<CheckoutSubmitResponse>(`/checkout/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
};

// ──────────────────────────────────────────────────────────────────────
// Phase 9.G: 認証 (= /api/v1/auth/*)
// ──────────────────────────────────────────────────────────────────────

/** auth handler の register / login / me レスポンスで共通な user view。 */
export interface AuthUser {
  userId: string;
  publicId: string;
  name: string;
  email?: string;
  role: string;
  /** /me 専用に avatarInitial が乗る (register / login レスポンスは含まない場合あり)。 */
  avatarInitial?: string;
}

export interface RegisterRequest {
  publicId: string;
  name: string;
  email: string;
  password: string;
  avatarInitial: string;
  /** 省略時は server 側で "breeder" がデフォルト。 */
  role?: string;
}

/** `POST /api/v1/auth/register` — 新規登録。同 cookie session を user に紐付ける。 */
export const postAuthRegister = async (
  req: RegisterRequest,
): Promise<AuthUser> => {
  return fetchJson<AuthUser>(`/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
};

export interface LoginRequest {
  email: string;
  password: string;
}

/** `POST /api/v1/auth/login` — email + password 検証 → session 昇格。
 *  失敗 (= 401) は account enumeration を防ぐため email 不在 / password 不一致を区別しない。 */
export const postAuthLogin = async (req: LoginRequest): Promise<AuthUser> => {
  return fetchJson<AuthUser>(`/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
};

/** `POST /api/v1/auth/logout` — session を anonymous に戻す。204 で完了。 */
export const postAuthLogout = async (): Promise<void> => {
  return fetchNoContent(`/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
};

/** `GET /api/v1/auth/me` — 現在 login 中の user 情報。anonymous は 401。 */
export const fetchAuthMe = async (): Promise<AuthUser> => {
  return fetchJson<AuthUser>(`/auth/me`);
};

// ──────────────────────────────────────────────────────────────────────
// Phase 9.G: 注文履歴 (= /api/v1/orders/*)
// ──────────────────────────────────────────────────────────────────────

export interface OrderSummary {
  id: string;
  sessionId: string;
  status: string;                    // "pending" / "paid" / "failed" / "canceled"
  amountJpy: number;
  shippingJpy: number | null;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  /** ISO8601 文字列 (= chrono::DateTime<Utc>) */
  createdAt: string;
  updatedAt: string;
}

export interface OrderLineSummary {
  productId: string;
  productUuid: string | null;
  title: string;
  unitPriceJpy: number;
  qty: number;
  subtotalJpy: number;
}

/** `GET /api/v1/orders/{id}` の戻り値。orders + line_items を 1 枚にまとめる。
 *  サーバ側は `#[serde(flatten)]` で order を埋め込んで返すため、
 *  client では `OrderSummary` のフィールド + `lineItems` で一段に展開される。 */
export type OrderDetail = OrderSummary & {
  lineItems: OrderLineSummary[];
};

/** `GET /api/v1/orders/me` — login user の注文履歴 (= 新しい順)。 */
export const fetchMyOrders = async (): Promise<OrderSummary[]> => {
  return fetchJson<OrderSummary[]>(`/orders/me`);
};

/** `GET /api/v1/orders/{id}` — 1 注文 + 内訳を取得。所有者でなければ 404。 */
export const fetchOrderDetail = async (id: string): Promise<OrderDetail> => {
  const safe = encodeURIComponent(id);
  return fetchJson<OrderDetail>(`/orders/${safe}`);
};
