// shortcuts.test.ts — P2-13 ショートカット抑制ロジックのユニットテスト
//
// shouldSkipShortcut(target) がフォームフォーカス / モーダル表示時に
// true を返すことを検証する。
import { afterEach, describe, expect, it } from "vitest";
import { shouldSkipShortcut } from "../App";

// 各テスト後に DOM を片付けてクロス汚染を防ぐ
afterEach(() => {
  document.body.innerHTML = "";
});

describe("shouldSkipShortcut()", () => {
  it("returns false for null / undefined", () => {
    expect(shouldSkipShortcut(null)).toBe(false);
  });

  it("returns false for a plain DIV", () => {
    const d = document.createElement("div");
    expect(shouldSkipShortcut(d)).toBe(false);
  });

  it("returns true for INPUT", () => {
    const i = document.createElement("input");
    expect(shouldSkipShortcut(i)).toBe(true);
  });

  it("returns true for TEXTAREA", () => {
    const t = document.createElement("textarea");
    expect(shouldSkipShortcut(t)).toBe(true);
  });

  it("returns true for SELECT", () => {
    const s = document.createElement("select");
    expect(shouldSkipShortcut(s)).toBe(true);
  });

  it("returns true for contentEditable elements (attribute)", () => {
    const d = document.createElement("div");
    d.setAttribute("contenteditable", "true");
    document.body.appendChild(d);
    expect(shouldSkipShortcut(d)).toBe(true);
  });

  it("returns true for contentEditable='plaintext-only'", () => {
    const d = document.createElement("div");
    d.setAttribute("contenteditable", "plaintext-only");
    document.body.appendChild(d);
    expect(shouldSkipShortcut(d)).toBe(true);
  });

  it("returns false for contenteditable='false'", () => {
    const d = document.createElement("div");
    d.setAttribute("contenteditable", "false");
    document.body.appendChild(d);
    expect(shouldSkipShortcut(d)).toBe(false);
  });

  it("returns true for role=textbox", () => {
    const d = document.createElement("div");
    d.setAttribute("role", "textbox");
    expect(shouldSkipShortcut(d)).toBe(true);
  });

  it("returns true when an aria-modal element is visible in the document", () => {
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    // target 自身は DIV (モーダル対象外でも true)
    const plainDiv = document.createElement("div");
    expect(shouldSkipShortcut(plainDiv)).toBe(true);
  });

  it("returns false when no modal exists and target is neutral", () => {
    const b = document.createElement("button");
    expect(shouldSkipShortcut(b)).toBe(false);
  });
});
