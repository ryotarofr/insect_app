# SDUI 三層モデル 設計方針 v6

> KOCHU のカード／セクション／ページシェルを動的にデータ駆動で表示するための、Server-Driven UI (SDUI) スキーマ設計。
>
> v5 で確立した三層モデル (Region → Block → Role) を維持したまま、Phase 2 (詳細ページ) / Phase 2.5 (CtaAction) / Phase 3 (Analytics ingest) / Phase 4 (Filter) / Phase 5 (Sort + faceted count) / Phase 6 (Pagination + Search) / Phase 7 (Cart) / Phase 8 (Checkout / Shipping) で実装した拡張を反映した版。
>
> 設計原則は v5 から不変。型定義・テンプレート定義・バリデーション規約・命名規則・i18n 規約は **Rust 側 `server/src/sdui/` を Source of Truth** として、ts-rs 経由で `client_solid/src/generated/sdui.ts` に生成し、`client_solid/src/sdui/branded.ts` で branded 型に持ち上げる二段防御を継続する。

## 0. v5 からの変更点 (Changelog)

実装が先行し、v5 では「Phase 1 (product_feature) のみ」「Block は 9 種類」だった範囲が、Phase 2-8 で大幅に拡張された。本章は v6 で追加・確定した契約だけを表に集約する。各項の詳細は本文の対応節を参照。

| Phase | 追加 / 変更 | 反映節 |
|---|---|---|
| 2 | `CardBlock::ProductDetail` テンプレート追加。`ProductDetailRegions` (gallery / hero / spec / pricing / cta / promise) を新設 | §4.5, §5.7 |
| 2 | `ProductDetailVariant` enum 追加 (`Default` のみ。将来「ペア販売」等を予約) | §4.5 |
| 2 | `ProductDetailRegions.promise` region 追加。安心保証カードを独立区画で表現 | §5.7 |
| 2.5 | `Block::Cta.action: Option<CtaAction>` 追加。href 経由の遷移と server 反映アクションを共存 | §4.2, §11.6 |
| 2.5 | `CtaAction` enum 追加 (`AddToCart { product_id, qty }` / `ToggleWatch { product_id }`) | §11.6 |
| 2.5 | カート / ウォッチ用 endpoint: `POST /cart` / `DELETE /cart/items/{token}` / `POST /watch/{product_id}` | §15.1 |
| 3 | `AnalyticsEvent` / `AnalyticsEventType` (`impression` / `click`) / `AnalyticsEventBatch` 追加 | §11.2 |
| 3 | Analytics ingest endpoint: `POST /events` (batch) / `GET /events?limit=N` (debug) | §11.7, §15.1 |
| 4 | `ProductListResponse` shell 追加 (一覧ページ全体を CardBlock より一段上の構造で表現) | §5.6 |
| 4 | `FilterBar` / `FilterGroup` / `FilterChipItem` 追加。toggle URL は **server が必ず返す** | §5.6.1 |
| 5 | `SortBar` / `SortOption` 追加 (single-select)。filter / search / sort / paginate の **連鎖順序** を §5.6.4 に明示 | §5.6.2, §5.6.4 |
| 5 | `FilterChipItem.count: Option<u32>` 追加 (faceted count = 「他軸を維持し、この chip に切り替えたら何件か」) | §5.6.1 |
| 6 | `Pagination` / `PageLink` (`Page` / `Ellipsis` の tag union) 追加。range collapse は server に集約 | §5.6.3 |
| 6 | `SearchBox` 追加。`submit_href` は q を抜いた base URL (= JS 無し fallback の form action) | §5.6.3 |
| 7 | `CardBlock::Cart` テンプレート追加。`CartRegions` (header / items / shipping / shipping_method / summary / cta) と `CartVariant` を新設 | §4.5, §5.8 |
| 7 | Block 追加: `LineItem` (1 行 = 1 商品の "fat block") / `OrderSummary` (合計行) | §4.2, §5.8 |
| 7 | `LineItemAction` enum 追加 (`SetQty { token, qty }` / `Remove { token }`)。`CtaAction` とは **別 enum** で関心を分離 | §11.6 |
| 7 | カート操作 endpoint: `GET /cards/cart` (snapshot) / `PATCH /cart/items/{token}` (qty 直接書き換え) | §15.1 |
| 8 | Block 追加: `FormField` (= 1 入力フィールド) / `ShippingMethodPicker` (= radio group) | §4.2, §5.8.2 |
| 8 | `FormFieldKind` enum 追加 (`Text` / `Tel` / `PostalCode` / `Select { options }`)。**discriminator は `inputType`** (親 `kind: FormFieldKind` フィールド名との衝突回避) | §4.2.1 |
| 8 | `SelectOption` (id + label) / `ShippingMethodOption` (id + name + description + amount + currency) 追加 | §4.2.1 |
| 8 | `CheckoutFieldAction::PatchField { field_name }` / `CheckoutMethodAction::PatchMethod` 追加。`LineItemAction` と同じ「自包含 action」設計を踏襲 | §11.6 |
| 8 | `CartRegions` を `shipping` / `shipping_method` で拡張 | §5.8 |
| 8 | チェックアウト endpoint: `PATCH /checkout/shipping_field/{name}` / `PATCH /checkout/shipping_method` / `GET /checkout` (debug snapshot) | §15.1 |
| 規約 | `Block` union が 9 → 13 variant、`CardBlock` が 1 → 3 template に拡張。命名規則・key 一意性検証・branded 型レイヤは **そのまま全 variant に適用** | §4.2, §4.5, §7.6 |
| 規約 | discriminator 名衝突回避ルールを §4.2.1 に明文化 (FormFieldKind の `inputType` を例として) | §4.2.1 |
| 規約 | server-driven state pattern を §11.8 に明文化: client は server 値を信用し、mutation 後は **常に再 fetch** で UI を反映する。Cart の qty / Checkout のフォーム値はいずれもこの規律で動く | §11.8 |
| 規約 | `Block` 共通の `key` フィールドを抽象化する `Block::key()` / `Block::iter_item_keys()` を Rust に追加。`ValidateKeys` 全 variant 対応 | §7.6 |
| 規約 | `i64` 金額フィールドは ts-rs に対し **`#[ts(type = "number")]`** で明示的に倒す (BigInt にしない) ことを §4.2.2 で確定 | §4.2.2 |

⚠️ **client_solid/src/ の Phase 2-8 ファイル群が disk 上で truncate しており実体を喪失している** (v6 末尾の §19 「現状とリカバリ」を参照)。本ドキュメントは **Rust 側 + bindings + 仕様書** から **client 側を再実装するための仕様レファレンス** としても機能する。

### 0.1 v6 期間中に採用したレビュー指摘 (= Phase 9 着手前に反映)

レビュー → メタレビューを経て採用された指摘を、**v7 を起こさず v6 への差分修正で吸収**する。修正計画の詳細は `docs/sdui-v6-revision-plan.md` を参照。

| # | 指摘 | 反映先 | 目的 |
|---|---|---|---|
| 1 | server-driven state の race condition / フォーカス保持 | §11.8 末尾 | input 中の値巻き戻し / PATCH 逆順到着の防止 |
| 4 | i18n キー網羅 CI | §13.5 (新設) | 本番で空文字フォールバックが起きないことを CI で保証 |
| 5 | headline 不変条件の Rust 側検証 | §5.2 + §7.7 (新設) | a11y の最低保証を deserialize 後にコード化 |
| 6 | AnalyticsEvent の clock skew | §11.2 表 | サーバ受信時刻 (`serverReceivedAtMs`) を真実値に格上げ |
| 8 | `deny_unknown_fields` と未知 type fallback の意味論 | §10.1 冒頭 | client fallback を「型生成パイプラインの遷移期保険」と性格付け |
| 3 (部分) | 多通貨対応の脚注 | §4.2.2 / §17 | 多通貨化時の minor unit 統一を予告 |
| 10 (部分) | `value:""` 規約 / `Vary` / B2B 兆超え | §5.8.2 / §14.3 / §4.2.2 | 個別の運用上の罠を明文化 |
| 逆 §4.1 | a11y × race の交差 | §10.5 (新設) | aria-live / focus 保持を a11y 最低保証として規定 |
| 逆 §4.2 | CDN キャッシュ毒の path 物理遮断 | §14.5 (新設) | `Cache-Control: no-store` を最後の防壁に降格 |
| 逆 §4.3 | property-based test 導入 | §13.6 (新設) | ts-rs + schemars 二重生成パイプラインの保証層 |
| 逆 §4.4 | cart cross-tab 同期 | §11.8 末尾 | `BroadcastChannel` で再 fetch 通知 (push の前段) |

### 0.2 却下したレビュー指摘 (= 判断ログ)

将来の再議論時の出発点として、却下理由を明示的に残す。

| # | 指摘 | 判断 | 理由 |
|---|---|---|---|
| 7 | `SearchBox.paramName` を YAGNI として削除 | **却下** | `paramName` は「URL shape の所有権を server に置く」という SDUI 中核思想を体現する。削ると client が URL 文字列を組む例外が発生してフレームワーク一貫性を毀損する。§2 設計原則 12 (= 予約された未使用機能の禁止) は「現在まさに使われている設定値」には適用されない。 |
| 9 | テンプレートバージョニング `__v2` の段階移行ロジック詳細化 | **却下 (= 1 行追記のみ)** | v2 採用の現実的トリガは Phase 9+ で初めて観測される見込み。いま詳細を書くと「使われない設計」になり §2 設計原則 12 に抵触する。§17 Future Work に「並走期間の switch 戦略は v2 採用時に詰める」と一行のみ追記して判断時期を遅延。 |
| 3 (主張部分) | `amount` を最初から minor unit に統一 | **却下 (= 脚注のみ採用)** | JPY 単独運用中に minor unit に倒すと、`amount` が「円そのもの」と一致する自明な恩恵を捨てることになる。多通貨化時に破壊的変更を行う方針を §4.2.2 / §17 に脚注追加するに留める。 |

## 1. 目的

ヒーロー、商品ハイライト、約束カード、商品詳細、商品一覧、カート、チェックアウトなどの UI を **DB 駆動 / API 駆動** で出し分けたい。一方で **デザインシステム・アクセシビリティ・パフォーマンス** は壊したくない。将来的に、運営／ブリーダーが管理画面から内容を編集できる土台、Stripe など外部サービスとの段階的接続、A/B テスト基盤の活用、を一気通貫で支える。

「データを動的に」「スタイルは破綻させない」を両立させるために、**レイアウトはコード／コンテンツは API/DB** という分離を、三層の抽象で表現する。Phase 2-8 の追加機能 (詳細 / カート / チェックアウト / 一覧シェル / 計測) もすべてこの分離原則に従って設計してある。

## 2. 設計原則

v5 と同じ。Phase 4 以降の追加機能はすべて以下の原則に従って設計済み。

1. **位置情報そのものを DB に持たせない**。座標・余白・レスポンシブ規則はすべてコード側 (TSX) の責務。
2. **DB が決めるのは「どのテンプレートを使うか」「各リージョンに何を入れるか」だけ**。
3. **語彙は閉じた enum で統制**する。新規追加は設計レビューを通す。`role` / `kind` / `intent` のように外見が string 型に見えるフィールドも、必ず enum で閉じる。
4. **多重度 (同じ役割の繰り返し) は配列で表現**する。`primaryCta` / `secondaryCta` のような ad-hoc 命名は禁止。
5. **フロント・バックで型定義を共有**し、CI で網羅性を保証する。**Rust が source of truth**。
6. **未知のテンプレート・ブロックは安全に縮退**する fallback を必ず実装する。
7. **a11y を壊し得るプロパティはデータ側に持たせない**。見出しレベル・読み順・タブ順序はテンプレートが決定する。
8. **計測 ID は最初から仕込む**。`analyticsId` / `experiment` は optional でも Phase 1 から含める。
9. **静的 UI コピーは i18n キー、動的データ値は raw 文字列**。両者は `Localizable` タグ付き union で型レベルに分離する。
10. **すべての文字列値は textContent としてのみ描画**。innerHTML / dangerouslySetInnerHTML は禁止。
11. **`block.key` 等の識別子は同一カード内で一意**。並び替え時の再マウントと計測識別子の整合の両方に効く。
12. **存在しないものは予約しない**。enum / 型の variant は「いま使う」ものだけを定義し、将来予定は §17 Future Work に書く。
13. **server-driven state**: mutation を伴う UI (Cart の qty / Checkout のフォーム値) は **client にローカル state を握らせない**。mutation endpoint を呼んだ後は、server から該当カードを再 fetch して UI に反映する。これにより「クライアント表示」と「サーバ真実」が永久にズレない。

## 3. 三層モデル

(v5 と同じ) Region → Block → Role の三層は変わらず。Phase 2-8 の拡張は **新しい Block variant の追加 / 新しい Template の追加 / 新しい Region の追加** で吸収しており、層構造そのものには手を入れていない。

> **命名注意**: `headline` という単語は本ドキュメント中で **2 つの異なる層** で使われる:
> - **Region 名としての `headline`** — カード内の主見出しを置く論理的な場所
> - **Text role としての `headline`** — テキストブロックの意味的サブ分類 (主見出し)
>
> 文脈で区別する。region 名で参照する場合は「`headline` リージョン」、role の場合は「role:headline」と書き分ける。

| 層 | 役割 | 個数 | 実体 |
|---|---|---|---|
| **Region (リージョン)** | カード内の論理的な「場所」。テンプレートが定義する | 数個に固定 | テンプレートごとの専用 struct |
| **Block (ブロック)** | リージョン内に並ぶ要素。型を持つ | 各リージョン 0..N | Array |
| **Role (ロール)** | ブロック型の中での意味的サブ分類 | ブロックの属性 | enum |

### 3.1 Region (リージョン)

カード横断で共通の論理的配置場所。テンプレートが「どのリージョンを持ち、それをどう描画するか」を決める。**Rust 側ではテンプレートごとに専用の struct で定義する** ため、テンプレートが許容しないリージョン名は deserialize で reject される (§7.3)。

標準セット (v5 まで):

- `header` — 上部の冒頭要素 (eyebrow、バッジなど)
- `media` — 画像／動画／アイコン
- `meta` — ID、ショップ名、コードなどの補助情報行
- `headline` — 主見出し領域
- `body` — 本文／副見出し
- `actions` — CTA、リンク
- `footer` — 価格、補助メタ、予測バナー

Phase 2-8 で追加された **テンプレート専用リージョン** (§5 で詳述):

- `gallery` / `hero` / `spec` / `pricing` / `cta` / `promise` — `product_detail` 専用
- `items` / `shipping` / `shipping_method` / `summary` — `cart` 専用 (Phase 7 + 8)

### 3.2 Block (ブロック)

リージョンに入る配列要素。`type` で識別される閉じた enum。

**v6 時点の全 13 variant** (Rust enum `Block`):

| Variant (snake_case JSON) | 用途 | 導入 |
|---|---|---|
| `text` | テキスト全般 (ロールでさらに分類) | Phase 1 |
| `cta` | ボタン／リンク (intent + 任意の action) | Phase 1 (action は Phase 2.5) |
| `media` | 画像／動画／アイコン (kind で分類) | Phase 1 |
| `badge` | 状態バッジ (role で status/evidence/warning/promo) | Phase 1 |
| `metric_list` | 数値ラベル群 (累計カルテ 12,480 件 など) | Phase 1 |
| `meta_line` | ID／ショップ名／コードなど 1 行のメタ情報 | Phase 1 |
| `price` | 価格表示専用ブロック | Phase 1 |
| `eclosion_forecast` | 羽化予測バナー (羽化に特化したドメイン型) | Phase 1 |
| `divider` | 区切り線 | Phase 1 |
| `line_item` | カート 1 行 = 1 商品 (画像+名前+単価+qty+小計+/-+削除) | Phase 7 |
| `order_summary` | カート集計行 (subtotal / shipping / tax / total) | Phase 7 |
| `form_field` | チェックアウトの 1 入力フィールド (label + input + validationError) | Phase 8 |
| `shipping_method_picker` | 配送方法ピッカー (radio group) | Phase 8 |

**Note**: `filter_chip` / `filter_bar` / `sort_bar` / `pagination` / `search_box` は `Block` の variant ではなく、**ページシェル `ProductListResponse`** の構成要素として独立した struct で持つ (§5.6)。理由は「カード内のブロック」ではなく「ページ全体のシェル UI」だから。

### 3.3 Role (ロール)

ブロックの `type` ごとに **異なる closed enum** を持つ。v5 から不変。

#### `text` のロール

| ロール | 用途 | 既定の HTML タグ ※ |
|---|---|---|
| `eyebrow` | 主見出しの上に置く小さなラベル | `<p class="eyebrow">` |
| `headline` | 主見出し | テンプレート依存 (h1〜h3) |
| `subhead` | 副見出し | `<p class="subhead">` |
| `lead` | 本文より太めのリード文 | `<p class="lead">` |
| `body` | 本文 | `<p>` |
| `caption` | 補助テキスト | `<figcaption>` |
| `byline` | 出典・著者 | `<p class="byline">` |

> ※ **見出しレベル (h1-h6) はデータに含めない**。`role: headline` のときの具体的な h レベルは、テンプレート × リージョン位置で決定する (§5 のテンプレート定義表で明示)。

#### その他ロール

- `cta` の intent: `primary` / `secondary` / `tertiary` / `destructive`
- `media` の kind: `image` / `video` / `icon` / `placeholder`
- `badge` の role: `status` / `evidence` / `warning` / `promo`
- `meta_line.items[]` の role: `id` / `shop` / `code` / `lot` / `breeder`

> 必要に応じて追加するが、**必ず enum を閉じる**。`role: string` は禁止。

## 4. スキーマ全体形

### 4.1 共通の値オブジェクト

```typescript
// shared/types — Rust から ts-rs で生成される (§7 参照)
// 手書きで編集しないこと

export type RegionName =
  | "header" | "media" | "meta" | "headline"
  | "body" | "actions" | "footer";

// Block.type の総覧 (v6 時点)
export type BlockType =
  | "text" | "cta" | "media" | "badge"
  | "metric_list" | "meta_line"
  | "price" | "eclosion_forecast" | "divider"
  | "line_item" | "order_summary"            // Phase 7
  | "form_field" | "shipping_method_picker"; // Phase 8

export type TextRole =
  | "eyebrow" | "headline" | "subhead"
  | "lead" | "body" | "caption" | "byline";

export type CtaIntent         = "primary" | "secondary" | "tertiary" | "destructive";
export type MediaKind         = "image" | "video" | "icon" | "placeholder";
export type BadgeRole         = "status" | "evidence" | "warning" | "promo";
export type MetaLineItemRole  = "id" | "shop" | "code" | "lot" | "breeder";

/** 当面 JPY のみ運用。多通貨対応は §17 Future Work で variant 追加 */
export type Currency = "JPY";

// ── ブランド型 (フロント側で branded.ts により強化される §7.5) ──
export type Href    = string & { readonly __brand: "Href" };
export type I18nKey = string & { readonly __brand: "I18nKey" };

// ── Localizable: 静的 i18n と動的 raw を型レベルで分離 ──
// params の値は Rust 側 ParamValue (= String | i64) の untagged union。
// TS では Record<string, ParamValue> として bindings/ParamValue.ts に出る
// (= string | bigint だが、§4.2.2 と同じく実運用は number 想定 / 無理に bigint にしない)。
export type Localizable =
  | { source: "i18n"; key: I18nKey;
      params?: Record<string, string | number> }   // = Record<string, ParamValue>
  | { source: "raw";  text: string };
```

### 4.2 ブロック (v6 全 13 variant)

> **`key: string` の制約**: 全 variant 共通で **空文字不可 / カード内一意**。型レベルでは `string` のままだが、Rust 側 `validate_keys()` (§7.6) が deserialize 後に空文字 / 重複を 400 で reject する。詳細は §4.3 / §7.6。

```typescript
export type Block =
  // ── Phase 1 (基本 9 種) ──────────────────────────────────────
  | { key: string; type: "text";        role: TextRole; content: Localizable;
      analyticsId?: string }
  | { key: string; type: "cta";         intent: CtaIntent; label: Localizable; href: Href;
      action?: CtaAction;                                       // Phase 2.5
      analyticsId?: string }
  | { key: string; type: "media";       kind: MediaKind;
      src?: string; alt?: Localizable; iconName?: string;
      analyticsId?: string }
  | { key: string; type: "badge";       role: BadgeRole; label: Localizable;
      analyticsId?: string }
  | { key: string; type: "metric_list";
      items: { key: string; label: Localizable; value: Localizable }[];
      analyticsId?: string }
  | { key: string; type: "meta_line";
      items: { key: string; role: MetaLineItemRole; value: string;
               align?: MetaItemAlign /* = "start" | "end" */ }[];
      analyticsId?: string }
  | { key: string; type: "price";       amount: number; currency: Currency; taxIncluded: boolean;
      analyticsId?: string }
  | { key: string; type: "eclosion_forecast";
      daysAhead: number; date: string; tolerance: number;
      analyticsId?: string }
  | { key: string; type: "divider" }
  // ── Phase 7 (cart 専用 fat block) ────────────────────────────
  | { key: string; type: "line_item";
      productId: string; title: Localizable;
      imageSrc?: string; imageAlt?: Localizable;
      unitPriceAmount: number; currency: Currency;
      qty: number; subtotalAmount: number;
      detailHref: Href;
      decrementAction?: LineItemAction;     // qty=1 の時は None (= disabled)
      incrementAction:  LineItemAction;     // 常に Some
      removeAction:     LineItemAction;
      analyticsId?: string }
  | { key: string; type: "order_summary";
      lineCount: number; totalQty: number;
      subtotalAmount: number;
      shippingAmount?: number; taxAmount?: number;
      totalAmount: number; currency: Currency;
      analyticsId?: string }
  // ── Phase 8 (checkout 専用) ──────────────────────────────────
  | { key: string; type: "form_field";
      name: string;                         // PATCH path に乗る field 識別子
      label: Localizable; value?: string; required: boolean;
      autocomplete?: string; placeholder?: Localizable;
      validationError?: Localizable;
      kind: FormFieldKind;                  // discriminator は inputType (§4.2.1)
      patchAction: CheckoutFieldAction;
      analyticsId?: string }
  | { key: string; type: "shipping_method_picker";
      options: ShippingMethodOption[]; selectedId: string;
      patchAction: CheckoutMethodAction;
      analyticsId?: string };
```

#### 4.2.1 Discriminator 名の衝突回避規約

`Block::FormField.kind: FormFieldKind` のように、**親フィールド名と子 enum の discriminator が同名になると JSON が `"kind": { "kind": "text" }` のように冗長**になる。これを避けるため、子 enum 側の `tag = ...` を別名にする。

```rust
// server/src/sdui/blocks.rs
#[serde(tag = "inputType", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum FormFieldKind {
    Text,
    Tel,
    PostalCode,
    Select { options: Vec<SelectOption> },
}
```

JSON は `{ "kind": { "inputType": "text" } }` のように展開される。TS でも `block.kind.inputType === "text"` で素直に narrow できる。

**規約**: 親 Block / Region 構造体のフィールド名と、子 enum の `tag = ...` 名は **必ず別名にする**。同名にしたい誘惑が湧いたら親側のフィールド名を変えるか、子 enum 側の tag を変える。

#### 4.2.2 数値型のマッピング規約 (i64 → number)

ts-rs はデフォルトで Rust の `i64` を TS の `bigint` にマップするが、(a) JSON.parse の結果は常に JS の `number` で `bigint` は乗らない、(b) JPY の最大金額は `MAX_SAFE_INTEGER` (9_007_199_254_740_991) で十分 (= 9 兆円) のため、**金額系フィールドはすべて `#[ts(type = "number")]`** で明示的に `number` に倒す。

```rust
Block::Price {
    #[ts(type = "number")]
    amount: i64,
    ...
}
```

多通貨対応で精度が必要になった場合 (§17 Future Work) はここで再評価する。

> **多通貨化時の破壊的変更 (Phase 9 前に明文化)**: 多通貨に拡張する際は **`amount` を minor unit (= 通貨ごとの最小単位、JPY=yen, USD=cent, BHD=mils) に統一**する。JPY 単独運用中の `amount: i64 yen` は移行時に `* 1` で minor unit と一致するため数値変更は不要だが、TS 側の `Money` 型に `scale: 0 | 2 | 3` を持たせる API 変更が発生する。フォーマッタは `Intl.NumberFormat(locale, { style: "currency", currency })` に統一する想定で、`scale` は currency に紐付くため TS 型としては redundant だが実装の自衛として持たせる。
>
> **B2B 兆超え注釈 (Phase 9 前に明文化)**: 「JPY 9 兆円で `MAX_SAFE_INTEGER` に間に合う」という前提は **リテール EC 限定** で成り立つ。法人卸取引で大口発注 (= 単一注文が兆を超えうる) を扱う場合は、`amount: i64` を維持しつつ TS 側で `bigint` に切り替える、もしくは「合計は別 endpoint で集計し、UI に乗るのは個別行のみ」のような責務分離が必要。再評価対象。

#### 4.2.3 補助型 (Phase 2.5 / 7 / 8 で追加)

```typescript
// Phase 2.5: CTA をクリックした時のサーバ反映アクション。
// 親 Block::Cta.action は Option<CtaAction>。None なら href への純粋な遷移。
export type CtaAction =
  | { type: "add_to_cart";  productId: string; qty: number }
  | { type: "toggle_watch"; productId: string };

// Phase 7: cart 内 LineItem の +/- / 削除アクション。
// CtaAction とは別 enum (関心 = LineItem の token 操作 vs Cta の商品操作)。
export type LineItemAction =
  | { type: "set_qty"; token: string; qty: number }
  | { type: "remove";  token: string };

// Phase 8: 配送先 1 フィールドを更新。PATCH /checkout/shipping_field/{fieldName}。
// field_name は Block::FormField.name と一致 (= 自包含で client は URL を組める)。
export type CheckoutFieldAction =
  | { type: "patch_field"; fieldName: string };

// Phase 8: 配送方法 (1 リソース) 切替。PATCH /checkout/shipping_method。
// 単一値なので path に id を取らず固定 endpoint。Action は payload を持たず Patch のみ。
export type CheckoutMethodAction =
  | { type: "patch_method" };

// Phase 8: form_field の入力種別。discriminator は inputType (§4.2.1)。
export type FormFieldKind =
  | { inputType: "text" }
  | { inputType: "tel" }
  | { inputType: "postal_code" }
  | { inputType: "select"; options: SelectOption[] };

export type SelectOption = { id: string; label: Localizable };

// Phase 8: shipping_method_picker の 1 候補。
export type ShippingMethodOption = {
  id: string;            // = radio value、selectedId と比較
  name: Localizable;
  description: Localizable;
  amount: number;        // 配送料 (税込, JPY 想定)
  currency: Currency;
};
```

### 4.3 `key` の一意性スコープと命名

| 対象 | 一意性スコープ | 推奨形式 |
|---|---|---|
| `Block.key` | **同一 `CardBlock` 内で一意** | `<region短縮>-<purpose>` 例: `header-eb`, `body-hl`, `body-sh`, `footer-pr` |
| `MetricItem.key` / `MetaItem.key` | **同一 `items` 配列内で一意** | 短い意味語または連番 例: `karte`, `breeders`, `m1`, `m2` |
| `LineItem.key` (Phase 7) | **同一カート内で一意** | `li-<token短縮>` または `li-<productId>`。`token` 自体は別フィールドに持つ |
| `FormField.key` (Phase 8) | **同一カート内で一意** | `ff-<name>` (例: `ff-name`, `ff-tel`, `ff-zip`) |

`Block.key` (識別子) と `FormField.name` (URL path に乗るフィールド名) は **役割が異なる** (§5.8.2 の解説を参照)。`name` は server 側 checkout state の key、`key` は描画上の identity。混同しないこと。

検証は **Rust 側の `validate_keys()` で deserialize 後に必須** (§7.6)。重複 / 空文字は 400 エラーで弾く。Phase 7-8 の `LineItem` / `FormField` / `ShippingMethodPicker` / `OrderSummary` も `Block::key()` の総当たり対象に含まれる (§7.6 のコード参照)。

### 4.4 Experiment

```typescript
export type Experiment = {
  /** 実験のキー (snake_case 必須、例: "hero_cta_2026q2") */
  key: string;
  /** A/B バケット (alphanumeric/_/- のみ、例: "A" | "B" | "control")。
   *  CardBlock.variant (マーチャンダイジング) とは独立 */
  bucket: string;
};
```

`key` / `bucket` は Rust 側 `Experiment::new` で **正規表現バリデーション** を経由する (§7.4)。

### 4.5 CardBlock (テンプレートで判別される共用体)

v6 時点では **3 テンプレート** が実装されている。

```typescript
export type CardBlock =
  // Phase 1: 商品ハイライトカード
  | {
      template: "product_feature";
      id: string;
      variant?: ProductFeatureVariant;   // = "default" | "featured" | "compact"
      experiment?: Experiment;
      analyticsId?: string;
      regions: ProductFeatureRegions;
    }
  // Phase 2: 商品詳細ページ (一覧と同じ商品でも regions 構成が違う)
  | {
      template: "product_detail";
      id: string;
      variant?: ProductDetailVariant;    // = "default" のみ (将来「ペア販売」等を予約)
      experiment?: Experiment;
      analyticsId?: string;
      regions: ProductDetailRegions;
    }
  // Phase 7: カート (1 ユーザにつき 1 枚、id は固定で "cart")
  | {
      template: "cart";
      id: string;
      variant?: CartVariant;             // = "default" のみ (空カートも Default)
      experiment?: Experiment;
      analyticsId?: string;
      regions: CartRegions;
    };

export type ProductFeatureRegions = {
  header: Block[]; media: Block[]; meta: Block[];
  body:   Block[]; footer: Block[];
};
export type ProductDetailRegions = {
  gallery: Block[]; hero: Block[]; spec: Block[];
  pricing: Block[]; cta: Block[];
  promise: Block[];                            // Phase 2 追加
};
export type CartRegions = {
  header: Block[]; items: Block[];
  shipping: Block[]; shippingMethod: Block[];  // Phase 8 追加
  summary: Block[]; cta: Block[];
};

export type TemplateName = CardBlock["template"];
```

**Phase 1 で予約されていた `hero_intro` / `promise_step` は未実装** (`/products` のヒーロー・約束カードは現状 Phase 2 で要件が変動するため凍結中)。実装したくなった時に variant を追加する。

### 4.6 `CardBlock.id` の規約

`CardBlock.id` は **「この SDUI レスポンスを一意に識別するための不変の文字列」**。次の三つの源泉のいずれかに従って付与する。

| 源泉 | 形式 | 使う場面 | 例 |
|---|---|---|---|
| **データ主キー** | データソースの ID をそのまま流用 | データ実体とカードが 1:1 で対応 | `DHH-0271` (商品マスタ) |
| **構造化 ID** | `<scope>-<purpose>` の固定命名 | データソースを持たず、コード／管理画面で配置 | `cart` (カートは 1 ユーザ 1 枚)、`hero-main` |
| **複合 ID** | `<scope>.<key>.<context>` のドット区切り | 同じデータ実体が複数の SDUI 配置で再利用される | `product.DHH-0271.related` |

**不変性**: 一度割り当てた `id` は **キャッシュキー / 計測 ID** として参照されるため、変更しない。表示位置や variant が変わっても `id` は据え置く。

**`analyticsId` との関係**: §11.4 のフォールバック規約により、`analyticsId` が省略された場合は `id` を計測 ID として流用する。

**Phase 2 以降の例**: `product_detail` の `id` はその商品の `product_feature` と **同じデータ主キー** を使ってよい (両者は別 template なので衝突しない)。`cart` の `id` は **常に文字列 "cart"** (1 ユーザ 1 カートのため固定)。将来 multi-cart (= ギフトリスト等) を持つなら `cart.<purpose>` のように分ける。

## 5. テンプレート定義

各テンプレートが持つリージョン・許容ブロック・**HTML タグ** を明示する。Phase 2-8 で追加されたテンプレート / シェルもここに集約する。

### 5.1 リージョン構成 (v6)

| Template / Shell | 主要リージョン |
|---|---|
| `product_feature` (Phase 1) | header (badge×N) / media (×1) / meta (meta_line) / body (text) / footer (price, eclosion_forecast) |
| `product_detail` (Phase 2)  | gallery (media×N) / hero (text+badge) / spec (metric_list, meta_line) / pricing (price) / cta (cta×N) / promise (text+cta) |
| `cart` (Phase 7+8)          | header (text) / items (line_item×N) / shipping (form_field×N) / shipping_method (shipping_method_picker×1) / summary (order_summary×1) / cta (cta×N) |
| **shell** `ProductListResponse` (Phase 4-6) | filter_bar (×1, optional) / sort_bar (×1, optional) / search_box (×1, optional) / pagination (×1, optional) / cards (CardBlock×N) |

> shell (`ProductListResponse`) は **CardBlock より一段上の構造** で、Page Layout レベルの抽象。詳細は §5.6。

### 5.2 見出しレベル (text.role:headline) のタグ解決表

| Template | 該当リージョン | 既定タグ |
|---|---|---|
| `product_feature` | `body` | `<h3>` |
| `product_detail`  | `hero` | `<h1>` |
| `cart`            | `header` | `<h1>` |

> **不変条件**: 同一テンプレート内に `text.role: headline` のブロックは **0 または 1 個**。複数置きたい場合はテンプレートを分割する。
>
> **コード化** (Phase 9 前): この不変条件は §7.7 `ValidateA11y` trait として deserialize 後にサーバ側で検証する。違反は 400 で reject。fixture 作成時に複数 headline を置くとテストが落ちる安全装置。

### 5.3 商品ハイライトカード `product_feature`

(v5 と同じ。Phase 4 で `analyticsId` が付与されるようになった点だけ補足)

`id: "DHH-0271"` は **データ主キー** (§4.6)。`analyticsId: "product.DHH-0271"` は計測の意味的階層を別途付与した例。

```jsonc
{
  "id": "DHH-0271",
  "template": "product_feature",
  "variant": "featured",
  "analyticsId": "product.DHH-0271",
  "regions": {
    "header": [
      { "key": "header-b1", "type": "badge", "role": "status",
        "label": { "source": "i18n", "key": "badge.featured" } }
    ],
    "media": [
      { "key": "media-img", "type": "media", "kind": "image",
        "src": "https://cdn.kochu.example/specimens/DHH-0271.jpg",
        "alt": { "source": "raw", "text": "ヘラクレス 個体写真" } }
    ],
    "meta": [
      { "key": "meta-ml", "type": "meta_line", "items": [
          { "key": "id",   "role": "id",   "value": "#DHH-0271" },
          { "key": "shop", "role": "shop", "value": "ANCHOR BEETLE CO." }
      ]}
    ],
    "body": [
      { "key": "body-hl", "type": "text", "role": "headline",
        "content": { "source": "raw", "text": "ヘラクレスオオカブト ♂ 142mm" } }
    ],
    "footer": [
      { "key": "footer-pr", "type": "price",
        "amount": 48000, "currency": "JPY", "taxIncluded": true }
    ]
  }
}
```

### 5.4 (旧 hero_intro 例) — 凍結

v5 §5.3 に書かれていた `hero_intro` テンプレートは v6 時点で実装していない。設計サンプルとしては v5 を参照。

### 5.5 (旧 promise_step 例) — 凍結

同上。v5 §5.5 を参照。

### 5.6 商品一覧シェル `ProductListResponse` (Phase 4-6)

一覧ページ全体を表す **CardBlock より一段上のレスポンス shell**。`/api/v1/cards/products?...` が返す。

```typescript
export type ProductListResponse = {
  filterBar?:  FilterBar;     // Phase 4
  sortBar?:    SortBar;       // Phase 5
  searchBox?:  SearchBox;     // Phase 6
  pagination?: Pagination;    // Phase 6
  cards: CardBlock[];         // sortBar.current の指示通りに並べ済み
};
```

**設計判断**: Card 型に乗せず別構造体で wrap する。`CardBlock` は「商品 1 件」を表すテンプレート単位なので、ページ全体のレイアウト要素 (絞り込み chip / sort dropdown / pager) を Card に混ぜると Card 型が肥大化する。

#### 5.6.1 FilterBar (Phase 4) + faceted count (Phase 5)

```typescript
export type FilterBar  = { groups: FilterGroup[] };
export type FilterGroup = {
  key: string;                  // クエリパラメータ名 ("category" / "difficulty" 等)
  label: Localizable;
  chips: FilterChipItem[];
};
export type FilterChipItem = {
  key: string;                  // chip 値識別子 ("live" / "easy" 等)
  label: Localizable;
  selected: boolean;            // 現クエリで選択中なら true
  href: Href;                   // toggle 後の URL (selected→解除 URL / not→適用 URL)
  count?: number;               // Phase 5: 「他軸維持しこの chip に切替えたら何件か」
  analyticsId?: string;         // 推奨形式: "filter.<group_key>.<chip_key>"
};
```

**toggle URL は server が必ず返す**: フロントは「現状の選択」と「クリックすべき URL」を server から受け取って `<a href>` するだけ。理由は (a) progressive enhancement で JS 無しでも動く、(b) URL canonicalization の責務をフロント・サーバ両方に置きたくない。

**faceted count の意味**: 「他軸の絞り込みは維持したまま、この軸の値を **この chip に切り替えた** 場合に何件マッチするか」。chip クリック前に件数が見える。0 件のチップも非表示にせず `count: 0` を返す (UI 側で disabled 表示する余地)。

**`Block::Cta` ではなく独立 struct にする理由**: chip 固有データ (`selected` / `count`) があり、将来 chip 専用 UI (削除 X / カウント badge) を追加する余地を残すため。

#### 5.6.2 SortBar (Phase 5)

```typescript
export type SortBar = {
  current: string;              // 現在適用中の sort key (default 値含む)
  options: SortOption[];
};
export type SortOption = {
  key: string;                  // "name" / "price_asc" / "price_desc" / "new" 等
  label: Localizable;
  selected: boolean;
  href: Href;                   // この sort に「置き換えた」URL (filter は維持)
  analyticsId?: string;         // 推奨: "sort.<key>"
};
```

filter chip との違い: chip は「自分を抜く / 自分を追加する」に対し、sort は「自分に置き換える」(single-select / segmented control)。multi-sort はやらない (= YAGNI)。

#### 5.6.3 Pagination + SearchBox (Phase 6)

```typescript
export type Pagination = {
  page: number; perPage: number;
  totalCount: number; totalPages: number;
  prevHref?: Href; nextHref?: Href;            // first/last は None (= disabled)
  pages: PageLink[];                            // collapse 済み (1 / current±2 / last)
  analyticsId?: string;
};
export type PageLink =
  | { kind: "page"; number: number; href: Href; selected: boolean }
  | { kind: "ellipsis" };                       // "..." (クリック不可)

export type SearchBox = {
  query?: string;                               // 現クエリ ?q= の値
  placeholder: Localizable;
  submitHref: Href;                             // q を抜いた base URL (= form action)
  paramName: string;                            // 通常 "q"
  analyticsId?: string;
};
```

**default は URL から省略**: `?page=1`, `?per_page=20` などの default 値は URL に焼かない (canonical URL 維持)。

**range collapse は server に集約**: `pages: PageLink[]` は最大 7 件 (1 / current±2 / last) で省略は `{kind:"ellipsis"}`。client は `for (link of pages)` するだけ。

**SearchBox の二重対応**: `<form action="{submitHref}" method="get">` + input `name="{paramName}"` で **JS 無し fallback** が効く。JS 有り時は debounce 後に navigate。`paramName` を field として持つのは将来 `?keyword=` 等にリネームしたくなった時 client を変えずに移行するため。

#### 5.6.4 Filter chain の順序

> filter (chip 選択) → search (q substring) → sort → paginate

faceted count は **「filter のみ適用後」の母集団に対して計算** する。検索 box に文字を打っても filter chip の数字は揺らがず、「全体の絞り込み構造」と「検索のヒット件数」を別レイヤとして扱える。

#### 5.6.5 一覧 endpoint URL 規約

```
GET /api/v1/cards/products[?category=...&difficulty=...&q=...&sort=...&page=...&per_page=...]
```

各 param は省略可能。default 値 (`sort=name` / `page=1` / `per_page=20`) はサーバ側で埋める。

### 5.7 商品詳細カード `product_detail` (Phase 2)

商品 1 件の詳細ページ全体。一覧 (`product_feature`) と同じ id で並立しうる (template が違うので衝突しない)。

| Region | 用途 | 主な block |
|---|---|---|
| `gallery` | 大画像 + サムネ列 | `media` × N |
| `hero` | 店舗 byline / タイトル / 学名 / chip 群 | `text` (byline / headline / subhead) + `badge` |
| `spec` | 個体スペック (サイズ / 性別 / 羽化日 / 累代 / 産地 / ブリーダー) | `metric_list` / `meta_line` |
| `pricing` | 価格 (税込 / 配送料注記) | `price` + `text` (caption) |
| `cta` | カートに追加 / カートを見る / ウォッチ など複数アクション | `cta` × N (Phase 2.5 で `action` 持ち) |
| `promise` | 安心保証カード (死着補償・温度制御便) | `text` × 3-4 + 末尾 `cta` × 1 |

**走査順**: `gallery → hero → spec → pricing → promise → cta` (validate_keys 用 / 視線誘導順)。`promise` を `cta` の **直前** に並べる: 「安心保証 → カートに追加」の自然な視線誘導順。

**`promise` を独立 region にした理由**:
- 視覚的に「囲み card」として hero/cta とは別レイアウトで描画
- 用品カードでは存在しない / 生体カードのみ表示する、という出し分けがしやすい
- 将来、保証種別が増えた時に block primitive を増やす前に「区画ごと省略」できる

**endpoint**: `GET /api/v1/cards/products/{id}/detail`

### 5.8 カートカード `cart` (Phase 7) + チェックアウト統合 (Phase 8)

1 ユーザにつき 1 枚。server 側 cart store + checkout store の現状を snapshot して返す。

| Region | 用途 | 主な block |
|---|---|---|
| `header` | "あなたのカート (3 件)" などの見出し | `text` (×1, headline) |
| `items` | カート行 | `line_item` × N (空 = カート空) |
| `shipping` | 配送先入力フォーム | `form_field` × 5 (氏名 / 電話 / 郵便番号 / 都道府県 / 住所) |
| `shipping_method` | 配送方法ピッカー | `shipping_method_picker` × 1 |
| `summary` | カート集計行 (subtotal / shipping / tax / total) | `order_summary` × 1 |
| `cta` | "Stripe で決済" / "買い物を続ける" | `cta` × N (server 側で 3-way 分岐) |

**走査順**: `header → items → shipping → shipping_method → summary → cta`。

**空カート時の表現**: `items` / `shipping` / `shipping_method` / `summary` を全て `[]` にし、`cta` には「買い物を続ける」だけ入れる。client は `<Show when={items.length > 0}>` で empty state を切り替える。**Variant を `Empty` で分けない理由**: "0 件" の判定は `regions.items.length === 0` で renderer 側が決められる。別 variant にすると「items が空でも Default を返す → 矛盾」を server が壁打ちするコストが増える。

**`shipping_method` を別 region にする理由**:
- shipping (= 入力フォーム) と shipping_method (= radio ピッカー) で section 見出しが違う (§02 お届け先 / §03 配送方法)
- empty state の出し分けが独立
- 将来「配送先確定後に方法を表示」のような二段構成にする余地

**endpoint**: `GET /api/v1/cards/cart`

#### 5.8.1 LineItem block (Phase 7)

```jsonc
{
  "key": "li-DHH-0271", "type": "line_item",
  "productId": "DHH-0271",
  "title": { "source": "raw", "text": "ヘラクレスオオカブト ♂ 142mm" },
  "imageSrc": "https://cdn.../specimens/DHH-0271.jpg",
  "imageAlt": { "source": "raw", "text": "ヘラクレス 個体写真" },
  "unitPriceAmount": 48000, "currency": "JPY",
  "qty": 2, "subtotalAmount": 96000,
  "detailHref": "/products/DHH-0271",
  "decrementAction": { "type": "set_qty", "token": "tok_xxx", "qty": 1 },
  "incrementAction": { "type": "set_qty", "token": "tok_xxx", "qty": 3 },
  "removeAction":    { "type": "remove",  "token": "tok_xxx" },
  "analyticsId": "cart.line.DHH-0271"
}
```

**1 行 = 1 block にする ("fat block") 理由**:
- 行内の各要素 (画像 / 価格 / qty / 削除) が密結合で、別々に並べ替える需要が無い
- "1 行 = 1 商品" の意味的単位として TS 側で narrow しやすい
- `LineItemAction` を 3 つ (decrement / increment / remove) フラットに持てる
- 将来「ギフトラッピング」のような行内追加要素が出たら sub-block を内包する形にリファクタ (= 今は YAGNI)

**`decrementAction` の None 表現**: `qty == 1` の時は `None` で送り、UI 側で `−` ボタンを disabled にする。`qty: 0` を投げるなら Remove を使うので、`SetQty { qty: 0 }` は契約上送られない。

**`subtotalAmount` を server で持つ理由**: クライアント計算と表示金額を絶対にずらさないため。`unitPriceAmount * qty` を client が再計算しない。

#### 5.8.2 FormField block + ShippingMethodPicker block (Phase 8)

```jsonc
// 配送先 1 フィールド (例: 氏名)
{
  "key": "ff-name", "type": "form_field",
  "name": "addressName",                                        // PATCH path に乗る
  "label":       { "source": "i18n", "key": "checkout.shipping.name.label" },
  "value":       "山田太郎",
  "required":    true,
  "autocomplete": "name",
  "placeholder": { "source": "i18n", "key": "checkout.shipping.name.placeholder" },
  "validationError": null,
  "kind":        { "inputType": "text" },                       // discriminator は inputType
  "patchAction": { "type": "patch_field", "fieldName": "addressName" },
  "analyticsId": "cart.shipping.field.addressName"
}

// 都道府県 (select)
{
  "key": "ff-pref", "type": "form_field",
  "name": "addressPref",
  "label": { "source": "i18n", "key": "checkout.shipping.pref.label" },
  "value": "13",  // 東京都の id
  "required": true,
  "kind": {
    "inputType": "select",
    "options": [
      { "id": "01", "label": { "source": "raw", "text": "北海道" } },
      // ...47 件
      { "id": "47", "label": { "source": "raw", "text": "沖縄県" } }
    ]
  },
  "patchAction": { "type": "patch_field", "fieldName": "addressPref" }
}

// 配送方法
{
  "key": "smp-method", "type": "shipping_method_picker",
  "options": [
    { "id": "cold",   "name": { "source": "raw", "text": "温度制御便（推奨）" },
      "description":  { "source": "raw", "text": "生体含むため必須設定 · 15〜25℃" },
      "amount": 1800, "currency": "JPY" },
    { "id": "normal", "name": { "source": "raw", "text": "通常便" },
      "description":  { "source": "raw", "text": "用品のみ・常温配送" },
      "amount": 800,  "currency": "JPY" }
  ],
  "selectedId": "cold",
  "patchAction": { "type": "patch_method" },
  "analyticsId": "cart.shipping.method"
}
```

**`Block::FormField.name` (= URL path) と `key` (= block 識別子) の使い分け**:
- `key`  : `ValidateKeys` 用 (`ff-name` 等)。block の identity。
- `name` : URL path に乗る field 名 (`addressName` 等)。`PatchAction.fieldName` と **1 文字も違わず** 一致させる契約。

**FormField を fat block にする理由**: 1 フィールドが server 側 checkout state の 1 reducer cell に対応 (URL `/checkout/shipping_field/{name}` PATCH と 1:1 マップ)。`validationError` を Localizable で持つことで、サーバ判定の文言を i18n に乗せたまま当該フィールド直下に出せる (= 「フィールド ↔ エラー」の対応を server 契約で表現)。

**FormField のグリッド配置**: 5 件 (氏名 / 電話 / 郵便番号 / 都道府県 / 住所) を CSS Grid 2 カラム + 住所 full-width で配置。block 単位で reorder したければサーバが Vec の順序を入れ替えるだけ。

**`value: ""` (空文字) と `value: undefined` (未入力) の区別**: Option で持つ。「未入力」と「空に編集中」を混同しない (server 側は debounce 中の中間状態を観測しない)。

> **`value` 三状態の正確な意味 (Phase 9 前に明文化)**: server 側 checkout store は field を `Option<String>` で保持する。
> - `Some("山田太郎")` → ユーザが入力した値。次の PATCH 上書きまで永続。
> - `Some("")` → ユーザが**明示的にクリアした**状態 (= フォームに値を入れた後で全削除した)。required field なら server は `validation_error` を返す。
> - `None` → 一度も触っていない / server 側で未入力扱い。required field でも `validation_error` を **返さない** (= UX 上「未入力」を premature に赤く出さない)。
>
> client 側 debounce 中の中間状態 (1 文字目を打った瞬間 / IME 変換中 等) は **client が保持し PATCH しない**。debounce 完了 (§11.8.1 の 300 ms 程度) 時の値だけが server に飛ぶ。`""` への遷移も明示的に PATCH する (= empty PATCH を「クリア操作」として server が解釈)。

**ShippingMethodPicker を `FormField::Select` で代用しない理由**: 配送方法は「料金 + 説明文」を含む rich option で、単なる「id + label」では表現できない。UI 上も `<select>` ではなく `<label>` の縦並び (radio + price 行) で描画したい (a11y / 見やすさ)。PATCH endpoint も `/checkout/shipping_method` (単一値) で `/checkout/shipping_field/{name}` とは別系統。**block と endpoint を 1:1 で揃える**。

#### 5.8.3 OrderSummary block (Phase 7)

```jsonc
{
  "key": "summary", "type": "order_summary",
  "lineCount": 2, "totalQty": 3,
  "subtotalAmount": 96000,
  "shippingAmount": 1800,                       // None なら配送料行を出さない
  "taxAmount":      null,                       // None なら税行を出さない
  "totalAmount":    97800, "currency": "JPY"
}
```

**`MetricList` で代用しない理由**: MetricList は「k/v ラベル+値」の汎用部品で、合計行の階層 (subtotal は明細、total は強調) を表現できない。OrderSummary は専用 block にして renderer 側で total 行を太字 / 大きめに描く意味的契約を作る。

## 6. フロントエンド (Solid) の実装パターン

> **Solid の前提**: コンポーネント本体は一度しか走らない。リアクティビティは signals / `createMemo` / props プロキシが担う。**props は分割代入せず `props.foo` でアクセスする**。

### 6.1 i18n と Localizable レンダラー

(v5 と同じ)

```tsx
// src/sdui/i18n.ts
import {
  createContext, useContext, createMemo,
  type Accessor, type ParentComponent,
} from "solid-js";
import type { Localizable } from "./branded";

export type Translator = (key: string, params?: Record<string, string | number>) => string;

const I18nCtx = createContext<Translator>();

export const I18nProvider: ParentComponent<{ value: Translator }> = (props) =>
  <I18nCtx.Provider value={props.value}>{props.children}</I18nCtx.Provider>;

export const useI18n = (): Translator => {
  const t = useContext(I18nCtx);
  if (!t) throw new Error("I18nProvider が必要です");
  return t;
};

export function localizable(value: () => Localizable | undefined): Accessor<string | undefined> {
  const t = useI18n();
  return createMemo(() => {
    const v = value();
    if (!v) return undefined;
    return v.source === "raw" ? v.text : t(v.key, v.params);
  });
}
```

### 6.2 テンプレートレジストリと CardRenderer (v6 — 3 templates)

```tsx
// src/sdui/CardRenderer.tsx
import type { CardBlock } from "./branded";
import { ProductFeatureCard } from "./templates/ProductFeatureCard";
import { ProductDetailCard } from "./templates/ProductDetailCard";
import { CartCard }          from "./templates/CartCard";
import { FallbackCard }      from "./templates/FallbackCard";
import { Match, Switch, ErrorBoundary } from "solid-js";
import { useImpression } from "./useImpression";

export function CardRenderer(props: { block: CardBlock }) {
  useImpression(() => props.block);

  return (
    <ErrorBoundary fallback={(err) => <FallbackCard id={props.block.id} error={err} />}>
      <Switch fallback={<FallbackCard id={props.block.id} />}>
        <Match when={props.block.template === "product_feature" && props.block}>
          {(b) => <ProductFeatureCard card={b()} />}
        </Match>
        <Match when={props.block.template === "product_detail" && props.block}>
          {(b) => <ProductDetailCard card={b()} />}
        </Match>
        <Match when={props.block.template === "cart" && props.block}>
          {(b) => <CartCard card={b()} />}
        </Match>
      </Switch>
    </ErrorBoundary>
  );
}
```

### 6.3 BlockRenderer (v6 — 13 variants)

```tsx
// src/sdui/BlockRenderer.tsx (抜粋)
export function BlockRenderer(props: { block: Block }) {
  return (
    <Switch>
      <Match when={props.block.type === "text" && props.block}>            {(b) => <TextBlockView block={b()} />}</Match>
      <Match when={props.block.type === "cta" && props.block}>             {(b) => <CtaBlockView block={b()} />}</Match>
      <Match when={props.block.type === "media" && props.block}>           {(b) => <MediaBlockView block={b()} />}</Match>
      <Match when={props.block.type === "badge" && props.block}>           {(b) => <BadgeBlockView block={b()} />}</Match>
      <Match when={props.block.type === "metric_list" && props.block}>     {(b) => <MetricListBlockView block={b()} />}</Match>
      <Match when={props.block.type === "meta_line" && props.block}>       {(b) => <MetaLineBlockView block={b()} />}</Match>
      <Match when={props.block.type === "price" && props.block}>           {(b) => <PriceBlockView block={b()} />}</Match>
      <Match when={props.block.type === "eclosion_forecast" && props.block}>{(b) => <EclosionForecastView block={b()} />}</Match>
      <Match when={props.block.type === "divider" && props.block}>         <hr class="card__divider" /></Match>
      {/* Phase 7 */}
      <Match when={props.block.type === "line_item" && props.block}>       {(b) => <LineItemView block={b()} />}</Match>
      <Match when={props.block.type === "order_summary" && props.block}>   {(b) => <OrderSummaryView block={b()} />}</Match>
      {/* Phase 8 */}
      <Match when={props.block.type === "form_field" && props.block}>      {(b) => <FormFieldView block={b()} />}</Match>
      <Match when={props.block.type === "shipping_method_picker" && props.block}>{(b) => <ShippingMethodPickerView block={b()} />}</Match>
    </Switch>
  );
}
```

### 6.4 統一フォールバック (v5 と同じ)

```tsx
// src/sdui/components/MediaFallback.tsx
import { Show } from "solid-js";
import type { Localizable } from "../branded";
import { localizable } from "../i18n";
import { Icon } from "./Icon";

/**
 * a11y 規約 (どちらかに必ず分岐する。中間状態は禁止):
 *   alt あり → role="img" + aria-label を付与 (意味のある画像扱い)
 *   alt なし → role="presentation" + aria-hidden="true" (装飾扱い)
 */
export function MediaFallback(props: { alt?: Localizable; iconName?: string }) {
  const altText = localizable(() => props.alt);
  return (
    <Show
      when={props.alt}
      fallback={
        <div class="media-fallback" role="presentation" aria-hidden="true">
          <Icon name={props.iconName ?? "image"} />
        </div>
      }
    >
      <div class="media-fallback" role="img" aria-label={altText()}>
        <Icon name={props.iconName ?? "image"} />
      </div>
    </Show>
  );
}
```

## 7. バックエンド (Rust) の型表現 — Source of Truth

(v5 § と同じ。実体ファイルは v6 で以下に増えている)

```
server/src/sdui/
├── analytics.rs   (Phase 3)  — AnalyticsEvent / Type / Batch
├── blocks.rs                  — Block (13 variant) / CardBlock (3 template) /
│                                CtaAction / LineItemAction /
│                                CheckoutFieldAction / CheckoutMethodAction /
│                                FormFieldKind / SelectOption /
│                                ShippingMethodOption / Currency /
│                                Href / I18nKey / Localizable /
│                                MetricItem / MetaItem / 各 Variant enum
├── experiment.rs              — Experiment + ExperimentRaw + バリデータ
├── list.rs        (Phase 4-6) — ProductListResponse / FilterBar / FilterGroup /
│                                FilterChipItem / SortBar / SortOption /
│                                Pagination / PageLink / SearchBox
├── regions.rs                 — ProductFeatureRegions / ProductDetailRegions /
│                                CartRegions
├── validate.rs                — ValidateKeys trait / KeyConflict
└── mod.rs                     — module 公開
```

### 7.1 ワークフロー

1. Rust 側で型を編集 (`server/src/sdui/blocks.rs` など)
2. `cargo test` 実行 → `ts-rs` が `server/bindings/` 以下に `.ts` を出力
3. `node scripts/gen-sdui-types.mjs` で `bindings/` を `client_solid/src/generated/sdui.ts` に集約
4. **ローカルは pre-commit hook**、**リモートは CI** で「`cargo test` 後に diff が出ない」ことを二重に検証
5. **JSON Schema** も併せて生成 (`schemars` クレート) し、フィクスチャ検証 (§13.2) に利用
6. フロント側は `generated/sdui.ts` を **直接 import せず** 、`sdui/branded.ts` (§7.5) 経由で参照する

#### なぜ `schemars` と `ts-rs` の両方を使うか

`ts-rs` は **TypeScript 型** を生成し、フロント開発時のコンパイルエラーで誤用を防ぐ。`schemars` は **JSON Schema** を生成し、フロント側 CI で `ajv` 等によるフィクスチャ検証を可能にする (TypeScript 型は実行時には消えるためフィクスチャ検証ができない)。両者は **コンパイル時 (TS) と実行時 (JSON Schema) の二段防御**を構成する。

### 7.2 Cargo.toml 抜粋 (v5 と同じ)

```toml
[dependencies]
serde      = { version = "1", features = ["derive"] }
serde_json = "1"
schemars   = "0.8"
chrono     = { version = "0.4", features = ["serde"] }
thiserror  = "1"
once_cell  = "1"
regex      = "1"

[dev-dependencies]
ts-rs = "9"
```

### 7.3 Regions 専用 struct (v6 — 3 テンプレート)

```rust
// server/src/sdui/regions.rs

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[ts(export)]
pub struct ProductFeatureRegions {
    #[serde(default)] pub header: Vec<Block>,
    #[serde(default)] pub media:  Vec<Block>,
    #[serde(default)] pub meta:   Vec<Block>,
    #[serde(default)] pub body:   Vec<Block>,
    #[serde(default)] pub footer: Vec<Block>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[ts(export)]
pub struct ProductDetailRegions {
    #[serde(default)] pub gallery: Vec<Block>,
    #[serde(default)] pub hero:    Vec<Block>,
    #[serde(default)] pub spec:    Vec<Block>,
    #[serde(default)] pub pricing: Vec<Block>,
    #[serde(default)] pub cta:     Vec<Block>,
    #[serde(default)] pub promise: Vec<Block>,        // Phase 2
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[ts(export)]
pub struct CartRegions {
    #[serde(default)] pub header:          Vec<Block>,
    #[serde(default)] pub items:           Vec<Block>,
    #[serde(default)] pub shipping:        Vec<Block>,   // Phase 8
    #[serde(default)] pub shipping_method: Vec<Block>,   // Phase 8
    #[serde(default)] pub summary:         Vec<Block>,
    #[serde(default)] pub cta:             Vec<Block>,
}
```

**重要**: 各 `Vec<Block>` フィールドに `skip_serializing_if = "Vec::is_empty"` を **付けない**。空配列も `[]` でシリアライズする。理由は、JSON で undefined になると TS 型 `Block[]` との不整合 (`undefined.length` でクラッシュ) を起こすため。default 値があるので **JSON 受信時の omit は OK**、**送信時の omit は禁止** という非対称な約束。

### 7.4 Experiment のバリデーション (v5 と同じ)

```rust
// server/src/sdui/experiment.rs
static KEY_RE:    Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-z][a-z0-9_]*$").unwrap());
static BUCKET_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9_-]+$").unwrap());

#[derive(Debug, Clone, Serialize, JsonSchema, TS)]
#[serde(try_from = "ExperimentRaw")]
#[ts(export)]
pub struct Experiment { pub key: String, pub bucket: String }

impl Experiment {
    pub fn new(key: impl Into<String>, bucket: impl Into<String>) -> Result<Self, ExperimentError> {
        let key = key.into(); let bucket = bucket.into();
        if !KEY_RE.is_match(&key)       { return Err(ExperimentError::InvalidKey(key)); }
        if !BUCKET_RE.is_match(&bucket) { return Err(ExperimentError::InvalidBucket(bucket)); }
        Ok(Self { key, bucket })
    }
}
```

これにより JSON 経由で `bucket: " B "` のような不正値が来ると **deserialize で 400** になる。

### 7.5 フロント側 branded 型レイヤ (v6 — 3 templates 対応)

ts-rs は `Href` / `I18nKey` を素の `string` として TS 出力するため、**フロント側で別ファイルに branded 型を 1 度だけ手書き**して上書きする。v6 では cart 系 fat block (LineItem / OrderSummary / FormField / ShippingMethodPicker) も branded layer 経由で扱う。

```typescript
// client_solid/src/sdui/branded.ts (v6 概形)

import type * as G from "../generated/sdui";

declare const __brand: unique symbol;

export type Href    = string & { readonly [__brand]: "Href" };
export type I18nKey = string & { readonly [__brand]: "I18nKey" };

// ── Localizable: i18n キーを branded I18nKey に置換 ──
export type Localizable =
  | { source: "i18n"; key: I18nKey;
      params?: Record<string, string | number> }
  | { source: "raw";  text: string };

// ── Phase 8: SelectOption (= form_field/select の選択肢 1 件) を branded 化 ──
//   label を branded Localizable に置換。
export type SelectOption = Omit<G.SelectOption, "label"> & {
  label: Localizable;
};

// ── Phase 8: FormFieldKind を branded 化 ──
//   select variant のみ options を branded SelectOption[] に置換。
//   text / tel / postal_code variant は payload を持たないので G から流用。
export type FormFieldKind =
  | Extract<G.FormFieldKind, { inputType: "text" }>
  | Extract<G.FormFieldKind, { inputType: "tel" }>
  | Extract<G.FormFieldKind, { inputType: "postal_code" }>
  | (Omit<Extract<G.FormFieldKind, { inputType: "select" }>, "options"> & {
      options: SelectOption[];
    });

// ── Phase 8: ShippingMethodOption (= shipping_method_picker の選択肢 1 件) を branded 化 ──
//   name / description を branded Localizable に置換。amount / currency はそのまま。
export type ShippingMethodOption = Omit<G.ShippingMethodOption, "name" | "description"> & {
  name: Localizable;
  description: Localizable;
};

// ── Action 系の re-export (block 単位 view 側から型を直接掴むため) ──
//   payload が string / 空のみで branded 化不要なので G から流用するが、
//   import 経路を branded.ts に集約するためここで再エクスポートする。
export type CheckoutFieldAction  = G.CheckoutFieldAction;
export type CheckoutMethodAction = G.CheckoutMethodAction;
export type LineItemAction       = G.LineItemAction;

// ── Block: 13 variant すべてを branded 化 ──
//   - cta.href / detailHref を Href に
//   - 各 Localizable を branded 版に
//   - form_field.kind を branded FormFieldKind に
//   - shipping_method_picker.options を branded ShippingMethodOption[] に
//   - その他のフィールドは G.Block からそのまま流用 (例: line_item.imageSrc は raw URL)
export type Block =
  | (Extract<G.Block, { type: "text" }>             & { content: Localizable })
  | (Omit<Extract<G.Block, { type: "cta" }>, "href" | "label">
                                                    & { href: Href; label: Localizable })
  | (Omit<Extract<G.Block, { type: "media" }>, "alt">
                                                    & { alt?: Localizable })
  | (Omit<Extract<G.Block, { type: "badge" }>, "label">
                                                    & { label: Localizable })
  | (Omit<Extract<G.Block, { type: "metric_list" }>, "items">
                                                    & { items: Array<{ key: string;
                                                                       label: Localizable;
                                                                       value: Localizable }> })
  | Extract<G.Block, { type: "meta_line" }>
  | Extract<G.Block, { type: "price" }>
  | Extract<G.Block, { type: "eclosion_forecast" }>
  | Extract<G.Block, { type: "divider" }>
  // ── Phase 7: cart 専用 fat block ──
  | (Omit<Extract<G.Block, { type: "line_item" }>, "title" | "imageAlt" | "detailHref">
                                                    & { title: Localizable;
                                                        imageAlt?: Localizable;
                                                        detailHref: Href })
  // OrderSummary は branded すべき外向き値が無い (= 全て number / Currency)。
  | Extract<G.Block, { type: "order_summary" }>
  // ── Phase 8: checkout 専用 ──
  //   FormField は label / placeholder / validationError / kind の 4 箇所を branded 化。
  //   patchAction (CheckoutFieldAction) は fieldName: string のみなので branded 化不要。
  | (Omit<
      Extract<G.Block, { type: "form_field" }>,
      "label" | "placeholder" | "validationError" | "kind"
    > & {
      label: Localizable;
      placeholder?: Localizable;
      validationError?: Localizable;
      kind: FormFieldKind;
    })
  //   ShippingMethodPicker は options を branded ShippingMethodOption[] に置換。
  //   patchAction (CheckoutMethodAction) は payload を持たないので branded 化不要。
  | (Omit<Extract<G.Block, { type: "shipping_method_picker" }>, "options"> & {
      options: ShippingMethodOption[];
    });

// ── CardBlock: regions の中の Block を branded 版に (3 template) ──
//
// **設計上の不変条件**: region は「空配列はあっても undefined ではない」(§5.1)。
//   Rust 側 `<Template>Regions` は `#[serde(default)]` で missing フィールドを
//   `Vec::new()` に倒すので、JSON で undefined / 欠落していても deserialize 後は
//   必ず `[]` になる。したがって TS 側でも `Block[]` (required) で扱う。
//
// **distributive conditional type への配慮**:
//   `R[K] extends G.Block[] | undefined ? ... : ...` のような書き方だと、
//   `R[K]` が naked type parameter として分配され、`undefined` 部分が消えない。
//   `-?` で optional modifier を外し、`NonNullable<R[K]>` で undefined を剥がして
//   から判定することで、generated 側が optional でも required な Block[] に統一する。
//
// **テスト fixture への影響**: region が必須化されるため、空 region でも `[]` を
//   明示的に書く必要がある。fixture で region を欠落させると TS2739 になる
//   (= shipping/shippingMethod の漏れを型レベルで検出できる安全装置)。
type ReplaceBlock<R> = {
  [K in keyof R]-?: NonNullable<R[K]> extends G.Block[] ? Block[] : R[K];
};

export type CardBlock =
  | (Omit<Extract<G.CardBlock, { template: "product_feature" }>, "regions">
       & { regions: ReplaceBlock<G.ProductFeatureRegions> })
  | (Omit<Extract<G.CardBlock, { template: "product_detail" }>, "regions">
       & { regions: ReplaceBlock<G.ProductDetailRegions> })
  | (Omit<Extract<G.CardBlock, { template: "cart" }>, "regions">
       & { regions: ReplaceBlock<G.CartRegions> });

export type TemplateName = CardBlock["template"];

// ── 構築ヘルパ (テスト/フィクスチャ用) ──
export const asHref    = (s: string): Href    => s as Href;
export const asI18nKey = (s: string): I18nKey => s as I18nKey;
```

**運用ルール**:

- アプリコードは `import { Block, CardBlock, FormFieldKind, SelectOption, ShippingMethodOption, LineItemAction, CheckoutFieldAction, CheckoutMethodAction } from "@/sdui/branded"` のように **branded.ts 経由で必要な型を import** する
- `generated/sdui.ts` の直接 import は eslint ルール (`no-restricted-imports`) で禁止
- `asHref` / `asI18nKey` はテスト・フィクスチャでのみ使用 (本番コードでの使用は code review で禁止)
- ランタイムには影響しない (型レベルのみの差し替え)
- **新しい block variant を追加した時のチェックリスト**:
  1. Rust 側 `Block` enum に variant 追加 → ts-rs で `G.Block` に variant が増える
  2. branded.ts の `Block` union に対応する Match 行を 1 行追加 (branded すべき Localizable / Href が無ければ `Extract<G.Block, { type: "..." }>` でそのまま流用)
  3. その variant が Region に乗るなら、対応する `<Template>Regions` を Rust 側で更新 → branded.ts の `ReplaceBlock` が自動で region 必須化を適用
  4. 既存テスト fixture の region オブジェクトに新フィールドを `[]` で追加 (TS2739 で自動検出される)

### 7.6 Block / CardBlock / key 一意性バリデータ (v6 全 variant 対応)

```rust
// server/src/sdui/blocks.rs (v6 抜粋)

impl Block {
    /// 全 variant に共通する `key` フィールドを返す。
    pub fn key(&self) -> &str {
        match self {
            Block::Text { key, .. }
            | Block::Cta { key, .. }
            | Block::Media { key, .. }
            | Block::Badge { key, .. }
            | Block::MetricList { key, .. }
            | Block::MetaLine { key, .. }
            | Block::Price { key, .. }
            | Block::EclosionForecast { key, .. }
            | Block::Divider { key }
            | Block::LineItem { key, .. }                    // Phase 7
            | Block::FormField { key, .. }                   // Phase 8
            | Block::ShippingMethodPicker { key, .. }        // Phase 8
            | Block::OrderSummary { key, .. } => key,        // Phase 7
        }
    }

    /// `items[].key` を持つ variant のみ列挙。それ以外は空。
    pub fn iter_item_keys(&self) -> Box<dyn Iterator<Item = &str> + '_> {
        match self {
            Block::MetricList { items, .. } => Box::new(items.iter().map(|i| i.key.as_str())),
            Block::MetaLine   { items, .. } => Box::new(items.iter().map(|i| i.key.as_str())),
            _ => Box::new(std::iter::empty()),
        }
    }
}

// server/src/sdui/validate.rs
impl ValidateKeys for CardBlock {
    fn validate_keys(&self) -> Result<(), KeyConflict> {
        let mut seen = HashSet::new();
        for block in self.iter_blocks() {
            check(&mut seen, block.key())?;
            for item_key in block.iter_item_keys() {
                let composite = format!("{}::{}", block.key(), item_key);
                check(&mut seen, &composite)?;
            }
        }
        Ok(())
    }
}

fn check(seen: &mut HashSet<String>, k: &str) -> Result<(), KeyConflict> {
    if k.is_empty() {
        return Err(KeyConflict { key: "<empty>".to_string() });
    }
    if !seen.insert(k.to_string()) {
        return Err(KeyConflict { key: k.to_string() });
    }
    Ok(())
}
```

API ハンドラは `serde_json::from_str::<CardBlock>(body)` 後に必ず `card.validate_keys()` を呼ぶ。失敗は 400 を返す。**v6 では LineItem / OrderSummary / FormField / ShippingMethodPicker も自動的に検証対象**になる (key() / iter_blocks() の網羅で解決)。

### 7.7 ValidateA11y trait (Phase 9 前に追加 / **実装済み**)

§5.2 の「同一テンプレート内に `text.role: headline` のブロックは 0 または 1 個」という a11y 不変条件を、`ValidateKeys` と同格の **deserialize 後 validate** としてコード化する。これは「a11y 上の利便性」ではなく「スクリーンリーダー利用者が見出しナビゲーションで迷子にならないことの最低保証」として位置付ける。

```rust
// server/src/sdui/validate.rs
pub trait ValidateA11y {
    fn validate_a11y(&self) -> Result<(), A11yViolation>;
}

#[derive(Debug, thiserror::Error)]
pub enum A11yViolation {
    #[error("template {template:?} region {region:?} has {count} headline blocks (expected 0 or 1)")]
    MultipleHeadlines { template: String, region: String, count: usize },
}

impl ValidateA11y for CardBlock {
    fn validate_a11y(&self) -> Result<(), A11yViolation> {
        let mut headline_count = 0_usize;
        for block in self.iter_blocks() {
            if let Block::Text { role: TextRole::Headline, .. } = block {
                headline_count += 1;
            }
        }
        if headline_count > 1 {
            return Err(A11yViolation::MultipleHeadlines {
                template: self.template_name().to_string(),
                region: "(card-wide)".to_string(),
                count: headline_count,
            });
        }
        Ok(())
    }
}
```

API handler は **`validate_keys()` の直後に `validate_a11y()` も呼ぶ** ことを規約とする。失敗時は `KeyConflict` と同様 400 で reject し、error body に `template` / `count` / `keys` を含めて debug 容易にする。

**M4 で実装済み**:
- `server/src/sdui/validate.rs` に `ValidateA11y` trait + `A11yViolation::MultipleHeadlines { template, count, keys }` 実装
- `server/src/sdui/mod.rs` から `pub use validate::{A11yViolation, ValidateA11y}` で再 export
- `server/src/handlers/cards.rs` の全 `validate_keys()` 呼び出しの直後に `validate_a11y()` を併設 (= `get_product_card` / `get_product_detail_card` / `get_cart_card` / `list_product_cards`)
- 単体テスト (`validate.rs` の `tests` module) で `validate_a11y_passes_with_zero_headlines` / `_with_one_headline` / `_with_non_headline_text_blocks` / `_fails_with_two_headlines_in_same_region` / `_fails_with_two_headlines_across_regions` / `_error_message_includes_template_and_keys` を網羅
- 既存 fixture が a11y 不変条件を満たすことを `all_mock_cards_pass_a11y_validation` / `all_detail_cards_pass_a11y_validation` の omnibus test で保証

**将来の拡張**: 同じ trait に「`<button>` の `aria-label` 欠落チェック」「`<img>` の `alt` 欠落チェック」等を順次追加する余地を残す。`A11yViolation` enum を `#[non_exhaustive]` 化はしていないため、新 variant 追加時は呼び出し側 (handler) のエラー文整形で網羅性を確認すること。

## 8. 命名規則

(v5 と同じ + Phase 7-8 で追加された慣行)

- **テンプレート名**: `snake_case` の名詞 + 用途。`product_feature`, `product_detail`, `cart`
- **リージョン名**: 場所を表す共通名。Rust 側は `snake_case` (`shipping_method`)、JSON は `camelCase` (`shippingMethod`)
- **ブロック型**: `snake_case`、内容の型を表す。レイアウト的な名前 (`top_block` など) は禁止
- **ロール名**: 組版・出版業界の語彙を借用。`description` のような曖昧語は不可
- **`CardBlock.id`**: §4.6 の三源泉 (データ主キー / 構造化 ID / 複合 ID)。**不変**
- **`Block.key`**: `<region短縮>-<purpose>` のドット区切り。例: `header-eb`, `body-hl`, `footer-pr`, `li-DHH-0271`, `ff-name`. **カード内一意**
- **`MetricItem.key` / `MetaItem.key`**: 短い意味語または連番。**同 items 配列内一意**
- **`FormField.name`** (Phase 8): URL path の最後のセグメント。**camelCase 推奨** (= JSON 全体の rename_all と揃う)。例: `addressName`, `addressTel`, `addressZip`, `addressPref`, `addressLine1`
- **`Action.token`** (Phase 7): cart store が発行する不透明 ID。client は中身を解釈しない
- **`analytics_id`**: `<scope>.<id>.<element>` のドット区切り階層。例: `product.DHH-0271.cta.add_to_cart`, `cart.line.DHH-0271`, `cart.shipping.field.addressName`, `filter.category.live`, `sort.price_asc`, `pagination.page`, `search.submit`. **未指定時は `id` を流用** (§11.4)
- **`I18nKey`**: `<scope>.<key>` のドット区切り
- **`experiment.key`**: `^[a-z][a-z0-9_]*$` (snake_case)
- **`experiment.bucket`**: `^[A-Za-z0-9_-]+$`
- **テンプレートのバージョニング**: 破壊的変更が必要な時は `product_feature__v2` のように suffix。Rust enum variant としては `ProductFeatureV2` で別 variant

## 9. 多重度の扱い

(v5 と同じ)

- **配列の長さで自然に表現する**
- **位置で命名しない** (`leftButton` / `rightButton` 禁止)
- **役割で区別したい場合は属性で**
- 「ちょうど 1 つしか取り得ない」リージョンも、配列で持つ (cart の `summary` / `shipping_method` も `Vec<Block>`)

## 10. fallback / 縮退戦略 + セキュリティ規約

### 10.1 縮退ルール (v5 + Phase 4-8 補足)

> **fallback の性格付け** (Phase 9 前に明文化): `Block` / `CardBlock` / `<Template>Regions` の deserialize は §7.3 のとおり `#[serde(deny_unknown_fields)]` を付けており、未知の variant / フィールドは **server side の deserialize 段階で 400 として reject** される。したがって client 側の「未知 type → 描画スキップ」「未知 template → `FallbackCard`」は **型生成パイプラインの遷移期保険** であり、想定する具体シナリオは以下の二つに限定される。
>
> 1. **開発時の hot reload ラグ**: Rust 先行で `Block` variant を追加し、ts-rs 再生成 / `gen-sdui-types.mjs` 実行前に dev server で API を叩くケース。
> 2. **deploy 順序の遷移期**: server > client の deploy 時系列で、新 variant を返す server が古い client から fetch される短時間ウィンドウ。
>
> 上記 2 シナリオ以外で client fallback が発火することは異常 (= server 側 validate のすり抜けまたは意図しない data corruption) を意味する。fallback は **二次防衛**であり、一次防衛は server 側の 400 / 422 / 500 系統。fallback ログは「設計の安全弁が回った件数」として観測指標に含める。

- 未知の `template` → `FallbackCard` を描画しログ通知
- 未知の `block.type` → 描画スキップ + ログ通知
- 既知 type だが未知の `role` → デフォルトロールにフォールバック
- 必須リージョンが空 → テンプレートが個別に「最低限の見た目」を担保
- 画像 `src` が解決不能 → §6.4 の `MediaFallback` に置換
- `MediaFallback` の a11y は **`alt` 有無で `role="img"` / `role="presentation"` を必ず分岐**
- `Localizable.i18n` のキー解決失敗 → 開発: キー名を表示。本番: 空文字 + エラーログ
- key 重複 / 不正 region キー / 不正 experiment / 不正 href → Rust 側で 400
- **(Phase 4-6) FilterBar / SortBar / Pagination / SearchBox が `None`** → そのシェル要素を描かない (= 機能 OFF として扱う)
- **(Phase 7) `regions.items` が空配列** → empty state を表示。`summary` / `shipping` / `shipping_method` も空配列で来る (server 規約)
- **(Phase 7) LineItemAction の token が server で未知** → 404 (= 多人数で同時操作したケース)。client は再 fetch して整合
- **(Phase 8) FormField.value が unknown 入力** → server は受け付けるが `validation_error` を Localizable で返す (= サーバ側でエラー文を i18n に乗せる)
- **(Phase 8) CheckoutMethodAction で未知の id** → 400 (= 改竄 / バグ検出)

### 10.2 Href の許容ルール

| 種別 | 許容 | 例 |
|---|---|---|
| 内部相対パス | ✅ | `/products`, `/cart`, `/karte/example` |
| KOCHU 自社ドメイン | ✅ | `https://kochu.example/...`, `https://*.kochu.example/...` |
| 既知の外部ホスト | ✅ | `KNOWN_EXTERNAL_HOSTS` 定数で管理 |
| `mailto:` / `tel:` | ✅ | `mailto:support@kochu.example` |
| 任意のサードパーティ https | ❌ | 申請ベースで `KNOWN_EXTERNAL_HOSTS` に追加 |
| `javascript:` / `data:` / `file:` / `vbscript:` | ❌ | 構築時 reject (XSS) |

**MVP の責務範囲**: 二段構えで考える。

| 層 | 責務 | やる時期 |
|---|---|---|
| **deny scheme** | `javascript:` / `data:` / `vbscript:` / `file:` を **構築時 (Rust `Href::parse`) で reject** する。これは XSS 直結の脆弱性なので **MVP 必須**。 | **今 (Phase 1 〜)** |
| **allowlist host** | 自社ドメイン / 既知外部ホストのホワイトリスト判定。| §17 Future Work (Phase 9+) |
| **utm 排除** | utm パラメータが焼き込まれていないかをパース時に検証。 | §17 Future Work |

**Phase 1 実装の現状**: `Href::parse` は今のところ「`/...` で始まる」「`https://...` で始まる」のみを許容する簡易判定。**deny scheme 4 種は明示的にチェックして reject する**ことで XSS は塞がっている。allowlist / utm 排除は §17 Future Work で `Href::parse` に統合予定。

### 10.3 utm パラメータ

`Href` には utm を入れない。トラッキングパラメータは **フロントの遷移直前に `analytics_id` を元に付与** する。

### 10.4 文字列描画の安全規約

- すべての user-facing 文字列は **textContent でのみ描画**
- 唯一の例外は `<L>` コンポーネント内の i18n 解決後文字列 (これも textContent 経由)
- リッチテキストが必要になった場合は、専用ブロック型 (`rich_text` 等) を新設し **限定タグの allowlist** で許容
- Solid 側の lint ルール: `props.value.text` / `props.value.key` を JSX に直接展開する記述を検出
- `generated/sdui.ts` の直接 import は eslint ルール (`no-restricted-imports`) で禁止

### 10.5 server-driven state 下での a11y 最低保証 (Phase 9 前に追加)

§11.8 の server-driven state pattern は **region 全体の差し替え**を伴うため、素朴な実装ではスクリーンリーダー利用者がフォーカスを失い操作不能になる。これは UX 上の不便ではなく **アクセシビリティの最低保証**として規定する。違反を許容しない。

**規律 1 — `aria-live` による状態変化のアナウンス**:
- mutation 完了 (= PATCH レスポンス受領後) に **`<div role="status" aria-live="polite">`** で「カートに追加されました」「配送先を保存しました」のような操作結果を通知する。
- 通知文は server から `validation_error` と同じ `Localizable` 型で受け取る (= i18n に乗せて翻訳可能にする)。
- `polite` は読み上げ中の操作を中断しない。**致命的でない通知すべて**に使う。

**規律 2 — エラーは `aria-live="assertive"` + `aria-describedby`**:
- `FormField.validationError` が `Some(_)` の場合、当該 input に **`aria-invalid="true"` と `aria-describedby="<key>-error"`** を付ける。
- エラー文を描画する要素には **`aria-live="assertive"` と `id="<key>-error"`** を付ける。
- `assertive` は読み上げ中でも割り込んでアナウンスする。**ユーザの次操作を妨げる致命的なエラー**にだけ使う。

**規律 3 — フォーカス保持 (= §11.8.1 規律 3 と統合)**:
- region 差し替えで input が再マウントされると caret 位置 / IME 変換中状態が失われ、スクリーンリーダーのフォーカスも飛ぶ。
- `<For each={regions.shipping} key={(b) => b.key}>` で DOM identity を維持する。`key` は §11.8.1 規律 3 と同一の `block.key`。
- 再マウントが避けられないケース (= block の追加・削除) では、`requestAnimationFrame` で `document.activeElement` を観測し、可能なら同等の field に focus を戻す。

**規律 4 — 動的に追加される要素の `aria-relevant`**:
- `regions.items` に新しい `LineItem` が追加された場合、`<ul aria-live="polite" aria-relevant="additions">` で「商品が追加されました」を通知する。
- 削除時は `aria-relevant="removals"` ではなく、規律 1 の `role="status"` で別途アナウンスする (= 読み上げ済みの行が消える挙動はスクリーンリーダー実装で揺れるため)。

**実装の所在**: `client_solid/src/sdui/useFormFieldState.ts` (規律 2 / 3 統合) / `useCartSnapshot.ts` (規律 1 / 4 統合) を §19.3 の再実装時に新設する。**§11.8.1 と §10.5 は同じ実装ファイルでカバーされる**ことを明記。

**テスト**: §13.4 の race E2E に「スクリーンリーダー (axe-playwright) でフォーカス飛びと aria-live 発火を assert」を追加。

## 11. 計測・実験 + Action / Server-driven state

### 11.1 二段階の粒度

- **カード単位**: `CardBlock.analyticsId` + `experiment` で impression / 全体クリックを集計
- **ブロック単位**: 各 `Block.analyticsId` で個別 CTA / badge / line / form field を集計

### 11.2 イベントスキーマ (Phase 3 で確定)

```typescript
// 1 件の Analytics イベント (server 側 AnalyticsEvent)
export type AnalyticsEvent = {
  analyticsId: string;                      // 空不可
  eventType: "impression" | "click";
  timestampMs: number;                      // クライアント Date.now() (= 観測時刻、信頼しない)
  serverReceivedAtMs?: number;              // サーバ受信時刻 (= 集計の真実値)。GET /events で読み出す時のみ存在
  context: Record<string, string>;          // productId / variant / experimentKey 等。空マップは省略
};

// POST /api/v1/events で送る batch payload
export type AnalyticsEventBatch = { events: AnalyticsEvent[] };
```

**eventType は snake_case enum で固定**: `impression` / `click` のみ。サーバが新種を黙って受け入れると後段集計でゴミが混じる。`hover` / `dwell_time` 等を増やすときは設計レビューを通す。

**context はキー集合を validate しない**: 拡張に対して open / 古いクライアントの互換性を壊さないため。

**`timestampMs` と `serverReceivedAtMs` の使い分け** (Phase 9 前に追加した規律):
- `timestampMs` は **クライアント `Date.now()` の観測値**。端末時計のズレ・悪意ある操作に晒されているため、**集計上の真実値としては使わない**。
- `serverReceivedAtMs` は handler が `chrono::Utc::now().timestamp_millis()` で受信時に必ず stamp する。ts-rs binding 上は `#[serde(skip_deserializing)]` 相当 (= 受信 body には乗らず、`GET /events` 出力でのみ表現される) のため TS では optional (`?`) で扱う。
- 両者の差分 (`serverReceivedAtMs - timestampMs`) を観測すれば「クライアント時計ズレ / 悪意ある送信」の兆候が後段集計で検出できる。集計クエリは原則 `serverReceivedAtMs` で grouping する。

**batch 制約**:

| 項目 | 値 | 備考 |
|---|---|---|
| `events.length` の上限 | **100 件 / batch** | 超えた場合は 413 Payload Too Large。client は分割 flush。 |
| 単一 event の `context` キー数上限 | **32 キー** | 超過は 400。debug context の暴走防止。 |
| 単一 event の `context` 値長上限 | **256 文字 / value** | 超過は 400。値が長くなる場合は集計側で別フィールドへ。 |
| body 全体の payload size 上限 | **64 KB** | 超過は 413。axum の `DefaultBodyLimit` で制御。 |
| `analyticsId` の長さ | **1〜128 文字 / 空文字不可** | 空文字は 400 (batch 単位で全件 reject)。 |

これらの上限は **Rust ハンドラ側 const** として `server/src/handlers/events.rs` に定義し、変更時に CI が壊れるよう test を貼っておく (= 暗黙の契約変更を防ぐ)。

### 11.3 variant と experiment.bucket は独立

- `CardBlock.variant` = マーチャンダイジング上の見栄え
- `Experiment.bucket` = 実験基盤が割り当てる A/B バケット

両者は **直交**。バック側は次の順で決定する:

1. 商品担当が指定した `variant` を使う (なければデフォルト)
2. 実験基盤が `experiment.bucket` を割り当て、レスポンスに同梱
3. フロントは届いた `experiment` を **そのまま記録** するだけ

### 11.4 `analytics_id` 未指定時のフォールバック

`analytics_id` が optional のため、未指定時のフォールバック ID を **フロントが機械的に組み立てる**:

- カード: `analyticsId ?? card.id`
- ブロック: `block.analyticsId ?? \`${cardAnalyticsId}.${block.key}\``

これにより最小構成 (`analytics_id` 全省略) でもイベントが識別可能。`block.key` がカード内一意 (§4.3) であること、`CardBlock.id` が不変 (§4.6) であることが前提。

### 11.5 重複発火対策 (Solid)

```tsx
// src/sdui/useImpression.ts
import { createEffect } from "solid-js";
import type { CardBlock } from "./branded";

const fired = new Set<string>();   // session-wide dedup

export function useImpression(card: () => CardBlock) {
  createEffect(() => {
    const c = card();
    const id = `${c.id}:${c.experiment?.key ?? ""}:${c.experiment?.bucket ?? ""}`;
    if (fired.has(id)) return;
    fired.add(id);
    sendImpression(c);
  });
}
```

### 11.6 Action 4 種類 (Phase 2.5 / 7 / 8)

サーバ反映を伴う UI を 4 種類の Action enum に分けて持つ。**すべて `tag = "type"` で discriminate**、`rename_all_fields = "camelCase"` で JSON は camelCase。

各 Action variant ごとに endpoint が決まる (= block を渡せば呼び先が自明な自包含設計):

| Enum | 親 Block | Variant | endpoint |
|---|---|---|---|
| `CtaAction` | `Cta` | `AddToCart { productId, qty }` | `POST /api/v1/cart` (returns `undoToken`) |
| `CtaAction` | `Cta` | `ToggleWatch { productId }` | `POST /api/v1/watch/{productId}` |
| `LineItemAction` | `LineItem` | `SetQty { token, qty }` | `PATCH /api/v1/cart/items/{token}` |
| `LineItemAction` | `LineItem` | `Remove { token }` | `DELETE /api/v1/cart/items/{token}` |
| `CheckoutFieldAction` | `FormField` | `PatchField { fieldName }` | `PATCH /api/v1/checkout/shipping_field/{fieldName}` |
| `CheckoutMethodAction` | `ShippingMethodPicker` | `PatchMethod` | `PATCH /api/v1/checkout/shipping_method` |

**それぞれ別 enum にする理由**:
- 関心が違う (商品操作 / cart 行操作 / 配送先 / 配送方法)
- `tag = "type"` を共有すると client 側 narrow が混線する
- 将来 endpoint 構造が分岐した時に enum ごと差し替えできる柔軟性が要る
- block と endpoint を 1:1 で揃える (= block 渡す → 何呼べばいいか自明)

**`href` は Action と共存**: `Block::Cta.action: Some(...)` の時も `href` は **必須**。JS が無効な環境でも CTA がリンクとして機能する progressive enhancement。例: AddToCart の href は `/cart?add=...` を指し続ける (= no-JS フォールバック)。

**`Action.field_name` / `Action.token` を action 側に持たせる理由**: client が URL を組むとき、block を渡すだけで PATCH/POST 先が決まる **自包含設計**。client は「この block のアクションをやれ」と命令されるだけ。

### 11.7 Analytics ingest endpoint (Phase 3)

```
POST /api/v1/events                  # batch ingest (impression / click)
GET  /api/v1/events?limit=N          # 直近 N 件 (debug 用、新しい順)
```

クライアント側 `sdui/analytics.ts` が定期 flush で `POST /events` を叩く設計。サーバ側は受け取った payload を validate し、in-memory ring buffer に積むだけ (集計や可視化は別経路 / Phase 4 以降に分離)。

**サーバ側 validate** (上限値の詳細は §11.2 の表):
- `analyticsId` 空 / 128 文字超 → 400 (batch 単位で全件 reject)
- `eventType` 未知 → 400 (deserialize 時点で reject)
- `events.length > 100` / payload `> 64 KB` → 413
- `context` のキー集合は validate しないが、キー数 (32) / 値長 (256) は超過時 400
- ring buffer は in-memory 固定容量 (= debug 用)。本格運用時は Phase 9+ で永続化先を切替予定。

### 11.8 Server-driven state pattern (Phase 7-8 で確立)

**規律**: mutation を伴う UI (Cart の qty / Checkout のフォーム値 / 配送方法) は **client にローカル state を握らせない**。次の流れで動かす。

```
User 操作 (例: + ボタン押下)
   ↓
client は LineItemAction を読んで PATCH /cart/items/{token} { qty: qty+1 } を発行
   ↓
server は cart_store を更新し 204 No Content を返す
   ↓
client は GET /cards/cart で snapshot を再 fetch
   ↓
新しい CardBlock を CardRenderer に流し込む
   ↓
UI が server の真実値で再描画される
```

**理由**:
- client と server で「カートの qty / 配送先の値」がズレる事故が原理的に起こらない
- client 側に optimistic update の reducer を書く必要がない (= UI コードが薄い)
- server-side validation (在庫切れ / 必須未入力) の結果 UI が **そのまま画面に反映される**
- 多人数 / 多デバイスで同時操作されても、最後の fetch が真実

**コスト**: mutation のたびに 1 round-trip かかる。許容できる UX かどうかは粒度ごとに判断。FormField は debounce 300ms 程度を入れて、入力が落ち着いてから PATCH する。配送方法は radio change 即発火で OK (頻度が低い)。

**例外**: 純粋なフロント表示状態 (gallery のサムネ選択 / アコーディオン開閉 等) は server に上げない。**「server 真実値が欲しい状態」と「ローカル UI 状態」を区別**して、前者だけ server-driven にする。

#### 11.8.1 in-flight input field の取り扱い (Phase 9 前に追加)

server-driven state pattern の素朴な実装には **入力中の値が突然 server 値で巻き戻る / PATCH レスポンス逆順到着で UI がチラつく** というレース条件がある。以下の 3 つを規律として client 側で守る。

**規律 1 — focus / dirty 中の field は server 値で上書きしない**:
- `<input>` / `<select>` / `<textarea>` がフォーカスされている、または最後の編集から **800 ms 以内**の field は、`/cards/cart` 再 fetch のレスポンスが届いても `value` を上書きしない。
- 上書きを保留している間、server 側 `validation_error` の更新は反映する (= 「入力値は client 優先 / 妥当性は server 優先」の分離)。
- focus が外れた瞬間 / 800 ms 経過時に server 値とローカル値が異なれば、その時点でローカル値を捨てて server 値で再描画する。

**規律 2 — request_seq による最新勝ち merge**:
- mutation を発する client は **単調増加の `request_seq` (= タブ起動時に 1 から始まる counter)** を内部で持ち、PATCH 完了後の `/cards/cart` 再 fetch レスポンスにこの seq を紐付けて保持する。
- レスポンス到着順が逆転した場合、**最大 seq に対応する snapshot のみが UI を更新**し、それより古い seq のレスポンスは破棄する。
- これにより `(PATCH n) → (PATCH n+1) → (GET for n+1) → (GET for n)` の交差で UI が古い値に戻る事故を防ぐ。

**規律 3 — `<For>` key の安定性**:
- region 配列を描画する `<For each={regions.shipping}>` の key は **`block.key`** を使う (`index` ではない)。
- これにより block 配列の順序が変わっても input の DOM identity が保たれ、IME 変換中・ペースト直後の input value / caret 位置が失われない。
- §13.4 のレース条件 E2E テストで「IME 変換中に snapshot が降ってきても変換が壊れない」ことを assert する。

**実装の所在**: `client_solid/src/sdui/useFormFieldState.ts` (focus / dirty 検出 + マージ) / `useCartSnapshot.ts` (request_seq 管理) を §19.3 の再実装時に新設する。

#### 11.8.2 Cross-tab 同期 (Phase 9 前に追加)

1 ユーザが 2 タブ以上で同じカートを開いた場合、片方の mutation は他方タブの UI に届かない (= 各タブが自前の `/cards/cart` snapshot で動く)。WebSocket push (§17 Future Work) の前段として、**`BroadcastChannel` で他タブに「再 fetch せよ」を通知**する暫定方針を採る。

```typescript
// client_solid/src/sdui/cartChannel.ts
const channel = new BroadcastChannel("kochu_cart_invalidate");

// mutation 成功時 (api.ts 内)
export async function patchLineItemQty(token: string, qty: number) {
  await fetch(`/api/v1/cart/items/${token}`, { method: "PATCH", body: JSON.stringify({ qty }) });
  channel.postMessage({ type: "invalidate", at: Date.now() });
  // 自タブも再 fetch (§11.8 主規律)
  await refetchCart();
}

// 受信側 (useCartSnapshot.ts)
channel.addEventListener("message", (ev) => {
  if (ev.data?.type === "invalidate") refetchCart();
});
```

**規律**:
- データ自体は流さない。**「再 fetch せよ」のシグナルのみ**を流し、真実値は常に server から引き直す (= §11.8 主規律と整合)。
- payload に sequence / timestamp を含めて、自タブで発した invalidate を loop back で受け取った場合に dedup する。
- `cart` / `checkout` / `watch` の 3 ドメインで個別の channel を切る (`kochu_cart_invalidate` / `kochu_checkout_invalidate` / `kochu_watch_invalidate`)。

**WebSocket push への移行**: §17 Future Work で push 接続が入ったら、`BroadcastChannel` invalidate は維持したまま「他デバイスからの push」を新たな invalidate トリガとして追加する。client UI 側のマージロジックは変更不要。

## 12. i18n

(v5 と同じ)

### 12.1 値は Localizable に統一

§4.1 の `Localizable` を全 user-facing テキストに使う。

### 12.2 静的 vs 動的の判別

| 判定基準 | 種別 | 表現 |
|---|---|---|
| デザイナー / 運営が編集する固定コピー | 静的 | `{ source: "i18n", key: "..." }` |
| 商品マスタ・カウンタなどデータソースから来る | 動的 | `{ source: "raw", text: "..." }` |
| 一部のみデータ駆動 (「{n} 日後に羽化予測」など) | 部分動的 | `{ source: "i18n", key: "...", params: {...} }` |

### 12.3 辞書の所在

- 静的 UI コピー → フロントリポジトリ内の JSON (`client_solid/src/i18n/<locale>.json`)
- 動的データ (商品名・説明) → 商品マスタが locale 別カラム or 翻訳テーブルを持ち、API レスポンスに raw で含める

### 12.4 `I18nKey` のバージョンサフィックス運用ルール

通常の翻訳更新ではサフィックスを切らず、in-place で辞書を書き換える。サフィックスを切るのは **意味が変わる差し替え** または **コピー A/B テスト**の 2 ケースに限る。

### 12.5 `params` の使い方ルール

`params` には **動的な値 (数値、ID、ユーザー名など) のみ**を渡す。**それ自身が翻訳対象になる文字列 (UI コピー、ラベル) は params に渡さない**。

### 12.6 例外: `meta_line.items[].value`

ID やショップ名は固有名詞 / 商号で **翻訳対象外** なので、Localizable ではなく `string` を直接持つ。

### 12.7 Phase 7-8 での Localizable 運用

- `LineItem.title`: 商品名なので **基本は `raw`** (商品マスタから流す)。多言語商品名が将来必要になったら §17 を参照
- `FormField.label` / `placeholder` / `validationError`: **すべて `i18n`** が原則。`validationError` は server が `{ source: "i18n", key: "checkout.shipping.name.required" }` のように返す
- `ShippingMethodOption.name` / `description`: `i18n` 推奨。MVP では `raw` (日本語固定) でも OK

## 13. テスト戦略

### 13.1 フィクスチャ駆動の Storybook

`fixtures/cards/*.json` に各テンプレート × 全 variant のサンプル `CardBlock` を置き、Storybook で全パターンを描画する。Phase 2-8 で追加された template / block も網羅:

- `product_feature.featured.json` / `product_feature.compact.json`
- `product_detail.default.json`
- `cart.empty.json` / `cart.with_items.json` / `cart.with_shipping.json`
- `product_list.with_filters.json` / `product_list.with_sort.json` / `product_list.with_pagination.json` / `product_list.with_search.json`

### 13.2 スキーマ契約テスト

- Rust 側で `schemars` を使い JSON Schema を出力 (`fixtures/schema/cardblock.schema.json`)
- フロント側 CI で **フィクスチャが Schema を満たすことを検証** (`ajv` 等)
- Rust 側でも `cargo test` でフィクスチャを `serde_json::from_str::<CardBlock>` できることを検証
- ts-rs 生成物の差分が無いことを CI で検証
- フィクスチャを `validate_keys()` に通し、key 重複が無いことを確認
- Storybook + `axe-core` で「同一カード内に複数 h タグが出ない」を assertion

### 13.3 縮退テスト

`fixtures/cards/broken/` に異常系を置き、縮退動作を検証:

- `unknown_template.json` / `unknown_block_type.json` / `missing_i18n_key.json`
- `invalid_href.json` — `javascript:` 等が Rust の deserialize で reject されること
- `invalid_region.json` — `product_feature` に `gallery` を入れた状態 → `deny_unknown_fields` で reject
- `duplicate_key.json` — カード内 key 重複 → `validate_keys()` で reject
- `invalid_experiment.json` — `bucket: " B "` 等が `Experiment::try_from` で reject
- (Phase 8) `form_field_without_input_type.json` — `kind: { }` (inputType 欠落) → reject
- (Phase 8) `shipping_method_unknown_id.json` — `selectedId` が `options[].id` のいずれにも無い

### 13.4 Action 系の契約テスト

**Phase 2.5 (CtaAction)**:
- `CtaAction::AddToCart { qty }` は **`qty >= 1` を Rust deserialize で reject せず受け取り、handler 側で `qty < 1` なら 400** を返すこと (型レベル拒否は overkill / 整数演算で吸収)
- `POST /api/v1/cart` のレスポンスに `undoToken` が含まれること、その token で `DELETE /api/v1/cart/items/{token}` が成立すること
- `CtaAction::ToggleWatch { productId }` の URL は `/api/v1/watch/{productId}` であり、`productId` のみ path にエスケープして乗ること (= productId に `/` や `?` が混じった場合に encodeURIComponent される)
- `Block::Cta.action` が `Some` でも `href` が **必ず** 設定されていること (= no-JS フォールバックの破綻検出)

**Phase 7 (LineItemAction)**:
- `LineItemAction::SetQty { qty: 0 }` は契約上送られない (= remove を使う) ことを Rust テストで保証 (handler 側で `qty < 1` なら 400)
- `LineItemAction::Remove { token }` は `DELETE /cart/items/{token}` に直結すること
- token が server 側 cart_store に存在しない場合は 404 を返すこと (= 多人数同時操作の整合)

**Phase 8 (CheckoutFieldAction / CheckoutMethodAction)**:
- `CheckoutFieldAction::PatchField { fieldName }` の `fieldName` が `Block::FormField.name` と **1 文字も違わず** 一致することを mock で確認
- 未知の `fieldName` で PATCH すると 400 を返す (= 改竄 / バグ検出)
- `CheckoutMethodAction::PatchMethod` の body が許可された `selectedId` (= options[].id のいずれか) でなければ 400
- `validation_error` が server から返った場合に block の `validationError` フィールドに乗って UI に出ること (i18n 解決込み)

**横断**:
- PATCH / POST 後の再 fetch で UI が server 値に整合する flow をテスト (E2E)
- mutation → 再 fetch → 描画の round-trip が **debounce / dedup されない** こと (= server 真実値が常に最後に勝つ §11.8)

**race condition (§11.8.1 規律のテスト, Phase 9 前に追加)**:
- **5 連打レース**: `+` を 5 連打しつつ `/cards/cart` 再 fetch が交差する状況で、UI が最終的に「+5 後」の qty に収束する (= request_seq 規律 2)
- **focus 中の上書き禁止**: input にフォーカスがある状態で snapshot が降ってきても `value` が巻き戻らない (= 規律 1)
- **逆順到着の dedup**: 連続 PATCH (`qty=2 → qty=3`) のレスポンスが逆順到着しても最終 UI 状態が新しい seq に整合する (= 規律 2)
- **IME 変換中の DOM 維持**: 日本語入力の変換中に snapshot が降ってきても変換が壊れない (= 規律 3 + §10.5 規律 3)
- **a11y フォーカス保持** (§10.5 規律 3): snapshot 差し替え後にスクリーンリーダー (= axe-playwright で simulate) のフォーカスが飛ばない
- **aria-live 発火** (§10.5 規律 1): mutation 完了時に `<div role="status">` が更新され、エラー時に `aria-live="assertive"` がアナウンスされる

**cross-tab 同期 (§11.8.2 のテスト, Phase 9 前に追加)**:
- 2 タブで同じカートを開き、片方で `+` を押すと他方が即座に再 fetch して同じ qty を表示する
- BroadcastChannel の自タブ loop back invalidate を dedup する (= 同じ tab 起源の invalidate を二重 fetch しない)

### 13.5 i18n キー網羅 CI (Phase 9 前に追加 / **実装済み**)

§10.1 で「本番でキー解決失敗時は空文字 + エラーログ」と規定したが、これは**本番環境で文字が消える事故を許容する**設計でもある。CI で **Rust source / fixture / TS source の `I18nKey` 参照集合 vs `client_solid/src/sdui/i18n/dict.ts` の辞書キー集合**を突き合わせることで、漏れを deploy 前に検出する。

**実装方針 (M5 で確定)**: Rust extractor は別 binary に切らず、**Node 単独で完結する extractor + checker**にした (= cargo に依存しない)。Rust source も regex で scan できるため、二段パイプライン (cargo → Node) は不要と判断。

**実装ファイル**: `client_solid/scripts/check-i18n-keys.mjs`

**抽出対象**:
1. **Rust source** (`server/**/*.rs`): `i18n("key")` / `I18nKey::new("key")` / `Localizable::I18n { key: "..." }` の 3 パターン
2. **JSON fixtures** (`**/*.json`): `{ "source": "i18n", "key": "..." }` リテラル
3. **TS source** (`client_solid/src/**/*.{ts,tsx}`): `{ source: "i18n", key: "..." }` / `asI18nKey("...")` (= 主にテスト fixture)

**辞書の所在**: `client_solid/src/sdui/i18n/dict.ts` の `SDUI_DICT_JA`。dict.ts は regex で `"key": value` ペアを抽出する (`SDUI_DICT_JA` ブロック内のみ; コメント行 `//` は除外)。

**判定**:
- 欠落 (referenced but not in dict) → **CI fail** (= 本番で空文字事故になる)
- 余剰 (in dict but not referenced) → **warn** (デフォルト) / `--strict` で fail (= 死んだ翻訳の検出)

**npm scripts**:
- `npm run check:i18n` — 通常モード (missing は fail / extra は warn)
- `npm run check:i18n:strict` — extra も fail

**出力モード**:
- 通常: 人間可読のレポート (CI ログ用)
- `--json`: 機械可読 (`{ referenced, dict, missing, extra }`)

**CI 統合**: `.github/workflows/ci.yml` に `npm run check:i18n` ステップを追加 (= 別途実 infra で). pre-commit hook にも組み込み推奨。

**動作検証**: `dict.ts` から `badge.featured` を 1 件削除 → exit 1 + 該当 reference ファイル一覧を表示することを確認済み。

**多 locale 化時の拡張ポイント**: `readDictKeys()` 内で `SDUI_DICT_JA` ブロック決め打ちで parse しているため、`SDUI_DICT_EN` 等を追加する際は同関数を locale で parametrize する。各 locale の差分も同時に検出する想定。

**例外**: `validation_error` で server が動的に組み立てるキー (= field 名 × エラー種別) は extractor の対象外。これらは別途 enum で網羅する設計とし、§17 Future Work に「validation_error key 網羅 CI」として追記済み。

### 13.6 ラウンドトリップ等価性テスト (Phase 9 前に追加 / **両側実装済み**)

ts-rs (= TS 型生成) + schemars (= JSON Schema 生成) の二重生成パイプラインの保証層として、property-based test を導入する。任意の `CardBlock` を生成 → JSON シリアライズ → 再 deserialize した際の等価性を assert することで、discriminator 名衝突 (§4.2.1) / camelCase / snake_case 揺れ / `Option<T>` の `null` vs missing 揺れ / `#[serde(default)]` の片側忘れ を機械的に検出できる。

**Rust 側 (`proptest`) — 実装済み**:
- `server/Cargo.toml` の `[dev-dependencies]` に `proptest = "1"` を追加。
- `server/tests/sdui_roundtrip.rs` (integration test) に下記の strategy を実装:
  - `arb_localizable()` (= i18n / raw / params 揺れ)
  - `arb_cta_action()` / `arb_param_value()` / `arb_simple_block()` (= 主要 9 種類の Block variant)
  - `arb_product_feature_card()` (= ProductFeature カードを 1 headline + 残り任意 Block で組み立て)
  - 各 branch を `.boxed()` で `BoxedStrategy` に揃えて `prop_oneof!` の型統合を確実化
- `proptest!` マクロでテスト 5 件を整備:
  - `localizable_roundtrip` / `cta_action_roundtrip` / `block_roundtrip` / `analytics_event_roundtrip` / `product_feature_card_roundtrip`
  - `serde_json::to_string` → `serde_json::from_str` → `prop_assert_eq!` で等価性確認
  - card test は `validate_keys()` / `validate_a11y()` の事前チェックで invariant 違反を pre-filter
- 静的 sanity test 3 件: `all_text_role_variants_roundtrip` / `empty_card_roundtrip` / `analytics_batch_roundtrip_with_skip_deserializing` (= `serverReceivedAtMs` の skip_deserializing 規律を proptest 外で固定検証)
- `cases: 256` で実行 (= 通常 CI 実行時間に収まる)。flaky になれば strategy を狭めるか cases を増やす。

**Rust 側 strategy が現状カバーしない範囲** (= 今後の拡張 TODO):
- `Block::EclosionForecast` / `Block::Divider` / cart 専用 fat block (`LineItem` / `OrderSummary` / `FormField` / `ShippingMethodPicker`) の strategy
- `CardBlock::ProductDetail` / `CardBlock::Cart` の strategy
- `Experiment` の bucket / key 文字列の正規表現整合性

**TS 側 (`fast-check`) — 実装済み**:
- `client_solid/package.json` の devDependencies に `fast-check ^4.7.0` を追加。
- `client_solid/src/sdui/roundtrip.test.ts` に下記の arbitrary を実装:
  - `arbLocalizable` (i18n / raw / params 揺れ)
  - `arbCheckoutFieldAction` / `arbCheckoutMethodAction` / `arbLineItemAction` / `arbCtaAction`
  - `arbBlock` (text / cta / badge / price / divider の 5 主要 variant)
  - `arbAnalyticsEvent` (`serverReceivedAtMs` / `context` の optional + null vs missing 揺れ)
- property test 8 件 + 静的 sanity 2 件 = 計 10 件。`assertJsonRoundtrip` で `JSON.parse(JSON.stringify(x)) === x` を deep equal で確認。
- `numRuns: 256` で実行 (= vitest の通常実行時間に収まる)。
- branded.ts ↔ generated/sdui.ts の **構造的互換性** を runtime レベルで確認: `asI18nKey("badge.featured")` / `asHref("/...")` が JSON 経由で生 string として読めることを assert (= branded brand が runtime 影響しないことの保証)。

**ajv (JSON Schema 検証) は未実装**: schemars が出力する `*.schema.json` ファイル群がまだリポジトリに存在しないため、ajv 統合は schema 出力パイプライン (= `cargo run --bin generate_schema` 相当) を整備した時点で追加する。Phase 9+ の TODO。

**ラウンドトリップ**:
- Rust が生成した JSON 文字列を TS 側でロードして `ajv` で validate。
- TS が生成した JSON 文字列を Rust 側でロードして `serde_json::from_str` できることを assert。
- 双方向で同じ fixture が両言語で読めることが保証される (= server / client 間の wire format の不変性)。

**CI 統合**:
- Rust 側は `cargo test` の通常実行に proptest テストを含める。実行時間が長ければ `[ignore]` + nightly job で動かす。
- TS 側も `bun run test` に含める。

**完了条件**: 1 万件のランダム CardBlock でラウンドトリップ green。CI が緑色のまま固定。

## 14. キャッシュ戦略 + レスポンス構造

### 14.1 `CardBlock` 単体のレスポンス

単一カードを返す API (例: `GET /api/v1/cards/products/{id}`) は、`updated_at` を **HTTP ヘッダ**で返す:

```
HTTP/1.1 200 OK
ETag: "kochu-DHH-0271-20260420T1230Z"
Last-Modified: Mon, 20 Apr 2026 12:30:00 GMT
Cache-Control: public, max-age=60
Content-Type: application/json

{ "id": "DHH-0271", "template": "product_feature", ... }
```

`CardBlock` 自体は `updated_at` フィールドを **持たない** (UI 描画に不要なため、Non-Goals §16)。

### 14.2 カードコレクションのレスポンス (v6 — Phase 4-6 で確立)

`/api/v1/cards/products?...` は `ProductListResponse` を返す。`updated_at` を持たせる場合は `meta` エンベロープに集約:

```jsonc
{
  "filterBar": { "groups": [...] },
  "sortBar":   { "current": "name", "options": [...] },
  "searchBox": { ... },
  "pagination": { "page": 1, "perPage": 20, "totalCount": 42, ... },
  "cards": [
    { "id": "DHH-0271", "template": "product_feature", ... },
    { "id": "DHH-0341", "template": "product_feature", ... }
  ]
}
```

ETag はコレクション全体に対して 1 つ発行する。クエリ string (filter/sort/search/page) を ETag のキーに含める。

### 14.3 Cart / Checkout (Phase 7-8) のキャッシュ

- `GET /api/v1/cards/cart` は **personalized response** なので長期キャッシュしない
- `Cache-Control: no-store` を返す
- `Vary: Cookie, Authorization` を併記する (= 万一 CDN が中継してしまった場合の最後の防壁。一次防衛は §14.5 の path-level 物理遮断)
- mutation 後の再 fetch (§11.8) は毎回 server に当てる

### 14.4 キャッシュキー (v5 と同じ)

- experiment が絡むレスポンスは **bucket をキャッシュキーに含める** (`/api/cards/...?bucket=B`)
- ユーザー固有データ (パーソナライズ、ログイン状態) は **別 API に分離** して `CardBlock` には混ぜない
- experiment の bucket は `hash(session_id, experiment.key)` で決定論的に算出
- i18n 辞書は locale 単位で長期キャッシュ (1 時間〜)、辞書ファイル自体のハッシュで cache-bust

### 14.5 認証必須エンドポイントの CDN 隔離 (Phase 9 前に追加 / **雛形 docs 完備**)

> **実装雛形**: KOCHU プロジェクトのインフラは AWS 統一のため、具体的な edge ロジック (CloudFront Functions / Lambda@Edge / WAF / IaC 雛形) と synthetic test スクリプトは `docs/infra/cdn-private-paths.md` を参照。Phase 9 着手時に Distribution / Function / WAF を本番展開する。


§14.3 で `/api/v1/cards/cart` 等に `Cache-Control: no-store` + `Vary: Cookie, Authorization` を返しているが、これは **最後の防壁** である。一次防衛として、**認証必須 endpoint が共有 CDN に到達する経路を物理的に塞ぐ**方針を採る。

**対象 path** (= 共有 CDN allowlist から除外 / private path として扱う):

```
/api/v1/cards/cart            # GET (cart snapshot, personalized)
/api/v1/cart                  # POST (add to cart)
/api/v1/cart/items/{token}    # PATCH / DELETE (qty / remove)
/api/v1/checkout              # GET (debug snapshot)
/api/v1/checkout/shipping_field/{name}    # PATCH
/api/v1/checkout/shipping_method          # PATCH
/api/v1/watch/{product_id}    # POST (watch toggle)
/api/v1/events                # POST / GET (analytics ingest, セッション ID 紐付け)
```

**実装方針**:
- AWS CloudFront Functions (Viewer Response phase) で上記 prefix に **`Cache-Control: private, no-store` を強制上書き** + `x-kochu-cdn: private-enforced` ヘッダを付与 (= 監視 / synthetic test 用)。実装は `docs/infra/cdn-private-paths.md` の §5.1。
- origin が `Cache-Control: public` を返してきても edge で打ち消す (= origin 側のミスを edge で吸収)。
- `/api/v1/cards/products` (= 一覧 / 詳細 / SDUI shell) は `experiment.bucket` を URL に含めればキャッシュ可能なので allowlist 側に残す。

**運用**:
- infra 設定の雛形を `docs/infra/cdn-private-paths.md` に置き、Phase 9 着手時に CDN プロバイダ依存の具体設定を加える。
- CI で「上記 path 一覧が `Cache-Control: private` 系を返している」ことを synthetic test (= 実 edge への HEAD リクエスト) で監視する。
- 新しい認証必須 endpoint を追加する PR では、infra config への追記が無い場合に CI fail する lint を仕込む (= path 一覧を Rust source で唯一の真実とする)。

**規律**: `Vary: Cookie` だけに頼らない。CDN によっては `Vary` が無視される / cache key 計算でバグることが現実にあるので、**path-level の物理遮断を一次防衛とする**。

## 15. 段階導入プラン (実績)

### 15.1 完了したフェーズと endpoint

| Phase | 内容 | 主な endpoint / type |
|---|---|---|
| 1 | `product_feature` テンプレート | `GET /api/v1/cards/products/{id}` |
| 1 | フィクスチャ駆動の `/products-sdui` (旧プレビュー画面) | (廃止済み) |
| 1.5 | `/products` 本番ページの SDUI 化 | 同 endpoint を /products から fetch |
| 2 | `product_detail` テンプレート + `ProductDetailRegions` (gallery / hero / spec / pricing / cta + 後に promise) | `GET /api/v1/cards/products/{id}/detail` |
| 2.5 | `Block::Cta.action: Option<CtaAction>` + `AddToCart` / `ToggleWatch` | `POST /api/v1/cart` (returns `undoToken`) / `DELETE /api/v1/cart/items/{token}` / `POST /api/v1/watch/{productId}` |
| 3 | Analytics 計装 (`AnalyticsEvent` / batch flush / IntersectionObserver impression / click) | `POST /api/v1/events` / `GET /api/v1/events?limit=N` |
| 4 | Filter chip (`FilterBar` / `FilterGroup` / `FilterChipItem`) + `ProductListResponse` shell | `GET /api/v1/cards/products?category=...&difficulty=...` |
| 5 | Sort (`SortBar` / `SortOption`) + faceted count on FilterChipItem | `GET /api/v1/cards/products?sort=...` |
| 6 | Pagination (`Pagination` / `PageLink`) + Search (`SearchBox`) | `GET /api/v1/cards/products?page=...&per_page=...&q=...` |
| 7 | Cart (`cart` template / `LineItem` / `OrderSummary` / `LineItemAction`) | `GET /api/v1/cards/cart` / `PATCH /api/v1/cart/items/{token}` |
| 8 | Checkout (`FormField` / `ShippingMethodPicker` / `CheckoutFieldAction` / `CheckoutMethodAction` + `CartRegions.shipping` / `shipping_method`) | `PATCH /api/v1/checkout/shipping_field/{name}` / `PATCH /api/v1/checkout/shipping_method` / `GET /api/v1/checkout` (debug snapshot) |

### 15.2 endpoint 全 listing (v6)

```
# Health / hello
GET    /health
GET    /api/v1/hello

# Cards
GET    /api/v1/cards/products                           # 一覧 (ProductListResponse)
GET    /api/v1/cards/products/{id}                      # 単一カード (product_feature)
GET    /api/v1/cards/products/{id}/detail               # 詳細カード (product_detail)
GET    /api/v1/cards/cart                               # カート (cart)

# Cart mutations (Phase 2.5 / 7)
POST   /api/v1/cart                                     # 追加 → undoToken
DELETE /api/v1/cart/items/{token}                       # Undo / 削除
PATCH  /api/v1/cart/items/{token}                       # qty 直接書き換え

# Watch (Phase 2.5)
POST   /api/v1/watch/{product_id}                       # ウォッチトグル

# Checkout (Phase 8)
PATCH  /api/v1/checkout/shipping_field/{name}           # 配送先 1 フィールド更新
PATCH  /api/v1/checkout/shipping_method                 # 配送方法切替
GET    /api/v1/checkout                                 # snapshot (debug 用)

# Analytics ingest (Phase 3)
POST   /api/v1/events                                   # batch (impression / click)
GET    /api/v1/events?limit=N                           # 直近 N 件 (debug)
```

### 15.3 凍結中・未着手

- `hero_intro` テンプレート: ヒーローセクションの動的化。要件が変動中で凍結。
- `promise_step` テンプレート: 約束カードの動的化。同上。
- 決済本体 (Stripe Checkout / Webhook): Phase 9 候補。`POST /api/v1/checkout/submit` で Stripe Session を作って 303 redirect する想定。
- 注文履歴 (`order` template): Phase 10 候補。

## 16. やらないこと (Non-Goals)

(v5 と同じ + Phase 7-8 の追加規律)

- 任意の CSS/style を DB に保存しない
- 生の HTML を DB に保存しない
- 位置・座標を DB に保存しない
- 見出しレベル (h1-h6) を DB に保存しない
- 生のローカライズ済み文字列を静的コピーとして DB に保存しない
- 任意の `href` を許容しない
- utm パラメータを `Href` に焼き込まない
- `MediaFallback` の中間 a11y 状態 (`role="img"` で aria-label 無し) を許容しない
- `params` に翻訳対象文字列を入れない
- テンプレートが許容しないリージョン名のデータを通さない
- `block.key` 等を空文字 / 非一意で許容しない
- パーソナライズ / 条件出し分けを SDUI スキーマに入れない (= 別 API で処理)
- A/B テストのフラグ評価をフロントでしない
- 画像最適化 (srcset / picture / AVIF) を DB に持たせない
- エラー / ローディング状態を SDUI スキーマに持たせない
- TypeScript 型を手書きしない
- Solid のテキスト描画で `<L>` / `localizable()` を経由しない直接展開を許容しない
- `generated/sdui.ts` を直接 import しない (`branded.ts` 経由必須)
- `updated_at` などの運用メタを `CardBlock` フィールドに含めない (HTTP ヘッダ / レスポンスエンベロープで返す)
- 使う予定のない enum variant / 型を予約しない (Future Work に書く)
- Notion レベルの自由ブロックツリーは目指さない
- **(Phase 7) cart の qty 計算を client で持たない** (server が `subtotalAmount` / `totalAmount` を確定値で返す)
- **(Phase 8) form の input value を client signal で握らない** (debounce → PATCH → 再 fetch で server 真実値を反映)
- **(Phase 8) checkout で client 側 validation を最終真実にしない** (= server validate 結果を `validation_error` で受け取る)
- **(Phase 4-6) toggle URL を client で組まない** (server が `href` を返す)
- **(規約) `LineItemAction::SetQty { qty: 0 }` を送らない** (= remove を使う)
- **(規約) `Action.token` の中身を client で解釈しない** (server 不透明 ID として扱う)
- **(Phase 9 前) `AnalyticsEvent.timestampMs` を集計の真実値として使わない** (= server 受信時刻 `serverReceivedAtMs` を真実値とする §11.2)
- **(Phase 9 前) focus 中 / 直近編集中の input field を server 値で上書きしない** (§11.8.1 規律 1)
- **(Phase 9 前) 認証必須 endpoint を共有 CDN allowlist に含めない** (§14.5)
- **(Phase 9 前) `<For>` の key に `index` を使わない** (= block.key 必須、§11.8.1 規律 3 / §10.5 規律 3)
- **(Phase 9 前) headline ブロックを 1 テンプレート内に 2 個以上置かない** (§5.2 + §7.7 ValidateA11y で reject)

## 17. Future Work

- **多通貨対応** — `Currency` enum に `USD` / `EUR` を追加 (Rust enum variant 追加は後方互換)。Phase 8 までは JPY 固定。**移行時は §4.2.2 のとおり `amount` を minor unit に統一する破壊的変更を伴う** (TS 側 `Money` 型に `scale` を持たせる API 変更)。
- **ブロック単位の experiment** — 同じカード内の CTA ラベル A/B など。`Block` のタグ付き union に各バリアント `experiment?: Experiment` を追加する余地あり
- **ページレベルの構造化** — `{ page: ..., sections: [{ type, items: [{ $ref: cardId }] }] }` の二段階抽象。`ProductListResponse` の発展形
- **リッチテキストブロック** — 限定タグ allowlist 付きの `rich_text` ブロック型 (商品説明 / 約束カードに必要になったら)
- **多言語商品名** — `LineItem.title` / `MetaItem.value` の Localizable 化。`NonLocalizableString` ブランド型を切って「翻訳対象外」を型で表明する案
- **ts-rs の JSON Schema 出力対応** — 対応次第 schemars を廃止できる可能性
- **Href の本格 allowlist** — `KNOWN_EXTERNAL_HOSTS` 定数 + utm 排除を `Href::parse` に統合
- **Stripe Checkout 統合 (Phase 9)** — `POST /checkout/submit` → Stripe Session → 303 redirect。`cta` の action 拡張で `OpenStripeCheckout { sessionUrl: Href }` を追加
- **注文履歴 (Phase 10)** — `order` template + `OrderSummary` の発展系 (status / shipped_at / tracking_url)
- **Block 単位 cache header** — `LineItem` / `OrderSummary` のように頻繁に変わる block と、`Promise` のように変わらない block で TTL を分けたい場合、Block 単位の `updatedAt` (HTTP ヘッダの `meta` エンベロープに集約) を導入する案
- **WebSocket push** — cart の他デバイス操作を即時反映するために `/cards/cart` をポーリングではなく push にする
- **Form field の client-side validation hint** — server が `regex: string` / `minLength: number` を block に含めて返し、client が「PATCH 前にローカル検証」できるようにする (= round-trip 削減)
- **テンプレートのバージョニング (`__v2`) 並走戦略** — §8 の命名規則で `product_feature__v2` のような suffix が予約されているが、並走期間 (= v1/v2 が同時に api response に乗りうる時期) の switch ロジック (= データソース側の version flag をどう持つか / client 側 CardRenderer の `Switch` をどう拡張するか) は **v2 採用が現実化した時点で詰める**。いま詳細を書くと「使われない設計」になり §2 設計原則 12 に抵触するため、トリガまで遅延。

## 18. 参考にした設計

- Sanity CMS Portable Text — ブロック配列の考え方
- Airbnb DLS / Server-Driven UI — テンプレート + データ分離
- Shopify Polaris — クローズドな語彙統制
- Material Design Tokens — テーマトークンの限定列挙
- 新聞組版用語 (eyebrow / headline / lead / byline) — テキストロール命名
- ICU MessageFormat / FormatJS — i18n キー方式と params
- GrowthBook / Optimizely — サーバ側 A/B 解決パターン
- ts-rs / schemars — Rust source of truth からの型生成
- Solid `<For>` / `<Show>` / `createMemo` / Context — リアクティブ UI パターン
- Branded types in TypeScript (Effect-TS / fp-ts) — ts-rs 生成物上のブランド型レイヤ
- Stripe Checkout / Form-driven server state (HTMX / Hotwire) — Phase 7-8 server-driven state pattern の発想元

## 19. 現状とリカバリ (2026-04-25 時点)

> このセクションは v6 リリース時点での **実装ファイルの存続状態** を記録する。設計仕様自体ではないが、プロジェクトを再開する際に必要な「どこから再構築するか」の地図として保持する。
>
> **クリーンアップ方針**: 本章は **client 側 (`client_solid/src/sdui/*`) の再実装が完了した時点で削除** し、設計書としてのノイズを取り除いた **v7** を切る。v7 は §1 〜 §18 のみの「仕様純度 100%」版にする。本章は git history に残すことで「なぜ v6 でここまで仕様密度を高めたか」(= 焼失からの復元レファレンスを兼ねていたから) の文脈を保存する。
>
> **削除のトリガ条件**:
> 1. §19.3 のリカバリパス A〜C のいずれかで client 側 `BlockRenderer.tsx` / `CardRenderer.tsx` / 全 13 block view / 3 template / `api.ts` / `analytics.ts` が動く状態に戻ったこと
> 2. `cd client_solid && bun run typecheck && bun run test` が green
> 3. `/products` / `/products/{id}` / `/cart` の主要 3 ページが手動 smoke テストで動くこと
>
> 上記 3 つを満たした時点で v7 を切り、v6 はアーカイブ扱いにする。

### 19.1 健全 (= disk 上で完全に残っている)

| 領域 | パス | 状態 |
|---|---|---|
| Rust source (Phase 1-8 全コード) | `server/src/sdui/*.rs` (analytics / blocks / experiment / list / regions / validate / mod) | OK |
| Rust handler (cart / checkout / events / watch / cards) | `server/src/handlers/*.rs` | OK |
| ts-rs 生成 bindings (41 ファイル) | `server/bindings/*.ts` | OK (Phase 8 分は今セッションで再生成) |
| 集約された TS 型 | `client_solid/src/generated/sdui.ts` (680 行) | OK (今セッションで再生成) |
| 設計書 v2-v5 + v6 | `docs/sdui-three-layer-model-v{2..6}.md` | OK |
| docs/features.md / ui-review*.md / ui-refactor-plan.md | 同上 | OK |
| 全エンドポイントのルーティング | `server/src/routes.rs` | OK |
| `gen-sdui-types.mjs` パイプライン | `scripts/gen-sdui-types.mjs` | OK |

### 19.2 焼失 (= disk 上で truncate / 内容喪失)

| ファイル | 残存状態 |
|---|---|
| `client_solid/src/sdui/BlockRenderer.tsx` | 73 行で truncate (mid-line) |
| `client_solid/src/sdui/templates/CartCard.tsx` | 69 行 (mid-string "カートは空です。お気に入") |
| `client_solid/src/sdui/api.ts` | 114 行で truncate |
| `client_solid/src/sdui/blocks/FormField.tsx` | 230 行 (内容ズレ可能性) |
| `client_solid/src/sdui/blocks/ShippingMethodPicker.tsx` | 165 行 (同上) |
| `client_solid/src/pages/CartSdui.test.tsx` | 253 行で truncate |
| その他 22+ 件の .tsx / .ts | tsc parse error を出す状態 |

git は `dca49f5 feat(sdui): implement initial SDUI schema with regions and validation` (= Phase 1 着手前) しか持たず、Phase 2-8 の commit は存在しない。git 復元は不可。

### 19.3 リカバリパス

A. **VS Code Local History / OneDrive バージョン履歴を確認** — エディタ右クリック → Timeline。OneDrive 配下なら「バージョン履歴」。残っていれば一発で復元できる。

B. **Rust + bindings + 本ドキュメント (v6) を仕様として client 側を再実装** — A が空振りした場合の道。本 v6 が「契約上どんな block / template / endpoint があるか」を全て列挙しているので、client 側の以下のファイルを仕様 → 実装で組み直す:

```
client_solid/src/sdui/
├── branded.ts                                   ← §7.5 のテンプレートで再生成
├── i18n.ts                                      ← §6.1 のテンプレート
├── api.ts                                       ← §15.2 の endpoint 表から fetcher を 1 個ずつ
├── analytics.ts                                 ← §11.7 (batch flush + IntersectionObserver)
├── useImpression.ts                             ← §11.5 のテンプレート
├── BlockRenderer.tsx                            ← §6.3 (13 variant の Switch)
├── CardRenderer.tsx                             ← §6.2 (3 template の Switch + ErrorBoundary)
├── RegionRenderer.tsx                           ← For + BlockRenderer
├── components/L.tsx                             ← Localizable 描画
├── components/MediaFallback.tsx                 ← §6.4
├── blocks/{Text,Cta,Media,Badge,MetricList,
│        MetaLine,Price,EclosionForecast,
│        Divider,LineItem,OrderSummary,
│        FormField,ShippingMethodPicker}.tsx    ← BlockRenderer の各 Match の中身
└── templates/{ProductFeatureCard,
              ProductDetailCard,
              CartCard,FallbackCard}.tsx        ← §5.3 / §5.7 / §5.8
```

ページ側 (`client_solid/src/pages/{Products,ProductDetail,Cart}*.tsx`) も api.ts を呼んで CardRenderer に渡すだけの薄い層。テスト (`*.test.tsx`) は §13 を参考に再構築。

C. **Phase 0 から段階的にやり直し** — B の発展形。git に commit を打ちながら Phase 1 → Phase 8 を順に積み直す。設計書の §15.1 の順序がそのままロードマップになる。

### 19.4 状態反映カバー範囲

本 v6 ドキュメントは Rust (= source of truth) の実装と完全に同期している。client 側を再構築する際、本ドキュメントの §4-§8 / §11 / §15 を仕様として参照すれば、過去に書かれていたコードと **意味的に同等な** client 実装に到達できる。完全に bit-identical な復元は git からは不可能だが、設計上の本質的な振る舞い (= server contract / discriminator / action / server-driven flow) は本ドキュメントに保存されている。
