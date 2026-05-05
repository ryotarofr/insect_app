# マイページ統合 + 出品管理 実装計画

> **背景**: C2C pivot (migration 0021) 後、ユーザは「飼育者 = 出品者 = 購入者」を兼ねる。
> しかしサーバ・クライアントとも「自分の出品を管理する画面」「自分の販売側 orders」が
> 欠けており、マイページの KPI も飼育系のみ。本計画では C2C モデルに合わせて
> マイページを「飼育 × 販売の自分専用ハブ」に拡張し、その配下にマイ出品管理を新設する。
>
> **モックアップ**:
> - [docs/mockups/mypage-with-shop-management.html](mockups/mypage-with-shop-management.html)
> - [docs/mockups/listing-new.html](mockups/listing-new.html)
> - [docs/mockups/mobile.html](mockups/mobile.html)

## 並べ方の方針

依存性 (前フェーズが揃わないと動かない) → 体感価値 (出した時にユーザが嬉しい度合い) →
リスク (migration / Stripe 等の外部依存) の順で並べる。各フェーズは独立してマージ可能。

---

## Phase 1 — `GET /listings/me` を作る (基盤)

**目的**: マイページ KPI、出品サマリ、マイ出品ページの全機能が依存する読み取り API を最初に切り出す。これがないと先の全フェーズが動かない。

**含む作業**:
- `repos::listings::find_by_seller(pool, seller_user_id, status_filter) -> Vec<ListingRow>`
- `handlers::listings::list_my_listings`: `?status=active|sold|canceled|expired|all` を受ける
- `routes.rs` に `GET /listings/me` 追加 (login 必須、`require_user_id` ガード)
- `v_listings_with_counts` を JOIN して `bid_count` / `watcher_count` も返す
- integration test: 自分の listings だけ返ること、cross-user リークが無いこと

**完了条件**: `cargo test`、`curl /api/v1/listings/me?status=active` で自分の active 出品のみ返る。

**規模**: 半日〜1日。migration 不要。リスク低。

---

## Phase 2 — MyPage の最小拡張

**目的**: 一番体感価値が大きい部分を最初に出す。モックの「§01 自分のサマリ」「§02 マイ出品サマリ」だけをホームに足す。

**含む作業**:
- `client_solid/src/api/listings.ts` (新規) または既存に `getMyListings(status)` 追加
- `store/myListings.ts` (新規): 4ステータス分の signal、`refreshMyListings()`
- `MyPage.tsx` 拡張:
  - 販売系 KPI 3枚 (出品中 / 入札・ウォッチ / 今月の売上) を既存KPIグリッドに追加
  - 「§02 マイ出品 と 取引」セクション追加 (タブ + 直近3件 + 「すべて見る」リンクは Phase 3 まで disabled)
- KPI グリッドを6列に拡張 (既存の `tag` 風プレフィクスでカテゴリ分け)

**完了条件**: ログイン状態でホームを開くと、自分の出品中件数・売上が表示される。anonymous は KPI 飼育系3枚のみ。

**規模**: 1日。**Phase 1 が必須前提**。

---

## Phase 3 — マイ出品専用ページ + サイドバー改修

**目的**: 詳細CRUDをホームから逃がす。サマリしか見ないユーザと、棚卸ししたいユーザを分離する。

**含む作業**:
- `router.ts`: `/listings/me` を `RouteKey="my-listings"` として追加、`pathnameToRouteKey` / `ROUTE_PATHS` に反映
- `pages/listings/MyListings.tsx` 新規 (タブ式 = `出品中 / 入札中 / 売却済 / 取消・期限切れ`)
- `Shell.tsx` のサイドバー「マーケット」セクションに「マイ出品」「取引履歴」を追加
- `MyPage.tsx` の「すべて見る →」リンクを `/listings/me` 有効化
- 各リスト行から `/listings/{public_id}` への遷移は既存 `getListing` を再利用
- 出品取消ボタン (既存 `POST /listings/{id}/cancel` に繋ぐだけ)

**完了条件**: サイドバーから「マイ出品」を選ぶと縦リストが表示され、タブ切替・取消ができる。

**規模**: 1〜2日。Phase 1, 2 前提。

---

## Phase 4 — 取引履歴に売却側を統合

**目的**: 現状 `/orders/me` は買い手のみ。販売側の取引が見えないのは C2C として致命傷。

**含む作業** (ここで小さい migration が要る):
- migration 0022: `orders` に `seller_user_id UUID REFERENCES users(id)` 追加 (NULL 許容、index 付き)
  - 旧 B2C 由来の既存 order は backfill 不要 (C2C pivot で削除済の前提)
- `handlers::stripe_webhook` で `payment_intent.succeeded` を受けたとき、`order_items.listing_id` から `listings.seller_user_id` を引いて `orders.seller_user_id` に書く
- `repos::orders::find_by_role(user_id, role: buyer|seller|all)`
- `handlers::orders::list_my_orders` を `?role=buyer|seller|all` 拡張
- `MyOrdersPage`: role タブ追加 / `MyPage.tsx` の「最近の取引」を売却+購入の merged view に切り替え

**完了条件**: 自分が出品して落札された取引が `/orders/me?role=seller` で取れる。MyPage のタイムラインに `+¥` と `−¥` が混ざって見える。

**規模**: 2日。Phase 1〜3 と並行可 (migration がぶつからない)。

---

## Phase 5 — モバイル BottomTabBar 改修

**目的**: モバイルでマイ出品とマーケットへの導線を確保する。Phase 3 で追加したマイ出品ページがモバイルからも到達可能になる。

**含む作業**:
- `BottomTabBar.tsx` を 5タブ構造に拡張: `ホーム / 探す / [FAB] / 飼育 / マイ出品`
- 中央 FAB スロット = 既存 `QuickLogFab` を昇格させて ActionSheet を出す (出品 / 個体登録 / 群作成 / 飼育ログ)
- `safe-area-inset-bottom` 対応 (CSS env var)
- `BottomTabBar` の active 判定を `pathnameToRouteKey` 経由に統一

**完了条件**: モバイル幅で全画面下部に5タブ + 中央 FAB が表示され、各タブから対応ページに遷移できる。

**規模**: 1〜2日。Phase 3 前提。

---

## Phase 6 — 出品作成 Wizard 化 (規模大)

**目的**: モックで描いた4ステップウィザードを実装。デスクトップは2カラム1ページのまま、モバイルだけ wizard モードに切り替える responsive 構造。

このフェーズは内部で 6a〜6d に分割可能:

### 6a — Wizard の枠と個体ピッカー
- `ListingNewWizard.tsx` で `step` signal + `<Show>` ベースの段階表示
- 既存の `specimens/me` を再利用した個体カードグリッド
- `archived` 除外、`is_listed_active` 判定 (= 同 specimen が active な listings に居るか) で disabled 表示

### 6b — 写真と説明 (カルテ自動生成)
- 説明文 3 モード (プレビュー / 編集 / マークダウン)
- スニペット挿入 (`+ 計測値を挿入` 等) = `specimen` 内容を template で出力
- 写真は既存 `/uploads/sign` → `/uploads/local` → `/uploads/complete` の3リクエスト構成を使う

### 6c — 価格・販売方式・配送 (schema拡張あり)
- migration 0023: `listings` に `allowed_shipping_methods TEXT[]` か `JSONB` を追加
- 即決価格 (reserve) は `listings.buyout_price_jpy` 列追加 (任意 / NULL 許容)
- 推奨価格 endpoint: `GET /api/v1/listings/recommended_price?species_id=X&size_mm_min=Y&size_mm_max=Z` を新規。`orders` × `order_items` × `listings` JOIN で中央値・四分位を返す

### 6d — 確認 → 出品 + 完了状態
- 確認画面はデスクトップ §06 / モバイル accordion
- 手数料サマリは client 側で計算 (10% + 3.6%)
- 出品成功後は `/listings/{public_id}` に遷移してモック完了画面を再現

**完了条件**: 既存ユーザがマイ出品ページの「+ 出品する」から個体選択 → 出品完了まで一気通貫できる。Stripe Connect 未連携時は「出品する」ボタンが disabled で原因表示される。

**規模**: 3〜5日。**Phase 1〜5 が前提**。schema 拡張あり。

---

## Phase 7 — Stripe Connect オンボーディング

**目的**: 売上が振り込まれるようにする。Phase 6 の「出品 disabled」の解除条件。

**含む作業**:
- migration 0024: `users` に `stripe_connect_account_id TEXT` / `stripe_connect_status TEXT CHECK (...)` 追加
- Stripe Connect Express の Account 作成 + Account Link 発行 endpoint
- `/auth/me` に Connect 連携状態を含める
- `/account/stripe-connect/start` `/account/stripe-connect/return` `/account/stripe-connect/refresh` のページ
- 既存 `stripe::mock_provider` の本番 Provider 化

**完了条件**: 出品者が Stripe Connect 連携を完了し、テスト落札 → 受取確認 → エスクロー解放 → 振込までシミュレートできる。

**規模**: 5〜7日。Phase 6 と並行可だが、独立した大仕事なので別 PR で。Stripe ダッシュボードでの設定作業も発生。

---

## Phase 8 — ドラフト保存と細部最適化

**含む作業**:
- migration 0025: `listings.status` の CHECK に `'draft'` 追加
- `GET /listings/me?status=draft` で下書き一覧
- 出品 Wizard の自動下書き保存 (離脱時 / 戻るボタン時)
- モバイル全体の responsive 詳細調整 (KPI 横スクロール、出品作成の step 切替アニメ)
- E2E テスト: マイページ表示 → マイ出品 → 出品作成 → 完了 の通しテスト

**規模**: 2〜3日。

---

## 並列実行できる部分

- Phase 4 (売却側 orders) は Phase 2/3 と並行可能 (`MyOrdersPage` のみ独立)
- Phase 5 (BottomTabBar) は Phase 3 完了後すぐ着手可
- Phase 7 (Stripe Connect) は Phase 6 と並行可能だが、Phase 6 の動作確認には Phase 7 のモック完成が要る

## マイルストーン

| マイルストーン | 内容 | 累計工数 |
|---|---|---|
| **M1: 販売情報の可視化** | Phase 1〜3 完了 | 3〜4日 |
| **M2: 取引完結性** | Phase 4 完了 | 5〜6日 |
| **M3: モバイル C2C 体験** | Phase 5〜6 完了 | 9〜13日 |
| **M4: 本番 C2C 取引** | Phase 7 完了 | 14〜20日 |
| **M5: 仕上げ** | Phase 8 完了 | 16〜23日 |

## リスクと注意点

最大のリスクは **Phase 4 の `orders.seller_user_id` backfill**。C2C pivot 直後で本番データが薄いので今のうちに NOT NULL 化したいが、まだ `payment_intent.succeeded` を受け切れていない過渡期 order があると詰まる。MVP は NULL 許容で出して、Phase 7 完了後に NOT NULL 化マイグレーションを別途切るのが無難。

二番目のリスクは **Phase 6c の `allowed_shipping_methods` の表現**。配列カラム (`TEXT[]`) は sqlx の扱いがやや扱いにくいので、`listing_shipping_methods (listing_id, shipping_method_id, extra_fee_jpy)` という関連テーブルを切るほうが将来の `extra_fee_jpy` カスタムや拡張に強い。決めの問題なので Phase 6c 着手時に確定させる。
