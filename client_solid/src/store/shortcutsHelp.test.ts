// shortcutsHelp.test.ts — P4-19 ? キーで開くモーダル用の signal ストア
import { beforeEach, describe, expect, it } from "vitest";
import {
  closeShortcutsHelp,
  isShortcutsHelpOpen,
  openShortcutsHelp,
  toggleShortcutsHelp,
} from "./shortcutsHelp";

describe("shortcutsHelp store", () => {
  beforeEach(() => {
    // 各テスト前に閉じ状態にリセット
    closeShortcutsHelp();
  });

  it("starts closed by default after reset", () => {
    expect(isShortcutsHelpOpen()).toBe(false);
  });

  it("openShortcutsHelp() sets the signal to true", () => {
    openShortcutsHelp();
    expect(isShortcutsHelpOpen()).toBe(true);
  });

  it("closeShortcutsHelp() sets the signal to false", () => {
    openShortcutsHelp();
    closeShortcutsHelp();
    expect(isShortcutsHelpOpen()).toBe(false);
  });

  it("toggleShortcutsHelp() flips the signal each call", () => {
    expect(isShortcutsHelpOpen()).toBe(false);
    toggleShortcutsHelp();
    expect(isShortcutsHelpOpen()).toBe(true);
    toggleShortcutsHelp();
    expect(isShortcutsHelpOpen()).toBe(false);
  });
});
