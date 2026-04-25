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

/**
 * P2-8: undo 付き addItem。 正確に直前の操作だけを取り消せる undo 関数を返す。
 *   - 新規追加だった場合 → 行ごと削除
 *   - 数量マージだった場合 → 足した qty 分だけ戻す (残行は温存)
 *   - undo 呼び出し時点で qty が不正に減っている場合は当該行は既に削除/変更された
 *     とみなし何もしない
 */
export const addItemWithUndo = (item: CartItem): { undo: () => void } => {
  let wasNew = false;
  setItems((list) => {
    const existing = list.find((it) => it.id === item.id);
    if (existing) {
      wasNew = false;
      return list.map((it) =>
        it.id === item.id ? { ...it, qty: it.qty + item.qty } : it,
      );
    }
    wasNew = true;
    return [...list, item];
  });

  const undo = () => {
    if (wasNew) {
      setItems((list) => list.filter((it) => it.id !== item.id));
    } else {
      setItems((list) =>
        list.flatMap((it) => {
          if (it.id !== item.id) return [it];
          const nextQty = it.qty - item.qty;
          if (nextQty <= 0) return [];
          return [{ ...it, qty: nextQty }];
        }),
      );
    }
  };
  return { undo };
};

export const clearCart = () => setItems([]);
