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

import type { LifeStatus, Specimen } from "../data";
import {
  type SpecimenView,
  SduiFetchError,
  fetchMySpecimens,
} from "../sdui/api";
import { findSpeciesById } from "./species";

const [specimens, setSpecimens] = createSignal<SpecimenView[] | null>(null);
const [isLoading, setIsLoading] = createSignal<boolean>(false);
const [error, setError] = createSignal<string | null>(null);

/** login user の所有個体 (= GET /specimens/me の結果)。`null` = まだ取得していない / anonymous。 */
export const serverSpecimens = specimens;

/** `refreshMySpecimens()` の進行中フラグ。double-invoke による flicker を防ぐのに使う。 */
export const isSpecimensLoading = isLoading;

/** 5xx / network 等の取得失敗メッセージ。401 は静かに null にするのでここには載らない。 */
export const serverSpecimensError = error;

// ──────────────────────────────────────────────────────────────────────
// SpecimenView → legacy Specimen 正規化 (= PR #5a / api/specimens.ts 側で使う)
// ──────────────────────────────────────────────────────────────────────
//
// 旧 `data.ts::Specimen` と新 server `SpecimenView` で 9 フィールド差分があるため、
// 正規化レイヤで埋めて legacy 互換 shape を提供する。
// 不足分のデフォルト値:
//   - sci / species_name      → species cache から speciesId で引く / 不在は speciesId
//   - shop                    → "ANCHOR BEETLE CO." 固定 (= MVP は 1 ショップ)
//   - price                   → 0 (= server に purchase_price_jpy は持つが現状 API 未公開)
//   - bloodline               → { father: "野生", mother: "野生" } (= server father_id 等は別経路)
//   - lifeStatusDetail        → undefined (= server 別 endpoint で履歴を引く設計)
//   - eclosionInDays          → eclosionEta - today (= client 計算)
//   - notes                   → "" (= localStorage memo は api/specimens.ts 側で別途 merge)

const SEX_SYMBOL: Record<string, string> = {
  male: "♂",
  female: "♀",
  unknown: "?",
};

const SHOP_NAME_FALLBACK = "ANCHOR BEETLE CO.";

/** ISO 日付文字列 ("2026-05-04") から **今日からの日数** を計算。
 *  null / 不正値は null を返す。負値 (= 過去) は計算上ありうる (= 羽化遅延等)。 */
const computeEclosionInDays = (eta: string | null): number | null => {
  if (!eta) return null;
  const etaDate = new Date(eta);
  if (Number.isNaN(etaDate.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = etaDate.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
};

/** `SpecimenView` (server) を legacy `Specimen` (data.ts) shape に正規化する。
 *  - 種名 / 学名は species cache から speciesId で引く
 *  - 不足フィールドは defaults で埋める (= 上のコメント参照)
 *  - 個体メモ (notes) は server 値をそのまま使う (PR #5b で localStorage 廃止) */
export const normalizeSpecimenForLegacy = (v: SpecimenView): Specimen => {
  const species = findSpeciesById(v.speciesId);
  const lifeStatus = (v.lifeStatus as LifeStatus | undefined) ?? "active";
  return {
    id: v.publicId,
    name: v.name,
    species: species?.name ?? v.speciesId,
    sci: species?.sciName ?? "",
    sex: SEX_SYMBOL[v.sex] ?? v.sex,
    stage: v.stage,
    stageProgress: v.stageProgress,
    sizeMm: v.sizeMm ?? 0,
    weightG: v.weightG ?? 0,
    birthDate: v.birthDate ?? "",
    purchasedAt: v.purchasedAt ?? "",
    shop: SHOP_NAME_FALLBACK,
    generation: v.generation ?? "",
    price: 0,
    eclosionETA: v.eclosionEta ?? null,
    eclosionInDays: computeEclosionInDays(v.eclosionEta ?? null),
    status: lifeStatus === "active" ? "alive" : lifeStatus,
    lifeStatus,
    lifeStatusDetail: undefined,
    bloodline: { father: "野生", mother: "野生" },
    notes: v.notes ?? "",
  };
};

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

/** テスト専用: signal にフィクスチャを直接セットする。
 *  /specimens/me を fetch したくない unit test (= api.test.ts) で使う。 */
export const setServerSpecimensForTest = (list: SpecimenView[] | null): void => {
  setSpecimens(list);
};
