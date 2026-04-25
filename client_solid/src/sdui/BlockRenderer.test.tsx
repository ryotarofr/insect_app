// BlockRenderer.test.tsx — Block ディスパッチの単体テスト
//
// **戦略**:
//   各 type を 1 個ずつ食わせて、対応するレンダラ特有のマーカ
//   (data-role / class / 文字列 / DOM 構造) を assert する。
//   個別 block のスタイル詳細は再現しないが「正しい renderer に到達した」だけを保証。
//
// 未知 type も同居させ、画面が落ちず null になることを確認する。

import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { Block } from "./branded";
import { asHref, asI18nKey } from "./branded";
import { BlockRenderer } from "./BlockRenderer";

// 短く書くための factory 群
const raw = (text: string) => ({ source: "raw" as const, text });
const i18n = (key: string) => ({ source: "i18n" as const, key: asI18nKey(key) });

describe("BlockRenderer dispatch", () => {
  it("text block → data-role 付き div に Localizable を流す", () => {
    const block: Block = {
      type: "text",
      key: "t1",
      role: "headline",
      content: raw("ヘラクレス"),
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    const el = container.querySelector("[data-role='headline']");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("ヘラクレス");
  });

  it("cta block → <a> with data-intent と href", () => {
    const block: Block = {
      type: "cta",
      key: "c1",
      intent: "primary",
      href: asHref("/products/x"),
      label: raw("カートに追加"),
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    const a = container.querySelector("a[data-intent='primary']") as HTMLAnchorElement | null;
    expect(a).not.toBeNull();
    // jsdom は相対 href を absolute 化する場合があるので endsWith で判定
    expect(a?.getAttribute("href")).toBe("/products/x");
    expect(a?.textContent).toBe("カートに追加");
  });

  it("media block (image+src) → <img>", () => {
    const block: Block = {
      type: "media",
      key: "m1",
      kind: "image",
      src: "https://example.com/x.jpg",
      alt: raw("ヘラクレス標本"),
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/x.jpg");
    expect(img?.getAttribute("alt")).toBe("ヘラクレス標本");
  });

  it("media block (placeholder) → div.ph", () => {
    const block: Block = {
      type: "media",
      key: "m2",
      kind: "placeholder",
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    expect(container.querySelector("div.ph")).not.toBeNull();
  });

  it("badge block → span.chip with role tone", () => {
    const block: Block = {
      type: "badge",
      key: "b1",
      role: "evidence",
      label: i18n("badge.pedigreed"),
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    const chip = container.querySelector("span.chip");
    expect(chip).not.toBeNull();
    expect(chip?.classList.contains("indigo")).toBe(true);
    expect(chip?.textContent).toBe("血統書付");
  });

  it("metric_list block → 各 item の label/value が出る", () => {
    const block: Block = {
      type: "metric_list",
      key: "ml1",
      items: [
        { key: "size", label: raw("サイズ"), value: raw("142mm") },
        { key: "sex", label: raw("性別"), value: raw("オス") },
      ],
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    expect(container.textContent).toContain("サイズ");
    expect(container.textContent).toContain("142mm");
    expect(container.textContent).toContain("性別");
  });

  it("meta_line block → 各 item の value が plain text として並ぶ", () => {
    const block: Block = {
      type: "meta_line",
      key: "meta1",
      items: [
        { key: "id", role: "id", value: "DHH-0271" },
        { key: "shop", role: "shop", value: "東京虫商" },
      ],
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    const idSpan = container.querySelector("[data-role='id']");
    expect(idSpan?.textContent).toBe("DHH-0271");
    expect(idSpan?.classList.contains("mono")).toBe(true);
    expect(container.textContent).toContain("東京虫商");
  });

  it("price block → ¥ + 3 桁区切りで描画される", () => {
    const block: Block = {
      type: "price",
      key: "p1",
      amount: 48000,
      currency: "JPY",
      taxIncluded: true,
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    expect(container.textContent).toContain("¥");
    expect(container.textContent).toContain("48,000");
    expect(container.textContent).toContain("税込");
  });

  it("eclosion_forecast block → 残り日数と日付が描画される", () => {
    const block: Block = {
      type: "eclosion_forecast",
      key: "e1",
      daysAhead: 15,
      date: "2026-05-10",
      tolerance: 5,
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    expect(container.textContent).toContain("羽化まで 15 日");
    expect(container.textContent).toContain("±5");
    expect(container.textContent).toContain("2026-05-10");
  });

  it("divider block → <hr>", () => {
    const block: Block = { type: "divider", key: "d1" };
    const { container } = render(() => <BlockRenderer block={block} />);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  // ── Phase 7: cart 専用 block の dispatch ─────────────────────
  it("line_item block → data-block-type='line_item' に到達する", () => {
    const block: Block = {
      type: "line_item",
      key: "li-tok",
      productId: "p-x",
      title: raw("ヘラクレス"),
      unitPriceAmount: 48000,
      currency: "JPY",
      qty: 2,
      subtotalAmount: 96000,
      detailHref: asHref("/products/p-x"),
      decrementAction: { type: "set_qty", token: "tok", qty: 1 },
      incrementAction: { type: "set_qty", token: "tok", qty: 3 },
      removeAction: { type: "remove", token: "tok" },
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    const root = container.querySelector("[data-block-type='line_item']");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-product-id")).toBe("p-x");
  });

  it("order_summary block → data-block-type='order_summary' に到達する", () => {
    const block: Block = {
      type: "order_summary",
      key: "summary",
      lineCount: 1,
      totalQty: 2,
      subtotalAmount: 96000,
      totalAmount: 96000,
      currency: "JPY",
    };
    const { container } = render(() => <BlockRenderer block={block} />);
    const root = container.querySelector(
      "[data-block-type='order_summary']",
    );
    expect(root).not.toBeNull();
    expect(root?.textContent).toContain("¥96,000");
  });

  it("未知 type は null を返し、console.warn を出す (画面真っ白を回避)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // type system を欺いて未知 type を流す
      const block = { type: "totally_new_block_xyz", key: "x" } as unknown as Block;
      const { container } = render(() => <BlockRenderer block={block} />);
      // null を返すので何も DOM に出ないはず
      expect(container.children.length).toBe(0);
      expect(spy).toHaveBeenCalled();
      const msg = spy.mock.calls[0]?.[0] as string;
      expect(msg).toContain("totally_new_block_xyz");
    } finally {
      spy.mockRestore();
    }
  });
});
