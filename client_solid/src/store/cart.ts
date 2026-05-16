// store/cart.ts — minimal reactive cart state
//
// **役割**:
//   /cart 画面そのものは CartSduiPage が担うが、本 store は以下の用途で残す:
//
//   1. **cartCount badge**: Shell / BottomTabBar の「カート」タブに件数を出す
//      - GET /cards/cart で毎回件数を取るより local mirror の方が UX 軽い
//      - TODO: WebSocket push が入ったら mirror 更新を server-driven 化検討
//
//   2. **add-to-cart Undo の即時 rollback**:
//      Cta.tsx の runAddToCart が POST /api/v1/cart 成功後に local store にも反映、
//      Toast の Undo クリック時に local 即戻 + DELETE /cart/items/:token を非同期で投げる
//
// **server-driven state との重複に注意** (= §11.8):
//   /cart 画面の表示そのものは GET /cards/cart の真実値で動く (= CartSduiPage)。
//   本 store はあくまで「局所的な UI フィードバック」用の mirror で、cart の真実値とは
//   ずれうる。両者を**比較しない・統合しない**。
//
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

// 初期種データは「サイドバーバッジが server cart と乖離する」UI バグを生むため空で起動する。
// 追加は addItem* 経由 (= POST /api/v1/cart 成功後の local mirror 反映) のみ。
const INITIAL: CartItem[] = [];

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
          const reduced = it.qty - item.qty;
          if (reduced <= 0) return [];
          return [{ ...it, qty: reduced }];
        }),
      );
    }
  };

  return { undo };
};

/** カートを空にする (= 注文確定後 / 手動クリア用)。 */
export const clearCart = () => setItems([]);
