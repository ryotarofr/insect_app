// store/commandPalette.ts — ⌘K 検索モーダル (P4-5) のグローバル開閉 state
//
// Toast と同じく createSignal をモジュールスコープで保持し、
// どこからでも openCommandPalette() / closeCommandPalette() を呼べる。
//   - トップバーの擬似検索ボタン / Cmd+K グローバルショートカット の両方から起動
//   - Esc で閉じる (コンポーネント側で window listener)
//   - 一度検索して選ぶとオートで閉じる
import { createSignal } from "solid-js";

const [open, setOpen] = createSignal(false);

export const isCommandPaletteOpen = open;

export const openCommandPalette = () => setOpen(true);
export const closeCommandPalette = () => setOpen(false);
export const toggleCommandPalette = () => setOpen((v) => !v);
