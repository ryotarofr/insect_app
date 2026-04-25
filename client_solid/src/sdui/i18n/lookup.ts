// lookup.ts — SDUI i18n の検索 & プレースホルダ展開関数
//
// 詳細: docs/sdui-three-layer-model-v5.md §3.3 (Localizable)
//
// **API**:
//   - `tr(key, params?)` → string
//     - 辞書ヒット時: 文字列を返す。`{foo}` プレースホルダを params で置換。
//     - ミス時: キー文字列をそのまま返す + `console.warn` (dev 視認用)。
//       これにより画面が空白になることは絶対に無い (=設計上の不変条件)。
//
// **branded I18nKey**:
//   サーバ→クライアントで来る型は `I18nKey` (branded string)。
//   `tr()` は branded を許容するため `string | I18nKey` を受け取り、
//   素の string にキャストして辞書を引く。型安全は branded.ts 側で担保済み。
//
// **将来拡張**:
//   - locale の動的切替: tr(key, params, locale?) の 3rd 引数を追加し、
//     SDUI_DICT を `Record<Locale, Record<string, string>>` に拡張する。

import type { I18nKey } from "../branded";
import { SDUI_DICT_JA } from "./dict";

/** `{foo}` 形式のプレースホルダを params で置換するだけの最小展開。
 *  - 値が undefined の placeholder は元のまま残す (誤って "undefined" を出さない)。
 *  - 数値はそのまま `String(...)` で文字列化。
 */
const interpolate = (
  template: string,
  params?: Record<string, string | number>,
): string => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : String(v);
  });
};

/** 1 度しか warn しないよう抑制 (HMR / 多数回 render で console を埋めない)。 */
const warned = new Set<string>();

/** SDUI から来た i18n キーを表示文字列に変換する。
 *  - 未登録キーはキー文字列を返す (空文字にはしない)。
 *  - dev では初回のみ console.warn。
 */
export const tr = (
  key: string | I18nKey,
  params?: Record<string, string | number>,
): string => {
  const k = key as string;
  const template = SDUI_DICT_JA[k];
  if (template === undefined) {
    if (!warned.has(k)) {
      warned.add(k);
      // eslint-disable-next-line no-console
      console.warn(`[sdui/i18n] missing key: "${k}" (falling back to key)`);
    }
    return k;
  }
  return interpolate(template, params);
};
