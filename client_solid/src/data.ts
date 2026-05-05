// data.ts — UI shape contracts (= 旧 mock-data 集約 → types-only に縮約)
//
// **PR-7/-8 後の現状**:
//   - 全 mock 実データ削除済 (`APP_DATA` / `interface AppData` は廃止)
//   - 残存しているのは UI shape interfaces (= adapter 層での正規化先 / API 契約)
//   - listings を含む全ドメインが server 駆動 (= store/* の cache 経由)
//   - `RouteKey` だけは router config 由来で残置 (= router.ts 隣に置いても良いが
//     26 file の import path を変える価値が薄いため現位置維持)
//
// **次の整理候補**:
//   - shape interfaces を `types/index.ts` に移動して `data.ts` を削除
//     (= 26 file の import path 書換が必要なので別 PR スコープ)
//   - OpenAPI 完全化後は generated/ の型に置換

export type RouteKey =
  | "mypage"
  | "products"
  | "product-detail"
  | "specimen"
  // Cohort Phase 1: 個体登録ページ (/specimens/new)
  | "specimen-new"
  // Cohort Phase 1: 飼育 (cohort) 一覧 — 旧「群」概念のラベル
  | "cohort"
  // Cohort Phase 1: 群詳細 (/cohorts/:id)
  | "cohort-detail"
  // Cohort Phase 1: 個体化モード (/cohorts/:id/promote)
  | "cohort-promote"
  // Cohort Phase 1: 群を作成 (/cohorts/new)
  | "cohort-new"
  // 旧 飼育ログ (/log) は Cohort Phase 1 で削除。ロギングは群・個体の文脈内に内包。
  | "eclosion"
  | "bloodline"
  // C2C pivot: 旧 "shop" / "market" RouteKey は削除。
  //   - "shop" (= ショップ管理) は B2C 概念のため C2C pivot で全廃
  //   - "market" (= 旧 C2Cマーケット) は /products と統合済 (= /products が listings 一覧)
  // Phase 9.1 (Strangler Fig 段階 2 完了): "cart" は SDUI 駆動の CartSduiPage に統一。
  //   C2C pivot 後は cart_items が listing_id を持ち、出品の購入経路として再利用。
  | "cart"
  | "warranty"
  // Phase 9.G: login / register UI を表示する route
  | "login"
  // Phase 9.G: 自分の注文履歴 / 詳細 (C2C pivot 後は「取引履歴」として運用)
  | "orders"
  | "order-detail"
  // C2C pivot: 出品作成ページ (/listings/new)
  | "listing-new"
  // Phase 3: 自分の出品管理ページ (/listings/me) — タブ式の縦リスト全件表示
  | "my-listings"
  // どの URL にもマッチしない時に使う擬似ルート (画面側で 404 を表示する)
  | "not-found";

/** P4-2: 個体のライフ状態。生存 / 故個体 / 譲渡済 / 脱走 の 4 値。
 *  旧 `status: "alive"` より意味が厳密で、StageBar 横の終了バッジに直接使える。
 *  本 union の真実値は server (= 0003_specimens_life_status.sql の CHECK) に依存するため
 *  [generated/api-types](./generated/api-types) を 1 箇所の source として re-export する。 */
import type { LifeStatus } from "./generated/api-types";
export type { LifeStatus };

/** P4-2: 終了理由のメタ情報 (lifeStatus !== "active" のときに表示) */
export interface LifeStatusDetail {
  /** 発生日 (ISO) */
  date: string;
  /** 備考 (死因 / 譲渡先 / 脱走状況 など) */
  note?: string;
}

export interface Specimen {
  id: string;
  name: string;
  species: string;
  sci: string;
  sex: string;
  stage: string;
  stageProgress: number;
  sizeMm: number;
  weightG: number;
  birthDate: string;
  purchasedAt: string;
  shop: string;
  generation: string;
  price: number;
  eclosionETA: string | null;
  eclosionInDays: number | null;
  /** @deprecated 旧 "alive" 表示。新コードは lifeStatus を使うこと */
  status: string;
  /** P4-2: 生存 / 故 / 譲渡 / 脱走。未設定は "active" とみなす */
  lifeStatus?: LifeStatus;
  lifeStatusDetail?: LifeStatusDetail;
  bloodline: { father: string; mother: string };
  notes?: string;
}

export interface Product {
  id: string;
  kind: "生体" | "用品";
  title: string;
  sci: string | null;
  price: number;
  badge: string;
  generation: string | null;
  shop: string;
  tone: "forest" | "amber";
  phLabel: string;
}

/** 飼育ログの種別。本 union の真実値は server `SpecimenLogType` (= [generated/api-types](./generated/api-types)) と
 *  完全一致するので、二重定義を避けて re-export する。 */
import type { SpecimenLogType as LogType } from "./generated/api-types";
export type { LogType };

export interface LogEntry {
  date: string;
  time: string;
  type: LogType;
  title: string;
  body: string;
  photo: boolean;
  specimen: string;
}

export interface Listing {
  id: string;
  title: string;
  seller: string;
  price: number;
  bids: number | null;
  watchers: number;
  endsIn: string;
  auction: boolean;
  verified: boolean;
}
