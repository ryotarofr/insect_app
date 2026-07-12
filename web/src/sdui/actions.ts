import { createContext, useContext, type JSX } from "solid-js";

/**
 * SDUI レンダラに注入する「現在ページの操作」。
 * ブロックレンダラはこれ経由でしか外の世界(再fetch・詳細描画)に触れない。
 */
export interface SduiActions {
  /** このビューの取得元 page_key(定義編集UIが PUT する先) */
  pageKey: string;
  /** 現在のページビューを再fetch */
  refresh: () => void;
  /** 関連ビューも含めて再fetch(ドメイン書込後に使う) */
  refreshAll: () => void;
  /**
   * specimen_list の行直下に個体詳細(specimen_detail ページ)をインライン描画する。
   * care ページが提供。ブロック側は「どう描くか」を知らずに済む(循環依存の回避)。
   */
  renderSpecimenDetail?: (specimenId: string) => JSX.Element;
}

export const SduiActionsContext = createContext<SduiActions>();

export const useSduiActions = () => useContext(SduiActionsContext);
