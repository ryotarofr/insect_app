// ProductDetailCard.test.tsx — product_detail テンプレートの単体テスト
//
// **検証ポイント (MVP)**:
//   - 6 リージョン (gallery / hero / spec / pricing / cta / promise) が描画される
//   - data-template / data-card-id 属性が付く
//   - 空 region (例: spec が空) は <Show> によって省略される
//   - hero の chip 群、spec の MetricList、cta の primary/secondary が見える
//
// **Phase 2 (UX 強化) 追加**:
//   - gallery が複数枚 → サムネ列が出る + クリックで hero (selected) が切り替わる
//   - cta region に Tertiary intent (♡ ウォッチ) が並ぶ
//   - promise region (eyebrow + caption x3 + cta) が `<aside>` として出る
//   - promise が空配列の時は aside ごと省略される

import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import type { CardBlock } from "../branded";
import { asHref } from "../branded";
import { ProductDetailCard } from "./ProductDetailCard";

type DetailCard = Extract<CardBlock, { template: "product_detail" }>;

/** 完全装備の detail カード factory。
 *  Phase 2 の要素 (gallery 3 枚 / watch CTA / promise) を全部入れる。 */
const fullDetailCard = (id = "p-test"): DetailCard => ({
  template: "product_detail",
  id,
  variant: "default",
  regions: {
    gallery: [
      {
        type: "media",
        key: "gallery-img-1",
        kind: "image",
        src: "https://example.com/x1.jpg",
        alt: { source: "raw", text: "メインカット" },
      },
      {
        type: "media",
        key: "gallery-img-2",
        kind: "image",
        src: "https://example.com/x2.jpg",
        alt: { source: "raw", text: "別アングル" },
      },
      {
        type: "media",
        key: "gallery-img-3",
        kind: "image",
        src: "https://example.com/x3.jpg",
        alt: { source: "raw", text: "サイズ比較" },
      },
    ],
    hero: [
      {
        type: "meta_line",
        key: "hero-shop",
        items: [{ key: "shop", role: "shop", value: "TEST SHOP" }],
      },
      {
        type: "text",
        key: "hero-hl",
        role: "headline",
        content: { source: "raw", text: "ヘラクレス" },
      },
      {
        type: "text",
        key: "hero-sh",
        role: "subhead",
        content: { source: "raw", text: "Dynastes hercules" },
      },
      {
        type: "badge",
        key: "hero-b1",
        role: "status",
        label: { source: "raw", text: "生体" },
      },
    ],
    spec: [
      {
        type: "metric_list",
        key: "spec-ml",
        items: [
          {
            key: "size",
            label: { source: "raw", text: "サイズ" },
            value: { source: "raw", text: "142mm" },
          },
          {
            key: "sex",
            label: { source: "raw", text: "性別" },
            value: { source: "raw", text: "♂ オス" },
          },
        ],
      },
    ],
    pricing: [
      {
        type: "price",
        key: "pricing-pr",
        amount: 48000,
        currency: "JPY",
        taxIncluded: true,
      },
    ],
    cta: [
      {
        type: "cta",
        key: "cta-add",
        intent: "primary",
        label: { source: "raw", text: "カートに追加" },
        href: asHref("/cart?add=p-test"),
      },
      {
        type: "cta",
        key: "cta-view-cart",
        intent: "secondary",
        label: { source: "raw", text: "カートを見る" },
        href: asHref("/cart"),
      },
      {
        type: "cta",
        key: "cta-watch",
        intent: "tertiary",
        label: { source: "raw", text: "♡ ウォッチ" },
        href: asHref("/watch?add=p-test"),
      },
    ],
    promise: [
      {
        type: "text",
        key: "promise-eyebrow",
        role: "eyebrow",
        content: { source: "raw", text: "安心保証" },
      },
      {
        type: "text",
        key: "promise-1",
        role: "caption",
        content: { source: "raw", text: "✓ 死着補償(24h 自動返金)" },
      },
      {
        type: "text",
        key: "promise-2",
        role: "caption",
        content: { source: "raw", text: "✓ 温度制御便" },
      },
      {
        type: "text",
        key: "promise-3",
        role: "caption",
        content: { source: "raw", text: "✓ 購入後 自動カルテ生成" },
      },
      {
        type: "cta",
        key: "promise-cta",
        intent: "tertiary",
        label: { source: "raw", text: "詳細を見る →" },
        href: asHref("/help/warranty"),
      },
    ],
  },
});

describe("ProductDetailCard — base", () => {
  it("data-template / data-card-id / data-variant が article に付く", () => {
    const card = fullDetailCard("p-detail-x");
    const { container } = render(() => <ProductDetailCard card={card} />);
    const article = container.querySelector(
      "article[data-template='product_detail']",
    );
    expect(article).not.toBeNull();
    expect(article?.getAttribute("data-card-id")).toBe("p-detail-x");
    expect(article?.getAttribute("data-variant")).toBe("default");
  });

  it("6 リージョン全部の中身が描画される", () => {
    const card = fullDetailCard();
    const { container } = render(() => <ProductDetailCard card={card} />);
    const text = container.textContent ?? "";
    // gallery: hero <img>
    expect(container.querySelector("img")).not.toBeNull();
    // hero: shop / title / sci / chip
    expect(text).toContain("TEST SHOP");
    expect(text).toContain("ヘラクレス");
    expect(text).toContain("Dynastes hercules");
    expect(text).toContain("生体");
    // spec
    expect(text).toContain("個体詳細");
    expect(text).toContain("サイズ");
    expect(text).toContain("142mm");
    // pricing
    expect(text).toContain("¥");
    expect(text).toContain("48,000");
    expect(text).toContain("税込");
    // cta: 各 intent が出ている (primary / secondary / tertiary)
    const intents = Array.from(
      container.querySelectorAll("a[data-intent]"),
    ).map((a) => a.getAttribute("data-intent"));
    expect(intents).toContain("primary");
    expect(intents).toContain("secondary");
    expect(intents).toContain("tertiary");
    // promise の eyebrow も出ている
    expect(text).toContain("安心保証");
  });

  it("variant 未指定時は data-variant='default' になる", () => {
    const card: DetailCard = { ...fullDetailCard(), variant: undefined };
    const { container } = render(() => <ProductDetailCard card={card} />);
    const article = container.querySelector("article[data-template='product_detail']");
    expect(article?.getAttribute("data-variant")).toBe("default");
  });

  it("空 region (spec) は section header ごと省略される", () => {
    const card: DetailCard = {
      ...fullDetailCard(),
      regions: { ...fullDetailCard().regions, spec: [] },
    };
    const { container } = render(() => <ProductDetailCard card={card} />);
    expect(container.textContent).not.toContain("個体詳細");
    // 他 region は残る
    expect(container.textContent).toContain("48,000");
    expect(container.textContent).toContain("安心保証");
  });
});

describe("ProductDetailCard — gallery (Phase 2)", () => {
  it("複数枚あればサムネイル列 (role=tablist) が出る", () => {
    const card = fullDetailCard(); // gallery 3 枚
    const { container } = render(() => <ProductDetailCard card={card} />);
    const thumbs = container.querySelector("[data-gallery-thumbs]");
    expect(thumbs).not.toBeNull();
    // role=tab のサムネボタンが 3 個
    const tabs = container.querySelectorAll("button[role='tab']");
    expect(tabs.length).toBe(3);
  });

  it("1 枚しかない時はサムネ列を出さない", () => {
    const single: DetailCard = {
      ...fullDetailCard(),
      regions: {
        ...fullDetailCard().regions,
        gallery: [fullDetailCard().regions.gallery[0]!],
      },
    };
    const { container } = render(() => <ProductDetailCard card={single} />);
    expect(container.querySelector("[data-gallery-thumbs]")).toBeNull();
    // hero 画像は出る
    expect(container.querySelector("[data-gallery-hero] img")).not.toBeNull();
  });

  it("最初は 1 枚目が active、サムネクリックで active が切り替わる", () => {
    const card = fullDetailCard();
    const { container } = render(() => <ProductDetailCard card={card} />);
    const tabs = container.querySelectorAll<HTMLButtonElement>(
      "button[role='tab']",
    );
    expect(tabs.length).toBe(3);

    // 初期: 1 枚目 (idx=0) が active
    expect(tabs[0]?.getAttribute("data-thumb-active")).toBe("true");
    expect(tabs[1]?.getAttribute("data-thumb-active")).toBe("false");
    expect(tabs[2]?.getAttribute("data-thumb-active")).toBe("false");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");

    // 2 枚目をクリック → idx=1 が active に
    fireEvent.click(tabs[1]!);
    expect(tabs[0]?.getAttribute("data-thumb-active")).toBe("false");
    expect(tabs[1]?.getAttribute("data-thumb-active")).toBe("true");

    // 3 枚目をクリック → idx=2 が active に
    fireEvent.click(tabs[2]!);
    expect(tabs[1]?.getAttribute("data-thumb-active")).toBe("false");
    expect(tabs[2]?.getAttribute("data-thumb-active")).toBe("true");
  });
});

describe("ProductDetailCard — promise (Phase 2)", () => {
  it("promise region は aside.card として描画される", () => {
    const card = fullDetailCard();
    const { container } = render(() => <ProductDetailCard card={card} />);
    const aside = container.querySelector("aside[data-region='promise']");
    expect(aside).not.toBeNull();
    expect(aside?.getAttribute("aria-label")).toBe("安心保証");
    const text = aside?.textContent ?? "";
    expect(text).toContain("安心保証");
    expect(text).toContain("死着補償");
    expect(text).toContain("温度制御便");
    expect(text).toContain("自動カルテ");
    // 末尾 CTA: warranty link
    expect(text).toContain("詳細を見る");
    expect(aside?.querySelector("a[href='/help/warranty']")).not.toBeNull();
  });

  it("promise が空配列の時は aside ごと出ない", () => {
    const card: DetailCard = {
      ...fullDetailCard(),
      regions: { ...fullDetailCard().regions, promise: [] },
    };
    const { container } = render(() => <ProductDetailCard card={card} />);
    expect(container.querySelector("aside[data-region='promise']")).toBeNull();
    // cta region は残る
    expect(container.querySelectorAll("a[data-intent]").length).toBeGreaterThan(0);
  });
});

describe("ProductDetailCard — watch CTA (Phase 2)", () => {
  it("cta region 内に /watch?add=... を href に持つ tertiary CTA が出る", () => {
    const card = fullDetailCard();
    const { container } = render(() => <ProductDetailCard card={card} />);
    // promise 内にも tertiary cta があるので、href プレフィックスで識別する
    const watchLink = Array.from(
      container.querySelectorAll<HTMLAnchorElement>("a[data-intent='tertiary']"),
    ).find((a) => a.getAttribute("href")?.startsWith("/watch?add="));
    expect(watchLink).toBeTruthy();
    expect(watchLink?.textContent).toContain("ウォッチ");
  });
});
