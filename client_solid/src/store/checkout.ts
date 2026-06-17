// store/checkout.ts — チェックアウト用の配送先フォーム state
//
// P2-4: Cart の住所フォームを DOM-only → signal ベースに。
//   - 入力が実際に反映される (useEffect/onInput が走る)
//   - localStorage に保存して再入力を不要にする (PII なので注意: 明示オプトアウトは
//     後のフェーズで追加予定)
//   - 都道府県も signal で、select の値として取り扱う
import { createSignal, createEffect, createRoot } from "solid-js";

export interface ShippingAddress {
  name: string;
  tel: string;
  zip: string;
  pref: string;
  addr: string;
}

/** 日本の都道府県 (select の選択肢) — よく使われる並び順 */
export const PREFECTURES: readonly string[] = [
  "北海道",
  "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県",
  "沖縄県",
] as const;

const STORAGE_KEY = "kochu:shipping";

const defaultAddress: ShippingAddress = {
  name: "山田 徹",
  tel: "080-0000-0000",
  zip: "150-0001",
  pref: "東京都",
  addr: "渋谷区神宮前...",
};

const readInitial = (): ShippingAddress => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultAddress;
    const parsed = JSON.parse(raw) as Partial<ShippingAddress>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : defaultAddress.name,
      tel: typeof parsed.tel === "string" ? parsed.tel : defaultAddress.tel,
      zip: typeof parsed.zip === "string" ? parsed.zip : defaultAddress.zip,
      pref: typeof parsed.pref === "string" ? parsed.pref : defaultAddress.pref,
      addr: typeof parsed.addr === "string" ? parsed.addr : defaultAddress.addr,
    };
  } catch {
    return defaultAddress;
  }
};

const initial = readInitial();

export const [shippingName, setShippingName] = createSignal(initial.name);
export const [shippingTel, setShippingTel] = createSignal(initial.tel);
export const [shippingZip, setShippingZip] = createSignal(initial.zip);
export const [shippingPref, setShippingPref] = createSignal(initial.pref);
export const [shippingAddr, setShippingAddr] = createSignal(initial.addr);

// 全体を一度に取り出すヘルパ
export const shippingAddress = (): ShippingAddress => ({
  name: shippingName(),
  tel: shippingTel(),
  zip: shippingZip(),
  pref: shippingPref(),
  addr: shippingAddr(),
});

// localStorage へ永続化 (各フィールドに effect をかけると書き込み頻度が高いので
// 1 つの effect でまとめて書き込む)。
// モジュールスコープの createEffect は "computations created outside createRoot"
// 警告を出すため createRoot でラップ。アプリのライフタイム内で存続させる。
createRoot(() => {
  createEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shippingAddress()));
    } catch {
      /* quota / private mode は無視 */
    }
  });
});

/** テスト用リセット */
export const resetShipping = () => {
  setShippingName(defaultAddress.name);
  setShippingTel(defaultAddress.tel);
  setShippingZip(defaultAddress.zip);
  setShippingPref(defaultAddress.pref);
  setShippingAddr(defaultAddress.addr);
};

/**
 * logout / アカウント切替時に PII (= name / tel / zip / pref / addr) を
 * 完全に消すための明示的クリア。
 *
 * 共有端末で別 user が login した時に前 user の住所が prefill されないよう、
 * `localStorage` キー (`kochu:shipping`) を物理削除し、メモリ上の signal も
 * 既定値に戻す。auth flow の logout 完了時に呼ぶこと。
 *
 * 失敗 (= QuotaExceededError 等) は握りつぶす (永続化は best-effort)。
 */
export const clearShippingPersistence = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / quota は無視 */
  }
  resetShipping();
};

/** 入力が完全に揃っているか (空白だけの値は不足とみなす) */
export const isShippingComplete = (): boolean => {
  const a = shippingAddress();
  return Object.values(a).every((v) => v.trim().length > 0);
};
