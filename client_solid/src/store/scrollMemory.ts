// scrollMemory.ts — pathname ごとに直近の scrollY を覚えておく簡易ストア
//
// 目的:
//   マイページ → 個体カルテ → ブラウザ戻る で 戻った時に
//   元のスクロール位置 (=ユーザが選んだカード周辺) に戻すための記憶。
//
// 設計:
//   - Map<pathname, scrollY> をモジュールスコープに置く
//   - ページから離れる時に save() して、戻る (popstate) 時に consume() する
//   - consume() は読み取り後に削除する: 次の "新規 push 訪問" は top から始める方が自然
//
// テスト容易性のため `_clear()` を export する。
const memory = new Map<string, number>();

export const saveScroll = (pathname: string, y: number): void => {
  memory.set(pathname, y);
};

export const consumeScroll = (pathname: string): number | null => {
  const y = memory.get(pathname);
  if (y == null) return null;
  memory.delete(pathname);
  return y;
};

export const _clearScrollMemory = (): void => {
  memory.clear();
};
