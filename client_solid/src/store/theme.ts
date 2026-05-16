// store/theme.ts — ユーザー選択のテーマ (P4-8 夜間赤色モード)
//
// モード:
//   - "auto"      : OS の prefers-color-scheme に従う (既定)
//   - "night-red" : 赤い減光テーマ。夜間の飼育ケア時に blue light を避ける用途。
//                   data-theme="night-red" を <html> に付け、tokens.css の
//                   override を有効化する。
//
// 永続化:
//   - localStorage に kochu:theme として保存
//   - createRoot で effect を閉じ込め、変化時に document の属性を書き換え
//
// 初期化:
//   - アプリ起動時の最初の effect run で OS の値に関わらず
//     適切な data-theme をセットする。
//   - HTML 側で初回描画フラッシュを避けたい場合は別途 inline script を仕込むが、
//     ローカル専用 PWA 想定なので初期チラつきは許容。
import { createSignal, createEffect, createRoot } from "solid-js";

export type ThemeMode = "auto" | "night-red";

const STORAGE_KEY = "kochu:theme";

const readInitial = (): ThemeMode => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "night-red" || raw === "auto") return raw;
  } catch {
    /* ignore */
  }
  return "auto";
};

const [themeMode, setThemeMode] = createSignal<ThemeMode>(readInitial());

/** 現在のテーマモードを読むシグナル */
export const getThemeMode = themeMode;

/** テーマを明示的に設定 */
export const setTheme = (m: ThemeMode) => setThemeMode(m);

/** auto <-> night-red トグル */
export const toggleNightRed = () =>
  setThemeMode((m) => (m === "night-red" ? "auto" : "night-red"));

// ─── 初回オンボーディング Toast 用フラグ ──────────────────────
//
// ナイトモード (赤色) は一般的なダークモードと混同されやすいので、初回 ON 時に
// 1 度だけ「これは暗順応保護用の赤色モードです」と説明トーストを出す。
// ユーザが気付けば以後は出さない。localStorage で永続化する。
const ONBOARDING_KEY = "kochu:theme:night-red-onboarded";

export const hasSeenNightRedOnboarding = (): boolean => {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
};

export const markNightRedOnboardingSeen = (): void => {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* quota / private mode は無視 — 出ても再度出るだけ */
  }
};

// document.documentElement に data-theme を反映し、localStorage に保存する。
// SSR なし前提 (typeof document の判定はテスト環境用)。
createRoot(() => {
  createEffect(() => {
    const m = themeMode();
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (m === "auto") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = m;
    }
    try {
      if (m === "auto") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, m);
      }
    } catch {
      /* quota / private mode は無視 */
    }
  });
});
