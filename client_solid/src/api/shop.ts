// api/shop.ts — ショップ管理 KPI と注文一覧
import { APP_DATA, type Order, type ShopStats } from "../data";

export const getShopStats = (): ShopStats => APP_DATA.shopStats;

export const listOrders = (): Order[] => APP_DATA.orders;
