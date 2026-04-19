// cart.test.ts — カートストアのユニットテスト
// モジュールスコープの signal なので beforeEach でクリアして状態を分離する
import { beforeEach, describe, expect, it } from "vitest";
import {
  addItem,
  cartCount,
  cartItems,
  cartSubtotal,
  clearCart,
  removeItem,
  updateQty,
  type CartItem,
} from "./cart";

const A: CartItem = {
  id: "t-a",
  title: "Test A",
  meta: "meta-a",
  price: 1000,
  qty: 1,
  kind: "生体",
  tone: "forest",
};

const B: CartItem = {
  id: "t-b",
  title: "Test B",
  meta: "meta-b",
  price: 500,
  qty: 2,
  kind: "用品",
  tone: "amber",
};

beforeEach(() => {
  clearCart();
});

describe("cart store", () => {
  it("starts empty after clearCart()", () => {
    expect(cartItems()).toEqual([]);
    expect(cartCount()).toBe(0);
    expect(cartSubtotal()).toBe(0);
  });

  it("addItem appends a new item and updates count/subtotal", () => {
    addItem(A);
    expect(cartItems()).toHaveLength(1);
    expect(cartCount()).toBe(1);
    expect(cartSubtotal()).toBe(1000);

    addItem(B);
    expect(cartItems()).toHaveLength(2);
    expect(cartCount()).toBe(3); // 1 + 2
    expect(cartSubtotal()).toBe(2000); // 1*1000 + 2*500
  });

  it("addItem with existing id merges qty instead of duplicating", () => {
    addItem(A);
    addItem({ ...A, qty: 3 });
    expect(cartItems()).toHaveLength(1);
    expect(cartItems()[0].qty).toBe(4);
    expect(cartCount()).toBe(4);
  });

  it("updateQty applies positive and negative delta", () => {
    addItem(A);
    updateQty(A.id, 2);
    expect(cartItems()[0].qty).toBe(3);
    updateQty(A.id, -1);
    expect(cartItems()[0].qty).toBe(2);
  });

  it("updateQty clamps to minimum 1", () => {
    addItem(A);
    updateQty(A.id, -100);
    expect(cartItems()[0].qty).toBe(1); // clamped, not 0 or negative
  });

  it("updateQty on unknown id is a no-op", () => {
    addItem(A);
    const before = cartItems()[0].qty;
    updateQty("unknown-id", 5);
    expect(cartItems()[0].qty).toBe(before);
  });

  it("removeItem deletes the matching item", () => {
    addItem(A);
    addItem(B);
    removeItem(A.id);
    expect(cartItems()).toHaveLength(1);
    expect(cartItems()[0].id).toBe(B.id);
    expect(cartCount()).toBe(2);
  });

  it("removeItem on unknown id is a no-op", () => {
    addItem(A);
    removeItem("unknown-id");
    expect(cartItems()).toHaveLength(1);
  });

  it("clearCart empties everything", () => {
    addItem(A);
    addItem(B);
    clearCart();
    expect(cartItems()).toEqual([]);
    expect(cartCount()).toBe(0);
    expect(cartSubtotal()).toBe(0);
  });

  it("cartCount and cartSubtotal track reactively after mutations", () => {
    addItem({ ...A, qty: 1, price: 100 });
    expect(cartCount()).toBe(1);
    expect(cartSubtotal()).toBe(100);

    updateQty(A.id, 4);
    expect(cartCount()).toBe(5);
    expect(cartSubtotal()).toBe(500);

    addItem({ ...B, qty: 1, price: 200 });
    expect(cartCount()).toBe(6);
    expect(cartSubtotal()).toBe(700);
  });
});
