// store/shortcutsHelp.ts — ? キーで開くショートカット一覧モーダルの開閉状態
// P4-19: グローバルから open/close/toggle できるシンプルな signal ストア。
import { createSignal } from "solid-js";

const [open, setOpen] = createSignal(false);

export const isShortcutsHelpOpen = open;
export const openShortcutsHelp = () => setOpen(true);
export const closeShortcutsHelp = () => setOpen(false);
export const toggleShortcutsHelp = () => setOpen((v) => !v);
