// CardRenderer.test.tsx — テンプレート判別と ErrorBoundary の単体テスト
//
// **テスト対象**:
//   1. product_feature template → article.card[data-template='product_feature']
//   2. 未知 template → null + console.warn
//   3. ErrorBoundary → 内部で throw されてもグリッド全体は壊れない
//
// **ErrorBoundary 検証の戦術**:
//   小さい "bomb" コンポーネントは作れないので、card.regions の必須プロパティを
//   `undefined` にして ProductFeatureCard 内部で `regions.media.length` の参照を
//   throw させる。実装上 RegionRenderer は length を読むのでこれで throw する。

import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { CardBlock } from "./branded";
import { CardRenderer } from "./CardRenderer";

const minimalProductFeatureCard = (id: string): CardBlock => ({
  template: "product_feature",
  id,
  variant: undefined,
  regions: {
    header: [],
    media: [
      { type: "media", key: "media", kind: "placeholder" },
    ],
    body: [
      { type: "text", key: "title", role: "headline", content: { source: "raw", text: "テスト商品" } },
    ],
    meta: [],
    footer: [],
  },
});

const minimalProductDetailCard = (id: string): CardBlock => ({
  template: "product_detail",
  id,
  variant: undefined,
  regions: {
    gallery: [
      { type: "media", key: "gallery-img", kind: "placeholder" },
    ],
    hero: [
      {
        type: "text",
        key: "hero-hl",
        role: "headline",
        content: { source: "raw", text: "詳細テスト商品" },
      },
    ],
    spec: [],
    pricing: [
      { type: "price", key: "p", amount: 1000, currency: "JPY", taxIncluded: true },
    ],
    cta: [],
    promise: [], // Phase 2 で追加された region。最小カードでは空。
  },
});

describe("CardRenderer", () => {
  it("product_feature template → article.card に template attribute が付く", () => {
    const card = minimalProductFeatureCard("p-test-1");
    const { container } = render(() => <CardRenderer card={card} />);
    const article = container.querySelector("article.card[data-template='product_feature']");
    expect(article).not.toBeNull();
    expect(article?.getAttribute("data-card-id")).toBe("p-test-1");
    // body region の中身が出ているはず
    expect(container.textContent).toContain("テスト商品");
  });

  it("未知 template は何も描画せず console.warn する", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const card = {
        template: "this_template_does_not_exist_xyz",
        id: "p-bad",
        regions: {},
      } as unknown as CardBlock;
      const { container } = render(() => <CardRenderer card={card} />);
      // ErrorBoundary は throw しか拾わない (Switch の fallback は throw しない)
      // → DOM は空、warn が出るのが期待
      expect(container.children.length).toBe(0);
      expect(spy).toHaveBeenCalled();
      const msg = spy.mock.calls[0]?.[0] as string;
      expect(msg).toContain("this_template_does_not_exist_xyz");
    } finally {
      spy.mockRestore();
    }
  });

  it("ErrorBoundary: テンプレート内で throw が出ても fallback UI を描画する", () => {
    // regions に必須プロパティが揃っていない card を渡し、
    // ProductFeatureCard 内の `regions().media` で TypeError を起こす。
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const broken = {
        template: "product_feature",
        id: "p-broken-1",
        // regions そのものが存在しない → regions() が undefined → .media の参照で throw
      } as unknown as CardBlock;
      const { container } = render(() => <CardRenderer card={broken} />);
      // fallback の article[data-card-error='true'] が出ているはず
      const fallback = container.querySelector("article[data-card-error='true']");
      expect(fallback).not.toBeNull();
      expect(fallback?.getAttribute("data-card-id")).toBe("p-broken-1");
      expect(fallback?.textContent).toContain("カードを表示できませんでした");
      // console.error にエラー情報が流れている
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  // ── Phase 7: cart テンプレート dispatch ─────────────────────
  it("cart template → article[data-template='cart'] が出る", () => {
    const cartCard: CardBlock = {
      template: "cart",
      id: "cart",
      variant: "default",
      regions: {
        header: [
          {
            type: "text",
            key: "header-title",
            role: "headline",
            content: { source: "raw", text: "あなたのカート (0 件)" },
          },
        ],
        items: [],
        summary: [],
        cta: [],
      },
    };
    const { container } = render(() => <CardRenderer card={cartCard} />);
    const article = container.querySelector("article[data-template='cart']");
    expect(article).not.toBeNull();
    expect(article?.getAttribute("data-card-id")).toBe("cart");
    expect(container.textContent).toContain("あなたのカート");
  });

  it("product_detail template → article[data-template='product_detail'] が出る", () => {
    const card = minimalProductDetailCard("p-detail-1");
    const { container } = render(() => <CardRenderer card={card} />);
    const article = container.querySelector(
      "article[data-template='product_detail']",
    );
    expect(article).not.toBeNull();
    expect(article?.getAttribute("data-card-id")).toBe("p-detail-1");
    // hero の headline と pricing の金額が出ている
    expect(container.textContent).toContain("詳細テスト商品");
    expect(container.textContent).toContain("¥");
    expect(container.textContent).toContain("1,000");
  });

  it("ErrorBoundary は隣接 CardRenderer に波及しない (1 枚壊れても他は残る)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ok = minimalProductFeatureCard("p-ok-1");
      const broken = {
        template: "product_feature",
        id: "p-bad-1",
      } as unknown as CardBlock;

      const { container } = render(() => (
        <div>
          <CardRenderer card={broken} />
          <CardRenderer card={ok} />
        </div>
      ));

      // 壊れた方は fallback、正常な方は通常レンダリング
      expect(container.querySelector("article[data-card-error='true']")).not.toBeNull();
      expect(
        container.querySelector("article.card[data-template='product_feature'][data-card-id='p-ok-1']"),
      ).not.toBeNull();
    } finally {
      errSpy.mockRestore();
    }
  });
});
