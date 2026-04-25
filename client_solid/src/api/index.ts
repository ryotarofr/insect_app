// api/index.ts — データアクセス層のバレル
//
// このファイル以外から `../data` を直接 import しないこと。
// バックエンド化や localStorage 永続化に切り替えるときは、このディレクトリの
// 各 fetcher の中身を差し替えるだけで、ページ/コンポーネント側は変更不要。

export { getCurrentUser } from "./user";
export { listProducts, getProduct, productExists } from "./products";
export {
  listSpecimens,
  getSpecimen,
  specimenExists,
  listUrgentEclosion,
  listEclosionForecasts,
  getSpecimenMemo,
  updateSpecimenMemo,
  __resetSpecimenMemos,
} from "./specimens";
export {
  listLogs,
  listLogsBySpecimen,
  listLogsByType,
  addLog,
  __resetUserLogs,
  type NewLogInput,
} from "./logs";
export { listMarketListings } from "./market";
export { getShopStats, listOrders } from "./shop";
export { getUserMetrics, type UserMetrics } from "./metrics";
export {
  getUpcomingActions,
  type UpcomingAction,
  type ActionKind,
} from "./nextActions";
export { getAuditLog, type AuditLogEntry } from "./audit";

// 型も api/ 経由で参照できるように re-export しておく
export type {
  User,
  Specimen,
  Product,
  LogType,
  LogEntry,
  ShopStats,
  Order,
  Listing,
  Species,
  LifeStatus,
  LifeStatusDetail,
} from "../data";
