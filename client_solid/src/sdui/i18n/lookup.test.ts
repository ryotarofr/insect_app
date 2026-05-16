// lookup.test.ts — `tr()` の振る舞いを固める単体テスト
//
// 検査ポイント:
//   1. 辞書ヒット → 文字列を返す
//   2. ヒットしないキー → キー文字列をそのまま返す (空文字にしない不変条件)
//   3. ヒットしないキー → console.warn が呼ばれる (1 回だけ)
//   4. プレースホルダ {name} を params で展開する
//   5. params 内に存在しない placeholder は元のまま残す (= "undefined" を出さない)
//   6. 数値 params も String 化される
//
// `warned` Set はモジュールスコープなのでテスト間で持ち越される。
// 「初回 warn」を確認したい時はそのテストでだけ使う未登録キーを使う (= test isolation)。
//
// **dict 拡張テスト**:
//   `SDUI_DICT_JA` は plain object なのでテスト内で一時的にキーを足し、
//   テスト後に delete して元に戻す。`vi.mock` を使うほど大袈裟ではない。

import { afterEach, describe, expect, it, vi } from "vitest";
import { SDUI_DICT_JA } from "./dict";
import { tr } from "./lookup";

describe("tr() — 辞書 lookup", () => {
  it("辞書にあるキーは対応する日本語を返す", () => {
    expect(tr("badge.featured")).toBe("おすすめ");
    expect(tr("badge.pedigreed")).toBe("血統書付");
  });

  it("未登録キーはキー文字列そのものを返す (空文字にしない不変条件)", () => {
    const key = "test.unique.never.exists.in.dict";
    expect(tr(key)).toBe(key);
  });

  it("未登録キーは console.warn を 1 回だけ呼ぶ", () => {
    // module-level の warned Set はテストファイル間で共有されるので、
    // このテスト専用の一意キーを使って初回の warn を検出する。
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const key = `test.warn.unique.${Math.random().toString(36).slice(2)}`;
      tr(key);
      tr(key); // 2 回目は warn しないはず
      tr(key);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain(key);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("tr() — placeholder 展開", () => {
  // テスト用キーを一時追加 → 終わったら削除して dict を汚さない
  const TEST_KEYS = {
    greeting: `test.greeting.${Math.random().toString(36).slice(2)}`,
    count: `test.count.${Math.random().toString(36).slice(2)}`,
    multi: `test.multi.${Math.random().toString(36).slice(2)}`,
  };

  // 各テスト前に dict にテスト用キーを注入
  SDUI_DICT_JA[TEST_KEYS.greeting] = "こんにちは {name} さん";
  SDUI_DICT_JA[TEST_KEYS.count] = "残り {n} 点";
  SDUI_DICT_JA[TEST_KEYS.multi] = "{a} と {b} と {a}";

  afterEach(() => {
    // 念のため毎回再注入 (他テストで delete されてないことを保証)
    SDUI_DICT_JA[TEST_KEYS.greeting] = "こんにちは {name} さん";
    SDUI_DICT_JA[TEST_KEYS.count] = "残り {n} 点";
    SDUI_DICT_JA[TEST_KEYS.multi] = "{a} と {b} と {a}";
  });

  it("string params で {name} 形式を置換する", () => {
    expect(tr(TEST_KEYS.greeting, { name: "田中" })).toBe("こんにちは 田中 さん");
  });

  it("number params も String 化されて埋め込まれる", () => {
    expect(tr(TEST_KEYS.count, { n: 5 })).toBe("残り 5 点");
  });

  it("同じ placeholder が複数回出ても全て置換される", () => {
    expect(tr(TEST_KEYS.multi, { a: "X", b: "Y" })).toBe("X と Y と X");
  });

  it("params 自体が undefined なら placeholder は残る (誤って 'undefined' を出さない)", () => {
    expect(tr(TEST_KEYS.greeting)).toBe("こんにちは {name} さん");
  });

  it("params にキーが無い placeholder は残る (= 'undefined' を出さない)", () => {
    expect(tr(TEST_KEYS.greeting, { other: "X" })).toBe("こんにちは {name} さん");
  });
});
