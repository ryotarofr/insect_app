# カードビルダー検討書 — ユーザが自分のカードを作れる飼育管理画面

「ユーザが好きなようにカードを作成できる機能」(TODO・通知設定・メモ等)を
飼育管理(care)画面から始めるための設計。確定済みの方針:
**care はユーザ毎に設定できるようにする / v1 は TODO と通知設定カードまで含める**。

先に全体像を一言で: この機能は新しい仕組みではなく、**エージェントがやっている
「定義の運用」を人間のGUIに開放するもの**。カード = `Card<DefBlock>`、保存 = 検証付き PUT、
語彙 = 閉じたスキーマ — すべて既存の機構の上に乗る。新規に必要なのは
(1) ユーザ毎ページの置き場、(2) 組み立てUI、(3) TODO/通知の**新ブロック語彙**の3つ。

---

## 0. 重要な整理 — 「好きなカード」の2階層

添付画像の3カード(メモ/飼育一覧/出品中)は**既存語彙の組合せ**で全部表現できる。
一方 TODO と通知設定は語彙に存在しない。つまり:

| 階層 | 内容 | 実現手段 |
|---|---|---|
| 構成の自由 | 既存ブロックを組み合わせたカード(メモ、リンク集、出品グリッド…) | **ビルダーUI**(§3)だけで可能 |
| 新しい振る舞いのカード | TODO、通知設定 | **新ブロック語彙の追加**(§4)が必要。ビルダーはそれを配置する入口 |

進化規約2(新ブロック型の追加は自由)がここで効く。TODO も通知も
「ドメインデータ+閉じたブロック+固定コードフォーム」という care_log_list /
listing_settings と同じ既存パターンの反復であり、原則からの逸脱はない。

**通知設定の正直な範囲**: メール・プッシュ等の外部チャネル基盤は存在しないため、
v1 の通知は**アプリ内通知**として本物にする(§4.2)。飼育データから計算できる実シグナル
(最終記録からの経過日数・次のアクション)を、ユーザが設定したしきい値で警告表示する。
外部チャネルは将来この設定の「送信先」を増やす形で拡張する(設定の器は無駄にならない)。

## 1. ユーザ毎ページ基盤(care のパーソナライズ)

### 設計: 共有定義 + ユーザ別コピー(copy-on-write)+ リセット

新テーブル(0020):

```sql
CREATE TABLE user_page_definitions (
    owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_key   text NOT NULL,
    definition jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, page_key)
);
```

- **GET /api/pages/{key}**: ログインユーザの行があればそれ、無ければ共有
  (`page_definitions`)を配信。hydrate・コンテキストは無変更
- **GET /api/pages/{key}/definition**: 同じ解決(編集の起点)
- **PUT /api/pages/{key}/mine**(新設): 検証(同じ `ValidPageDefinition`)して
  ユーザ行へ upsert。**初回書込 = その時点の共有定義を土台にしたコピーが個人化の瞬間**
- **DELETE /api/pages/{key}/mine**(新設): ユーザ行を削除 = **共有の最新に戻す**リセット
- PUT /api/pages/{key}(共有・既存)はエージェント/管理の経路としてそのまま

トレードオフと対処: 個人化したユーザには以後の共有側更新(migration・エージェント運用)が
届かなくなる。これは個人化の本質的コストなので、**リセット(共有に戻す)を必ずUIに置く**
ことで逃げ道を保証する(「共有の最新を取り込んでから作り直す」が1クリック)。

クライアント側は route が scope を宣言する: care は `pageScope: "mine"`
(SduiActions に追加)。text/markdown の既存編集UI(`patchDefinitionBlock`)も
care 上では `/mine` に書く = 文言編集も自分のページに閉じる。home 等は従来どおり共有。

運用観測(Phase 4 判断)との接続: `scripts/definition_ops_report.sql` に
`user_page_definitions`(users JOIN でメール表示)を UNION で追加する。
**ユーザのカード作成はそのまま「定義運用の実発生」のシグナル**になる。

## 2. ビルダーの入口 — 閉じた動詞の2例目

Phase 1 の機構をそのまま使う。`UiAction::AddCard` を追加し、共有 care 定義の
footer に action_button を置く(0023):

```json
{ "key": "page-tools", "blocks": [
  { "type": "action_button", "content": {
      "key": "add-card", "intent": "secondary",
      "label": "＋ カードを追加", "action": "add_card" } } ] }
```

care ページの actions provider が `add_card` → CardBuilder モーダルを開く。
ボタンの存在・位置・文言が定義管理になる(消したい環境は定義から消せばよい)。
UiAction の enum に動詞が2つになり、「動詞を足す設計」が単発でなかったことの実証にもなる。

## 3. CardBuilder モーダル(固定コードUI)

AddSpecimenModal と同じ作法の固定コード部品。primitive 層(FormStack/Field/Row/Grid)で組む。

- **カード設定**: タイトル(→ text.headline ブロックとして自動生成、省略可)/
  size(full | half)/ tone(default | accent)。すべて既存の閉じたトークンの select
- **ブロックパレット**(v1): 本文テキスト(role 選択)/ Markdown / リンクボタン
  (label + サイト内 href)/ 出品グリッド(sort・limit・seller の閉じたフォーム)/
  **TODOリスト** / **通知**。追加したブロックは上下移動・削除できる。
  コンテキスト必須ブロック(specimen_profile 等)は care では 400 になるためパレットに出さない
- **key の自動生成**: `my-<ランダム4字>` 形式(BlockKey パターン準拠)。ユーザに key は見せない
- **保存**: 現在の定義を取得 → body 末尾にカード挿入 → `PUT /mine`。
  サーバ検証の 422(カード10枚超・重複key等)はモーダル内に表示(サーバが常に最終権威)
- **自分のページの編集**: v1 はカード単位の「削除」(各カードのゴーストボタン+確認)と
  「共有の最新に戻す」(リセット)まで。ブロック単位の後からの編集・並べ替えは v2
  (それまでは削除→作り直しで代替)

明示的にやらないこと(§5 の維持): 自由なCSS・色・サイズ数値の入力欄は作らない
(出すのは閉じたトークンの選択肢のみ)。任意イベントも式言語も入れない。
フォームの中身の語彙化(Phase 4)には踏み込まない — ビルダーの各フォームは固定コード。

## 4. 新ブロック語彙(v1 の2つ)

どちらも「定義は配置だけ、設定値・中身はユーザ毎のドメインデータ」の既存ドクトリンに従う。

### 4.1 `todo_list` — 個人TODO

- **ドメイン**(0021): `user_todos (id, owner_id→users CASCADE, body text, done bool,
  created_at, done_at)`
- **REST**: `POST /api/todos {body}` / `PATCH /api/todos/{id} {body?, done?}` /
  `DELETE /api/todos/{id}`(全て AuthUser、owner 検証)
- **定義**: `todo_list { key, emptyText? }`(パラメータは他のドメインバインドと同じ最小)
- **ビュー**: `todo_list { key, items: [{ todoId, body, done }], emptyText? }`。
  未完了→完了済みの順、ctx.user 必須(401)
- **レンダラ**: チェックボックス行 + 追加入力 + 削除。REST → refreshAll
  (CareLogListView と同型・約1日)。配置が共有でも中身は個人別、
  個人ページなら配置ごと個人のもの

### 4.2 `care_alerts` — 通知(アプリ内)+ しきい値設定

- **ドメイン**(0022): `notification_prefs (owner_id PK→users CASCADE,
  enabled bool DEFAULT true, stale_days int DEFAULT 7)`。
  **設定値は定義ではなくドメインデータ**(定義は全員の配置を書く場所であり、
  「私は10日で警告」という値の置き場ではない)
- **REST**: `PATCH /api/notification_prefs {enabled?, staleDays?}`(upsert)
- **定義**: `care_alerts { key, emptyText? }`
- **ビュー**: `care_alerts { key, enabled, staleDays, items: [...], emptyText? }`。
  items = ①`alert=true` の個体 ②最終記録(care_logs)が staleDays 日より古い個体
  ③記録が1件も無く登録から staleDays 日超の個体 — 理由ラベル付き
  (例: 「最終記録から9日」)。enabled=false なら items は空で配信
- **レンダラ**: 警告行のリスト(クリックで `?open=` 展開に飛ぶ)+ インライン設定フォーム
  (有効トグル + 日数入力 → PATCH → refreshAll)。listing_settings と同型・約1日
- 将来の外部チャネルは notification_prefs に `channel` 系カラムと送信ジョブを足す拡張
  (このカードのUIと設定の器はそのまま使い回せる)

### L2 検証の追加

新ブロックの emptyText は既存の `MAX_UI_TEXT_CHARS` を適用。それ以外の新規不変条件は無し
(todo/alerts の実データはドメイン側で検証)。JSON Schema 再生成でエージェントの語彙にも載る
= エージェントも TODO カードや通知カードを配置できるようになる(この対称性が本題の回収)。

## 5. 変更ファイルとマイルストーン

| 順 | 内容 | 主な変更 | 規模 |
|---|---|---|---|
| P1 | ユーザ毎ページ基盤 | 0020 / main.rs(GET解決・PUT/DELETE `/mine`)/ api.ts / care.tsx(scope)/ report SQL 統合 | 1日 |
| P2 | ビルダー | UiAction::AddCard / 0023(入口ボタン)/ CardBuilder.tsx(新規)/ renderer(カード削除アフォーダンス)/ リセットUI | 1〜1.5日 |
| P3 | todo_list | 0021 / def・view・hydrate・valid / main.rs REST / TodoListView / types | 1日 |
| P4 | care_alerts | 0022 / 同上 + 警告抽出SQL / CareAlertsView + 設定フォーム | 1日 |

計 4〜4.5日。P1→P2 が本線、P3/P4 は独立(P2 のパレットに現れるのは実装済みのものだけ)。
各フェーズで cargo test / tsc / スクリーンショット検証 + dump_schema 再生成。
指標3(新ブロックのリードタイム)を P3/P4 でそれぞれ記録する。

## 6. 受け入れ基準(v1)

- care で「＋ カードを追加」→ タイトル+Markdown のメモカードを作成 → 自分だけに表示され、
  別アカウントには出ない。リロード・再ログインで保持
- TODOカード: 追加・チェック・削除が動き、中身はアカウント毎に別
- 通知カード: しきい値を 3日 に変えると「最終記録から9日」の個体が出る/
  無効にすると消える(スクリーンショット添付の ⚠個体で実演可能)
- 作成カードが 422 条件(11枚目のカード等)でモーダル内にエラー表示
- 「共有の最新に戻す」で共有定義の表示に戻る
- `definition_ops_report.sql` にユーザのカード運用が現れる(Phase 4 判断材料)
- エージェント経路の対称性: 同じカードを PUT(共有)/ PUT `/mine` で投入しても
  同一表示になる(語彙が共通である確認)

## 7. 決定事項の記録と残す論点

- 確定: **care はユーザ毎**(user_page_definitions・CoW+リセット)/
  **v1 に TODO・通知を含む**(通知はアプリ内)
- 推奨のまま実装に入る細目: 入口は action_button(§2)/ パレットは§3の6種 /
  カード編集は v1 では削除+作り直し
- 残す論点(実装中に確認): ①個人ページでの共有カード削除を許すか(CoW なので技術的には
  可能。v1 は「自分が作ったカード以外は削除ボタンを出さない」に倒すか、全カード削除可にするか)
  ②通知カードを全ユーザの共有 care にも標準配置するか(0023 で入口ボタンと一緒に置ける)
