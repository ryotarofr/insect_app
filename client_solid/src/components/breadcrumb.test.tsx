// breadcrumb.test.tsx — Breadcrumb / crumbFor のユニットテスト (P2-14)
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { Router, Route } from "@solidjs/router";
import type { JSX } from "solid-js";
import { Breadcrumb } from "./Breadcrumb";
import { crumbFor } from "../router";

const wrap = (child: () => JSX.Element) => (
  <Router>
    <Route path="*" component={child as () => JSX.Element} />
  </Router>
);

describe("crumbFor()", () => {
  it("mypage returns a single non-linked current crumb", () => {
    const c = crumbFor("mypage");
    expect(c).toHaveLength(1);
    expect(c[0].label).toBe("マイページ");
    expect(c[0].href).toBeUndefined();
  });

  it("specimen page links back to mypage", () => {
    const c = crumbFor("specimen", { specimenId: "#X", specimenName: "テスト君" });
    expect(c).toHaveLength(3);
    expect(c[0].href).toBe("/");
    expect(c[2].label).toBe("テスト君");
    expect(c[2].href).toBeUndefined();
  });

  it("cart links back to /products", () => {
    const c = crumbFor("cart");
    expect(c[0].href).toBe("/products");
    expect(c[c.length - 1].label).toBe("カート");
  });

  it("warranty has ヘルプ > 安心保証 (last is current)", () => {
    const c = crumbFor("warranty");
    expect(c.map((x) => x.label)).toEqual(["ヘルプ", "安心保証"]);
    expect(c[1].href).toBeUndefined();
  });

  it("product-detail uses productTitle when provided", () => {
    const c = crumbFor("product-detail", { productTitle: "テスト商品" });
    expect(c[c.length - 1].label).toBe("テスト商品");
  });
});

describe("<Breadcrumb>", () => {
  it("renders non-linked label for current (last) item", () => {
    const { container } = render(() =>
      wrap(() => (
        <Breadcrumb
          items={[
            { label: "親", href: "/parent" },
            { label: "現在地" },
          ]}
        />
      )),
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("親");
    expect(links[0].getAttribute("href")).toBe("/parent");
    // 末尾は aria-current="page"
    const current = container.querySelector('[aria-current="page"]');
    expect(current).toBeTruthy();
    expect(current?.textContent).toBe("現在地");
  });

  it("renders separator between items", () => {
    const { container } = render(() =>
      wrap(() => (
        <Breadcrumb
          items={[
            { label: "A", href: "/a" },
            { label: "B", href: "/b" },
            { label: "C" },
          ]}
        />
      )),
    );
    const text = container.textContent ?? "";
    // " / " が 2 個あるはず
    const sepCount = (text.match(/ \/ /g) ?? []).length;
    expect(sepCount).toBe(2);
  });

  it("has nav role with breadcrumb label", () => {
    const { container } = render(() =>
      wrap(() => <Breadcrumb items={[{ label: "X" }]} />),
    );
    const nav = container.querySelector('nav[aria-label="パンくずリスト"]');
    expect(nav).toBeTruthy();
  });
});
