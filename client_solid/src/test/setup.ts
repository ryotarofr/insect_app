// vitest setup — jsdom 環境に jest-dom マッチャを取り込む
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@solidjs/testing-library";
import { __resetUserLogs, __resetSpecimenMemos } from "../api";

// jsdom が未実装の Window.scrollTo / scroll を stub して無害化
if (typeof window !== "undefined") {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.scroll = vi.fn() as unknown as typeof window.scroll;
}

// 各テスト前後で localStorage と api signal の永続状態をクリアして副作用を遮断
beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
  __resetUserLogs();
  __resetSpecimenMemos();
});

afterEach(() => {
  cleanup();
  if (typeof localStorage !== "undefined") localStorage.clear();
  __resetUserLogs();
  __resetSpecimenMemos();
});
