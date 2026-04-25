# KOCHŪ 改修計画

根拠: `docs/ui-review.md` (機能・情報設計 35 項目) + `docs/ui-review-visual.md` (視覚 30 項目) の **合計 65 項目** を完遂するプラン。

> **前提 (Ryotaro さんとの合意)**
> - 実装は **Claude が進める**。タスクはコミット単位まで落とす。
> - 時間軸は **2-3 ヶ月で全完遂**。4 フェーズ × ~2 週間。
> - 優先軸は **モバイル体験**。viewport / PWA / bottom-tab / FAB を最初に立てる。

---

## 0. 全体像

| Phase | 期間 | 焦点 | 主要アウトプット |
|---|---|---|---|
| **Phase 1** | Week 1-2 | **モバイル基礎** | viewport 修正 / PWA / safe-area / BottomTabBar / FAB |
| **Phase 2** | Week 3-5 | **URL・信頼性・データ整合** | @solidjs/router / Cart PII 除去 / Toast / focus trap / Bloodline prop受け |
| **Phase 3** | Week 6-7 | **視覚の磨き** | focus ring / card shadow / Hero 刷新 / chip 統一 / primary 色 / placeholder シルエット |
| **Phase 4** | Week 8-10 | **ドメイン & 仕上げ** | StageBar SVG + LifeStatus / dark mode / 検索・フィルタ実装 or 撤去 / テスト |

### デリバリ基準 (全フェーズ共通)
- コミット単位で「1 つの視覚変化 or 1 つの動作変化」だけ。
- PR 前に Ryotaro さんが `http://localhost:5173/` で動作確認し、GO が出たらマージ。
- 既知の未確認事項 (ui-review.md の「未確認」マーク) は実装時に改めて判定し、必要ならタスク追記。
- 各フェーズ末にリグレッション目視 + Lighthouse + axe-core の 3 点チェック。

### 項目 ID の対応
- `F-x-y`: `ui-review.md` の機能レビュー項目 (例 `F-1-1` = 1-1 viewport)
- `V-x-y`: `ui-review-visual.md` の視覚レビュー項目 (例 `V-1-1` = V1-1 focus ring)
- 重複がある場合は両方記載。

---

## Phase 1 — モバイル基礎 (Week 1-2, 10 commit 想定)

### ゴール
- スマホで開いた時点で KOCHŪ が"普通に使える"状態にする。
- PWA として成立する最低ラインに到達 (manifest + SW + safe-area)。
- ログ入力の鉄板パターン (Bottom-tab + FAB) を提示する。

### 依存関係
- P1-1 (viewport) は Phase 1 の最初。これが無いと他の CSS が効果測定できない。
- P1-7 以降は P1-1 完了前提。

### コミット計画

| # | タスク | 該当 | 工数 | 完了条件 |
|---|---|---|---|---|
| **P1-1** | viewport を `device-width` に + `viewport-fit=cover` | F-1-1, V のモバイル前提全部 | 30min | iPhone 14 Safari で横幅がデバイス相当になる |
| **P1-2** | form系の `font-size: 16px` (iOS のみ、それ以外 14px) + padding 10/12 | F-1-3, V-1-10 | 1h | iOS Safari でフォーカス時ズームしない |
| **P1-3** | `vite-plugin-pwa` 導入 + `manifest.webmanifest` (192/512/maskable + theme-color + display: standalone) | F-1-2 | 3-4h | iOS で「ホームに追加」後、スプラッシュ + フルスクリーン起動 |
| **P1-4** | Service Worker: precache (静的) + StaleWhileRevalidate (API) | F-1-2 | 3-4h | オフラインで直近ページが開ける |
| **P1-5** | safe-area 対応: Shell/topbar/bottom-tab に `env(safe-area-inset-*)` | F-1-1 派生 | 1-2h | iPhone 14 で notch/home-indicator を侵食しない |
| **P1-6** | `components/BottomTabBar.tsx` を新設 (5 項目: 生体 / マイ / **記録 (FAB 兼)** / 羽化 / マーケット) | F-1-12 | 1 日 | 640px 以下で sidebar の代わりに表示。active 表示込み |
| **P1-7** | Shell.tsx を `matchMedia("(max-width: 640px)")` で切り替え (sidebar ⇔ bottom-tab) | F-1-12 | 半日 | リサイズで自然に切替、active 状態維持 |
| **P1-8** | `components/Fab.tsx` を新設 + specimen/mypage/log で `QuickLogSheet` を開く (モバイルのみ) | F-2-4 | 半日 | Tab 中央の「+」押下で QuickLogSheet が下から |
| **P1-9** | chip のモバイル時 `min-height: 36px` + tap area 44×44 を満たす余白 | F-2-6, V-1-6 部分 | 1h | Lighthouse の tap target 警告ゼロ |
| **P1-10** | `QuickLogSheet` の温度初期値を `placeholder`化 (`signal` は空) | F-1-14 | 30min | モーダル開いた瞬間は空。前回値はグレー placeholder |

### 完了基準 (Phase 1 Exit)
1. iPhone 14 Safari (実機 or Web Inspector) で全ページ操作可能。
2. 「ホームに追加」でアイコン + スプラッシュが出る。
3. オフラインでも直近の一覧ページは表示 (API は再接続で同期)。
4. Lighthouse PWA 90+ / tap target エラーなし。

---

## Phase 2 — URL・信頼性・データ整合性 (Week 3-5, 14 commit 想定)

### ゴール
- 商品 URL を SNS で共有したら同じ画面が開くようにする。
- デモに堪える状態: ハードコード固有名の除去、アクション通知の統一。
- モーダル・フォーカス回りの最低限 a11y。

### 依存関係
- P2-1 (router) は Phase 2 の最初。これに乗って P2-2〜P2-5 が動く。
- P2-9 (Toast) は P2-10 の前に完了。

### コミット計画

| # | タスク | 該当 | 工数 | 完了条件 |
|---|---|---|---|---|
| **P2-1** | `@solidjs/router` 導入 + ルート定義 (`/`, `/products`, `/products/:id`, `/mypage`, `/specimen/:id?`, `/log`, `/eclosion`, `/bloodline/:specimenId?`, `/market`, `/shop`, `/cart`, `/help/warranty`) | F-1-4 | 1 日 | 各 URL 直叩きで該当画面が開く |
| **P2-2** | Shell の nav-item を `<A href>` 化 + `aria-current` は router に委譲 | F-1-8, V-1-11 連携 | 半日 | 右クリック「新しいタブ」で URL が開ける |
| **P2-3** | `localStorage kochu:*` の route/product/specimen 保存を削除 (router に一元化) | F-1-4 派生 | 1h | localStorage に route 関連が残らない |
| **P2-4** | Cart 配送先を `store/checkout.ts` + `<Input onInput>` に差し替え。未ログイン時は空欄。複数住所 select はスコープ外 (Phase 4 で) | F-1-5 | 半日 | "山田 徹" 等が消える / 入力が反映・保存される |
| **P2-5** | Bloodline が `useParams<{specimenId}>()` を受ける + `createEffect` で追従 | F-1-6 | 1-2h | `/bloodline/:id` で個体が切り替わる / mypage からの遷移で追従 |
| **P2-6** | MyPage KPI を `api.getUserMetrics()` + `createMemo` に / 未ログイン/空状態で「まだカルテがありません」CTA | F-1-13 | 半日 | 新規デモユーザーで `0` が出る / リアルデータで個別値 |
| **P2-7** | `components/Toast.tsx` + `store/toast.ts` (`toast.success/error/info`) を新設 + `Shell` 下部に `aria-live="polite"` 領域 | F-1-17 | 1 日 | 4 種トーストが開発者ツールから呼べる |
| **P2-8** | Cart 追加を Toast + 滞在 (画面遷移しない) + Undo 5s に差し替え | F-1-10 | 半日 | 商品詳細で「カートに追加」→ 右下トースト、詳細画面のまま |
| **P2-9** | `utils/focusTrap.ts` ユーティリティ + `inert` フォールバック。`QuickLogSheet` / Market 出品モーダルに適用 | F-1-11 | 1 日 | モーダル開放時に Tab が内部循環 / Esc で閉じる |
| **P2-10** | Hero の補償リンクを `/help/warranty` (仮: placeholder ページ) に差し替え | F-1-7, F-1-16 | 1h (本格ページは Phase 4 で) | 押して market に飛ばなくなる |
| **P2-11** | Hero 数値 (12,480件 / 86名 / 99.2%) に hover ツールチップで集計期間注記 | F-2-3 | 1h | カーソル当てで「2024-01〜2026-03 集計」等 |
| **P2-12** | `Market.tsx` の textarea を signal 化 + 個体変更時に `templateFor(p)` を流し込み (user 編集後は固定) | F-1-18 | 半日 | 個体切替で本文が自動更新 (手動編集優先) |
| **P2-13** | `App.tsx` のショートカット (1-9) を `document.activeElement` が input/textarea のとき無効化 | F-2-8 部分 | 30min | 検索欄フォーカス中は数字キーで画面遷移しない |
| **P2-14** | `breadcrumb` を `<Breadcrumb items=[{label, href}]>` 構造に / 各ページが router 情報から生成 | F-2-11, V-3-5 連携 | 半日 | 各階層タップで親に戻れる |

### 完了基準 (Phase 2 Exit)
1. すべての主要 URL が直接共有可能。戻る/進むボタンが効く。
2. デモ中に山田徹 / 99.2% / 28.4 等の固有ダミー値が目立たない (完全消去ではなく、"誰の" データか明示)。
3. すべてのアクション結果がトーストで統一される (cart / log / market / 補償申請等)。
4. axe-core で modal 関連の critical ゼロ。

---

## Phase 3 — 視覚の磨き (Week 6-7, 18 commit 想定)

### ゴール
- 画面全体が「浮いている / 押せる / 注目できる」がすべて**視覚だけで判別可能**になる。
- ブランドトーン (serif + mono + oklch) を強化し、完成度を一段上げる。
- Hero / 商品カード / 血統系図 の 3 つの顔が一目で印象的になる。

### 依存関係
- P3-1 (focus ring) は早い段階で (全テストで必須)。
- P3-8 (primary を forest) は P3-6 (chip) と同時に視覚確認。
- P3-16 (silhouette) は Phase 3 の最後でも OK (素材準備が律速)。

### コミット計画

| # | タスク | 該当 | 工数 | 完了条件 |
|---|---|---|---|---|
| **P3-1** | `:focus-visible` リング統一 (2px indigo + offset 2px) を `:where(button, a, input, ...)` に付与 | V-1-1 | 30min | Tab 移動で必ずリングが見える |
| **P3-2** | `.card` に極薄 `box-shadow: 0 1px 2px oklch(0 0 0 / .03)` + hover で持ち上げ | V-1-5 | 1h | 商品カードに hover で 1px 浮く |
| **P3-3** | `:active` で `scale(0.98)` + 内側シャドウの軽微フィードバック (btn/card) | V-1-1 派生 | 30min | 押下感が視覚的に出る |
| **P3-4** | Hero title を `clamp(40px, 4.5vw, 56px)` / `font-weight: 700` / `letter-spacing: -0.02em` + `<em>` を `--accent-amber` | V-1-3 | 1h | 「買う、育てる、継ぐ。」が画面の主役に |
| **P3-5** | Hero lead を 14.5 → 16px / line-height 1.75 | V-1-3 連携 | 30min | 読み始めたくなる密度に |
| **P3-6** | Hero trust を `flex gap:16px` + 区切り `li+li { border-left }` + 数字を serif 14px ink、単位を mono 11px | V-1-4 | 1h | 11px ブラーが消え、信頼が読める |
| **P3-7** | hero-eyebrow の罫線を 10px → 32-40px / `--accent-forest` に | V-3-3 | 30min | "入口" らしい視覚的プロローグに |
| **P3-8** | hero padding-block 56→40 に + hero-promises の margin-top 詰める | V-2-4 | 30min | 1440×900 で商品グリッド上端が視界に入る |
| **P3-9** | `hero-promise` に `01` `02` `03` の 64px serif 薄色背景 + 左罫線 3px accent | V-2-9 | 2h | "3 つの約束" が装飾として成立 |
| **P3-10** | chip のサイズを `height: 24px / padding: 0 10px / font-size: 11px` に 1 本化、色 modifier のみで差別化 | V-1-6, F-2-6 視覚面 | 半日 | 商品詳細の 4 chip がベースライン一致 |
| **P3-11** | `.btn.primary` を `oklch(--accent-forest)` に / `.btn.ghost` に `border: 1px solid var(--border-strong)` | V-2-12, V-2-2 | 半日 | CTA に森緑が登場 / ghost が消えない |
| **P3-12** | radius を 3 段階固定 (`--r-card: 12px / --r-btn: 8px / --r-chip: 999px`) で変数化 → 全クラスへ | V-2-8 | 1-2h | 中間の radius 値が CSS から消える |
| **P3-13** | `nav-item` の padding 9/10, active 左 3px indicator + 薄背景 / `.nav-title` 10.5px uppercase 0.08em | V-1-11 | 1-2h | アクティブが塗りつぶしから罫線インジケータに |
| **P3-14** | 価格: `.price` に `tabular-nums`、`¥` を mono 0.7em に分離 | V-2-3, V-2-7 | 1h | 商品詳細の ¥48,000 が標本ラベル感 |
| **P3-15** | `.topbar` に `backdrop-filter: blur(10px) saturate(1.1)` | V-3-1 | 30min | スクロール時に下がすりガラス越しに |
| **P3-16** | `.page-head .cat` を 11px / uppercase / letter-spacing 0.12em / ink-mute に統一 | V-2-6 | 30min | 各ページの「所属」が一目で判る |
| **P3-17** | 商品カード下部のスペックを 2×2 grid に + label 11px / 値 mono | V-1-9 | 1-2h | サイズ・体重・累代・羽化 が読める |
| **P3-18** | `.ph` の aspect-ratio を **用途別**に統一: 商品一覧 4:3 / Hero feature 16:9 / 詳細 3:2 | V-1-8, F-2-9 | 半日 | CSS に aspect-ratio 変数が明示される |
| **P3-19** | **shop chart の色分け**: 系列が 1 つなら「今日だけ accent、他は forest-soft」 | V-3-6 | 30min | 系列意図が見える |
| **P3-20** | Bloodline 血統カードに `data-kind="self|direct|other|wild"` + `data-generation="0..3"` → 4 色 + 世代トーン | V-1-12 | 半日 | 凡例と画面上の色が一致 |
| **P3-21** | `.ph.forest / .ph.amber` に placeholder **種別シルエット SVG** (ヘラクレス角 / コーカサス 3 本角 / ネプチューン / 国産ノコ / 汎用サナギ) を重ねる | V-1-2 | 2 日 (SVG 作成込) | ストライプだけの画面が消滅 |
| **P3-22** | Market 等の同形カードに `data-state` 別の左ボーダー 3px 色分け | V-2-10 | 1h | 注目/入札中/まもなく締切 が色で読める |
| **P3-23** | Log の `tl-day` に月区切りラベル + 週末背景を 1 段沈める | V-2-11 | 1-2h | 日記感が出る |

### 完了基準 (Phase 3 Exit)
1. キーボードだけで全画面を一周してフォーカスが常に見える。
2. `.ph` が入った画面のスクショを並べて「完成品に見える」。
3. 原則として **CSS 変数**で全値が制御されている (inline style がほぼ残らない)。

---

## Phase 4 — ドメイン & 仕上げ (Week 8-10, 20 commit 想定)

### ゴール
- 飼育ログ系の核 (ライフステージ / 死亡・脱走) を正しく表現。
- 検索・未実装フィルタを**実装 or 正式撤去**で決着。
- ダークモード / 赤ライトモード / 細部の詰めで "プロ向け専門アプリ" に仕上げる。

### コミット計画

| # | タスク | 該当 | 工数 | 完了条件 |
|---|---|---|---|---|
| **P4-1** | StageBar 専用 SVG 7 種 (卵/幼虫 1-3/前蛹/蛹/成虫) を `components/icons/stage/` に追加 | F-1-15, F-2-2, V-1-7, V-2-5 | 2 日 (デザイン込) | `🛋` 絵文字が完全消滅 |
| **P4-2** | `api.ts` の `Specimen` に `lifeStatus: 'active'\|'deceased'\|'transferred'\|'escaped'` + UI バッジ | F-1-15 | 1-2 日 | StageBar 横に終了バッジが出る |
| **P4-3** | Bloodline で `lifeStatus === 'deceased'` を `opacity: 0.5 + 喪章リボン` | F-1-15 | 半日 | 故個体が系図で視覚的に識別可 |
| **P4-4** | `/help/warranty` ページ本実装: 24h 返金フロー図 / 開封動画アップ手順 / 申請フォーム | F-1-7 | 2-3 日 | Hero の「補償フローの詳細」が本当に詳細 |
| **P4-5** | トップバー検索を `⌘K` モーダル (cmdk 風) で実装 | F-1-9, V-2-1 | 2-3 日 | `⌘K` で ID/種名/商品の混在検索 |
| **P4-6** | `ProductFilters` の `PLACEHOLDER_FILTERS` (♂/♀/成虫/幼虫/CBF以上/即決) を実装 or ドロップダウンにまとめる | F-2-5 | 2-3 日 | 灰色 disabled chip が表面から消える |
| **P4-7** | `@media (prefers-color-scheme: dark)` 対応: tokens.css の `--bg / --ink` のみ置換 (accent 流用) | F-2-1 | 1-2 日 | 夜間 OS 設定でそのまま見やすい |
| **P4-8** | `data-theme="night-red"` 赤ライトモード + Shell にトグル | F-2-1 | 半日 | 飼育室モード: 画面が赤く夜行性個体を妨げない |
| **P4-9** | `MyPage` に NextActions タイムライン (API: `getUpcomingActions()`) | F-2-10 | 2 日 | 明日のエサ/体重/羽化 がカードで並ぶ |
| **P4-10** | 個体カルテ下部に "次のログ候補" 5 ボタン → `QuickLogSheet` ショートカット | F-2-10 | 半日 | 温度/湿度/体重/交換/観察 が 1 タップで開く |
| **P4-11** | Bloodline の `+ 交配記録` `PDF出力` ボタンを click ハンドラ実装 or `disabled + title="準備中"` 化 | F-3-2 | 半日〜2 日 (PDF 本実装の場合) | 見た目だけのボタンが消える |
| **P4-12** | Shop チャートがモックなら「サンプルデータ」バナー、本番接続なら `api.getShopStats()` | F-3-3 | 半日 | "偽数値" の誤解が起きない |
| **P4-13** | `.ph` に `role="img" aria-label="{種名}{性別} 俯瞰"` | F-3-4 | 1h | スクリーンリーダーが「画像」と読む |
| **P4-14** | QuickLog 温度 input を `inputmode="decimal"` | F-3-5 | 10min | iOS で数字キーパッドに `.` が出る |
| **P4-15** | cart item 削除ボタンを 44×44 タップ領域に | F-3-6 | 30min | モバイルで誤タップしない |
| **P4-16** | media gallery (商品詳細) を aspect-ratio 自由 + `max-height:480px object-fit:contain` + 黒背景 | F-2-9, V-1-8 | 1 日 | 縦長標本写真が潰れない |
| **P4-17** | Swiper 相当の複数画像スライダ導入 | F-2-9 拡張 | 1 日 | 1 枚目=標本角度 / 2 枚目=ケース / 3 枚目=タイムラプス |
| **P4-18** | Inline style をユーティリティクラスに整理 (`mt-4 / gap-2 / row-center` etc.) | F-2-7 | 2 日 (段階的) | `style={{...}}` が 80% 減 |
| **P4-19** | `?` キーで開くショートカット一覧モーダル | F-2-8 | 半日 | 画面遷移 1-9 / QuickLog / 検索 / Esc 一覧 |
| **P4-20** | `.fade-enter` を router の onLocationChange で再付与 | F-3-1 | 30min | 画面切替で毎回フェード |
| **P4-21** | `AUDIT_LOG` を `api.getAuditLog(specimenId)` に (Bloodline.tsx:231) | F-3-3 連携 | 半日 | サンプル固定が消える |
| **P4-22** | Bloodline `+ 交配記録` → 新規モーダル (親個体 2 匹 + 日付 + メモ) | F-3-2 深掘り | 1 日 | 実際に記録を残せる |
| **P4-23** | timeline date 列を mono 11px 固定幅 48px | V-3-5 | 1h | 日付がガター上で縦一直線 |
| **P4-24** | serif 大数字に `<data unit="件">` 右肩単位 | V-3-4 | 1h | mypage KPI が "数字だけ浮く" 感を解消 |
| **P4-25** | Lighthouse PWA 95+ / axe-core critical 0 / tap target 100% で最終点検 | 全体 | 1 日 | 3 ツールのスコア表スクリーンショット |

### 完了基準 (Phase 4 Exit)
1. 仮素材 / ダミー表示 / `🛋` / 絵文字ばらつきが画面上に存在しない。
2. iOS ライト/ダーク/赤ライトの 3 モードすべてで視覚的に美しい。
3. 本レビュー `ui-review.md` / `ui-review-visual.md` のチェックリストが 100% チェック済み。

---

## 1. 工数サマリー

| Phase | タスク数 | 総工数 (人日目安) | 備考 |
|---|---|---|---|
| Phase 1 | 10 | 7-9 日 | PWA で伸びやすい |
| Phase 2 | 14 | 10-12 日 | router 移行でリグレッション注意 |
| Phase 3 | 23 | 10-12 日 | SVG 素材 (P3-21) が律速 |
| Phase 4 | 25 | 18-22 日 | 検索・ダークモード・PDF で伸びやすい |
| **合計** | **72** | **45-55 日** | 1 日 1-2 コミット ペースで 2-3 ヶ月 |

### 律速要因 (事前に確保したいもの)
1. **PWA 用アイコン素材** (192/512/maskable, SVG 1 枚から書き出し可)。Phase 1 開始までに用意。
2. **StageBar SVG 7 種** (P4-1)。2026-05 中旬までに。
3. **種別シルエット SVG 5 種** (P3-21)。2026-06 までに。
4. **補償フロー図 / ヘルプページのコピー** (P4-4)。Ryotaro さん側で原稿を用意してもらえると速い。
5. **本番画像 (実写 or 生成)** — Phase 3 の最中に並行調達。Phase 4 で差し替え。

---

## 2. 優先指針 (モバイル優先の具体化)

モバイル優先を採ったことで、Phase 1 完了時点で以下の"見えない変化"が出る:

- iPhone のホーム画面追加でアプリが起動する (体験としては既にアプリ)。
- 片手で QuickLogSheet が開ける (FAB + BottomTab)。
- 電波が途切れた飼育室で直近の画面が開ける (SW precache)。
- 屋外で眩しくない (後フェーズだが、Phase 4 で dark + 赤ライト対応)。

一方で、以下は **Phase 2 まで動かない** ので説明時に注意:
- 商品 URL の共有 (SNS/LINE)。
- ブラウザ "戻る" ボタン。
- 固有名の除去 (Cart 配送先の山田徹等)。

この gap を Phase 1 デモ時には「モバイル版優先で進めてます、URL 共有系は来週来ます」と明示して期待値を合わせるのが吉。

---

## 3. 各フェーズのリスクと対応

| フェーズ | 想定リスク | 対応 |
|---|---|---|
| Phase 1 | viewport 修正で既存デスクトップの CSS が崩れる | `index.html` 変更のみ、CSS は触らない。崩れたら P3 のスコープで吸収 |
| Phase 1 | PWA の iOS 要件不明 (manifest 必須 + start_url 設定) | vite-plugin-pwa のデフォルトで開始、実機で確認 |
| Phase 2 | router 移行で localStorage を頼ったテストが割れる | `e2e/` に最低限の Playwright テストを用意 (router 切替と同時) |
| Phase 2 | Cart store 変更で既存商品追加処理がバグ | `store/cart.ts` を不変リファクタ (addItem のシグネチャ維持) |
| Phase 3 | focus ring 追加でデザインと喧嘩 | `:focus-visible` 限定なのでマウス押下時は出ない。当初は indigo、PR で調整 |
| Phase 3 | SVG シルエット素材が集まらない | AI 生成 + 手修正で初版 → Ryotaro さんレビュー |
| Phase 4 | dark モード対応で oklch 計算が崩れる | L 値のみ反転 (`--bg-L`/`--ink-L`) の変数を用意して単体テストを CSS 単位で |
| Phase 4 | 検索本実装のコスト超過 | 最悪 P4-5 を Phase 5 に送り、`⌘K` は後回し可 (既存の `disabled` を V2-1 の暫定で維持) |

---

## 4. 運用ルール (コミット / PR)

- **1 commit = 1 task (Pn-x)**。commit message 冒頭に `[P1-3]` 等の ID を入れる。
- **PR 単位はフェーズ内の 3-5 commit を束ねる**。巨大 PR は避ける。
- **PR 本文 template**:
  - 対応タスク ID
  - `ui-review.md` / `ui-review-visual.md` の該当項目引用
  - Before / After スクショ (視覚変更時は必須)
  - モバイル / デスクトップの両方で手動確認した旨
- `main` ブランチ保護 + Lighthouse 自動計測を Phase 2 で仕込む (P2-1 と同時)。

---

## 5. 進め方の即時アクション

Ryotaro さんに確認したい 3 点 (Phase 1 着手前に):

1. **PWA アイコン素材**: KOCHŪ の「蟲」ロゴマーク (Shell.tsx にある brand-mark) を SVG で欲しい。無ければ現行の `蟲` 文字から起こしてもよいか？
2. **ブランチ戦略**: 既存リポジトリに `feat/refactor/phase-1` のように fork ブランチを切って PR で戻す形で良いか？
3. **実機テスト**: iPhone 実機を持っていれば、Phase 1 Exit 時に QR コードで `npm run dev --host` にアクセスして確認してもらえると速い。

これら答えをもらった時点で、`P1-1 (viewport)` のコミットから着手します。
