// L.test.tsx — Localizable レンダリングの単体テスト
//
// 検査:
//   - resolveLocalizable (純関数): raw / i18n の 2 経路で正しい文字列
//   - <L value=... />: テキストノードとしてレンダリングされる (タグでラップしない)
//
// **branded 対策**: I18nKey は branded string なので、テスト用に asI18nKey で包む。

import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { asI18nKey } from "./branded";
import { L, resolveLocalizable } from "./L";

describe("resolveLocalizable", () => {
  it("source: 'raw' は text を素通しする", () => {
    expect(resolveLocalizable({ source: "raw", text: "ハーキュリーズ" })).toBe(
      "ハーキュリーズ",
    );
  });

  it("source: 'i18n' は dict を引いた文字列を返す", () => {
    expect(
      resolveLocalizable({ source: "i18n", key: asI18nKey("badge.featured") }),
    ).toBe("おすすめ");
  });

  it("未登録 i18n キーはキー文字列を返す (空文字にしない)", () => {
    const k = "test.never.exists.in.dict.unique.42";
    expect(resolveLocalizable({ source: "i18n", key: asI18nKey(k) })).toBe(k);
  });
});

describe("<L>", () => {
  it("raw を text node として描画する (タグでラップしない)", () => {
    const { container } = render(() => (
      <span data-testid="wrap">
        <L value={{ source: "raw", text: "テスト文字列" }} />
      </span>
    ));
    const wrap = container.querySelector("[data-testid='wrap']");
    expect(wrap?.textContent).toBe("テスト文字列");
    // <L> 自体は要素を増やさない (Fragment 描画) ので子要素は無いはず
    expect(wrap?.children.length).toBe(0);
  });

  it("i18n キーを dict 経由で描画する", () => {
    const { container } = render(() => (
      <span data-testid="badge">
        <L value={{ source: "i18n", key: asI18nKey("badge.featured") }} />
      </span>
    ));
    expect(container.querySelector("[data-testid='badge']")?.textContent).toBe(
      "おすすめ",
    );
  });
});
