# 実行計画 — ハーネス(指標1)→ primitive 導入 → Phase 4 判断

推奨タスク順(ハーネスが先、primitive は Phase 4 の前が最後の安いタイミング)に沿った実行計画。
フロントは Solid.js 継続が確定したため、primitive 投資の寿命に関する留保は無し。

| 順 | タスク | 規模 | 前提 |
|---|---|---|---|
| T1 | LLMハーネス実装 + 実測(成功指標1) | 半日 + 実測 | なし(validate / dump_schema は実装済み) |
| T2 | フロント primitive 導入 Step 1〜2 | 1〜2日 | T1 と独立(並行可)。Phase 4 より前 |
| T3 | Phase 4(フォーム語彙化)の着手判断 | 0.25日 | T1 の結果 + 運用実績 |

ユーザ判断が必要なチェックポイントは3つ: **CP1** タスク套件20件のレビュー(T1.1)、
**CP2** 空白トークンの刻み確定(T2.1)、**CP3** 実測の実行者(APIキーの扱い、T1.4)。

---

## T1. LLMハーネス(harness/run.py)— 指標1の計測

**目的**: 「閉じたスキーマを与えれば、LLM が validate を通る画面定義を書ける」を数値にする。
PLAN.md ステップ6(未実装)。目標: N=20 で通過率 90%以上。

### T1.1 タスク套件の作成(CP1: 20件をレビューしてもらう)

`harness/tasks.json` に20件。設計方針:

- **語彙カバレッジ**: text(role/editable)/ markdown / media / cta / **action_button** /
  listing_grid(sort × limit × seller)/ **group_tabs + specimen_rows** / **layout(sidebar/stack)** /
  size(full/half)/ tone(accent) を套件全体で必ず1回以上踏む(Phase 1〜3 の新語彙を含む)
- **構成比**: 新規ページ生成 16件 + 既存定義の編集 4件
  (編集系 = 現行 care/home 定義を与えて「カードを1枚追加して全体を返せ」— 実運用の PUT に近い)
- **難度の傾斜**: 単純(text+cta のカード1枚)〜複合(sidebar カード + 出品グリッド + 制約際どい limit)
- 各タスクの形式: `{ id, page_key, instruction(日本語), expects: [語彙タグ], mode: generate|edit }`

### T1.2 run.py の実装

構成(Python 150〜200行、依存は anthropic SDK のみ):

```
harness/
  run.py            # 本体
  tasks.json        # T1.1 の套件
  l2_rules.md       # L2 意味検証ルールのプロンプト用文書(新規作成・valid.rs から転記)
  fixtures/         # dry-run 用(valid×2 / L1違反×3 / L2違反×3)
  requirements.txt  # anthropic
  results/<ts>/     # report.md + raw/<task_id>.json(生出力を全保存)
```

処理フロー: スキーマ読込(`schema/page_definition.schema.json`、無ければ `cargo run --bin dump_schema`)
→ タスクごとに Claude API 1回 → 出力を `target/debug/validate` に stdin で流す(無ければ
`cargo build --bin validate`)→ exit code + stderr を記録 → 分類 → 集計レポート。

- **生成モード**(自動フォールバック、使用モードを記録):
  1. structured outputs(スキーマで制約サンプリング)
  2. tool_use 強制(スキーマを input_schema にした単一ツール呼び出し)
  3. プロンプト埋め込み(スキーマ本文を貼り「JSONのみ出力」)
  ※ schemars の oneOf+pattern 構成が 1/2 のサポート範囲外ならフォールバックが働く
- **2条件測定**: (A) スキーマのみ / (B) スキーマ + `l2_rules.md`。
  L2 ルールはスキーマに載っていない(key一意・headline≦1/card・limit 1..=24・カード/ブロック≦10・
  markdown≦5000字)ため、条件差が「文書で何ポイント稼げるか」の診断になる
- **失敗の自動分類**: validate の stderr をパース —
  `structural:`(L1)はさらに 未知フィールド / 未知variant / ブランド型(SitePath/BlockKey)に、
  L2 は DefinitionError の種別(DuplicateKey / MultipleHeadlines / LimitOutOfRange /
  MarkdownTooLong / TooManyCards / TooManyBlocks / SchemaVersion)に分ける。
  **「スキーマ準拠だが serde で拒否」**(SitePath の `..`/`//` 等、brand.rs が意図した隙間)は
  専用の分類枠を設ける
- CLI: `--n --model --temperature --condition A|B --dry-run --hydrate-gate`
- レポート: 通過率(全体/条件別/生成・編集別)、失敗タクソノミ表、モデル・温度・トークン数・
  所要時間、生出力への相対パス

### T1.3 (任意)第二ゲート: hydrate 通過率(--hydrate-gate)

validate 通過 = 配信可能ではない(例: `specimen_profile` をホームに置くと validate は通るが
GET は 400 MissingContext)。API + DB が起動している環境でのみ、
`PUT /api/pages/harness_test` → `GET` して 200/4xx を第二判定として記録する。
Phase 2 E2E で使った起動手順(fresh DB + 登録ユーザ)を流用。初回実装では省略可。

### T1.4 実測と記録(CP3)

- dry-run で fixtures 8件が全て正しく分類されること(パイプラインの受け入れ基準)
- 実測 N=20 × 2条件。実行者はどちらでも:
  (a) ユーザが `ANTHROPIC_API_KEY` を入れてローカル実行 /(b) キーを預けられるなら私が実行
- 結果を `docs/PLAN.md` の検証チェックリスト(指標1)に転記。90% 未達の場合は
  失敗タクソノミから改善候補(スキーマの description 強化・l2_rules の恒常化・語彙の説明追記)を
  次アクションとして列挙する — 未達でも「どこが漏れるか」が成果物

**T1 完了条件**: dry-run 全件正分類 + 実測レポート1式 + PLAN.md への結果転記。

---

## T2. フロント primitive 導入(FRONTEND_PRIMITIVES.md の Step 1〜2)

**目的**: ブロック内部を「閉じた props の primitive 合成」に寄せ、汎用レイアウト12クラス +
意味部品19クラスを吸収。次の意味トークン追加を primitive の組合せ1つにする(指標3短縮)。

### T2.1 トークン語彙の確定(CP2)

app.css の実測分布(gap: 4×3箇所 / 8×8 / 10×4 / 12×8 / 14×3 / 16×2)から提案:

- `Space = xs(4) / sm(8) / md(12) / lg(16) / xl(20)`。実測の 10 → sm、14 → md に丸める
  (最大 2px の視差。許容できない箇所だけ既存クラス残置)
- `Grid cols = 2 | 3`(現状 sd-form-grid2/3 のみ)、`Justify = start/center/end/between`、
  `Align = start/center/end/stretch`
- Text role / Button intent / Chip は既存の variant をそのまま enum 化
  (`headline/lead/body/caption`、`default/primary/ghost/danger`)

### T2.2 Step 1: primitives.tsx + トークンCSS(半日)

- `web/src/sdui/primitives.tsx`(~150行): `Box / Stack / Row / Grid / Text / Button / Chip / Field`。
  Solid の `splitProps` でリアクティビティ維持、`class`+`classList` 合成
- app.css に `ui-*` トークンクラス(~60行)を追加(既存 `sd-*` と共存)
- ファイル冒頭に**定義層への漏れ出し禁止ガード**を明文化:
  「この props はレンダラの内部命令セット。DefBlock / Card に direction や gap を生やさない。
  定義に出してよいのは意味トークン(例: layout: sidebar)のみ(REFACTOR §3 案ロ参照)」

### T2.3 Step 2: B/C クラスの吸収(半日〜1日)

対象は実測で6ファイル: `renderer.tsx` / `specimen.tsx` / `listing.tsx` /
`routes/care.tsx` / `routes/login.tsx` / `app.tsx`(+ app.css の削除)。

- B(12クラス): `sd-form(-row/-grid2/-grid3/--boxed)` → Stack/Row/Grid、
  `sd-actionrow` → `<Row justify="end">`、`sd-textwrap` → Row、`sd-chips` → `<Row wrap gap="sm">`、
  `sd-speclist` → Stack(レガシー `sd-speclist-layout/-toolbar` は SpecimenListView 専用として残置)
- C(19クラス): `sd-btn` 系 → Button、`sd-cta` 系 → Cta(または Button の href variant)、
  `sd-text` 系 → Text、`sd-chip` → Chip、`sd-field` → Field、`sd-status/sd-empty` → Text の variant
- **触らないもの**: D(タブ・行・モーダル・Collapse・hero 等の装飾49クラス)、
  レガシー `SpecimenListView`、`shell__*`、メディアクエリと reduced-motion
- 進め方はコミット単位を「1分類=1コミット相当」に刻む(B→Cの順)。見た目回帰の確認は
  tsc + `bun run build` + before/after スクリーンショットの目視比較

**T2 完了条件**: tsc/build 緑、app.css の削減行数を記録(目安 250〜350行減)、
B/C の `sd-*` クラスが app.css から消えている(D と shell は残る)。

### T2.4 (任意・接続確認)primitive の配当を1つ実証

`sidebar` の実装(`sd-card-cols/side/main` の専用CSS)を `<Row align="start">` +
`<Stack grow>` に置き換え、「意味トークン → primitive 合成」の経路を実際に1本通す。
これが次のトークン(`toolbar` 等)追加時のテンプレートになる。

---

## T3. Phase 4(フォーム語彙化)の着手判断 — 実装はしない

REFACTOR.md の条件「Phase 1〜3 の運用実績 — エージェントが実際にボタンやタブ構成を
運用するか — を見てから着手」を判断可能な状態にする。

- **観測の仕込み**: `page_definitions.updated_by` の集計クエリ(seed / migration / api の内訳と
  最終更新日)を scripts/ に追加し、README に確認手順を1行足す。
  エージェント運用を試すときは updated_by='agent' 等で書き込ませて区別できるようにする
- **判断基準の明文化**(docs/PLAN.md へ追記):
  着手条件 = 指標1 が目標到達(閉じた語彙をLLMが書ける実証)+ 定義運用が実際に発生
  (ボタン文言・タブ構成・レイアウトの定義変更が updated_by='api' 以降で観測される)。
  未達なら Phase 4 は保留し、ハーネスの失敗タクソノミ起点の小粒改善
  (description 強化・editable 拡大)を先に行う
- T1/T2 完了時点で判断材料が揃うので、判断そのものは30分のレビューで済む

---

## 見積りと順序(まとめ)

```
T1.1 套件20件 ──▶ CP1 レビュー ──▶ T1.2 run.py ──▶ T1.4 dry-run → 実測(CP3)
                                        │
T2.1 トークン確定(CP2)──▶ T2.2 Step1 ─┴─▶ T2.3 Step2 ──▶ T2.4(任意)
                                                              │
                                     T3 判断(T1 の結果 + 観測)┘
```

- T1 と T2 は独立なので、CP1 のレビュー待ちの間に T2.2 を進める並行が最短
- 合計: 実働 2〜3日(実測の API 実行時間は数分)
- リスク: structured outputs がスキーマの oneOf/pattern を受けない場合 → フォールバックで
  計測は成立(モード差はレポートに残る)。primitive の見た目回帰 → 分類刻みのコミットと
  目視比較で局所化。10px/14px の丸めが気になる場合 → 該当箇所のみ既存クラス残置で逃がす
