// L.tsx — Localizable を表示する SDUI 共通コンポーネント
//
// 詳細: docs/sdui-three-layer-model-v5.md §3.3 (Localizable)
//
// **責務**:
//   `Localizable` (i18n キー or raw text) を受け取り、テキストノードとして描画する。
//   `tr()` への参照はここに集約し、各 Block レンダラからは `<L value={...} />` で済ませる。
//
// **レンダリング戦略**:
//   - source: "raw"  → そのまま text を出力 (i18n は介在しない)。
//   - source: "i18n" → tr(key, params) で文字列化して出力。
//
// **空文字対策**:
//   tr() は missing key でもキー文字列を返すので、L が空テキストになることは無い。
//   raw 側は SDUI 不変条件として text が空にならない前提 (validate_keys 等で担保)。
//
// **Solid の <Switch> を避ける理由**:
//   value は signal でなく props で来るため、props proxy の getter 評価が
//   毎回走る。最小コストの三項分岐で十分。

import type { Localizable } from "./branded";
import { tr } from "./i18n/lookup";

/** Localizable を文字列に解決する純関数 (テスト容易性のため export)。 */
export const resolveLocalizable = (v: Localizable): string => {
  if (v.source === "raw") return v.text;
  return tr(v.key, v.params);
};

/** Localizable を <span> 等で囲まずテキストノードとして描画。
 *  ラップが必要な時は呼び出し側で <span class=...><L value=.../></span> と書く。 */
export const L = (props: { value: Localizable }) => {
  // props は Solid の reactive proxy なので、getter 経由で都度評価される。
  return <>{resolveLocalizable(props.value)}</>;
};
