# SDUI v6 修正実装計画

> 設計書 `sdui-three-layer-model-v6.md` に対する 1st レビューと、その上に重ねたメタレビューを統合し、**v6 への差分修正** として落とし込む計画。v7 は起こさない。Phase 9 (Stripe 統合) 着手前に全項目をクローズする。

## 0. 方針サマリ

| カテゴリ | 件数 | 該当項目 | 着手粒度 |
|---|---|---|---|
| そのまま採用 | 5 | #1 race / #4 i18n CI / #5 headline 検証 / #6 timestamp / #8 fallback 性格付け | 設計書追記 + 実装 |
| 部分採用 | 2 | #3 多通貨 (脚注のみ) / #10 小項目 (`value:""`, `Vary`, B2B 兆超え) | 設計書追記のみ |
| 却下 | 2 | #7 paramName / #9 `__v2` 詳細化 | §0 Changelog に判断ログ |
| 逆提案 (追加) | 4 | a11y × race / CDN path 物理遮断 / property-based test / cross-tab 同期 | 設計書追記 + 一部実装 |

スコープ外: client_solid の Phase 2-8 ファイル群の再実装 (= §19 のリカバリパス B/C)。本計画はその再実装が始まる **前に設計書を確定** させ、再実装が同じ穴に落ちないようにすることを目的とする。

---

## 1. そのまま採用する 5 件

### 1.1 #1 — Server-driven state の race condition / フォーカス保持

**設計書編集**: §11.8 末尾に「in-flight input field の取り扱い」細則を追加。

追加文案 (要点):
- **規律 1**: `<input>` / `<select>` がフォーカスされている / 直近 N ms 以内に編集された場合、`/cards/cart` 再 fetch の結果でその field の `value` を**上書きしない** (= server 値は次の blur まで保留する)。
- **規律 2**: PATCH リクエストには **client 側で発行する単調増加の `request_seq`** を持たせ、レスポンス到着順が逆転しても **最大 seq に対応する snapshot だけが UI を更新**する。
- **規律 3**: `<For>` の key は `block.key` のみで、parent region の差し替え時にも input の DOM identity を保つ。

**実装タスク**:

| 項目 | 場所 | 工数目安 |
|---|---|---|
| `useFormFieldState.ts` (focus / dirty 検出 + server 値マージ) | `client_solid/src/sdui/` | 50 行 |
| `useCartSnapshot.ts` (request_seq + 最新勝ち merge) | 同上 | 60 行 |
| `<FormFieldView>` を `useFormFieldState` 経由に置換 | `blocks/FormField.tsx` | 既存 30 行差し替え |

**テスト追加 (§13.4 横断テスト)**:
- E2E: `+` を 5 連打しつつ snapshot 再 fetch が交差する状況で UI が "+5 後" の qty に収束する
- Unit: input にフォーカスがある状態で snapshot が降ってきても value が巻き戻らない
- Unit: 連続 PATCH のレスポンスが逆順到着しても最終状態が新しい seq に整合する

**完了条件**: 上記 3 テストが green。

---

### 1.2 #4 — i18n キー網羅 CI

**設計書編集**: §13.2 (スキーマ契約テスト) の隣に **§13.5 i18n キー網羅テスト** を新設。

追加文案:
- Rust source 中で `I18nKey` として埋め込まれた文字列リテラル / fixture / handler 内で生成される `Localizable::I18n { key }` のキー集合を抽出
- `client_solid/src/i18n/<locale>.json` のキー集合と diff
- 欠落キーがあれば CI fail。本番で空文字フォールバックが起きないことを保証

**実装タスク**:

| 項目 | 場所 | 工数目安 |
|---|---|---|
| Rust: `cargo test` 内で `extract_i18n_keys()` を実装し、`server/i18n_keys.json` を出力 | `server/src/sdui/i18n_audit.rs` (新設) | 80 行 |
| Node script: `scripts/check-i18n-keys.mjs` で `i18n_keys.json` × `client_solid/src/i18n/*.json` を比較 | `scripts/` | 60 行 |
| CI workflow に `npm run check:i18n` ステップを追加 | `.github/workflows/ci.yml` (要確認) | 10 行 |

**完了条件**: 故意にキーを 1 つ消したフィクスチャで CI fail することを確認。

---

### 1.3 #5 — headline 不変条件の Rust 側検証

**設計書編集**: §5.2 の不変条件記述を **§7.6 ValidateKeys と同格の `ValidateA11y` trait** に格上げする旨を追記。

追加文案:
- 現状 §5.2 で「同一テンプレート内に `text.role: headline` のブロックは 0 または 1 個」と書かれている不変条件は **コード化されていない** ことを明記
- `ValidateA11y` trait を新設し、`CardBlock` deserialize 後に `validate_keys()` と並んで呼ぶ
- 違反時は 400、テンプレート ID とリージョン名を error body に含めて debug 容易にする

**実装タスク**:

| 項目 | 場所 | 工数目安 |
|---|---|---|
| `ValidateA11y` trait + `headline` カウンタ | `server/src/sdui/validate.rs` | 50 行 |
| `CardBlock` 全 3 template に `impl ValidateA11y` | 同上 | 30 行 |
| handler で `validate_keys()` の隣で呼ぶ | `server/src/handlers/cards.rs` 等 | 各 1 行 × N |
| broken fixture: `multiple_headlines.json` | `fixtures/cards/broken/` | 1 ファイル |

**完了条件**: `multiple_headlines.json` が 400 で reject される Rust テスト green。

---

### 1.4 #6 — AnalyticsEvent の clock skew

**設計書編集**: §11.2 の表に `serverReceivedAtMs` 行を追加。

追加文案:
- `timestampMs` はクライアント観測時刻として保持
- `serverReceivedAtMs` を **server 側で受信時に必ず stamp** する非デシリアライズ field を追加
- 集計側はデフォルトで `serverReceivedAtMs` を使い、`timestampMs` は client 観測の補助として参照

**実装タスク**:

| 項目 | 場所 | 工数目安 |
|---|---|---|
| `AnalyticsEvent` に `#[serde(skip_deserializing)] server_received_at_ms: i64` を追加 | `server/src/sdui/analytics.rs` | 5 行 |
| handler で `chrono::Utc::now().timestamp_millis()` を入れる | `server/src/handlers/events.rs` | 3 行 |
| ts-rs binding 再生成 → branded.ts に optional として通す | `client_solid/src/sdui/branded.ts` | 1 行 |
| ring buffer 出力 (`GET /events?limit=N`) に両方のフィールドが乗ることを test | `server/tests/events.rs` | 20 行 |

**完了条件**: `GET /events` レスポンスの全件に `serverReceivedAtMs` が乗っている test green。

---

### 1.5 #8 — `deny_unknown_fields` と未知 type fallback の意味論統一

**設計書編集**: §10.1 の縮退ルール冒頭に **fallback の性格付け節** を追加。

追加文案:
- `Block` / `CardBlock` の deserialize は `deny_unknown_fields` で未知 variant を **deserialize 段階で reject** する。
- したがって client 側の「未知 type → 描画スキップ」「未知 template → FallbackCard」は **型生成パイプラインの遷移期保険** と性格付ける。
- 想定するシナリオ: (a) Rust 先行で variant 追加され、ts-rs 再生成前に hot reload した開発環境、(b) deploy 順序で server > client が一時的に古い場合 (= server が新 variant を返す前に client deploy 完了が前提だが、保険として保持)。
- それ以外のシナリオ (= 故意に不正な JSON が body に来る) は server 400 が一次防衛で、client fallback は二次防衛。

**実装タスク**: 設計書追記のみ。コードは現状で意味論を満たしているので変更不要。

**完了条件**: 設計書 §10.1 に追記済み。

---

## 2. 部分採用 2 件

### 2.1 #3 — 多通貨対応の脚注追加

**設計書編集**: §4.2.2 末尾と §17 Future Work の `Currency` 項に脚注を追加。

追加文案 (§4.2.2):
- 多通貨化時の破壊的変更として **`amount` は minor unit (= 通貨ごとの最小単位、JPY=yen, USD=cent, BHD=mils) に統一する**。JPY 単独運用中の `amount: i64 yen` は移行時に `* 1` で minor unit と一致するため数値変更不要だが、TS 側 `Money` 型に `scale` を持たせる API 変更が発生する。
- 移行時期は §17 Future Work の Currency 拡張に同期。

**実装タスク**: なし。設計書追記のみ。

---

### 2.2 #10 — 小項目 3 件

| 項目 | 編集先 | 追記内容 |
|---|---|---|
| `value: ""` vs `value: undefined` 規約 | §5.8.2 末尾 | サーバ側 store は `Option<String>` で持ち、`""` は「明示的にクリア」、`undefined` は「未送信」と区別。debounce 中の中間状態は client が保持し PATCH しない。 |
| `Vary: Cookie, Authorization` | §14.3 末尾 | `Cache-Control: no-store` に加え `Vary: Cookie, Authorization` を返す。ただし共有 CDN への到達は §4 (新設) で物理的に塞ぐので、`Vary` は最後の防壁として明記する位置付け。 |
| B2B 兆超え注釈 | §4.2.2 内 | 「9 兆円で MAX_SAFE_INTEGER」は **リテール EC 限定** の前提。法人卸取引で大口注文を扱う場合は再評価。 |

**実装タスク**: なし。設計書追記のみ。

---

## 3. 却下 2 件 — §0 Changelog に判断ログ

### 3.1 #7 — `SearchBox.paramName` 削除案

**判断**: 却下。

**判断ログ追加先**: §0 末尾に新設する **「却下されたレビュー指摘」** 表 (もしくは別ファイル `docs/sdui-design-decisions.md` に切り出し)。

**判断理由**:
- `paramName` は「URL shape の所有権を server に置く」という SDUI の中核思想を体現するフィールドである。削ると client が URL 文字列を組む例外が発生してフレームワーク一貫性を毀損する。
- §2 設計原則 12「存在しないものは予約しない」は「予約された未使用機能」を禁ずる規律であり、`paramName` は「現在まさに使われている設定値」なので原則 12 の適用範囲外。
- 削除コスト > 維持コスト (型 1 行 + JSON 1 フィールド)。

### 3.2 #9 — テンプレートバージョニング `__v2` の詳細化

**判断**: 却下 (= §17 に 1 行のみ追加)。

**判断ログ**:
- v2 採用の現実的トリガ (= product_feature の region 構造変更が必要になる事象) は Phase 9+ の決済導線拡張で初めて観測される見込み。
- いま詳細を書くと「使われない設計」になり §2 設計原則 12 に抵触する。
- §17 Future Work に「並走期間の switch 戦略は v2 採用時に詰める」と一行のみ追記し、判断時期を遅延させる。

---

## 4. 逆提案 (追加検討) 4 件

### 4.1 a11y × race condition の交差規定

**設計書編集**: §10 (UI 不変条件) に **§10.5 a11y under server-driven state** を新設。

追加文案 (要点):
- region 全体差し替え時のスクリーンリーダー操作不能を防ぐため、
  - PATCH 完了通知は `<div role="status" aria-live="polite">` で明示する (= 「カートに追加されました」を音声で出す)
  - input がフォーカス中の場合、再 fetch で diff があっても DOM ノードの再生成を回避 (= §1.1 規律 3 と整合)
  - エラー (`validation_error`) は `<input aria-describedby="...">` で当該 field と紐付け、`aria-live="assertive"` でアナウンス
- これは UX 上の利便性ではなく **アクセシビリティの最低保証** として位置付ける。

**実装タスク**: §1.1 と統合。`useFormFieldState.ts` に aria 属性管理を含める。

---

### 4.2 CDN キャッシュ毒の path-level 物理遮断

**設計書編集**: §14 (キャッシュ戦略) に **§14.5 認証必須エンドポイントの CDN 隔離** を新設。

追加文案 (要点):
- `/api/v1/cards/cart` / `/api/v1/checkout/*` / `/api/v1/cart/*` / `/api/v1/watch/*` は **共有 CDN の origin allowlist から除外** する設定方針を明文化。
- edge ロジック (Cloudflare Workers / CloudFront Functions 等) で `/api/v1/{cart,checkout,watch}` prefix を private path とマークし、共有キャッシュへの到達を物理的に塞ぐ。
- `Cache-Control: no-store` + `Vary: Cookie, Authorization` は **最後の防壁** であり、一次防衛は path-level 隔離である。

**実装タスク**:

| 項目 | 場所 | 工数目安 |
|---|---|---|
| 設計書追記 | §14.5 新設 | - |
| infra config 雛形 (Cloudflare WAF rule の規約サンプル) | `docs/infra/cdn-private-paths.md` | 30 行 |
| (Phase 9 着手時) 実 infra 設定 | infra repo | scope 外 |

**完了条件**: 設計書追記済み + infra config 雛形が docs に存在。

---

### 4.3 Property-based test 導入

**設計書編集**: §13 (テスト戦略) に **§13.6 ラウンドトリップ等価性テスト** を新設。

追加文案 (要点):
- ts-rs + schemars の二重生成パイプラインの保証として、
  - **Rust 側**: `proptest` で任意の `CardBlock` を生成 → JSON シリアライズ → デシリアライズして等価性を assert
  - **TS 側**: `fast-check` で生成した同等の値を JSON Schema (`ajv`) で validate
  - **ラウンドトリップ**: Rust 生成 JSON が TS 型で deserialize 可能、その逆も成り立つ
- 想定発見できる事故: discriminator 名衝突 (§4.2.1)、camelCase / snake_case 揺れ、`Option<T>` の `null` vs missing 揺れ、`#[serde(default)]` の片側忘れ。

**実装タスク**:

| 項目 | 場所 | 工数目安 |
|---|---|---|
| `proptest` strategy for `CardBlock` (3 template) | `server/src/sdui/proptest.rs` (新設) | 200 行 |
| ラウンドトリップ test | `server/tests/sdui_roundtrip.rs` | 80 行 |
| TS 側 `fast-check` + ajv | `client_solid/src/sdui/__tests__/roundtrip.test.ts` | 100 行 |

**完了条件**: 1 万件のランダム CardBlock でラウンドトリップが green。

---

### 4.4 Cart cross-tab 同期

**設計書編集**: §11.8 末尾に **cross-tab 同期セクション** を追加。

追加文案 (要点):
- 1 ユーザが複数タブで同じカートを開いた場合、片方の mutation は他方には届かない (= 各タブが自前の `/cards/cart` snapshot で動く)。
- 暫定方針: **`BroadcastChannel("kochu_cart")` で「再 fetch せよ」シグナル**を投げ、受信したタブは即座に snapshot を引き直す。
- データ自体は流さない (= 真実値は常に server に問い合わせる、§11.8 主規律と整合)。
- WebSocket push (Future Work) で本格対応するが、その前段としてこの cross-tab シグナルを Phase 8 完了直後に入れる。

**実装タスク**:

| 項目 | 場所 | 工数目安 |
|---|---|---|
| `useCartSnapshot.ts` に BroadcastChannel listener を追加 | client_solid/src/sdui/ | 30 行 |
| mutation 成功時に `postMessage({ type: "invalidate" })` | api.ts | 10 行 |
| E2E: 2 タブでの同時操作テスト | playwright | 50 行 |

**完了条件**: 2 タブ間で `+` 押下が即時反映される E2E green。

---

## 5. 作業順序とマイルストーン

```
Phase 8 完了直後 (= 設計書のみ更新)
├── M0: §0 Changelog に「却下指摘」「採用指摘」セクション新設                        [0.5d]
├── M1: 採用 5 件 + 部分採用 2 件 の設計書追記                                       [1.0d]
├── M2: 逆提案 4 件 の設計書追記                                                     [1.0d]
└── 中間 review

Phase 9 着手前 (= 実装に降ろす)
├── M3: #6 (timestamp) → 5 行修正 + binding regen + test                               [0.5d]
├── M4: #5 (ValidateA11y) → trait + 全 template 実装 + broken fixture                  [0.5d]
├── M5: #4 (i18n CI) → Rust extractor + Node check script + CI 統合                    [1.0d]
├── M6: #1 (race + a11y) → useFormFieldState / useCartSnapshot / aria-live           [2.0d]
├── M7: §4.4 (cross-tab) → BroadcastChannel 統合                                       [0.5d]
├── M8: §4.3 (proptest) → roundtrip test 整備                                          [1.5d]
└── M9: §4.2 (CDN config 雛形) → infra docs                                            [0.5d]

合計: 設計書 2.5d / 実装 6.5d (= 1 週間 + 余裕)
```

依存関係:
- M3 < M8 (proptest が AnalyticsEvent ラウンドトリップを含むため)
- M4 < M6 (ValidateA11y のエラーパスを useFormFieldState が利用)
- M5 は独立 (並列実行可)
- M6 ⊃ a11y × race (= §4.1 と統合)

---

## 6. v6 への差分パッチ箇所マップ

実際の編集を行う際の grep ターゲット一覧:

| 編集セクション | 対応する計画項目 | 編集種別 |
|---|---|---|
| `## 0. v5 からの変更点` 末尾 | M0 (却下/採用ログ) | **新設サブ表 2 つ** |
| `## 4.2.2 数値型のマッピング規約` 末尾 | 2.1, 2.2 (B2B 兆) | 脚注 2 行追加 |
| `## 5.2 見出しレベル` | 1.3 (#5) | 「`ValidateA11y` で server 検証する」一行追加 |
| `## 5.8.2 FormField` 末尾 | 2.2 (`value:""`) | 規約節追加 |
| `## 7.6 Block / CardBlock / key 一意性バリデータ` 直後 | 1.3 (#5) | **§7.7 ValidateA11y 新設** |
| `## 10.1 縮退ルール` 冒頭 | 1.5 (#8) | 性格付け節追加 |
| `## 10` 末尾 | 4.1 (a11y × race) | **§10.5 新設** |
| `## 11.2 イベントスキーマ` 表 | 1.4 (#6) | `serverReceivedAtMs` 行追加 |
| `## 11.8 Server-driven state pattern` 末尾 | 1.1 (#1), 4.4 (cross-tab) | 細則 + cross-tab 節追加 |
| `## 13` 末尾 | 1.2 (#4), 4.3 (proptest) | **§13.5 / §13.6 新設** |
| `## 13.4 Action 系の契約テスト` 横断 | 1.1 (#1) | レース条件テスト 3 件追加 |
| `## 14.3 Cart / Checkout のキャッシュ` 末尾 | 2.2 (Vary) | 1 行追加 |
| `## 14` 末尾 | 4.2 (CDN path) | **§14.5 新設** |
| `## 17 Future Work` | 2.1 (多通貨脚注), 3.2 (#9 v2 一行) | 既存項目に脚注 + 1 行追加 |

---

## 7. 完了基準 (= Phase 9 着手の Go 判定)

- [ ] 設計書 §0 に却下指摘の判断ログが存在
- [ ] 採用 5 件すべてで「設計書追記 + 実装 + テスト」がそれぞれ green
- [ ] CI が i18n キー網羅 / proptest ラウンドトリップ / ValidateA11y を含めて green
- [ ] `cargo test && bun run typecheck && bun run test` が冒頭 §19 の trigger 条件を満たす
- [ ] §14.5 の CDN private path 雛形が `docs/infra/` に存在し、Phase 9 infra 着手者が読めば設定できる状態
