// api/index.ts — データアクセス層のバレル
//
// このファイル以外から `../data` を直接 import しないこと。
// バックエンド化や localStorage 永続化に切り替えるときは、このディレクトリの
// 各 fetcher の中身を差し替えるだけで、ページ/コンポーネント側は変更不要。
//
// 現在の login user は `store/auth.ts::currentUser()` を使うこと (= /api/v1/auth/me 経由)。

export { listProducts, getProduct, productExists } from "./products";
export {
  listSpecimens,
  getSpecimen,
  specimenExists,
  listUrgentEclosion,
  listEclosionForecasts,
  getSpecimenMemo,
  updateSpecimenMemo,
} from "./specimens";
export {
  listLogs,
  listLogsBySpecimen,
  addLog,
  type NewLogInput,
} from "./logs";
export { listMarketListings } from "./market";
// shop admin (= Shop.tsx) は page-local sample で動作中。
// TODO: 実 admin API (`GET /api/v1/shop/orders` 等) に置き換え予定。
export { getUserMetrics, type UserMetrics } from "./metrics";
export {
  getUpcomingActions,
  type UpcomingAction,
  type ActionKind,
} from "./nextActions";
export { getAuditLog, type AuditLogEntry } from "./audit";

// 型も api/ 経由で参照できるように re-export しておく。
// login user は store/auth::AuthUser を使う。
export type {
  Specimen,
  Product,
  LogType,
  LogEntry,
  Listing,
  LifeStatus,
  LifeStatusDetail,
} from "../data";
