// dict.ts — SDUI 用の i18n 辞書 (MVP: ja のみ)
//
// 詳細: docs/sdui-three-layer-model-v5.md §3.3 (Localizable.i18n)
//
// **設計方針 (MVP)**:
//   - 言語は ja 1 種類のみ。将来 en を足す時はキーを増やす前にここを Record<Locale, ...> に切る。
//   - キーは "namespace.subkey" の dot 区切り (例: "badge.featured")。
//   - キーの所在: サーバ側 `server/src/handlers/cards.rs` の `i18n("...")` 呼び出しが
//     ここで網羅されている必要がある。サーバ側で新キーを使う前にここへ追加する。
//   - **未登録キー**: lookup.ts 側で「キー文字列をそのまま返す」フォールバック。
//     本番ではテレメトリで検出して埋める。アプリは絶対に空文字を出さない。
//
// 文字列内のプレースホルダは `{name}` 形式 (例: "残り {count} 点")。
// パラメータ展開は lookup.ts の `tr()` で行う。

export type Locale = "ja";

/** SDUI 既知の i18n キー一覧 (MVP)。
 *  サーバ側 mock 同期用。新キーは server 側追加と同時にここに追記する。 */
export const SDUI_DICT_JA: Record<string, string> = {
  // ── badge.* ────────────────────────────────────────────────────────
  // BadgeRole に応じてサーバが選ぶ表示文言。
  "badge.featured": "おすすめ",
  "badge.pedigreed": "血統書付",

  // ── 将来追加予定 (サーバ実装に追従して埋める) ─────────────────────
  // "badge.cb_f1": "CBF1",
  // "badge.cb_f2": "CBF2",
  // "badge.wf1": "WF1",
  // "cta.add_to_cart": "カートに追加",
  // "cta.view_detail": "詳細を見る",
};

/** デフォルトロケール (MVP では固定)。 */
export const DEFAULT_LOCALE: Locale = "ja";
