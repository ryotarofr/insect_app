// store/listingDraft.ts — 出品 Wizard の入力ドラフトを localStorage に永続化する。
//
// **目的**:
//   ユーザが出品 Wizard 入力中にタブを閉じたり別画面に遷移しても、
//   次回開いた時に途中入力を復元する (= 離脱時の入力消失を防ぐ)。
//
// **スコープ (= MVP / A 案)**:
//   - 1 端末 / 1 ドラフトのみ。複数デバイス間の同期は対象外 (= 将来 B 案で DB 化)。
//   - 復元は picked / mode / desc / 価格 / 配送方法 / photos まで含む。
//     photos は server 側 asset を参照 (= asset GC されると <img> が 404 する可能性あるが
//     MVP ではそのまま許容、ユーザは再アップロードで対応)。
//
// **Schema 互換性**:
//   - localStorage キーに `:v1` の suffix を付け、将来フィールドを追加した時に
//     旧版ドラフトを安全に無効化できるようにする (= キー変更で古いものは silently 破棄)。
//   - 復元時は型を runtime で軽く検証し、壊れていれば null 返却 (= 破棄相当)。

const STORAGE_KEY = "kochu:listing-draft:v1";

export type SellMode = "auction" | "fixed";
export type WizardStep = 1 | 2 | 3 | 4;
export type DurationDays = 3 | 5 | 7;

export type ListingDraftPhoto = {
  assetId: string;
  publicUrl: string;
};

export type ListingDraft = {
  step: WizardStep;
  picked: string | null;
  mode: SellMode;
  desc: string;
  descEdited: boolean;
  priceJpy: number;
  buyoutPrice: number | null;
  durationDays: DurationDays;
  /** Set<string> は JSON 化できないので配列で保存。読み出し側で Set に戻す。 */
  shippingMethodIds: string[];
  photos: ListingDraftPhoto[];
  /** 保存タイムスタンプ (= 古すぎるドラフトは UI 側で破棄判断する余地を残す)。 */
  savedAt: number;
};

const isWizardStep = (v: unknown): v is WizardStep =>
  v === 1 || v === 2 || v === 3 || v === 4;
const isSellMode = (v: unknown): v is SellMode =>
  v === "auction" || v === "fixed";
const isDurationDays = (v: unknown): v is DurationDays =>
  v === 3 || v === 5 || v === 7;

/**
 * localStorage からドラフトを読み出す。壊れていれば null。
 *
 * 復元失敗時は throw せず null を返し、呼び出し側はフレッシュ初期値を採用する
 * (= 「読み込めなかったから何もできません」という UX を避ける)。
 */
export const loadListingDraft = (): ListingDraft | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null) return null;

    const o = obj as Record<string, unknown>;
    if (!isWizardStep(o.step)) return null;
    if (!isSellMode(o.mode)) return null;
    if (!isDurationDays(o.durationDays)) return null;
    if (typeof o.priceJpy !== "number") return null;
    if (typeof o.desc !== "string") return null;

    const photos = Array.isArray(o.photos)
      ? o.photos.filter(
          (p): p is ListingDraftPhoto =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as ListingDraftPhoto).assetId === "string" &&
            typeof (p as ListingDraftPhoto).publicUrl === "string",
        )
      : [];

    const shippingMethodIds = Array.isArray(o.shippingMethodIds)
      ? o.shippingMethodIds.filter((s): s is string => typeof s === "string")
      : [];

    return {
      step: o.step,
      picked: typeof o.picked === "string" ? o.picked : null,
      mode: o.mode,
      desc: o.desc,
      descEdited: o.descEdited === true,
      priceJpy: o.priceJpy,
      buyoutPrice:
        typeof o.buyoutPrice === "number" ? o.buyoutPrice : null,
      durationDays: o.durationDays,
      shippingMethodIds,
      photos,
      savedAt: typeof o.savedAt === "number" ? o.savedAt : 0,
    };
  } catch {
    return null;
  }
};

/** ドラフトを localStorage に保存。quota 超過などは silent に無視。 */
export const saveListingDraft = (d: ListingDraft): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* quota / private mode は無視 — 次回保存で再試行されるため致命的ではない */
  }
};

/** ドラフトを破棄 (= submit 成功時 / ユーザの明示的な discard 操作時)。 */
export const clearListingDraft = (): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

/** ドラフトが現在保存されているかを返す (= バナー表示判定用)。 */
export const hasListingDraft = (): boolean => loadListingDraft() !== null;
