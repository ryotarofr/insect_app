// CartContext.tsx — /cart 画面用の "カード再 fetch" 関数を子孫に流す Context
//
// 詳細: docs/sdui-three-layer-model-v5.md §5.5 (server-driven 状態の再 sync)
//
// **責務**:
//   `<CartReloadProvider>` で reload 関数を流し、子孫の LineItemBlockView から
//   `useCartReload()` で取り出して PATCH/DELETE 成功後に呼ぶ。
//
// **Provider 不在時の挙動**:
//   `useCartReload()` は常に呼べる関数を返す。Provider が無い時は no-op (= テスト
//   や `<CardRenderer card={cartCard} />` を単独配置した場合に AppCrash しない)。
//
// **なぜ context にするか (= props drilling しないか)**:
//   `BlockRenderer` は変えたくない (= 全 block で共通の dispatch 層を保つ) ので、
//   reload を block ごとに引数で渡すと renderer の generic 性が崩れる。
//   ambient context にしておけば LineItem だけが必要に応じて引っ張れる。

import { createContext, useContext } from "solid-js";

/** カードの再 fetch を依頼する関数。Promise を返しても返さなくても OK。 */
type CartReload = () => Promise<unknown> | unknown;

const NOOP_RELOAD: CartReload = () => undefined;

const CartReloadContext = createContext<CartReload>(NOOP_RELOAD);

/** /cart ページが reload 関数を子孫に流すための Provider。 */
export const CartReloadProvider = CartReloadContext.Provider;

/** 子孫から reload 関数を取り出す。Provider 不在なら no-op を返す。 */
export const useCartReload = (): CartReload =>
  useContext(CartReloadContext) ?? NOOP_RELOAD;
