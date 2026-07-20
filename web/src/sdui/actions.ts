import { createContext, useContext, type JSX } from "solid-js";

/**
 * SDUI レンダラに注入する「現在ページの操作」。
 * ブロックレンダラはこれ経由でしか外の世界(再fetch・詳細描画)に触れない。
 */
export interface SduiActions {
  /** このビューの取得元 page_key(定義編集UIが PUT する先) */
  pageKey: string;
  /**
   * このページの定義書込スコープ。"mine" = ユーザ毎定義(PUT /api/pages/{key}/mine。
   * care 等のパーソナライズ対象ページ)。未指定は共有("shared")。
   * text/markdown の編集UI・カードビルダー・カード削除はこれに従う。
   */
  pageScope?: "shared" | "mine";
  /** 現在のページビューを再fetch */
  refresh: () => void;
  /** 関連ビューも含めて再fetch(ドメイン書込後に使う) */
  refreshAll: () => void;
  /**
   * specimen_list の行直下に個体詳細(specimen_detail ページ)をインライン描画する。
   * care ページが提供。ブロック側は「どう描くか」を知らずに済む(循環依存の回避)。
   */
  renderSpecimenDetail?: (specimenId: string) => JSX.Element;
  /**
   * action_button の閉じた動詞を実行する。ページが対応する動詞のみ実装し、
   * 未知の動詞は no-op(+ console.warn)。provider の無いページでは
   * レンダラがボタンを無効表示にする。
   */
  runAction?: (action: string) => void;
  /**
   * 個体をページ上で「見せる」(タブ切替+行展開)。care ページが URL 更新で実装する。
   * ブロック(care_alerts 等)はこれ経由でしか画面遷移に触れない —
   * ビルダーのプレビューでは提供されないため、プレビュー内クリックが実URLを動かさない。
   */
  revealSpecimen?: (groupId: string, specimenId: string) => void;
}

export const SduiActionsContext = createContext<SduiActions>();

export const useSduiActions = () => useContext(SduiActionsContext);
