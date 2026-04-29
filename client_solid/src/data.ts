// data.ts — UI shape contracts (= 旧 mock-data 集約 → types-only に縮約)
//
// **PR-7/-8 後の現状**:
//   - 全 mock 実データ削除済 (`APP_DATA` / `interface AppData` は廃止)
//   - 残存しているのは UI shape interfaces (= adapter 層での正規化先 / API 契約)
//   - listings を含む全ドメインが server 駆動 (= store/* の cache 経由)
//   - `RouteKey` だけは router config 由来で残置 (= router.ts 隣に置いても良いが
//     26 file の import path を変える価値が薄いため現位置維持)
//
// **次の整理候補**:
//   - shape interfaces を `types/index.ts` に移動して `data.ts` を削除
//     (= 26 file の import path 書換が必要なので別 PR スコープ)
//   - OpenAPI 完全化後は generated/ の型に置換

export type RouteKey =
  | "mypage"
  | "products"
  | "product-detail"
  | "specimen"
  | "log"
  | "eclosion"
  | "bloodline"
  | "shop"
  | "market"
  // Phase 9.1 (Strangler Fig 段階 2 完了): "cart" は SDUI 駆動の CartSduiPage に統一。
  //   旧 "cart-sdui" route は削除済み。/cart-sdui へのアクセスは router で /cart に正規化。
  | "cart"
  | "warranty"
  // Phase 9.G: login / register UI を表示する route
  | "login"
  // Phase 9.G: 自分の注文履歴一覧 (= GET /api/v1/orders/me)
  | "orders"
  // Phase 9.G: 1 注文の詳細ページ (= GET /api/v1/orders/{id} で line_items 込み)
  | "order-detail"
  // どの URL にもマッチしない時に使う擬似ルート (画面側で 404 を表示する)
  | "not-found";

/** P4-2: 個体のライフ状態。生存 / 故個体 / 譲渡済 / 脱走 の 4 値。
 *  旧 `status: "alive"` より意味が厳密で、StageBar 横の終了バッジに直接使える。 */
export type LifeStatus = "active" | "deceased" | "transferred" | "escaped";

/** P4-2: 終了理由のメタ情報 (lifeStatus !== "active" のときに表示) */
export interface LifeStatusDetail {
  /** 発生日 (ISO) */
  date: string;
  /** 備考 (死因 / 譲渡先 / 脱走状況 など) */
  note?: string;
}

export interface Specimen {
  id: string;
  name: string;
  species: string;
  sci: string;
  sex: string;
  stage: string;
  stageProgress: number;
  sizeMm: number;
  weightG: number;
  birthDate: string;
  purchasedAt: string;
  shop: string;
  generation: string;
  price: number;
  eclosionETA: string | null;
  eclosionInDays: number | null;
  /** @deprecated 旧 "alive" 表示。新コードは lifeStatus を使うこと */
  status: string;
  /** P4-2: 生存 / 故 / 譲渡 / 脱走。未設定は "active" とみなす */
  lifeStatus?: LifeStatus;
  lifeStatusDetail?: LifeStatusDetail;
  bloodline: { father: string; mother: string };
  notes?: string;
}

export interface Product {
  id: string;
  kind: "生体" | "用品";
  title: string;
  sci: string | null;
  price: number;
  badge: string;
  generation: string | null;
  shop: string;
  tone: "forest" | "amber";
  phLabel: string;
}

export type LogType = "weight" | "feed" | "mat" | "molt" | "observation";

export interface LogEntry {
  date: string;
  time: string;
  type: LogType;
  title: string;
  body: string;
  photo: boolean;
  specimen: string;
}

export interface Listing {
  id: string;
  title: string;
  seller: string;
  price: number;
  bids: number | null;
  watchers: number;
  endsIn: string;
  auction: boolean;
  verified: boolean;
}

