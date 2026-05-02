---
title: "業者向け飼育管理ピボット — 機能設計書"
description: "SNS から業者向け飼育管理へのピボット方針と、それを支える 5 つの中核機能 (群飼育 / 5 秒記録 / 写真統合 / 血統ツリー / 血統書 PDF) の設計。"
sidebar:
  order: 5
---

> **正典**: `docs/breeder-pivot-and-features.md` (リポジトリ直下)。本ページはそのミラーです。
>
> **位置付け**: 実装着手前のレビュー資料 + 着手後の整合確認用。価格設定・ヒアリング結果・法務確認など、後日詰める論点は「§ 9. オープン論点」にまとめています。

最終更新: 2026-04-29

関連ドキュメント:

- 全体設計概要: [insect_app 設計概要](/insect_app/architecture/design-overview/)
- 機能ロードマップ: [機能一覧とロードマップ](/insect_app/planning/features/)
- DB 設計の正典: [KOCHU DB スキーマ設計](/insect_app/architecture/db-schema-design/) (本書のスキーマ提案は本書クローズ後にこちらへ統合)

---

## 1. 戦略転換の背景

### 1.1 これまでの方針 (SNS 中心)

昆虫飼育 SNS として、ユーザが個体写真や繁殖記録を投稿しコミュニティ形成を促す方向で開発を進めてきた。

### 1.2 新方針 (飼育管理中心)

ターゲットを **業者 (商業ブリーダー / ショップ)** に絞り、彼らが日常的に Excel・Word・写真フォルダで分散管理している業務を **1 つのサービスに統合** する。具体的には個体カルテ、ログ、血統管理、出品連携を中核機能とする。

### 1.3 期待効果

- **支払意欲**: SNS の広告/サブスクと違い、業務効率化は時間 = 金で換算でき、業者は月額課金に抵抗が少ない
- **データロックイン**: 個体・血統・ログを蓄積するほど他サービスへの乗り換えが困難になる
- **既存スキーマと整合**: `specimens` / `specimen_logs` / `mating_records` / `specimen_status_history` は既に業務管理向けに設計されており、転換のための DB 改修は最小

### 1.4 「Excel 代替」フレーミングのリスク

「Excel より便利です」を訴求の中心に据えると失敗する。理由:

1. Excel は 30 年分の機能蓄積があり、1.5 倍便利程度では乗換コストを正当化できない (一般に 10 倍の差が必要)
2. 業者の Excel は本人最適化済みで、本人にとっては最適なツール
3. CSV エクスポートを必須実装すると、退路が確保される = 競合への離脱経路にもなる

代わりに採るフレーミング: **「Excel ではできない 4 つの仕事を、これ 1 つで」** — 写真とデータの結合 / 血統ツリーの自動描画 / スマホでの 5 秒記録 / 血統書 PDF と出品の連携。Excel と正面で戦わない。

### 1.5 北極星指標 (North Star Metric)

> **1 業者あたり、1 週間に記録された `specimen_logs` 件数 (`cohort_logs` 含む)**

MAU/WAU は嘘をつくが、ログ件数は嘘をつかない。これが週次で伸びれば「Excel から移行している」「日々の業務に組み込まれている」証拠となる。

### 1.6 SNS 機能の扱い

完全には捨てない。ただし「業務支援としての共有」に再定義する。具体的には:

- 業者間の血統公開 (`specimens.public_id` 経由)
- 個体評価レビュー (買い手 → 売り手)
- 貸し出し・委託交渉

これらは管理データを蓄積したサービスにしか作れない機能であり、ピボット後の差別化要素として残す。

### 1.7 EC との優先度調整

現在 SDUI / EC (B2C) / C2C マーケット / 個体管理を並走中。業者向けに集中するため:

- EC 側の SDUI テンプレート (`ProductFeature` / `ProductDetail`) の優先度を下げる
- `Cart` 系 SDUI とチェックアウトワーカーは数か月凍結可
- **管理画面側の SDUI 化 (カルテ表示テンプレート)** に同等以上の労力を投じる

これにより、業者ヒアリング → レイアウト変更 → デプロイなしで配信、というサーバ駆動 UI の本来の利点を管理 UI に引き寄せる。

---

## 2. 中核機能一覧

| # | 機能 | 一言要約 | 着手順 |
|---|---|---|---|
| 1 | 群飼育 (cohorts) | 卵 100 個 = 1 行で管理し、3 齢以降に個体化する 2 段モデル | 1 |
| 2 | スマホで 5 秒記録 | QR/NFC 識別 + 差分入力 + オフライン同期で現場の業務を破綻させない | 2 |
| 3 | 写真とデータの一体化 | 1 ログ = 写真 + メトリクス。タイムラプス自動生成、計測 OCR | 3 |
| 4 | 血統ツリー自動描画 | DAG レイアウト + 累代/COI 自動計算 + 仮想交配シミュレーション | 4 |
| 5 | 血統書 PDF / 出品連携 | 上記 4 つの集大成。出品時自動添付、所有者移転で再発行 | 5 |

着手順の根拠は「§ 8. 実装着手順」に記す。

---

## 3. 機能 1: 群飼育 (cohorts)

### 3.1 業務実態

産卵セット → 卵 30〜200 個 → 幼虫化。**全部に番号を振るのは非現実的**。容器単位 (1 ケース = 1 群) で管理し、3 齢以降または蛹化前後で個体管理に "昇格" させる。一部だけ大型化した個体を抜き出して別管理することも多い。

### 3.2 既存スキーマの限界

現在 `specimens` は「1 行 = 1 個体」前提のため、群を表現できない:

- 卵 100 個に対して 100 行作ると DB 肥大 + UX 破綻
- 個体識別データ (`size_mm`, `weight_g`) が群には適用できない (個体ごとにバラつく)
- "群 → 個体への分離" イベントを表現できない

### 3.3 提案スキーマ

```sql
-- 群 (cohort)
CREATE TABLE cohorts (
  id UUID PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,         -- 例: LOT-2026-0007
  owner_user_id UUID NOT NULL REFERENCES users,
  species_id UUID NOT NULL REFERENCES species,

  origin_kind TEXT NOT NULL,              -- egg_lay | purchase | field_collected
  parent_mating_id UUID REFERENCES mating_records,  -- 由来する繁殖記録 (任意)

  initial_count INT NOT NULL,             -- 開始時の数
  current_count INT NOT NULL,             -- 生存数 (個体化分は減る)
  stage TEXT NOT NULL,                    -- egg | larva_l1 | larva_l2 | larva_l3 | pupa | mixed

  start_date DATE NOT NULL,
  notes TEXT,
  archived_at TIMESTAMPTZ
);

-- 群ログ
CREATE TABLE cohort_logs (
  id UUID PRIMARY KEY,
  cohort_id UUID NOT NULL REFERENCES cohorts ON DELETE CASCADE,
  log_type TEXT NOT NULL,                 -- feed | mat | death | observation
  count_delta INT,                        -- 死亡 -3 等
  metrics JSONB,
  logged_at TIMESTAMPTZ NOT NULL,
  author_user_id UUID
);

-- 既存 specimens に "由来" を表す 2 カラムを追加
ALTER TABLE specimens
  ADD COLUMN cohort_id UUID REFERENCES cohorts,
  ADD COLUMN promoted_from_cohort_at TIMESTAMPTZ;
```

### 3.4 個体への "昇格" フロー

1. 群一覧で群 (例: `LOT-2026-0007`) を選択 → 「個体化」ボタン
2. n 匹を分離 → n 行の `specimens` を一括 INSERT、`cohorts.current_count -= n`
3. 親情報 (`mating_records` 経由) を自動継承し `specimens.father_id` / `mother_id` を埋める
4. **1 トランザクション内でコミット**。途中失敗時に群と個体の数が不整合にならないように。

### 3.5 業者向け統計

- **ロット生存率**: 「2026 春の産卵 5 ロット → 平均生存率 87%、最高ロット 95%」
- **餌コスト/個体**: `cohort_logs.metrics.feed_amount` の総和 ÷ 最終個体化数
- **失敗パターン分析**: `cohort_logs` の死亡数スパイクと環境ログの相関

### 3.6 UX

- ホーム画面に「群」と「個体」を **並列タブ** で配置
- 群はリストビュー (サムネイル小)、個体はカードビュー (写真大) と表示密度を変える
- `mating_records` 画面から「この交配の子 (cohort) を見る」を双方向リンク

### 3.7 移行

- 既存 `specimens` への `cohort_id` 追加マイグレーション 1 本で後方互換維持
- 既存個体は `cohort_id = NULL` のまま
- 新規ユーザのみ群フローに乗る

---

## 4. 機能 2: スマホで 5 秒記録

### 4.1 業務実態と制約

朝の給餌は 50 個体に 30 分。**1 個体あたり 36 秒**。記録時間込みで超過すると現場が破綻する。手は片方塞がっており (餌スプーン or 水差し)、画面操作は片手・親指のみ。屋外/倉庫だと電波弱の可能性。

### 4.2 5 秒の内訳

> **個体識別 1 秒 + 入力 3 秒 + 確定 1 秒**

各フェーズで 1 秒超過すると即破綻するため、UI を逆算で設計する。

### 4.3 個体識別の選択肢

| 方式 | 識別速度 | 機材コスト | 採用条件 |
|---|---|---|---|
| QR コード | 1.5〜2 秒 (カメラ起動含む) | 低 (シール印刷) | 屋内、明るい環境 |
| NFC タグ | 0.3 秒 (タッチ) | 中 (1 個 30〜50 円) | 暗所/屋外 OK、両手必要 |
| 音声入力 | 1〜2 秒 | ゼロ | 静かな環境のみ |

**採用方針**: QR + NFC のハイブリッド。安価な個体は QR シール、高額個体や暗所環境には NFC。`specimens.public_id` をそのままエンコードすれば追加スキーマ不要。

### 4.4 入力の高速化

- **直近値からの差分入力**: 「前回 12.3g → +」ボタンで 0.1g 刻みのスピナー。テンキー入力より約 3 倍速い
- **チェックリスト型ログ**: 「餌交換 / 水交換 / マット」の 3 チェックだけで保存可。テキスト入力ゼロ
- **連番モード (ループ入力)**: A-1, A-2, A-3... と並んだ個体を `Tab` のように送りながら入力。50 個体 × 5 秒 = 4 分で完了
- **テンプレート保存**: 「月曜の標準作業」テンプレを作っておき、ホームから 1 タップで全個体に適用

### 4.5 オフライン対応

- IndexedDB に下書きキュー、Service Worker で バックグラウンド同期 (PWA 既存資産で実装可)
- **コンフリクト解消はタイムスタンプ後勝ち**。業者は単独利用が大半で、複数端末同時編集は稀
- 認証 Cookie が切れていると同期時に 401 で全消失するため、**バックグラウンド同期失敗時の再認証フロー** を初期から設計に含める

### 4.6 スキーマへの影響

ほぼ不要。ただし以下を 1 つ追加すると一括適用が劇的に楽になる:

```sql
CREATE TABLE log_templates (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users,
  name TEXT NOT NULL,
  default_metrics JSONB NOT NULL,
  applies_to_filter JSONB,                -- 種・stage 絞込み条件
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. 機能 3: 写真とデータの一体化

### 5.1 業務実態

業者は計測時に必ず写真を撮る。用途は (1) 後日のクレーム対応、(2) 出品用素材、(3) 成長記録 の 3 つ。スマホで撮影 → PC で Excel ペーストの二段運用が常態化しており、**撮影は終わったが Excel への貼り付けが追いつかない**。

### 5.2 設計の核

- **撮影と数値入力を同じ画面に**。1 ログ = 写真 0..n + メトリクス
- **EXIF から `logged_at` を自動補完**。撮影時刻 = 記録時刻が業者の直感と一致し、後日まとめてアップロードしても時刻が崩れない
- **写真へのタグ**: 脱皮 / 計測 / 羽化 / 出品候補 / 異常 の 5 種程度をチェックボックスで付与
- **タイムラプス自動生成**: 1 個体の写真群を時系列で並べた MP4/GIF を 1 クリック生成 → 出品時の販売素材として再利用 (Excel では作れない領域)

### 5.3 提案スキーマ

```sql
-- 写真と log の多対多リンク
CREATE TABLE specimen_log_assets (
  log_id UUID NOT NULL REFERENCES specimen_logs ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets ON DELETE CASCADE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  tag TEXT,                               -- molt | measure | eclosion | listing | abnormality
  PRIMARY KEY (log_id, asset_id)
);

-- 既存 assets に圧縮・公開フラグを追加
ALTER TABLE assets
  ADD COLUMN original_size_bytes BIGINT,
  ADD COLUMN compressed_size_bytes BIGINT,
  ADD COLUMN compression_tier TEXT DEFAULT 'original',  -- original | medium | small
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'; -- private | public
```

`cohort_logs` も同様に `cohort_log_assets` を持たせる (構造は対称)。

### 5.4 高度化 (一段尖らせる仕掛け)

- **計測写真からの自動メトリクス抽出**: ノギスを並べた画像から OCR で体長を読み取り、`specimen_logs.metrics.size_mm` を自動入力。Vision API + 数値抽出でプロトタイプ可。**初期は精度 80% で「補正すれば良い」状態にできれば業者は喜ぶ**
- **異常検知**: 過去写真と比較して「変色」「サイズ停滞」を警告。クレーム予防にもなる

### 5.5 ストレージコスト試算と段階圧縮

100 業者 × 1000 個体 × 50 枚 × 2MB ≒ 100GB 規模 (S3/R2 で月数千〜数万円)。**段階的劣化** を初期から設計に入れる:

- 撮影直後: original (フル解像度)
- 1 年経過: medium (1280px) に再エンコード、original 削除
- 2 年経過: small (640px) に再エンコード

cron で `assets.compression_tier` を遷移させるバッチを追加する。

### 5.6 公開 / 非公開

`specimens.public_id` 公開ページに表示するのは `assets.visibility = 'public'` のみ。撮影時に既定で `private` とし、出品時に明示的に `public` に切り替える運用。

---

## 6. 機能 4: 血統ツリー自動描画

### 6.1 業務実態

血統は **販売価格の半分** を決める。「○○系統 F2」を証明できないと値段が大きく落ちる。業者は Excel の図形描画か手書きノートで管理し、累代 (F世代) を手で計算している。

### 6.2 設計の核

- **DAG として扱う**。同一ペアから複数子は当然、近親交配 (兄妹掛け・親子戻し) も実務でよくあり、木ではなくグラフ構造
- **`generation` のデノーマライズ**: 累代 (F0/F1/F2…) を毎回 CTE で計算するのは現実的でない。`specimens.generation` を保持し、親子登録時に `MAX(parent.generation) + 1` で書き込む (野生 = 0、片親野生 = もう一方を継承)
- **系統 (bloodline) は別概念**: 個別個体の親子関係 ≠ 系統名

### 6.3 提案スキーマ

```sql
-- 系統マスタ
CREATE TABLE bloodlines (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users,
  name TEXT NOT NULL,
  founder_specimen_id UUID REFERENCES specimens,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 個体と系統の多対多 (父系・母系の両方に所属し得る)
CREATE TABLE specimen_bloodlines (
  specimen_id UUID NOT NULL REFERENCES specimens ON DELETE CASCADE,
  bloodline_id UUID NOT NULL REFERENCES bloodlines ON DELETE CASCADE,
  lineage_role TEXT NOT NULL,             -- paternal | maternal | adopted
  PRIMARY KEY (specimen_id, bloodline_id, lineage_role)
);

-- 累代をデノーマライズ
ALTER TABLE specimens
  ADD COLUMN generation SMALLINT;
```

### 6.4 高度化

- **インブリード係数 (COI) の自動計算**: Wright's algorithm を Rust 側で実装。表示は「COI: 12.5% (兄妹掛け 1 回相当)」のような自然言語付きにする。COI は数学が分からない業者でも価格交渉の根拠になる
- **不可能交配の警告**: 死亡日以降の交配、雌雄一致、累代逆転をフォーム送信時に弾く
- **「もし掛けたら」シミュレーション**: 未交配の 2 個体を選ぶと、その仮想子の累代・COI を即時計算 → **繁殖計画ツールとしての価値**

### 6.5 ビジュアライゼーション

- **dagre.js** の DAG レイアウト推奨 (近親交配で枝が合流するため d3 hierarchy では破綻)
- 大規模対応: 100+ ノードでは「注目個体から 3 ホップ以内」を既定表示にし、展開ボタンで深掘り
- **ブラウザ用と PDF 用でスタイルだけ差し替えられる構造**にしておく (機能 5 の血統書 PDF と直結)

### 6.6 整合性

- 循環参照防止: 入力時バリデーション + DB 制約 (CHECK or トリガで `descendants ∩ ancestors = ∅`)
- 大規模 (1 万個体) では「祖先方向 N 世代 / 子孫方向 M 世代」を `recursive CTE` + `generation` インデックスで最適化

---

## 7. 機能 5: 血統書 PDF / 出品連携

### 7.1 業務実態

ヤフオク等で「血統書付き」は **+20〜50% のプレミアム**。業者は Word でテンプレを作って毎回コピペしているが、(1) 個体名や血統の差し込みミス、(2) 写真の解像度劣化、(3) 系図の手書き — の 3 つが事故の温床。**Word + Excel + PDF の三段運用** をやめさせるのが価値の核。

### 7.2 PDF 構成

1. 表紙 — 個体写真 + 業者ロゴ
2. プロファイル — 種・性別・体長・体重・誕生日・現所有者
3. 系図 — 機能 4 の SVG をそのまま埋め込む (3 世代 8 個体まで)
4. 計測ログサマリー — 主要マイルストーン (孵化 / 終齢移行 / 蛹化 / 羽化 / 最大体重)
5. 譲渡証明 — 出品 ID + QR (公開個体ページへ飛ぶ)
6. 業者印・発行日

### 7.3 PDF 生成ライブラリの選定

| 候補 | 利点 | 欠点 |
|---|---|---|
| `printpdf` | 純 Rust、軽量 | 日本語フォント埋込・SVG 埋込が手作業 |
| `genpdf` | Markdown ライク | レイアウト自由度低い |
| **`typst-cli` 経由** | テンプレート言語が強力、SVG 埋込が簡単、日本語 OK | 外部バイナリ依存 |
| Headless Chrome (HTML→PDF) | レイアウト自由 | 重い、コンテナで Chromium 必要 |

**採用方針**: Typst。テンプレートを `.typ` ファイルで持ち、業者ごとのブランディング (ロゴ・色・社名) を変数差し込み。系図 SVG を `image()` で取り込める点が大きい。

### 7.4 提案スキーマ

```sql
CREATE TABLE pedigree_templates (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users,
  name TEXT NOT NULL,
  layout_typ TEXT NOT NULL,               -- Typst テンプレ本文
  brand_assets JSONB,                     -- ロゴ asset_id, カラー, 社名 等
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pedigree_certificates (
  id UUID PRIMARY KEY,
  specimen_id UUID NOT NULL REFERENCES specimens,
  version INT NOT NULL,                   -- 同一個体で再発行のたび +1
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by_user_id UUID NOT NULL REFERENCES users,
  template_id UUID REFERENCES pedigree_templates,
  pdf_asset_id UUID NOT NULL REFERENCES assets,
  qr_token TEXT UNIQUE NOT NULL,          -- 短い乱数。/p/<token> で公開ページへ
  brand_snapshot JSONB NOT NULL,          -- 発行時のロゴ/社名を凍結保存
  UNIQUE (specimen_id, version)
);
```

`brand_snapshot` を凍結保存するのは「業者が後日ロゴを変えても、過去発行済みの血統書は変わらない」を保証するため。実務上重要。

### 7.5 出品連携 (既存 `listings.specimen_id` の活用)

- 「出品ボタンを押すと血統書を自動添付」: 出品詳細ページに PDF プレビューと系図サムネイルが並ぶ
- 落札 → `order_items.fulfilled_specimen_id` に紐付き、買い手の所有として記録
- **血統書の "現所有者" が自動更新** され、新所有者用の血統書 v2 を 1 クリックで再発行
- 「個体は売れて終わりではない」「買い手も育てて再出品 → 血統書 v3 発行」というロイヤリティループを形成

### 7.6 「1 通」の定義 (= 課金単位)

「1 通」= **`pedigree_certificates` テーブルに 1 行 INSERT されるイベント** = PDF ファイルが 1 個生成されるイベント。

| アクション | 1 通 (課金対象) |
|---|---|
| 個体 X に対する新規発行 (version 1) | はい |
| 個体 X の再発行 (version 2, 3, ...) | はい |
| 落札後の所有権移転に伴う新所有者向け発行 | はい (買い手側に課金) |
| 発行済み PDF のダウンロード / 印刷 | いいえ (無料、何度でも) |
| 公開ページ (QR 経由) の閲覧 | いいえ |

> **価格設計は要検討** (§ 9 オープン論点を参照)。1 通あたり課金 vs. 月額無制限プラン vs. その併用、誤字修正の再発行を無料にする緩衝期間、下書き発行 (透かし付き) の扱い、などを業者ヒアリングを経て決める。

### 7.7 法的留意点

昆虫の血統書は **法定様式なし** = 自由設計可。ただし「○○協会認定」と書くと景表法に触れ得るため、**「業者発行 / 真正性は QR で確認」** に留める。獣医のカルテとは別物として明確に分離する。

---

## 8. 実装着手順

5 つを同時着手すると確実に破綻する。**業者の業務フローの "1 日" を完成させる順序** で並べる:

| 優先 | 機能 | 理由 |
|---|---|---|
| 1 | 群飼育 (cohorts) | 業者の現業務がそもそも個体単位で動いていない。これが無いと既存 `specimens` が業者にとって使い物にならない。データモデルなので最初に決める必要あり。後から入れるとデータ移行・既存 UI 修正のコストが膨らむ |
| 2 | スマホで 5 秒記録 | 毎日触れる機能。これが快適でないと残り全機能が使われない。継続率が決まる中核 |
| 3 | 写真とデータの一体化 | ログ機能の延長線。撮影フローを記録フローに統合することで 2 の価値を倍増 |
| 4 | 血統ツリー自動描画 | 価値は高いが、データ (`mating_records`, `generation`) がある程度溜まってから効く。MVP では簡易版 (3 世代だけ表示) で十分 |
| 5 | 血統書 PDF / 出品連携 | 上記 4 つの **集大成として** PDF が出る構造。先に作っても中身がスカスカ。最後に作れば「すごい」となる |

### 8.1 マイグレーション順序 (案)

```
0019_cohorts.sql                # 機能 1: cohorts, cohort_logs, specimens.cohort_id
0020_log_templates.sql          # 機能 2 補助
0021_specimen_log_assets.sql    # 機能 3: 写真リンク, assets 拡張
0022_bloodlines.sql             # 機能 4: bloodlines, specimen_bloodlines, generation
0023_pedigree.sql               # 機能 5: pedigree_templates, pedigree_certificates
```

### 8.2 並走できる作業

各機能内で UI / API / バリデーションは並走可。たとえば機能 1 のスキーマ確定後、API 実装と UI モックは別担当が並行できる。

---

## 9. オープン論点 (後で詰める)

### 9.1 価格設計 (要検討)

- 血統書 1 通あたり課金 vs. 月額無制限プラン vs. 併用
- 月額プランの段階 (個体数上限 / 業者数 / 写真ストレージ容量で課金変動)
- 誤字修正再発行の無料緩衝期間 (例: 24 時間以内)
- 下書き発行 (透かし付き) を無料にするか
- Stripe Metered Billing との統合タイミング

### 9.2 業者ヒアリング

実装着手前に 5 〜 10 業者へ以下を確認:

- 何を Excel で管理しているか具体的に (個体? 仕入れ? 顧客? 売上?)
- 1 業者あたり扱う個体数 (10 / 100 / 1000 / 10000 で UX が大きく変わる)
- チームで使うか (権限管理が必要か)
- 必須出力形式 (PDF / CSV / 印刷ラベル)
- 群飼育の慣習 (容器単位の数、群 → 個体化の閾値)

### 9.3 ストレージコスト試算

- 100 業者 × 1000 個体 × 50 枚 × 2MB ≒ 100GB / 月数千〜数万円 (S3/R2)
- 段階圧縮の閾値 (1 年 / 2 年 / 削除) を業者の保管要件に合わせて確定

### 9.4 法務確認

- 血統書記載文言で景表法に触れない表現
- 個体公開 (`public_id`) における所有者プライバシー
- 出品時の譲渡証明としての PDF の法的位置付け

### 9.5 競合調査

- 海外: ZooEasy, BreederZoo, BreedBase など
- 国内: クワカブ業界に特化した SaaS の有無
- 「業界が SaaS を使わない」構造的理由 (高齢化 / IT 抵抗感) があるかどうか

### 9.6 SDUI の管理 UI 適用範囲

カルテ表示・血統ツリー表示の SDUI 化 (新 `CardBlock` variant の追加) を、いつどこまで広げるか。EC 側 (`ProductFeature` / `ProductDetail`) 凍結の判断と合わせて整理。

---

## 10. 評価指標 (再掲 + 補助指標)

### 10.1 北極星指標 (NSM)

> 1 業者あたり、1 週間に記録された `specimen_logs` 件数 (`cohort_logs` 含む)

### 10.2 補助指標

- **群 → 個体化率**: 群 1 つあたり何個体に分離されたか (歩留まり)
- **ログ平均入力時間**: クライアント側で計測し、5 秒以内を維持
- **血統書発行数 / 月**: マネタイズの先行指標
- **出品時の血統書添付率**: 機能 5 が業務動線に組み込まれているか
- **オフライン記録 → 同期成功率**: 機能 2 のインフラ品質
