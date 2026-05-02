# 実装計画 — 群飼育 (cohort) と 5 秒記録モード

最終更新: 2026-05-02

位置付け: `docs/breeder-pivot-and-features.md` §3 と §4 の機能を、現在のスタック (SolidJS + Rust/sqlx) に組み込むための段階的実装計画。プロトタイプ (会話内 v4) を仕様の正典として参照する。

> **スコープ外 (今回の計画では扱わない)**
> - 写真とデータの一体化 (機能 3) — 別計画
> - 血統ツリー / 血統書 PDF (機能 4 / 5)
> - オフライン完全対応 (PWA / IndexedDB / Service Worker)
> - ラベルプリンタ連携 (テプラ等)
> - 棚位置の本格運用 (通常モードの完全実装)

---

## 0. 前提状況 (調査結果)

### フロントエンド (`client_solid/`)

- SolidJS 1.9.3 + Vite 5.4
- ルーティング: `@solidjs/router`、`router.ts` で RouteKey 中央管理
- 状態: signal ベース、`store/*.ts` に集約 (例: `matingRecords.ts` は現状 localStorage のみ、サーバ同期なし)
- API クライアント: 型付き fetch wrapper、OpenAPI コードジェン (`generated/api-types.ts`)、ts-rs エクスポートで型同期
- スタイル: 自前 CSS + デザイントークン (`tokens.css`)。Tailwind なし
- レスポンシブ: モバイルは `BottomTabBar`、デスクトップは sidebar の二系統。CSS グリッド + メディアクエリで切替 (明示的なフックなし)
- SDUI 基盤: `sdui/BlockRenderer.tsx` 等で server-driven UI を実装済み

### バックエンド (`server/`)

- Rust + sqlx 0.8 + PostgreSQL
- マイグレーション: `server/migrations/NNNN_*.sql`、最新は `0019_product_bloodlines.sql`
- リポジトリパターン: `src/repos/*.rs` で `*Row` (FromRow) + `*Insert` + 非同期関数
- ts-rs 9 で型エクスポート (現状は SDUI ブロック中心、specimen DTO はまだ未エクスポート)

### cohort 関連の現状

- **テーブルなし** (`cohorts`, `cohort_logs` 共に未作成)
- specimens に `cohort_id`, `promoted_from_cohort_at` カラム **なし**
- 既存の `specimens` / `specimen_logs` / `mating_records` は完全実装、API もある

---

## 1. 実装範囲 (今回)

| # | 機能 | 含むか |
|---|---|---|
| 1.1 | 飼育一覧ページ (旧 群一覧、サイドバー nav 統合先) | ✅ |
| 1.2 | 群詳細ページ | ✅ |
| 1.3 | 個体化モード (5 秒記録の特殊形) — 終了 / 完了ダイアログ含む | ✅ |
| 1.4 | **個体詳細設定フォーム** (`SpecimenDetailForm`) | ✅ |
| 1.5 | 通常 (連番) モードの**骨組み** | △ (UI のみ、棚位置データは別計画) |
| 1.6 | サイドバー nav: `群` → `飼育` リネーム + `飼育ログ` 削除 | ✅ |
| 1.7 | **既存 `飼育ログ` ページの削除** (pages/Log.tsx, /log ルート) | ✅ |
| 1.8 | 写真撮影画面 | ❌ (除外) |
| 1.9 | 血統ツリー / 血統書 | ❌ |
| 1.10 | オフライン同期 | ❌ (失敗時の再試行ボタンのみ) |

---

## 2. 全体フェーズ (FE-first 実行順序)

UI に対するフィードバックループを早く回すため、**フロントエンドを先に作って UI を確定させてからバックエンドに着手** する FE-first 方式を採用。

```
Phase 0: デスクトップモック作成     (1 日)   ← 完了
Phase 1: FE 基盤 + mock layer       (1 日)
Phase 2: 飼育一覧 / 群詳細 (FE)     (2 日)
Phase 3: 個体化モード (FE)          (2-3 日)
Phase 4: 登録フォーム + CTA (FE)    (2 日)
Phase 5: UI レビュー + 調整         (1-2 日)
Phase 6: バックエンド実装           (3 日)
Phase 7: BE 接続 + ts-rs 型乗換     (1-2 日)
Phase 8: 通常モードの骨組み (FE)    (1 日)
Phase 9: レスポンシブ + テスト      (2 日)
                                  -------
                                   16-18 日
```

| 実行 Phase | 詳細参照 | 備考 |
|---|---|---|
| 1: FE 基盤 + mock layer | §2.1 (新), §6.2 | 飼育ログ削除もここ |
| 2: 飼育一覧 / 群詳細 | §6.3, §6.4 | mock data 駆動 |
| 3: 個体化モード | §7 | mock data 駆動 |
| 4: 登録フォーム + CTA | §8, §3.6 末尾 | mock data 駆動 |
| 5: UI レビュー + 調整 | (新) | 業者にデモして反応収集 |
| 6: バックエンド実装 | §4 | DB 設計と API 実装 |
| 7: BE 接続 + 型乗換 | §5 | mock を real fetch に置換 |
| 8: 通常モード骨組み | §9 | FE 完結 |
| 9: レスポンシブ + テスト | §10 | 仕上げ |

### 2.1 FE-first 戦略の核

#### 型定義の二段構え

Phase 1 で TypeScript interface を **手書き** で定義 (`client_solid/src/types/cohort.ts` など)。これは将来の ts-rs 出力と互換になるよう設計しておく。

```ts
// Phase 1 で手書き → Phase 7 で ts-rs 生成版に置換
export interface CohortView {
  id: string;
  publicId: string;
  ownerUserId: string;
  speciesId: string;
  originKind: 'egg_lay' | 'purchase' | 'field_collected';
  parentMatingId?: string;
  initialCount: number;
  currentCount: number;
  stage: 'egg' | 'larva_l1' | 'larva_l2' | 'larva_l3' | 'pupa' | 'mixed';
  startDate: string;
  notes?: string;
  archivedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
```

Phase 7 で `cargo run --bin export_ts` の出力で `generated/api-types.ts` を生成し、手書きの `types/*.ts` を削除して import を切り替える。

#### Mock layer の作り方

`api/cohorts.ts` を以下の構造で実装:

```ts
// Phase 1: mock 実装
export async function listCohorts(): Promise<CohortView[]> {
  await sleep(300); // リアルな遅延
  if (Math.random() < 0.01) throw new NetworkError();
  return loadFromLocalStorage('cohorts') ?? defaultMockCohorts;
}

// Phase 7: 実 fetch に置換 (内部のみ変更、シグネチャ不変)
export async function listCohorts(): Promise<CohortView[]> {
  const res = await fetch('/api/v1/cohorts/me');
  if (!res.ok) throw new ApiError(res);
  return res.json();
}
```

mock は **localStorage で永続化** し、開発中のリロードでデータが消えないようにする。`?reset_mocks=1` クエリで初期化可能。意図的なエラー (1% 確率) でローディング・エラー UI も検証できる。

#### 利点とリスク

**利点**:
- UI のフィードバックループが Phase 5 まで早期に取れる
- BE 設計が UI の実装で見えたニーズから逆算される (例: 親個体検索で必要なフィルタが具体化されてから API 設計)
- 業者デモが Phase 5 で可能 (mock データで実機相当のフローを見せられる)

**リスク**:
- mock と real BE の差分で Phase 7 後に再調整が必要 (楽観 lock、FK 制約、transaction atomic 性 など)
- mock data 保守が一時的に必要

**対策**: Phase 7 を 1〜2 日のバッファ込みで設定。最初に `POST /promote` のような複雑エンドポイントを接続して、問題が早期に出るようにする。

---

## 3. Phase 0 — デスクトップモック作成

### 3.1 目的

レスポンシブ設計の判断材料を得る。モバイルは既存の v4 プロトタイプで確定だが、デスクトップは複数の妥当な選択肢があり、実装着手前に視覚化して 1 案に絞る。

### 3.2 検討する候補 (HTML プロトタイプで提示)

| 案 | 特徴 | 想定利点 / 欠点 |
|---|---|---|
| A. **スマホ UI 中央配置** | スマホ画面を `max-width: 420px` で中央表示。タッチ操作前提、ボタンは大きいまま | 一貫性が高くシンプル。ただしデスクトップの画面領域が無駄 |
| B. **テーブル + サイドパネル** | 個体一覧テーブル (左) + 選択中個体の編集 UI (右)。 PC ネイティブ | 複数個体を見比べながら作業可。設計量が倍 |
| C. **3 ペイン (ダッシュボード)** | 群リスト (左) + 編集 UI (中央) + 履歴 (右) | 情報密度最大。複雑で初期実装は重い |

### 3.3 デスクトップでのキーボードショートカット (全案共通)

- `Enter` → 完了 → 次の 1 匹
- `Esc` → 個体化モード終了 (ダイアログへ)
- `+` / `-` → スピナー (input から focus を外さずに ±0.1)
- `↑` / `↓` → スピナー (同上、ブラウザ標準)
- 数字キー → 直接入力 (input が常に focused)
- `Tab` → 作業チェックリストを巡回 → 完了ボタン
- `Space` → 写真 (将来用)

### 3.4 アウトプット (確定)

- **採択: B 案 (2 ペイン構成)** — 左 240px = セッション履歴 (直近個体 + 平均 / σ)、右 = 入力フォーム
- 入力 UI は **input を主軸 + ±ボタンを補助**のハイブリッド (§3.5 参照)
- §6.3 / §7 の詳細はこの方針で記述する

### 3.5 入力 UI の設計 (両プラットフォーム共通)

#### 採用パターン

`<input type="number" inputmode="decimal" step="0.1">` を中央に置き、両側に ±ボタンを補助的に配置する number stepper。

```
[ − ]   [    8.2     ]   [ + ]
        ↑ input field
        type=number, inputmode=decimal
```

#### プラットフォーム別の挙動

| | PC | モバイル |
|---|---|---|
| input 既定 | **自動 focus + 強調枠** (青 outline) | フォーカスなし (静的表示) |
| 主動線 | 数字キーで直接入力 | ±ボタンを親指タップ |
| 副動線 | マウスで ±クリック | input タップ → テンキーで直接入力 |
| 確定 | Enter | 「完了 → 次の 1 匹」ボタン |
| ボタンサイズ | 44×44px (mouse 想定) | 52×52px (thumb 想定) |

#### なぜ input を主軸にしたか

個体化モードは「新規個体 = 前回値なし」のため、0 から ± で積み上げるのは無駄が多く、直接入力 (例: 「8.2」と打つ) が圧倒的に速い。一方、通常 (連番) モードは前回値からの差分が小さいため ± が活きる。**両モードで同じ UI を維持** しつつ、フォーカス挙動だけプラットフォームで切り替えることで、コンポーネントは 1 つに保つ。

#### 共通コンポーネント仕様

`components/recording/SpecimenSpinner.tsx`:
```ts
interface SpecimenSpinnerProps {
  value: number;
  onChange: (value: number) => void;
  step?: number;             // default 0.1
  unit?: string;             // default 'g'
  label?: string;            // default '体重'
  previousValue?: number;    // 通常モードで「前回比」表示
  autoFocus?: boolean;       // PC では true、モバイルでは false (デフォルト)
  onSubmit?: () => void;     // Enter 押下時のコールバック
}
```

### 3.6 画面遷移設計

#### ルートマップ (cohort 関連)

| ルート | 画面 | 備考 |
|---|---|---|
| `/` | ホーム (MyPage) | 個体タブ + 群タブ + 既存タブ |
| `/cohorts` | 群一覧 | 「新規作成」モーダルあり |
| `/cohorts/:id` | 群詳細 | active / archived で表示分岐 |
| `/cohorts/:id/promote` | 個体化モード | 完了 / 中断後は群詳細へ replace |
| `/specimens?cohort_id=:id` | 個体一覧 (cohort filter) | 既存個体一覧にフィルタ機能追加 |

#### ナビゲーション原則

1. **完了 / 中断後は `router.replace('/cohorts/:id')`** — push ではなく replace を使う。これによりブラウザ戻るで個体化モードに戻れない (完了済みセッションへの再入を防ぐ)
2. **完了後の自動遷移先は群詳細** — プロトタイプの「通常モードに戻る」は複数ページ構成と整合しないため、**群詳細 (archived 表示)** に遷移する。業者は完了直後に成果サマリ (100/100、所要時間、平均体重、個体一覧へのリンク) を群詳細上で確認できる
3. **個体化モード in-progress でブラウザ戻る / タブ閉じ** → `beforeunload` + Solid Router の `useBeforeLeave` で確認ダイアログを表示。X 匹を個体化済みである旨を明示

#### 群詳細の表示分岐 (active / archived)

| 状態 | ヘッダー | アクション | 追加表示 |
|---|---|---|---|
| `archived_at IS NULL` (active) | アクティブバッジ | 「個体化を開始」/ 「個体化を再開」 (中断後) | 直近の群ログ |
| `archived_at IS NOT NULL` (archived) | アーカイブ済みバッジ | 「個体一覧を見る (X 匹)」 | 完了サマリ (所要時間、平均体重、σ) |

完了直後のフレッシュな archived 表示には、URL クエリ `?just_completed=true` を付けて router.replace し、群詳細側で「個体化が完了しました」のトースト + サマリカードを 1 度だけ表示する。

#### deep link / リフレッシュ時の挙動

| 状況 | 挙動 |
|---|---|
| URL 直叩きで `/cohorts/:id/promote` (cohort active) | 通常通り個体化モード開始 (denominator = current_count) |
| URL 直叩きで `/cohorts/:id/promote` (cohort archived) | 群詳細にリダイレクト + トーストで通知 |
| 個体化中にリフレッシュ | セッション state は揮発、個体化済み specimens は server に永続化済みなので消えない。リフレッシュ後はサーバ最新の current_count でセッション再開可能 (denominator は更新されることに注意) |
| 個体化中にネットワーク切断 → ボタン押下 | `POST /promote` 失敗、トースト + 再試行ボタン (§7.4) |

#### 周辺フロー (今回の図には含めなかったもの)

- **群一覧 ↔ アーカイブ済み一覧**: タブ切替で同一ページ内 (URL クエリ `?archived=true`)
- **個体化済み個体の閲覧**: 群詳細 → 「個体一覧 (100 匹)」→ `/specimens?cohort_id=:id` へ遷移 (個体一覧にこのフィルタ機能の追加が必要、Phase 3 のスコープに含める)

#### 個体登録 / 群登録の遷移元・遷移先

両フォーム (`SpecimenDetailForm`, `CohortDetailForm`) は専用ページとして配置し、以下のエントリ・エグジットを持つ。

##### 遷移元 (entry points)

| フォーム | エントリ | 起動方法 | URL クエリ |
|---|---|---|---|
| 個体登録 (`/specimens/new`) | 飼育一覧 | 「+ 個体登録」CTA ボタン | なし |
| 個体登録 | マイページ | クイックアクション (header dropdown) | なし |
| 個体登録 | ⌘K パレット | コマンド「個体登録」 | なし |
| 個体登録 (将来) | 群詳細 | 「+ 個体登録」(個体化フロー外) | `?cohort_id=:id` |
| 群登録 (`/cohorts/new`) | 飼育一覧 | 「+ 群を作成」CTA ボタン | なし |
| 群登録 | マイページ | クイックアクション | なし |
| 群登録 | ⌘K パレット | コマンド「群を作成」 | なし |
| 群登録 (将来) | 親交配ページ | 「この交配で群を作成」リンク | `?parent_mating_id=:id` |

「将来」とマークしたエントリは Phase 5 以降の拡張範囲。Phase 3 では飼育一覧・マイページ・⌘K の 3 経路のみ実装する。

##### 遷移先 (exit destinations)

| アクション | 個体登録の遷移先 | 群登録の遷移先 |
|---|---|---|
| キャンセル | 遷移元へ戻る (`router.back()` または referrer) | 遷移元へ戻る |
| 登録 / 作成 (Enter / 主ボタン) | `router.replace('/specimens/:newId')` | `router.replace('/cohorts/:newId')` |
| 保存して続けて登録 | 同画面でフォーム部分リセット (下記参照) | 同画面でフォーム部分リセット (下記参照) |

`router.replace` を使う理由は、ブラウザ戻るで登録フォームに戻った時に「同じ specimen / cohort をもう一度登録してしまう」事故を防ぐため。

##### 「保存して続けて登録」のコンテキスト保持仕様

連続登録時、同じ条件で次のレコードを作るのが目的なので、以下のフィールドを保持する:

| フォーム | 保持するフィールド | リセットするフィールド |
|---|---|---|
| 個体登録 | 累代、父個体、母個体 | 個体 ID (再採番)、名前、性別、体重、体長、ステージ、メモ |
| 群登録 | 種、由来 (産卵 / 購入 / 採集)、親交配、系統 | LOT ID (再採番)、名前、初期数、ステージ、開始日、備考 |

実装上は `SpecimenDraft` / `CohortDraft` の partial を `localStorage` に一時保存し、`保存して続けて登録` 押下時に reset したフィールドだけ初期値に戻す。リロード対策としても機能する。

##### マイページのクイックアクション再構成

実機の MyPage 右上には現在「+ ログを記録」「+ 新しい個体を探す」が並ぶ。Phase 3 で以下に再構成:

- 「+ ログを記録」**削除** (飼育ログ廃止に伴う)
- 「+ 新しい個体を探す」**保持** (EC 経路、既存通り)
- 「+ 個体登録」**追加** (新規)
- 「+ 群を作成」**追加** (新規)

CTA が増えるので、4 つの「+」ボタンを横並びにせず、**「+ 新規」 dropdown menu に集約** する案も検討余地あり (実装中に判断)。

---

## 4. Phase 1 — バックエンド実装

### 4.1 マイグレーション

#### `0020_cohorts.sql`

```sql
CREATE TABLE cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT UNIQUE NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id),
  species_id UUID NOT NULL REFERENCES species(id),

  origin_kind TEXT NOT NULL CHECK (origin_kind IN ('egg_lay', 'purchase', 'field_collected')),
  parent_mating_id UUID REFERENCES mating_records(id),

  initial_count INT NOT NULL CHECK (initial_count > 0),
  current_count INT NOT NULL CHECK (current_count >= 0),
  stage TEXT NOT NULL CHECK (stage IN ('egg', 'larva_l1', 'larva_l2', 'larva_l3', 'pupa', 'mixed')),

  start_date DATE NOT NULL,
  notes TEXT,
  archived_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cohorts_owner ON cohorts(owner_user_id) WHERE archived_at IS NULL;
CREATE INDEX idx_cohorts_archived ON cohorts(owner_user_id, archived_at) WHERE archived_at IS NOT NULL;

CREATE TABLE cohort_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  log_type TEXT NOT NULL CHECK (log_type IN ('feed', 'mat', 'death', 'observation')),
  count_delta INT,
  metrics JSONB,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT
);

CREATE INDEX idx_cohort_logs_cohort ON cohort_logs(cohort_id, logged_at DESC);

ALTER TABLE specimens
  ADD COLUMN cohort_id UUID REFERENCES cohorts(id),
  ADD COLUMN promoted_from_cohort_at TIMESTAMPTZ;

CREATE INDEX idx_specimens_cohort ON specimens(cohort_id) WHERE cohort_id IS NOT NULL;
```

### 4.2 リポジトリ

- `src/repos/cohorts.rs`
  - `CohortRow` (FromRow), `CohortInsert`
  - `find_by_id`, `list_by_owner`, `list_archived_by_owner`
  - `insert`, `update_current_count`, `archive`
- `src/repos/cohort_logs.rs`
  - `CohortLogRow`, `CohortLogInsert`
  - `list_by_cohort`, `insert`

### 4.3 ハンドラ

- `src/handlers/cohorts.rs`
  - `GET /cohorts/me` — オーナーの群一覧 (アクティブ + アーカイブの両方、クエリパラメータで絞込)
  - `POST /cohorts` — 群新規作成
  - `GET /cohorts/{id}` — 詳細
  - `POST /cohorts/{id}/cohort_logs` — 群ログ追加 (一括ログ用)
  - **`POST /cohorts/{id}/promote`** — 個体化 1 匹 (中核 API)
  - `POST /cohorts/{id}/archive` — 手動アーカイブ (中断時)

#### `POST /cohorts/{id}/promote` の仕様

リクエスト:
```json
{
  "specimen": {
    "name": null,
    "weight_g": 8.2,
    "size_mm": null,
    "stage": "larva_l3"
  },
  "log": {
    "metrics": { "container": "individual" }
  }
}
```

レスポンス:
```json
{
  "specimen": { /* SpecimenRow */ },
  "cohort": { /* CohortRow (current_count -1 反映済み) */ },
  "session": {
    "promoted_count_in_session": 4,
    "remaining_in_cohort": 96,
    "completed": false
  }
}
```

サーバ側で 1 トランザクション:
1. `INSERT INTO specimens (cohort_id, promoted_from_cohort_at, ...)`
2. 親 `mating_records` から父母情報を継承して埋める
3. `UPDATE cohorts SET current_count = current_count - 1, version = version + 1`
4. `current_count = 0` なら同時に `archived_at = now()` をセット
5. `INSERT INTO cohort_logs` (`log_type='death'` ではなく `'observation'` で個体化記録)
6. `INSERT INTO specimen_logs` (新規個体の初回ログ)

`session.completed = true` をフロントが見て完了ダイアログを表示。

### 4.4 ts-rs 型エクスポート

新規 DTO に `#[derive(TS)]` を付与:
- `CohortView`
- `CohortDetailView`
- `CohortLogView`
- `PromoteCohortRequest` / `PromoteCohortResponse`
- `PromotionSessionState`

`cargo run --bin export_ts` (既存スクリプトに追加) → `client_solid/src/generated/api-types.ts` 更新。

### 4.5 ルート登録

`src/routes.rs` に `/cohorts/*` を追加。既存の `/specimens/*` と同じ middleware (auth, owner) を適用。

### 4.6 テスト

- `tests/cohorts_repo_test.rs`
  - `promote` の楽観的ロック (version 競合) 確認
  - `current_count = 0` → `archived_at` セット確認
  - 親情報継承 (mating_records から) 確認
- 失敗ケース: 既にアーカイブ済みの cohort への promote は 409

---

## 5. Phase 2 — 型同期 + store + API

### 5.1 型同期

`cargo run` (or `pnpm gen:openapi`) で `client_solid/src/generated/` を更新。

### 5.2 `client_solid/src/store/cohorts.ts`

既存 `store/specimens.ts` のパターンに従う:

```ts
import { createSignal } from "solid-js";
import type { CohortView } from "../generated/api-types";

const [serverCohorts, setServerCohorts] = createSignal<CohortView[]>([]);
const [loading, setLoading] = createSignal(false);
const [error, setError] = createSignal<Error | null>(null);

export { serverCohorts, setServerCohorts, loading, error };

export async function fetchCohorts() { /* GET /cohorts/me */ }
export async function fetchCohortDetail(id: string) { /* GET /cohorts/:id */ }
```

#### 個体化セッション専用 store (`store/promoteSession.ts`)

セッション中だけ持つ揮発性 state:

```ts
type PromoteSessionState = {
  cohortId: string;
  denominator: number;        // セッション開始時の current_count
  promotedCount: number;      // この セッション中に個体化した数
  promotedSpecimens: SpecimenView[];  // 巻き戻し用
  dialog: 'none' | 'confirm-end' | 'complete';
  status: 'active' | 'completing' | 'completed';
};
```

### 5.3 `client_solid/src/api/cohorts.ts`

```ts
export async function listCohorts(includeArchived = false): Promise<CohortView[]>;
export async function getCohort(id: string): Promise<CohortDetailView>;
export async function createCohort(input: CohortInsert): Promise<CohortView>;
export async function promoteFromCohort(
  cohortId: string,
  payload: PromoteCohortRequest,
): Promise<PromoteCohortResponse>;
export async function archiveCohort(cohortId: string): Promise<CohortView>;
export async function addCohortLog(cohortId: string, log: CohortLogInsert): Promise<CohortLogView>;
```

`api/index.ts` の barrel export に追加。

---

## 6. Phase 3 — 群一覧 / 詳細ページ

### 6.1 ルーティング (`router.ts` への追加)

```ts
// RouteKey に追加
'cohort'         // /cohorts
'cohort-detail'  // /cohorts/:id
'cohort-promote' // /cohorts/:id/promote
```

`pathnameToRouteKey()` のパターンマッチに `/cohorts/:id` を追加。`sidebarRouteKey()` で `cohort-detail` の親を `cohort` にマップ。

### 6.2 サイドバー nav の再構成 + 飼育ログ削除

実機の確認を経て、サイドバー nav 構造を以下のように変更:

**Before (現状):**
```
ブリード:  マイページ / 飼育ログ / 羽化予測 / 血統系図
```

**After:**
```
ブリード:  マイページ / 飼育 (NEW) / 羽化予測 / 血統系図
```

#### 削除する実装

| ファイル / ルート | 扱い |
|---|---|
| `pages/Log.tsx` | **削除** (旧 `/log` の独立ページ) |
| `router.ts` の `/log` ルート登録 | **削除** |
| `RouteKey: 'log'` | **削除** |
| サイドバー nav 項目 `飼育ログ` | **削除** |
| `components/log/LogTimeline.tsx` | **保持** (specimen 詳細で再利用) |
| `components/log/LogTypeTag.tsx` | **保持** (再利用) |
| `api/logs.ts` | **保持** (specimen log API は cohort log と並行して使用) |

#### 削除の根拠

旧 `飼育ログ` ページは「全 specimen 横断の日次記録 + タイムライン」の独立画面だったが、業者向けピボットで以下の理由から不要:

1. ロギングはコンテキスト依存になる (どの群・どの個体に対するログか) ため、群詳細・個体詳細の中で記録するのが自然
2. 横断的な「全ログを見る」ニーズはサマリ KPI (マイページの「今月の飼育ログ」) で満たせる
3. 機能 1.7 の方針: ロギング機能は群詳細・個体詳細・個体化モードのコンテキスト内に内包

### 6.3 新規ページ

- `pages/cohort/index.tsx` — 飼育一覧 (URL は `/cohorts` のまま、ラベルだけ「飼育」)
  - モバイル: カードリスト (`components/cohort/CohortCard.tsx`)
  - デスクトップ: 2 カラムカードグリッド + フィルターパネル
  - URL クエリ `?archived=true` でアーカイブ済みタブ表示
  - ヘッダー CTA: 「+ 個体登録」(→ `SpecimenDetailForm` 単独表示) と「+ 群を作成」の 2 種類
- `pages/cohort/[id].tsx` — 群詳細 (active / archived で表示分岐、§3.6 参照)
  - モバイル: 縦スタック (メタ → ログ → アクションボタン)
  - デスクトップ: KPI 行 (4 カード) + アクションボタン + タブ (概要 / ログ / 由来)
  - active: 「個体化を開始」/ 「個体化を再開」ボタン → `/cohorts/:id/promote` へ遷移
  - archived: 完了サマリ + 「個体一覧 (X 匹) を見る」ボタン → `/specimens?cohort_id=:id` へ
  - URL クエリ `?just_completed=true` でトーストとサマリカード強調表示

#### 既存ページへの追加

- `pages/specimen/index.tsx` (個体一覧) に **`cohort_id` フィルタ機能を追加**
  - クエリパラメータ `?cohort_id=:id` を受けて該当 specimens のみ表示
  - フィルタ表示時はヘッダーに「LOT-2026-0007 から個体化された 100 匹」のような breadcrumb 風表示

### 6.4 新規コンポーネント

- `components/cohort/CohortCard.tsx` — モバイル一覧カード
- `components/cohort/CohortRow.tsx` — デスクトップテーブル行
- `components/cohort/CohortMeta.tsx` — 詳細画面のメタ情報部分
- `components/cohort/CohortStatusBadge.tsx` — アクティブ / アーカイブ / 警告
- `components/cohort/SessionHistoryPanel.tsx` — **B 案左パネルの中身**。直近個体リスト + 平均 / σ。Phase 4 で個体化モード画面に再利用するほか、群詳細画面の「最近のログ」表示にも転用

### 6.5 スタイル

`styles/cohort.css` を新設。`tokens.css` のカラー / スペーシング変数を使う。

---

## 7. Phase 4 — 個体化モード

### 7.1 新規ページ `pages/cohort/promote.tsx`

URL: `/cohorts/:id/promote`

ページ in / out の挙動 (詳細は §3.6 画面遷移設計):
- in: ルートパラメータから `cohortId` 取得 → `getCohort(id)` で詳細取得 → セッション初期化 (`denominator = current_count`, `promotedCount = 0`)。archived 済みなら群詳細にリダイレクト
- out (ブラウザ戻る / タブ閉じ): セッションが active なら確認ダイアログ (`useBeforeLeave` + `beforeunload`)
- out (完了): `router.replace('/cohorts/:id?just_completed=true')` で群詳細へ
- out (中断確定): `router.replace('/cohorts/:id')` で群詳細へ (cohort.archived_at は NULL のまま)

#### レイアウト (B 案)

| 幅 | 構成 | 内容 |
|---|---|---|
| `< 768px` (モバイル) | 1 ペイン | フォームのみ縦スタック (既存 v4 プロトタイプそのまま) |
| `>= 768px` (デスクトップ) | 2 ペイン | 左 240px: `SessionHistoryPanel` / 右 残り: フォーム |

CSS 例:
```css
.promote-layout {
  display: grid;
  grid-template-columns: 1fr;
}
@media (min-width: 768px) {
  .promote-layout {
    grid-template-columns: 240px 1fr;
  }
}
```

左パネル (`SessionHistoryPanel`) はモバイルでは非表示 (`display: none`)。完了ダイアログ表示中はパネル全体を modal が覆うため、レイアウト分岐を考慮する必要なし。

### 7.2 新規コンポーネント

- `components/cohort/PromoteSession.tsx`
  - メイン UI。spinner + チェックリスト + ボタン群
  - props: `cohort: CohortDetailView`
- `components/recording/SpecimenSpinner.tsx`
  - 体重スピナー (汎用、通常モードでも再利用)
  - 詳細仕様は §3.5 を参照 (input + ±ボタンのハイブリッド構成)
  - props: §3.5 の `SpecimenSpinnerProps` インタフェース通り
- `components/recording/RecordingDialog.tsx`
  - 終了確認 / 完了の汎用 modal
  - props: `kind: 'confirm-end' | 'complete'`, `onCancel`, `onConfirm`, `countdownSec?`

### 7.3 状態遷移

```
[active] --click "完了→次の1匹"--> POST /promote
                                       │
                                       ├─ resp.session.completed = false
                                       │   └─ promotedCount++, 同画面に留まる
                                       │
                                       └─ resp.session.completed = true
                                           └─ status='completing', dialog='complete', start countdown
                                                ├─ 3秒経過 → router.replace('/cohorts/:id') (群詳細へ)
                                                └─ "OK" 押下 → 即遷移

[active] --click "個体化モードを終了する"--> dialog='confirm-end'
                                              ├─ "キャンセル" → dialog='none'
                                              └─ "終了する" → router.replace('/cohorts/:id') (群詳細, cohort.archived_at は NULL のまま)
```

**ダイアログ文言の確定**:
- 完了: 「個体化モードが完了しました。**群詳細に戻ります** (3 秒)」
- 中断: 「個体化を終了しますか？ X 匹を個体化しました。残りの (denominator - X) 匹は群に残ります。」

### 7.4 エラーハンドリング

- `POST /promote` 失敗 (ネットワーク / 楽観 lock 競合):
  - トースト表示 (`store/toast.ts` を再利用)
  - 「再試行」ボタンを画面下に出す
  - リトライ成功までセッション状態は変えない

### 7.5 デバッグ用 URL クエリ

開発時の確認用に `?debug=complete` で完了ダイアログを即表示できるようにする (本番ビルドでは無視)。

---

## 8. Phase 5 — 個体詳細設定フォーム (`SpecimenDetailForm`)

個体化モードの内部 (詳細展開時) と、群外からの単独個体登録 (`/specimens/new`) で共通利用する詳細フォーム。

### 8.1 配置

#### 単独個体登録 `/specimens/new`

- 飼育一覧ページ (`pages/cohort/index.tsx`) のヘッダー CTA「+ 個体登録」から遷移
- フォームのみのフルページ (右上に「OO-0046」のプレビュー表示)
- 由来選択: 群から / 購入 / 採集 → 由来に応じて関連フィールドが切替
  - 群から: 由来元の群 (selector、active な cohort 一覧)
  - 購入: 購入元 shop / 購入価格 / 購入日
  - 採集: 採集地 / 採集日

#### 個体化モード内のインライン展開

- `pages/cohort/[id]/promote.tsx` の新規記録カード右上「詳細設定 ▾」リンクで展開
- 同じ `SpecimenDetailForm` コンポーネントを `compact={true}` props で呼び出す
- 由来は群から固定、由来元は cohort_id で固定 (変更不可)

### 8.2 フォーム構成

4 セクションで構成。各セクションは独立 card:

1. **基本情報** — 個体 ID (mono input、自動採番ボタン併設) / 名前 (任意 text) / 性別 (♂/♀/不明 segmented control)
2. **血統情報** — 累代 (自動継承の F2 表示 + 手動上書きリンク) / 父個体 (selector、cohort 由来時は read-only) / 母個体 (同上)
3. **初期計測 (任意)** — 体重 g / 体長 mm / ステージ (L1/L2/L3/蛹/成虫 segmented)
4. **備考・公開設定** — textarea + 公開フラグ (既定 非公開)

### 8.3 props 仕様

```ts
interface SpecimenDetailFormProps {
  mode: 'standalone' | 'inline';
  defaultValues?: Partial<SpecimenDraft>;
  cohortContext?: CohortView;       // 由来=cohort 時にプリフィル
  onSubmit: (draft: SpecimenDraft) => Promise<void>;
  onCancel: () => void;
  enableContinuousMode?: boolean;   // 「保存して続けて登録」ボタン表示
}

interface SpecimenDraft {
  publicId: string;                 // 採番 or 上書き
  name?: string;
  sex?: 'male' | 'female' | 'unknown';
  origin: 'cohort' | 'purchase' | 'field';
  cohortId?: string;
  fatherId?: string;
  motherId?: string;
  generation?: number;              // null = 自動継承
  birthDate?: string;
  weightG?: number;
  sizeMm?: number;
  stage?: 'larva_l1' | 'larva_l2' | 'larva_l3' | 'pupa' | 'adult';
  notes?: string;
  visibility: 'private' | 'public';
}
```

### 8.4 ボタン構成

- `キャンセル` (outline) — 戻る
- `保存して続けて登録` (outline) — 保存後フォームをリセットして同じ画面に留まる (連続登録モード)
- `登録する` (forest filled, primary) — 保存後 `/specimens/:newId` または cohort 詳細へ遷移
- Enter キーでは「登録する」が発火

### 8.5 バックエンド連携

#### 単独登録 (origin = purchase / field)

- `POST /specimens` (既存エンドポイント) を流用
- 親情報 (father_id, mother_id) は手動指定された値を直接 INSERT

#### 群から (origin = cohort, inline)

- `POST /cohorts/{id}/promote` (Phase 1 で作成) のリクエストボディを `SpecimenDetailForm` の draft で生成
- compact mode では一部フィールド (備考・公開設定) は折り畳み内に隠す

### 8.6 バリデーション

- `publicId` ユニーク制約 (server 側で 409 → トースト表示)
- 死亡日 < 出生日のような不可能な組み合わせは送信前にクライアント検証
- 性別 = 不明のまま登録可能 (幼虫期は判別困難なため)

---

## 9. Phase 6 — 通常 (連番) モードの骨組み

完全実装は別計画 (棚位置データの追加が必要)。今回は **UI 骨格のみ**:

- `PromoteSession.tsx` と同じ UI を「通常モード」として再利用
- `components/cohort/PromoteSession.tsx` は `mode: 'promote' | 'sequential'` props で切替可能にしておく
- 通常モードでは個体 ID 自動採番のロジックを変えるだけ
- 棚位置 (shelf / row / col) は将来の `specimens` カラム追加を待つ

これにより、Phase 4 の実装が「個体化のためだけ」ではなく、将来の通常モードにも転用できる構造を持つ。

---

## 10. Phase 7 — レスポンシブ調整 + テスト

### 9.1 ブレークポイント

`tokens.css` に明示的に追加:

```css
:root {
  --bp-sm: 480px;
  --bp-md: 768px;
  --bp-lg: 1024px;
  --bp-xl: 1280px;
}
```

メディアクエリは既存の自前 CSS パターンに統一。

### 9.2 ページ別の挙動

| ページ | < 768px (モバイル) | >= 768px (デスクトップ) |
|---|---|---|
| 群一覧 | カードリスト + BottomTabBar | テーブル + Sidebar |
| 群詳細 | 縦スタック | 2 カラム |
| 個体化モード | スマホ UI フルスクリーン | Phase 0 で決定した案 |

### 9.3 ダイアログ

`RecordingDialog.tsx` は両デバイスで `position: fixed` (フルビューポート) + 中央 modal。スマホで親要素にスクロールがあっても確実に中央に出る。

### 9.4 テスト

#### Vitest + @solidjs/testing-library

- `store/promoteSession.test.ts` — 状態遷移の table-driven test
- `PromoteSession.test.tsx` — ボタン押下 → API モック → ダイアログ表示
- `RecordingDialog.test.tsx` — カウントダウン後 callback 発火、cancel が timer 解除

#### バックエンド

- `tests/cohorts_test.rs` — 既存の sqlx テストパターンに従う
- 統合テスト: 個体化 100 連発 → 完了 → cohort archived 確認

#### 手動確認 (e2e は今回見送り)

- 個体化 1 → 2 → 完了の動線をモバイル / デスクトップ両方で
- ネットワーク切断時の挙動 (Chrome DevTools)
- アーカイブ済み群を一覧でフィルタ表示

---

## 11. 実装順序の根拠 (なぜこの順か)

FE-first 戦略を採用 (詳細は §2.1)。各 Phase 間の依存と理由:

| 順 | 理由 |
|---|---|
| Phase 0 (モック) → 1 (FE 基盤) | モックで UI が固まったので、その通りの構造を実装する |
| Phase 1 → 2 (一覧 / 群詳細) | ルーティングと型と mock layer が揃わないと、個別ページが書けない |
| Phase 2 → 3 (個体化モード) | 個体化モードへは群詳細から遷移するため、群詳細を先に作る |
| Phase 3 → 4 (登録フォーム + CTA) | フォームは群詳細・個体化と独立して作れるが、CTA から呼ばれる関係上 4 を後に |
| Phase 4 → 5 (UI レビュー) | 全 FE 機能が揃ってから業者にデモして反応収集 |
| Phase 5 → 6 (BE 実装) | UI レビューで詰まった仕様を BE 設計に反映 (ニーズ駆動の API) |
| Phase 6 → 7 (BE 接続) | mock を real fetch に置換、ts-rs 型に乗換 |
| Phase 7 → 8 (通常モード骨組み) | 個体化の `PromoteSession` を抽象化して再利用するため、個体化が安定してから |
| Phase 8 → 9 (レスポンシブ + テスト) | 全ページ揃ってからレイアウト調整 + テスト |

---

## 12. 既知の論点 (実装中に詰める)

### 11.1 ID 採番ポリシー

- 初期実装: `OO-{YYYY}-{4桁}` 自動採番 (種 prefix は species テーブルから引く)
- カスタムテンプレート (`{species}-{bloodline}-{seq}` など) は v2 機能
- 採番の競合: PostgreSQL の `SELECT FOR UPDATE` + シーケンス
- 採番テーブルは新設せず、`specimens` の `public_id` を参照して MAX + 1

### 11.2 中断後の再開導線

- 中断 (50/100 で終了など): `cohorts.archived_at` は NULL のまま
- 群詳細画面で「個体化を再開」ボタンを表示
- 再開時は denominator = 現在の `current_count` (50 になっている)
- 連続性: 「前回 50 匹個体化済み」を画面に表示する案 → 要検討 (UX)

### 11.3 楽観的並行制御

- `cohorts.version` カラムを追加 (`UPDATE ... WHERE version = ?`)
- 競合時は 409 を返し、フロントは「他の端末で更新されました。再読み込みします」トースト

### 11.4 ts-rs vs OpenAPI コードジェン

- 現状フロントは OpenAPI ジェン (`generated/api-types.ts`) と ts-rs エクスポート (`generated/sdui.ts`) が併存
- cohorts 系は ts-rs に寄せるのが既存 SDUI パターンに揃って合理的
- ただし OpenAPI ドキュメントとの整合は別途確認 (utoipa の ToSchema は両方に書く)

### 11.5 デスクトップショートカット

- §3.3 のショートカットは Phase 4 で実装
- アクセシビリティ: `aria-keyshortcuts` 属性で読み上げ対応
- グローバルキャッチ vs ページ内キャッチ: 個体化モード内のみ有効に限定

### 11.6 アーカイブ済み群の閲覧

- 群一覧のフィルタタブ「アクティブ / アーカイブ」
- アーカイブ済みは個体化 / 編集不可、閲覧のみ
- archived から個体一覧 → 元 cohort へ逆引き可能 (`specimens.cohort_id` インデックスあり)

---

## 13. リスクと対策

| リスク | 対策 |
|---|---|
| バックエンドの cohort スキーマ確定が UI 開発を阻害 | Phase 1 を先行、フロントは型ジェン後着手。それまでは Phase 0 のモック作業を並行 |
| `PromoteSession` の状態管理が複雑化 | テスト駆動で先に状態遷移表を書く (§7.3) |
| デスクトップ UX の決定遅延 | Phase 0 で必ず確定。3 案のうち未決の場合は最も簡素な A 案で着手 |
| 個体化中のネットワーク切断で部分成功 | 1 トランザクション設計で部分成功は起きない。失敗時は再試行ボタン |
| 既存 SpecimenView 型の破壊変更 | `cohort_id` 追加は optional フィールドにして既存呼び出し側に影響しない |

---

## 14. 関連ドキュメント

- `docs/breeder-pivot-and-features.md` — 機能仕様の正典
- `docs/market-research.md` — 市場調査結果 (本計画の前提)
- `docs/db-schema-design.md` — DB スキーマの正典 (Phase 1 完了後に cohorts を統合)
- 会話内プロトタイプ v4 — UI 仕様の正典 (本計画と整合確認済み)

---

## 15. 計画の使い方

1. Phase 0 (デスクトップモック) を先に進める。3 案のレビュー後 1 案を採択
2. Phase 1 (バックエンド) と並行して Phase 0 の選択を反映した詳細設計を §6 / §7 に追記
3. 各 Phase 完了時に本ドキュメントの該当節をチェックマーク (- [x]) で更新
4. Phase 中に発見した論点は §11 に追記、後続 Phase で対応
