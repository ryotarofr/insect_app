# SDUI改修方針 — specimen_list の解体と語彙の拡張

飼育一覧カードの分解図(設計資料スライド②)から見えた課題への改修方針。
指摘は2点: (1)「+ 個体を追加」ボタンがフロント固定コードで、DB管理されていない。
(2) `<SpecimenListView />` が飼育一覧カード専用の太い部品になっており、
理想である「Box / Card の組合せで動的にカードを構成する」から遠い。

---

## 1. 現状診断 — 何が「甘い」のか

`specimen_list` ブロックの定義側語彙は `{ key }` だけだが、その1ブロックの実装
(`SpecimenListView` 約230行 + `AddSpecimenModal` 約120行)が抱えているもの:

| 部位(分解図の番号) | 実装 | 定義から見えるか |
|---|---|---|
| ③「+ 個体を追加」ボタン | JSXに固定(存在・位置・文言すべて) | 見えない |
| ④ 縦タブ(表示・選択状態・改名/削除/追加フォーム) | ブロック内クライアント状態 + 固定コード | 見えない |
| ⑤ 個体行 + アコーディオン展開 | ブロック内(`renderSpecimenDetail` 注入) | 見えない |
| 個体追加モーダル | ブロック内に同居 | 見えない |

つまり **カードの中に「ミニv1」が残っている**: データは hydrate 経由で正しく
サーバ駆動だが、カード内の構成(ボタンがあるか・タブがあるか・並び)はコードに
ハードコードされ、エージェントの運用対象外。加えて:

- 選択タブ/展開状態がモジュールスコープ signal(アプリ内1箇所前提の負債、コメントにも明記済み)
- タブ・行・ボタンのレイアウトは `sd-speclist-*` 専用CSSで、Box/Card の外の世界
- hydrate は全グループ×全行を毎回解決(選択タブ分だけで良いはず)

## 2. 原則 — 「DBで管理すべき」の正しい形

改修の軸を2つに分ける。ここを混ぜると前身(v1)の轍を踏む:

- **構成(何が・どこに・どんな文言で)** → 定義(DB)が持つべき。
  ボタンの存在・位置・ラベルは構成。**指摘のとおり定義へ移す。**
- **振る舞い(押したら何が起きるか)** → 閉じた語彙(enum)+ 固定コード。
  任意のイベント定義をDBに入れると検証不能になり、「安全な語彙を与える」が崩れる。

よって「ボタンのDB管理」の正解は:
**ボタンをブロックとして定義に置けるようにし、その action は閉じた動詞enumから選ぶ**。

## 3. 改修フェーズ(すべて additive、独立リリース可)

### Phase 1: `action_button` 語彙 — ボタンをDBへ(小・半日)

新ブロック型を追加する(既存 `cta` の href を optional にする案は、旧クライアントが
リンク無しctaを壊れた形で描くため不採用。新型追加なら進化規約2で fallback が保証される)。

```rust
// def.rs(additive)
ActionButton {
    key: BlockKey,
    intent: CtaIntent,
    label: String,          // editable 対応も可
    action: UiAction,       // 閉じた動詞
},

#[serde(rename_all = "snake_case")]
pub enum UiAction { AddSpecimen }   // 必要になったら動詞を足す
```

- view/hydrate: パススルー1 arm。valid: 未知 action → 422 をテストで釘打ち
- renderer: `case "action_button"` → `SduiActions.runAction?.(action)` を呼ぶだけ
- care ページ(actions provider)が `add_specimen` → `AddSpecimenModal` を開く実装を提供。
  モーダル自体は固定コードのまま(§2の線引き)
- `SpecimenListView` から toolbar を削除し、migration で care 定義の同カードに
  `action_button` を挿入

**効果**: ボタンの存在・位置・文言が定義更新のみで変わる(成功指標2の実証+1)。
「ラベルを『個体を登録』に変える」「ボタンを消す」がデプロイ不要になる。

### Phase 2: `specimen_list` の分割 — 状態をコンテキストへ持ち上げる(中・1〜2日)

太いブロックを分割する際の核心は「**ブロック間で共有される状態(選択タブ)を
クライアント状態からページコンテキストへ移す**」こと。ブロック同士を直接結合させない。

- URL を状態にする: `/care?group={id}` → `GET /api/pages/care?group={id}`
  → `HydrateCtx { specimen, listing, user, group }`
- ブロックを2つに分割:
  - `group_tabs { key }` — タブ帯。hydrate はグループ+件数のみ。選択は `?group=` リンク
    (改名/削除/追加のインラインフォームは固定コードのまま内蔵)
  - `specimen_rows { key }` — ctx.group の個体行のみ hydrate(未指定はサーバが既定選択)。
    アコーディオンは従来どおり `renderSpecimenDetail` 注入
- 副次効果: 全グループ全行を毎回解決していた hydrate が選択グループ分だけになる。
  モジュールスコープ signal(activeId)が URL に置き換わり負債解消
  (openId も `?open=` に寄せれば For 再マウント問題ごと消える)

**効果**: 「タブなしで一覧だけ」「タブ帯を別カードへ」「行リストを他ページに再利用」が
定義変更のみで可能になる。カード構成が初めて定義から見える。

### Phase 3: カード内レイアウトの意味トークン(小・半日)

分割後の「タブ左・行リスト右」の横並びを定義で表現する。2案を比較:

- **案イ(採用): 閉じたレイアウトトークン** — `Card.layout: stack | sidebar` を
  additive に追加。`sidebar` = 最初の対応ブロックを側柱、残りを本体として描く。
  Box はレンダラ内部の primitive のまま、定義には「意味」だけを出す。
  モバイル(SwiftUI/Compose)でも自然に解釈でき、検証可能。
- **案ロ(不採用): 汎用Box再帰** — `box { direction, gap, children }` を DefBlock に
  入れる案。「すべてBoxで動的に」の直訳だが、(1) カード非再帰の型不変条件を壊す
  (2) レイアウト健全性まで検証できず「壊れた画面が通る」 (3) px/gap の数値が語彙に
  混入する(原則4違反) (4) スキーマがレイアウトエンジン化する = v1 の 2,259行
  デッドコードと同じ道。将来本当に必要なら schemaVersion++ の破壊的変更として再検討。

### Phase 4: フォームの語彙化(大・Phase C)

最後に残る固定コードは AddSpecimenModal・記録追加・タブ改名などの**フォームの中身**。
`form { fields: [...] }` の閉じた field 語彙(text / date / select{source: groups} …、
submit 先はドメインRESTに固定)で原理的には語彙化できるが、ここは前身が複雑化した
最難所(サーバ駆動の検証表示・状態・競合)。Phase 1〜3 の運用実績 —
エージェントが実際にボタンやタブ構成を運用するか — を見てから着手する。

## 4. 到達点(Phase 3 完了時の care 定義・抜粋)

```json
{
  "key": "specimen-list",
  "layout": "sidebar",
  "blocks": [
    { "type": "text",          "content": { "key": "title", "role": "headline", "text": "飼育一覧" } },
    { "type": "action_button", "content": { "key": "add", "intent": "secondary",
                                            "label": "＋ 個体を追加", "action": "add_specimen" } },
    { "type": "group_tabs",    "content": { "key": "tabs" } },
    { "type": "specimen_rows", "content": { "key": "rows" } }
  ]
}
```

分解図の5部位のうち、固定コードに残るのはフォームの中身だけになる。
見出し・ボタン・タブ帯・行リストの有無と並びは、すべて定義 = エージェントの運用対象。

## 5. やらないこと(明文化)

- 任意イベント/式言語の定義化(`onClick: "..."` 等) — 検証不能、閉じた語彙の放棄
- 汎用Box再帰コンテナ(§3案ロ)
- action への対象ID埋め込み(`add_care_log { specimen: "..." }` 等) —
  定義は全ユーザ共有物。IDはコンテキスト(URL / ログインユーザ)から解決する

## 6. 補足 — 「すべてBox化」への見解

目的は原子化そのものではなく「**エージェントが操作できる継ぎ目を増やす**」こと。
業界のSDUI実装(粗い section 単位のバインド)が示すとおり、原子まで JSON 化すると
検証面が爆発し、逆にエージェントが安全に触れなくなる。Phase 1〜3 で
「構成はすべて定義、振る舞いは閉じた動詞、フォームだけ固定コード」まで到達すれば、
分解図で赤枠を引いた全部位が語彙で説明できる状態になり、思想と実装の残差は
Phase 4(フォーム)だけに絞られる。