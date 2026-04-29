// api-types.ts — server `/api/v1/*` の型を friendly な名前で surface する alias レイヤ
//
// **目的**:
//   - [openapi.d.ts](./openapi.d.ts) は `bun run gen:openapi` で自動生成され、`components["schemas"]["..."]`
//     の verbose な構文。本ファイルは consumer 側の sugar として、よく使う schema を
//     friendly 名で 1:1 alias する。
//   - server 側 DTO (= utoipa::ToSchema 派生) の単一の真実値が openapi.json なので、
//     consumer 側で同じ shape を二重定義しない (= drift 自動検出 / 手動同期コストゼロ)。
//
// **設計**:
//   - alias 名は legacy `sdui/api.ts` の手書き名に揃える (= consumer 互換)。
//     例: `ProductSummary = components["schemas"]["ProductResponse"]`
//   - server 側で型情報が落ちる (= literal union → string) ものは consumer 側で
//     `Omit<..., K> & { K: NarrowedType }` で再 narrowing する。
//   - `metrics: Record<string, never>` (= utoipa `value_type = Object` が
//     `additionalProperties` を出さないため) は `Record<string, unknown>` に override。
//
// **手書きを残す型** (= 本ファイルでは alias しない):
//   - `AuthUser`: server 3 種 (`MeResponse` / `LoginResponse` / `RegisterResponse`) の superset として
//     handler 共通で使う設計のため、`sdui/api.ts` で hand-rolled superset を維持。
//   - `ProductListQuery`: クライアント側の URL build helper 入力。server query は inline 記述。
//   - SDUI block 系 (`CardBlock` / `ProductListResponse` 等): ts-rs 経由で typed なので
//     こちらでは扱わない (= [client_solid/src/sdui/branded.ts](../sdui/branded.ts) が真実値)。

import type { components } from "./openapi";

// ──────────────────────────────────────────────────────────────────────
// 商品マスタ / 種マスタ
// ──────────────────────────────────────────────────────────────────────

/** server `GET /api/v1/products` の 1 行。`kind` / `badge` は ja に整形済。 */
export type ProductSummary = components["schemas"]["ProductResponse"];

/** server `GET /api/v1/species` の 1 行。`name` は locale 別、`sciName` は学名。 */
export type SpeciesSummary = components["schemas"]["SpeciesResponse"];

// ──────────────────────────────────────────────────────────────────────
// auth (= request / response それぞれ per-call-site で alias)
//
// 3 fetch endpoint (`POST /auth/register` / `POST /auth/login` / `GET /auth/me`) は
// レスポンス shape が異なる (= MeResponse のみ avatarInitial / joinedAt を含む)。
// 各 endpoint の戻り値は per-call-site の strict 型を使い、store signal で 3 type を
// 抱える `AuthUser` superset は [sdui/api.ts](../sdui/api.ts) 側で hand-rolled に維持する
// (= 3 server type の structural superset / 1 つに alias できないため)。
// ──────────────────────────────────────────────────────────────────────

export type RegisterRequest = components["schemas"]["RegisterRequest"];
export type RegisterResponse = components["schemas"]["RegisterResponse"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type LoginResponse = components["schemas"]["LoginResponse"];
export type MeResponse = components["schemas"]["MeResponse"];
/** `POST /api/v1/auth/password_reset_request` の body。 */
export type PasswordResetRequest = components["schemas"]["PasswordResetRequest"];
/** `POST /api/v1/auth/password_reset_confirm` の body。 */
export type PasswordResetConfirmRequest =
  components["schemas"]["PasswordResetConfirmRequest"];

// ──────────────────────────────────────────────────────────────────────
// cart / orders / checkout
// ──────────────────────────────────────────────────────────────────────

export type AddToCartResponse = components["schemas"]["AddToCartResponse"];
export type PatchCartItemResponse = components["schemas"]["PatchCartItemResponse"];

export type OrderSummary = components["schemas"]["OrderView"];
export type OrderLineSummary = components["schemas"]["OrderLineView"];
/** server `GET /api/v1/orders/{id}` の戻り値。`OrderView & { lineItems }` の intersection で
 *  serde flatten を表現 (= server 側 `#[serde(flatten)]` と整合)。 */
export type OrderDetail = components["schemas"]["OrderDetailView"];

export type PatchShippingFieldResponse =
  components["schemas"]["PatchShippingFieldResponse"];
export type PatchShippingMethodResponse =
  components["schemas"]["PatchShippingMethodResponse"];
export type CheckoutSubmitResponse = components["schemas"]["CheckoutSubmitResponse"];
/** debug / テスト用の checkout state snapshot。 */
export type CheckoutSnapshotResponse =
  components["schemas"]["CheckoutSnapshotResponse"];

// ──────────────────────────────────────────────────────────────────────
// 個体カルテ (specimens)
// ──────────────────────────────────────────────────────────────────────

/** 個体のライフ状態。生存 / 故 / 譲渡 / 脱走 の 4 値。
 *
 *  server 側は `String` で受けるが値域は `0003_specimens_life_status.sql` の CHECK 制約で
 *  この 4 値に固定されているため、client 側で narrow union に絞る (= 表示分岐を網羅判定可能)。 */
export type LifeStatus = "active" | "deceased" | "transferred" | "escaped";

/** server `GET /api/v1/specimens/me` / `GET /api/v1/specimens/{public_id}` の戻り値。
 *  `lifeStatus` を narrow union に絞る (server は string で返すが CHECK で値域確定)。 */
export type SpecimenView = Omit<
  components["schemas"]["SpecimenView"],
  "lifeStatus"
> & {
  lifeStatus: LifeStatus;
};
export type CreateSpecimenRequest = components["schemas"]["CreateSpecimenRequest"];
export type CreateSpecimenResponse = components["schemas"]["CreateSpecimenResponse"];
export type ChangeLifeStatusRequest =
  components["schemas"]["ChangeLifeStatusRequest"];
export type StatusHistoryView = components["schemas"]["StatusHistoryView"];
export type UpdateNotesRequest = components["schemas"]["UpdateNotesRequest"];

// ──────────────────────────────────────────────────────────────────────
// 飼育ログ (specimen_logs) — literal union 再 narrowing + metrics override
// ──────────────────────────────────────────────────────────────────────

/** server 側は `String` で受けるが client 側は narrow に絞る (= sdui/api.ts 既存の集合)。 */
export type SpecimenLogType = "weight" | "feed" | "mat" | "molt" | "observation";

/** server 戻り値。`logType` は server 側 `String` で受けるため client 側で narrow union に絞る。
 *  (`metrics` は server `value_type = HashMap<String, serde_json::Value>` で
 *   `additionalProperties: {}` を emit するため、生成時に `Record<string, unknown>` 相当になる
 *   = override 不要)。 */
export type SpecimenLogView = Omit<
  components["schemas"]["SpecimenLogView"],
  "logType"
> & {
  logType: SpecimenLogType;
};

export type CreateSpecimenLogRequest = Omit<
  components["schemas"]["CreateSpecimenLogRequest"],
  "logType"
> & {
  logType: SpecimenLogType;
};

// ──────────────────────────────────────────────────────────────────────
// 交配記録 (mating_records) — literal union 再 narrowing
// ──────────────────────────────────────────────────────────────────────

export type MatingStatus =
  | "planned"
  | "mated"
  | "eggs_laid"
  | "hatched"
  | "failed";

/** server 戻り値。`status` は narrow union に絞る。 */
export type MatingRecordView = Omit<
  components["schemas"]["MatingRecordView"],
  "status"
> & {
  status: MatingStatus;
};

export type CreateMatingRequest = Omit<
  components["schemas"]["CreateMatingRequest"],
  "status"
> & {
  /** 省略時 server 側 default "planned"。 */
  status?: MatingStatus;
};

// ──────────────────────────────────────────────────────────────────────
// C2C marketplace (listings)
// ──────────────────────────────────────────────────────────────────────

export type ListingView = components["schemas"]["ListingView"];
export type ListingViewWithCounts = components["schemas"]["ListingViewWithCounts"];
export type CreateListingRequest = components["schemas"]["CreateListingRequest"];
export type PlaceBidResponse = components["schemas"]["PlaceBidResponse"];

// ──────────────────────────────────────────────────────────────────────
// watch (= product watch toggle / listing watch toggle)
// ──────────────────────────────────────────────────────────────────────

/** `POST /api/v1/watch/{productId}` の戻り値。
 *  server 側 schema は `WatchToggleResponse` (PR O-12 で `listings::ToggleWatchResponse` との
 *  名前衝突を避けるためリネーム済) → client 側 legacy 名 `ToggleWatchResponse` に再 alias。 */
export type ToggleWatchResponse = components["schemas"]["WatchToggleResponse"];

/** `POST /api/v1/listings/{id}/watch` の戻り値。 */
export type ListingWatchResponse = components["schemas"]["ToggleWatchResponse"];

// ──────────────────────────────────────────────────────────────────────
// uploads
// ──────────────────────────────────────────────────────────────────────

export type SignRequest = components["schemas"]["SignRequest"];
export type SignResponse = components["schemas"]["SignResponse"];
export type CompleteRequest = components["schemas"]["CompleteRequest"];
export type CompleteResponse = components["schemas"]["CompleteResponse"];

// ──────────────────────────────────────────────────────────────────────
// SDUI analytics ingest (events)
// ──────────────────────────────────────────────────────────────────────

export type AnalyticsEvent = components["schemas"]["AnalyticsEvent"];
export type AnalyticsEventBatch = components["schemas"]["AnalyticsEventBatch"];
export type AnalyticsEventType = components["schemas"]["AnalyticsEventType"];
