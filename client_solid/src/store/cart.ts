// store/cart.ts — minimal reactive cart state
// 単一の signal をモジュールスコープで保持して全画面から参照する。
import { createSignal } from "solid-js";

export interface CartItem {
  id: string;
  title: string;
  meta: string;
  price: number;
  qty: number;
  kind: string;
  tone: "forest" | "amber";
}

const INITIAL: CartItem[] = [
  {
    id: "i1",
    title: "ヘラクレスオオカブト ♂ 142mm",
    meta: "CBF2 · #DHH-0271",
    price: 48000,
    qty: 1,
    kind: "生体",
    tone: "forest",
  },
  {
    id: "i2",
    title: "高栄養ゼリー 17g × 50個",
    meta: "消耗品",
    price: 1480,
    qty: 2,
    kind: "用品",
    tone: "amber",
  },
];

const [items, setItems] = createSignal<CartItem[]>(INITIAL);

export const cartItems = items;

/** 合計点数（数量の総和） */
export const cartCount = () => items().reduce((a, i) => a + i.qty, 0);

/** 小計（税込・送料別） */
export const cartSubtotal = () => items().reduce((a, i) => a + i.price * i.qty, 0);

export const updateQty = (id: string, delta: number) => {
  setItems((list) =>
    list.map((it) => (it.id === id ? { ...it, qty: Math.max(1, it.qty + delta) } : it)),
  );
};

export const removeItem = (id: string) => {
  setItems((list) => list.filter((it) => it.id !== id));
};

export const addItem = (item: CartItem) => {
  setItems((list) => {
    const existing = list.find((it) => it.id === item.id);
    if (existing) {
      return list.map((it) => (it.id === item.id ? { ...it, qty: it.qty + item.qty } : it));
    }
    return [...list, item];
  });
};

export const clearCart = () => setItems([]);
