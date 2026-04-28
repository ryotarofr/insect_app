// store/specimens.ts — login user の所有個体 (= /api/v1/specimens/me) の reactive store
//
// **責務** (= store/auth.ts と同じパターン):
//   - 現在 login 中の user の active な specimens (SpecimenView[]) を module-scope signal で保持
//   - `refreshMySpecimens()` を 1 関数で「サーバ取得 → signal 更新」まで握る
//   - anonymous (= 401) は signal を null にして静かに失敗する (= toast を出さない)
//   - 5xx / network 障害は error signal に詰めて、UI 側でバナー等を出せるようにする
//
// **`/specimens/me` の 401 解釈**:
//   anonymous か、login したものの session がまだ反映されていない過渡期に 401 が返る。
//   refreshMe() と同じく「ログインしていない」として signal を `null` にして done。
//
// **server-driven state (v6 §11.8) との整合**:
//   create / archive 等の mutation 直後は **必ず再 fetch** で server の真値で UI を更新する。
//   client 側の楽観的 mutation はせず、サーバが Source of Truth。
//
// **mock との関係 (= api/specimens.ts)**:
//   旧 `listSpecimens()` (= APP_DATA seed) はそのまま残す。本 store は **追加** で動き、
//   logged-in 時に呼び出し側 (= MyPage / SpecimenDetail) が server 値を優先する。
//   anonymous 時は本 store は null のまま、呼び出し側は mock にフォールバックする。

import { createSignal } from "solid-js";

import {
  type SpecimenView,
  SduiFetchError,
  fetchMySpecimens,
} from "../sdui/api";

const [specimens, setSpecimens] = createSignal<SpecimenView[] | null>(null);
const [isLoading, setIsLoading] = createSignal<boolean>(false);
const [error, setError] = createSignal<string | null>(null);

/** login user の所有個体 (= GET /specimens/me の結果)。`null` = まだ取得していない / anonymous。 */
export const serverSpecimens = specimens;

/** `refreshMySpecimens()` の進行中フラグ。double-invoke による flicker を防ぐのに使う。 */
export const isSpecimensLoading = isLoading;

/** 5xx / network 等の取得失敗メッセージ。401 は静かに null にするのでここには載らない。 */
export const serverSpecimensError = error;

/** publicId (= "#DHH-0271" 等) で 1 件引く。未取得 / 不存在は undefined。
 *  `serverSpecimens()` のキャッシュを線形探索するだけ (= 個体数 O(数十) 想定で十分)。 */
export const findServerSpecimenByPublicId = (
  publicId: string,
): SpecimenView | undefined => {
  const list = specimens();
  if (!list) return undefined;
  return list.find((s) => s.publicId === publicId);
};

/** internal UUID で 1 件引く。create_log / archive 等 UUID 必須経路で使う。 */
export const findServerSpecimenById = (id: string): SpecimenView | undefined => {
  const list = specimens();
  if (!list) return undefined;
  return list.find((s) => s.id === id);
};

/**
 * `/api/v1/specimens/me` を叩いて signal を更新する。
 *
 * - 401 → `serverSpecimens` を `null` にして静かに終了 (= anonymous)。`error` も null に保つ。
 * - 200 → 配列 (空でも OK) を signal に詰める。
 * - 5xx / network → `error` にメッセージを詰めて throw する。呼び出し側は catch して toast 等。
 *
 * **冪等性**: 同時に複数回呼ばれても最後の結果が反映される (= 単純な race の許容)。
 *   重要な競合 (= old request が new を上書き) を厳密に防ぐ場合は AbortController を導入する。
 */
export const refreshMySpecimens = async (): Promise<SpecimenView[] | null> => {
  setIsLoading(true);
  setError(null);
  try {
    const list = await fetchMySpecimens();
    setSpecimens(list);
    return list;
  } catch (e) {
    if (e instanceof SduiFetchError && e.status === 401) {
      // anonymous: signal を null に戻す。toast や error 表示は出さない。
      setSpecimens(null);
      return null;
    }
    const msg = e instanceof Error ? e.message : String(e);
    setError(msg);
    throw e;
  } finally {
    setIsLoading(false);
  }
};

/** create / archive 等のあとに呼べる軽量ヘルパ。fire-and-forget で再 fetch する。
 *  失敗してもログだけ吐いて握り潰す (= UI フローを止めない)。 */
export const triggerSpecimensRefresh = (): void => {
  refreshMySpecimens().catch((e) => {
    // refreshMySpecimens 内で error signal に詰めているのでログのみ。
    // eslint-disable-next-line no-console
    console.warn("triggerSpecimensRefresh failed:", e);
  });
};

/** ログアウト等で signal を anonymous に戻す。fetch は走らせない。 */
export const clearServerSpecimens = (): void => {
  setSpecimens(null);
  setError(null);
};

/** テスト専用: signal をリセット。 */
export const resetServerSpecimensForTest = (): void => {
  setSpecimens(null);
  setIsLoading(false);
  setError(null);
};
