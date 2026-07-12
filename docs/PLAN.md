# insect_app_r2 — SDUI 最小POC

## 検証する仮説

**閉じたスキーマ + DB管理の画面定義なら、AIエージェントが安全に画面を生成・運用できる。**

Web単一クライアントではSDUIの従来便益(リリース速度)は薄く、この設計の回収路はエージェント運用ただ一つ。
よってPOCはその仮説を最小コストで検証することだけに絞る(insect_app本体レビューの提案①②)。

## 成功指標

1. **LLM生成 definition の validate 通過率** — schema/page_definition.schema.json を与えた
   Claude API の structured outputs で N=20 生成し、`cargo run --bin validate` の通過率を計測。目標 90%以上
2. **コード変更ゼロの画面変更** — `page_definitions` への SQL UPDATE のみでリロード後の画面が変わることをデモ
3. **新ブロック種追加のリードタイム** — enum variant 追加→レンダラ対応までの実測時間を記録

## レイヤーモデル

```
Page → Region → Card → Block(Role)
```

- **Card は構造層**(常にカード。タグ不要のstruct)。Card は Card を含めない(型レベルで再帰禁止)
- レイアウトは `size` のセマンティックトークン(`full` / `half`)+ `tone`(`default` / `accent`)。
  CSS値は決して入れない
- フロントのコンテナは **Box(レイアウト)と Card(面)の2primitiveのみ**。Blockはその葉

## 定義とビューの分離

| | 型 | 書き手 | 置き場所 |
|---|---|---|---|
| 定義 | `PageDefinition`(DefBlock) | エージェント / 人間 | `page_definitions.definition` (JSONB) |
| ビュー | `PageView`(ViewBlock) | サーバ(hydrate) | `GET /api/pages/{key}` レスポンス |

データバインドブロックだけが差分(query/宣言 ↔ 解決済みデータ)。価格・商品データは
定義側の語彙に存在しない = エージェントは商品データを書けない(構造的安全性)。

## ワイヤ形式

- enum は **adjacently-tagged**: `{ "type": "text", "content": { ... } }`(typeshare対応形式)
- タグは snake_case、フィールドは camelCase
- `deny_unknown_fields` + ブランド型(`BlockKey` / `SitePath`)の `try_from` 検証で閉じる
- タグ付きunionに**ユニットvariant禁止**(serde #2294 対策。payloadなしは `Variant {}` と書く)
- `flatten` 禁止(`deny_unknown_fields` と非互換)

## 検証(parse, don't validate)

`ValidPageDefinition::parse` だけが検証済み定義を作れる。ハンドラ・DB層はこの型しか受け取らない。

- L1 構造: serde(deny_unknown_fields / try_from ブランド型 / 閉じたenum)
- L2 意味: schemaVersion==1 / key一意(card.key と card.key::block.key)/ headline≦1 per card /
  listing_grid limit 1..=24 / markdown ≦5000字 / カード≦10 per region / ブロック≦10 per card

## 進化規約(モバイル対応の前提)

1. **additive-only**: フィールド追加は Optional+default のみ。既存フィールドの意味変更・削除・転用禁止
2. **新ブロック型の追加は自由**。全クライアントは未知 `type` を fallback カード表示する義務を負う
3. **破壊的変更は schemaVersion++ でのみ**行う
4. **未知enum値のフォールバック**: クライアントは未知の `CardSize` 等を既定値(`full`)として扱う。
   `size` 系にはコンテナ比率/サイズクラスの語彙のみ(px・CSS値禁止)。レスポンシブは将来
   `size_compact` 等の optional 追加(サイズクラス語彙)で入れる。汎用レイアウトエンジンはスコープ外

## 構成

```
api/   Rust (axum + sqlx/Postgres + schemars + typeshare + argon2)
  src/sdui/{brand,def,view,valid}.rs   スキーマSoT
  src/hydrate.rs                       定義→ビュー変換(コンテキスト付き)
  src/auth.rs                          セッションCookie認証 + AuthUser/MaybeUser extractor
  src/main.rs                          配信/定義書込/ドメインREST(起動時にmigration適用)
  src/bin/dump_schema.rs               → ../schema/page_definition.schema.json
  src/bin/validate.rs                  stdin JSON → 検証(ハーネス用CLI)
  migrations/                          0001〜(適用済みは編集禁止。変更は新migrationで)
web/   SolidStart(SPAモード, /api は vite proxy → 127.0.0.1:3001)
  src/app.tsx                          固定シェル(ヘッダー+上部ナビ+ユーザ表示)= コード管理領域
  src/sdui/{types,api,actions,renderer,specimen,listing}  types.tsは暫定手書き
  src/routes/{index,care,login,listings/[id]}.tsx         SDUIコンテンツ面
scripts/seed_test_user.sql             testユーザ用サンプルデータ(docker cp + psql -f で実行)
harness/run.py                         (未実装・ステップ6)LLM生成→validate→通過率集計
```

## フェーズ2: 飼育管理(2026-07-11 実装)

- 新ブロック4種: `specimen_list`(タブ+行リスト)/ `specimen_profile` /
  `care_log_list` / `species_note` — いずれも定義側パラメータは `key` のみ
- タブ軸はユーザ定義グループ(`specimen_groups`、0004で導入。虫かご単位等の自由ラベル)。
  旧4ステージは初期グループとして移行済み。タブのラベルはドメインデータであり、
  SDUIスキーマは無変更(グループの追加は `POST /api/groups`)
- **コンテキスト付きhydration**: `specimen_detail` は定義1枚を全個体で共有し
  `GET /api/pages/specimen_detail?specimen={id}` で解決。コンテキスト必須ブロックが
  コンテキスト無しで呼ばれたら 400
- **書き込みの2経路**: 画面定義への書込 = `PUT /api/pages/{key}`(text編集UIもこの経路 =
  エージェントと同一)/ ドメイン書込 = REST(`/api/specimens` 系)+ 成功後に再fetch。
  フォームはSDUI語彙ではなく固定コード部品(FormField語彙の再導入はPhase C)
- 詳細は一覧行直下のアコーディオン展開(specimen_detail 定義をインライン描画。
  モーダルは個体追加のみ。URL直リンクなし、必要になれば `?specimen=` 同期を後付け)
- 写真アップロードは未実装(プレースホルダ)
- `text.editable`(default false・falseは非出力): 編集UIをスキーマ側で宣言する
  additiveフィールド。homeは未指定=非表示、care/specimen_detailはmigration 0003で付与。
  UIアフォーダンスの宣言であって認可ではない(認可は将来テーマ)
- **出品一覧は独立ページ化しない**(0005でcareに「出品中」カードを既存語彙のみで埋め込み
  = 指標2の実例)。検索/絞込/ページング付きの市場一覧(list shell語彙の再導入、
  listing_summary、listings↔specimens紐付け)は買い手が存在するマルチユーザ化の際に再設計する
- **出品詳細** `/listings/{id}`(0006): 定義1枚(`listing_detail`)+ `?listing=` コンテキスト。
  新ブロック `listing_hero` / `listing_spec` の2種。購入・ウォッチはPhase C(ボタンのみ準備中)。
  「この個体の飼育履歴」カードは listings↔specimens 紐付け時に追加予定
- **個体からの出品**(0011): `listings.specimen_id`(ON DELETE **RESTRICT** = 出品中の個体は
  将来も削除不可)+ `seller_id`。1個体につき出品中1件(部分ユニーク)。新ブロック
  `listing_settings`(specimenコンテキスト)を個体詳細に配置。`ListingQuery.seller: "mine"`
  (additive)でcareの「出品中」カードは自分の出品のみ・ホームは市場全体。
  取り下げ(withdrawn)は全 listing_grid から除外。一覧hintは 次のアクション>出品中>最新記録
- **個体の削除**: `DELETE /api/specimens/{id}`(トランザクション)。出品中は422で拒否
  (RESTRICT制約と二重防御)、過去の出品は個体と一緒に削除、記録はCASCADE。
  UIはプロフィール右上のghostボタン→専用確認ダイアログ(422はダイアログ内表示)
- **markdownブロック**(0014でheroに適用): 原文をビューに配信し描画は各クライアント
  (Web = marked + DOMPurify ホワイトリスト方式、モバイルはネイティブレンダラ想定)。
  文中見出しはh3以下へシフト(headline≦1/cardの不変条件を保護)、生HTMLは除去、
  外部リンクはnoopener+新規タブ。L2でMAX_MARKDOWN_CHARS=5000。editable対応
- **指標3の記録**: 新ブロック4種+コンテキスト導入で、変更ファイル 13
  (api: def/view/mod/hydrate/main/migration、web: types/api/actions/renderer/specimen/care/css)。
  所要時間: ____(ユーザ記入)

## フェーズ3: 認証 Phase A(2026-07-12)

- セッションCookie方式(argon2 + トークンSHA-256保存、HttpOnly/SameSite=Lax、30日)。
  0009: users + sessions。`/api/auth/register・login・logout・me`
- 保護 = ハンドラに `AuthUser` extractor を足すだけ: ドメイン書込全部 +
  `PUT /api/pages` + `GET .../definition`(ページGETと一覧系GETは公開のまま)
- ログイン/登録UIは固定コード(`/login`)。ヘッダーにユーザ名+ログアウト
- Phase B(0010): specimens / specimen_groups / species_notes に owner_id。
  **共有定義 × ユーザ毎データ** — `HydrateCtx.user` により同じ specimen_list 定義が
  ログインユーザごとに自分のデータを hydrate する。specimen系ブロックは未ログイン401
  (careページはログイン誘導表示)。既存データは最初の登録ユーザへ帰属
  (ユーザ不在ならログイン不能なシードユーザ)。新規登録時にデフォルト4タブを自動作成。
  個体code・タブlabel・種メモはユーザ単位の一意に変更。listings と page_definitions は共有のまま
- 未実装(Phase C): ロール(管理者のみ定義PUT)、CSRF対策強化・レート制限・パスワードリセット

## 起動手順

```
# 1) DB(Docker)。接続情報は api のデフォルト DATABASE_URL と一致済み
docker compose up -d          # 破棄してseedからやり直す時: docker compose down -v
# 2) API(migration + seed は起動時に自動適用)
cd api && cargo run
# 3) Web
cd web && pnpm install && pnpm dev
# 4) http://localhost:3000 を開く
```

## 検証チェックリスト

- [ ] `cargo test` — round-trip / 未知フィールド拒否(全階層)/ ブランド型拒否 / 意味検証
- [ ] `cargo run --bin dump_schema` — schema.json 生成
- [ ] `curl localhost:3001/api/pages/home` — hydrate済みJSON
- [ ] 不正PUTが422 / 正当PUTで画面反映
- [ ] 未知 `type` 注入で fallback カード表示
- [ ] SQL UPDATE → リロードで画面変化(指標2)
- [ ] typeshare CLI で generated 型を出力し types.ts と一致確認(i64の扱い確認込み)
- [ ] harness 実行 → 通過率レポート(指標1)
