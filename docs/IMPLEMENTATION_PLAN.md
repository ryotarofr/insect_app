# SDUI改修 実装計画 — REFACTOR.md(specimen_list の解体と語彙の拡張)

docs/REFACTOR.md の方針をソースコードと突き合わせ、Phase 1〜3 をそのまま実装できる粒度
(変更ファイル・コード骨子・migration SQL・テスト・受け入れ基準)まで落とした計画。
Phase 4(フォーム語彙化)は方針どおりスコープ外とし、着手判断の条件だけ記す。

---

## 0. 現状診断の確認(コード上の根拠)

REFACTOR.md §1 の指摘はすべてコードで確認できた。改修対象は以下に局在する。

| 指摘 | 実体 | 場所 |
|---|---|---|
| ③「+ 個体を追加」ボタンがJSX固定 | `sd-speclist-toolbar` 内の `<button>` | `web/src/sdui/specimen.tsx` L136-140 |
| 選択タブ/展開状態がモジュールスコープ signal | `activeId` / `openId`(「アプリ内1箇所前提」のコメント付き) | `specimen.tsx` L37-41 |
| ④⑤ タブ・行・モーダルが1ブロックに同居 | `SpecimenListView`(~230行)+ `AddSpecimenModal`(~120行) | `specimen.tsx` L76-430 |
| hydrate が全グループ×全行を毎回解決 | `fetch_specimen_groups`(LEFT JOIN で全件) | `api/src/hydrate.rs` L396-449 |
| レイアウトが専用CSS | `.sd-speclist-layout` / `.sd-vtabs`(幅172px 固定) | `web/src/app.css` L478-509, L938-946 |
| 定義から見える語彙は `{ key }` のみ | `DefBlock::SpecimenList { key }` | `api/src/sdui/def.rs` L146-148 |

care 定義の現在形(0002 + 0003 + 0005 + 0016 適用後):

```
body[0] = roster カード  blocks: [ text(roster-title, editable), specimen_list(roster-list) ]
body[1] = selling カード blocks: [ text(selling-title, editable), listing_grid(selling-grid) ]
```

→ 既存 migration の家風(固定 index + key ガードで no-op 安全化。0013/0016 参照)を踏襲できる。

---

## 1. 設計上の決定事項(推奨案)

実装前に確定したい点。いずれも推奨案で計画を書いてある。変更があればこの節だけ差し替えれば良い。

- **D1: `specimen_list` レガシー語彙の扱い — 残す(推奨)**。
  進化規約1(削除禁止)に従い、def/view/hydrate/レンダラとも残置し doc comment で
  `#[deprecated]` 相当の注記を付ける。care 定義は 0018 で新語彙へ移行するため実利用は消える。
  完全削除は将来 schemaVersion++ の破壊的変更としてまとめて行う(スコープ外)。
  ※ Phase 2 でモジュールスコープ signal を消す際、レガシー `SpecimenListView` は
  コンポーネント内ローカル signal に付け替える(挙動は僅かに劣化して良い: 再fetchで選択リセット)。
- **D2: クライアントの `action` 型は `string`(union にしない)**。未知動詞が来ても型が壊れない
  (寛容な読み手)。handler が未実装の動詞は no-op + `console.warn`。
  actions provider が無いページ(home 等)ではボタンを disabled 表示。
- **D3: `?group=` の不正値(他人のグループ・存在しないID)はエラーにせず既定選択へフォールバック**。
  所有チェックは行クエリ側(`owner_id`)で担保されるため情報漏えいは無い。
  UUID として parse できない文字列は axum の Query 拒否で 400(既存 `?specimen=` と同じ)。
- **D4: `?open=`(アコーディオン展開)も Phase 2 で URL に寄せる(推奨)**。
  REFACTOR §Phase2 の「For 再マウント問題ごと消える」を同時に回収し、モジュールスコープ signal を
  2つとも撲滅する。行の開閉は `replace: true` で履歴を汚さない。タブ切替は push(戻るでタブが戻る)。
- **D5: Phase 1 のモーダル既定グループ**: `specimen.tsx` の `activeId` を一時的に
  `export const currentGroupId = activeId` として care.tsx から参照(UX無劣化)。
  Phase 2 で URL (`?group=`) に置換してこの export を削除する(寿命1フェーズの明示的な仮設)。
- **D6: `sidebar` の解釈 = 「側柱対応ブロック」の集合をレンダラが持つ**(初期は `group_tabs` のみ)。
  カード内ブロックを [側柱ブロックより前 → 全幅の前置行] [最初の対応ブロック → 側柱]
  [残り → 本体] に分割して描画。対応ブロックが無ければ stack と同じ(検証エラーにしない)。
- **D7: Phase 2 と Phase 3 は独立リリース可能だが、連続して出す(推奨)**。
  Phase 2 単体の期間はタブ帯が行リストの上に縦積みになる(モバイル表示と同じ見た目)。
  数日空くなら許容範囲だが、PC の見た目を崩したくなければ 2→3 を同じリリース枠に入れる。
- **D8: `action_button.label` の editable 対応は見送り**(REFACTOR の「対応も可」)。
  additive フィールドなので必要になったら後付けできる。Phase 1 の差分を最小に保つ。
- **D9: 新ブロックの key は家風どおり `roster-add` / `roster-tabs` / `roster-rows`**
  (REFACTOR §4 の `add`/`tabs`/`rows` は抜粋表記。key 一意性は card::block 合成なのでどちらでも可)。

---

## 2. Phase 1 — `action_button` 語彙(小・半日)

ボタンの存在・位置・文言を DB 定義へ。振る舞いは閉じた動詞 enum。

### 2.1 API 側

**`api/src/sdui/def.rs`**

```rust
/// UIアクションの閉じた動詞。対象IDは持たせない(§5: IDはコンテキストから解決)。
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UiAction {
    AddSpecimen,
}

// DefBlock に variant 追加(構造体variant。ユニットvariant禁止の規約に適合)
/// 押下でクライアント固定実装の動詞を起動するボタン。
/// 構成(存在・位置・文言)は定義が持ち、振る舞いは閉じた動詞(REFACTOR §2)。
ActionButton {
    key: BlockKey,
    intent: CtaIntent,
    label: String,
    action: UiAction,
},
```

`DefBlock::key()` の match に `| DefBlock::ActionButton { key, .. }` を追加。

**`api/src/sdui/view.rs`** — 同形の variant を `ViewBlock` に追加(`UiAction` を def から import)。

**`api/src/hydrate.rs`** — パススルー 1 arm:

```rust
DefBlock::ActionButton { key, intent, label, action } =>
    ViewBlock::ActionButton { key, intent, label, action },
```

**`api/src/sdui/mod.rs`** — `UiAction` を re-export。

**`api/src/sdui/valid.rs`** — L2 追加は不要(閉じた enum は L1 で落ちる)。テストで釘打ち:

```rust
#[test] fn action_button_roundtrips() { /* sample に action_button を足して等値round-trip */ }
#[test] fn rejects_unknown_ui_action() { /* action: "self_destruct" → Err(Json) = PUTで422 */ }
#[test] fn rejects_unknown_field_in_action_button() { /* content に junk → Err(Json) */ }
```

**`api/migrations/0017_action_button.sql`** — 見出し直後(specimen_list の手前)に挿入。
家風どおり形状ガード付き(ユーザが定義を編集済みなら no-op。その場合も PUT /api/pages/care で
同じブロックを入れられる — それ自体がこの機能の主旨):

```sql
-- careの「飼育一覧」カードに「+ 個体を追加」ボタンを定義として挿入(Phase 1)。
-- body[0] が roster かつ blocks[1] が specimen_list の場合のみ実行(no-opガード)。
UPDATE page_definitions
SET definition = jsonb_insert(
        definition,
        '{page,content,regions,body,0,blocks,1}',
        $json${ "type": "action_button", "content": {
          "key": "roster-add", "intent": "secondary",
          "label": "＋ 個体を追加", "action": "add_specimen" } }$json$::jsonb
    ),
    updated_at = now(),
    updated_by = 'migration:0017'
WHERE page_key = 'care'
  AND definition #> '{page,content,regions,body,0,key}' = '"roster"'::jsonb
  AND definition #> '{page,content,regions,body,0,blocks,1,type}' = '"specimen_list"'::jsonb;
```

`cargo run --bin dump_schema` で `schema/page_definition.schema.json` を再生成。

### 2.2 Web 側

**`web/src/sdui/types.ts`** — `ViewBlock` union に追加(action は string。D2):

```ts
| { type: "action_button"; content: { key: string; intent: CtaIntent; label: string; action: string } }
```

**`web/src/sdui/actions.ts`** — `SduiActions` に追加:

```ts
/** action_button の閉じた動詞を実行。ページが対応する動詞のみ実装する */
runAction?: (action: string) => void;
```

**`web/src/sdui/renderer.tsx`** — `case "action_button"` → `ActionButtonView`。
provider 不在なら disabled、未知動詞は provider 側で no-op + warn:

```tsx
function ActionButtonView(props: { content: { intent: CtaIntent; label: string; action: string } }) {
  const actions = useSduiActions();
  return (
    <div class="sd-actionrow">
      <button
        class="sd-btn" classList={{ "sd-btn--primary": props.content.intent === "primary" }}
        disabled={!actions?.runAction}
        onClick={() => actions?.runAction?.(props.content.action)}
      >
        {props.content.label}
      </button>
    </div>
  );
}
```

**`web/src/sdui/specimen.tsx`**
- `SpecimenListView` から `sd-speclist-toolbar` の div ごと削除
- `AddSpecimenModal` を `export` に変更し、**groups を自分で fetch する形へ**
  (`createResource(fetchGroups)`。現在は props 受け。care 側が hydrate 済み groups を
  持たなくなるため)。既定グループは `currentGroupId()`(D5)→ 無ければ先頭
- `export const currentGroupId = activeId;` を一時追加(Phase 2 で削除)

**`web/src/routes/care.tsx`** — モーダルの所有をページへ移す:

```tsx
const [adding, setAdding] = createSignal(false);
// Provider value に追加:
runAction: a => { if (a === "add_specimen") setAdding(true); else console.warn("unknown action:", a); },
// JSX 末尾:
<Show when={adding()}><AddSpecimenModal onClose={() => setAdding(false)} /></Show>
```

**`web/src/app.css`** — `.sd-actionrow { display:flex; justify-content:flex-end; }` を追加
(現状のツールバー右寄せを再現)。`.sd-speclist-toolbar` は care_log_list でも使用中のため残す。

### 2.3 受け入れ基準・デモ(成功指標2の実証+1)

- `cargo test` 緑(新テスト3件含む)/ `cargo run --bin dump_schema` 差分に action_button
- 画面: ボタンが見出し直後に出て、押すと従来どおりモーダルが開く。home 等 provider 無しページに
  同ブロックを置いても disabled 表示で壊れない
- **デプロイ無し画面変更のデモ**:
  `UPDATE page_definitions SET definition = jsonb_set(definition, '{page,content,regions,body,0,blocks,1,content,label}', '"個体を登録"') WHERE page_key='care';`
  → リロードで文言が変わる。ブロックを `#-` で消せばボタンが消える
- 不正 PUT(`"action": "unknown_verb"`)が 422
- 指標3 記録: 変更ファイル数(想定 api 5 + migration 1 + web 5)と所要時間をメモ

---

## 3. Phase 2 — `specimen_list` の分割(中・1〜2日)

核心は「ブロック間で共有される状態(選択タブ)をページコンテキスト(URL)へ持ち上げる」。
ブロック同士は直接結合しない。

### 3.1 コンテキストの拡張(URL → HydrateCtx)

- **`api/src/main.rs`**: `PageQuery` に `group: Option<Uuid>` を追加し `HydrateCtx` へ渡す
  (`PageQuery` は deny_unknown_fields ではないので additive 安全)
- **`api/src/hydrate.rs`**: `HydrateCtx` に `pub group: Option<Uuid>` を追加
- **`web/src/sdui/api.ts`**: `fetchPage(key, ctx?: { specimen?; listing?; group? })` に拡張

### 3.2 語彙の追加(def / view)

**`api/src/sdui/def.rs`** — 定義側パラメータはどちらも `{ key }` のみ:

```rust
/// グループタブ帯(タブ+件数のみ)。選択は URL (?group=) = HydrateCtx.group。
/// 改名/削除/追加のインラインフォームはクライアント固定コード(REFACTOR §2 の線引き)。
GroupTabs { key: BlockKey },
/// 選択グループの個体行リスト。ctx.group 未指定/無効時はサーバが既定選択。
SpecimenRows { key: BlockKey },
```

**`api/src/sdui/view.rs`**:

```rust
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GroupTabItem {
    #[typeshare(serialized_as = "String")]
    pub group_id: Uuid,
    pub label: String,
    pub count: u32,
}

// ViewBlock:
GroupTabs {
    key: BlockKey,
    /// サーバが解決した選択グループ(グループが1つも無い場合のみ None)
    #[typeshare(serialized_as = "Option<String>")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_group_id: Option<Uuid>,
    groups: Vec<GroupTabItem>,
},
SpecimenRows {
    key: BlockKey,
    #[typeshare(serialized_as = "Option<String>")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    group_id: Option<Uuid>,
    items: Vec<SpecimenItem>,
},
```

### 3.3 hydrate の分割(副次効果: 解決範囲が選択グループのみに)

```rust
/// ?group= が自ユーザ所有ならそれ、無効なら count>0 の最初 → sort_order 最初(D3)。
async fn resolve_active_group(pool, owner, requested: Option<Uuid>) -> Result<Option<Uuid>, sqlx::Error>
async fn fetch_group_tabs(pool, owner) -> Vec<GroupTabItem>        // GROUP BY の軽量1クエリ
async fn fetch_specimen_rows(pool, owner, group: Uuid) -> Vec<SpecimenItem>
    // 既存 fetch_specimen_groups の hint ロジック(次のアクション>出品中>最新記録)を
    // WHERE s.group_id = $2 に絞って移植
```

- `group_tabs` / `specimen_rows` の両 arm がそれぞれ `resolve_active_group` を呼ぶ
  (2回呼びの整合性: 同一リクエスト内のスナップショットずれは POC として許容。コメントで明記)
- どちらも `ctx.user` 必須(401)= 現行 `specimen_list` と同じ
- **`specimen_list` の arm は残す**(D1)

### 3.4 Web 側

**`web/src/sdui/specimen.tsx`**
- モジュールスコープ `activeId` / `openId` と `currentGroupId` export を**削除**
- `GroupTabsView`(新規): 表示は現行 `sd-vtabs` 部を移植。選択ハイライトは
  `content.activeGroupId`(サーバ解決値)。クリックで `setSearchParams({ group, open: undefined })`。
  タブ追加/改名/削除のインラインフォームは現行コードをそのまま移設
  (作成成功 → `setSearchParams({ group: created.groupId })`、選択中タブ削除 → `{ group: undefined }`)
- `SpecimenRowsView`(新規): 現行 `sd-rowlist` 部 + `Collapse` を移植。展開は
  `searchParams.open === item.specimenId`、トグルは `{ replace: true }`(D4)。
  詳細は従来どおり `actions?.renderSpecimenDetail?.(id)` 注入
- レガシー `SpecimenListView`: signal をコンポーネント内ローカルへ移して残置(D1)

**`web/src/sdui/renderer.tsx`** — `case "group_tabs"` / `case "specimen_rows"` を追加。

**`web/src/sdui/types.ts`** — 2 union member + `GroupTabItem` を追加。

**`web/src/routes/care.tsx`**

```tsx
const [params] = useSearchParams();
const [view, { refetch }] = createResource(
  () => (isServer ? undefined : (["care", params.group ?? ""] as const)),
  ([key, group]) => fetchPage(key, { group: group || undefined }),
);
```

- `?group=` 変更で自動 refetch(`view.latest` パターンのままなのでちらつき無し)
- `AddSpecimenModal` の既定グループ = `params.group`(無ければ先頭)

### 3.5 migration

**`api/migrations/0018_split_specimen_list.sql`**(0017 適用後: roster.blocks = [title, add, list]):

```sql
-- specimen_list を group_tabs + specimen_rows に置換(Phase 2)。
-- roster-title の editable 等ユーザ編集済みフィールドに触れないよう、対象ブロックのみ操作。
UPDATE page_definitions
SET definition = jsonb_insert(
        jsonb_insert(
            definition #- '{page,content,regions,body,0,blocks,2}',
            '{page,content,regions,body,0,blocks,-1}',
            $json${ "type": "group_tabs", "content": { "key": "roster-tabs" } }$json$::jsonb,
            true),
        '{page,content,regions,body,0,blocks,-1}',
        $json${ "type": "specimen_rows", "content": { "key": "roster-rows" } }$json$::jsonb,
        true),
    updated_at = now(),
    updated_by = 'migration:0018'
WHERE page_key = 'care'
  AND definition #> '{page,content,regions,body,0,key}' = '"roster"'::jsonb
  AND definition #> '{page,content,regions,body,0,blocks,2,type}' = '"specimen_list"'::jsonb;
```

### 3.6 受け入れ基準

- `cargo test` 緑(新ブロックの round-trip / 未知フィールド拒否テスト追加)+ schema 再生成
- `/care?group={id}` 直リンク・リロード・ブラウザ戻るでタブ状態が再現する(URL = 状態)
- タブ追加→新タブがアクティブ / 選択中タブ削除→既定タブへ / 改名が反映
- `?group=` に他人・不存在の UUID → 既定タブで 200(D3)
- 行の展開が `?open=` で往復し、保存後の再fetchでも展開が維持される(従来の
  モジュール signal 対策コメントが不要になる = 負債解消の確認)
- hydrate が選択グループの行しか引かないこと(SQL ログで確認)
- 未ログイン時 401 → care のログイン誘導表示が従来どおり
- **定義変更のみのデモ**: 行リストだけのカード(タブ無し)、タブ帯を別カードへ移す、を
  SQL UPDATE だけで実演(REFACTOR §Phase2 の効果)
- 指標3 記録(想定: api 5 + migration 1 + web 5 ファイル)

---

## 4. Phase 3 — カード内レイアウトの意味トークン(小・半日)

### 4.1 スキーマ(案イ: 閉じたレイアウトトークン)

**`api/src/sdui/def.rs`**

```rust
/// カード内レイアウト(意味トークン)。CSS値は入れない。
/// 未知値はクライアントで stack 扱い(進化規約4)。
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CardLayout {
    Stack,
    /// 最初の「側柱対応ブロック」を側柱、残りを本体として描く
    Sidebar,
}

// Card<B> に additive フィールド(Def/View 共用ジェネリクスなので1箇所で両側に効く):
#[serde(default, skip_serializing_if = "Option::is_none")]
pub layout: Option<CardLayout>,
```

L2 追加は不要(側柱対応ブロックが無い sidebar は stack と同義に落ちるだけ。
「壊れた画面が通る」余地を作らない最小解釈)。テスト: layout round-trip /
未知値 `"grid"` 拒否 / 未指定が出力に乗らない(additive 確認)。

### 4.2 レンダラ・CSS

**`web/src/sdui/renderer.tsx`** — `CardView` を拡張(D6):

```tsx
const SIDEBAR_CAPABLE = new Set(["group_tabs"]);
// layout !== "sidebar" または対応ブロック不在 → 従来どおり縦積み。
// sidebar: [対応ブロックより前 = 全幅の前置行(見出し・action_button)]
//          [最初の対応ブロック = 側柱] [残り = 本体] に分割して描画
<section class="sd-card sd-card--sidebar">
  <div class="sd-card-lead">…前置ブロック…</div>
  <Box class="sd-card-cols">
    <div class="sd-card-side">…側柱ブロック…</div>
    <div class="sd-card-main">…残りブロック…</div>
  </Box>
</section>
```

**`web/src/app.css`** — `.sd-speclist-layout` 相当を汎用化:

```css
.sd-card-cols { display: flex; gap: 14px; align-items: flex-start; }
.sd-card-side { width: 172px; flex-shrink: 0; }
.sd-card-main { flex: 1; min-width: 0; }
@media (…既存モバイル分岐…) { .sd-card-cols { flex-direction: column; } .sd-card-side { width: 100%; } }
```

`.sd-speclist-*` のレイアウト系はレガシー `SpecimenListView` 専用として残す(D1。
レガシー削除時に一緒に消す)。`sd-vtab` / `sd-row` 系はブロック内部の見た目なのでそのまま共用。

**`web/src/sdui/types.ts`** — `Card` に `layout?: string`(未知値 stack 扱い)。

### 4.3 migration

**`api/migrations/0019_roster_sidebar.sql`**:

```sql
-- 飼育一覧カードを sidebar レイアウトに(Phase 3)。
UPDATE page_definitions
SET definition = jsonb_set(definition, '{page,content,regions,body,0,layout}', '"sidebar"'),
    updated_at = now(),
    updated_by = 'migration:0019'
WHERE page_key = 'care'
  AND definition #> '{page,content,regions,body,0,key}' = '"roster"'::jsonb;
```

### 4.4 受け入れ基準 — REFACTOR §4「到達点」との一致

適用後の care roster カードが §4 の抜粋と同構造になる(key 名は D9):

```json
{ "key": "roster", "layout": "sidebar", "blocks": [
  { "type": "text",          "content": { "key": "roster-title", "role": "headline", "text": "飼育一覧", "editable": true } },
  { "type": "action_button", "content": { "key": "roster-add", "intent": "secondary", "label": "＋ 個体を追加", "action": "add_specimen" } },
  { "type": "group_tabs",    "content": { "key": "roster-tabs" } },
  { "type": "specimen_rows", "content": { "key": "roster-rows" } } ] }
```

- PC: タブ左・行リスト右、見出しとボタンが全幅の前置行(現行と同じ見た目に復帰)
- モバイル: 縦積み(既存 media query と同挙動)
- `layout` を `"stack"` に SQL UPDATE → 縦積みに変わる(定義でレイアウトが動く実証)
- 未知 layout 値の PUT が 422 / ビューに未知値が来ても stack で描ける(手動確認)

---

## 5. Phase 4 — フォームの語彙化(スコープ外)

REFACTOR §Phase4 のとおり着手しない。残る固定コードは AddSpecimenModal・記録追加・タブ改名等の
「フォームの中身」のみ。着手判断の材料として、Phase 1〜3 リリース後に
「エージェントがボタン文言・タブ構成・レイアウトを実際に運用したか」(定義の updated_by と
更新履歴)を観測できる状態にしておく。

---

## 6. 横断事項

- **進化規約チェック(全Phase共通のレビュー観点)**: 変更はすべて additive
  (新ブロック型 = 規約2、`Card.layout` = 規約1の Optional+default、未知enumのクライアント
  fallback = 規約4)。既存フィールドの意味変更・削除は無し。schemaVersion は 1 のまま
- **serde 規約適合**: `UiAction` / `CardLayout` は素の文字列 enum(タグ付き union に
  ユニット variant を混ぜない)。`ActionButton` 等は構造体 variant。`flatten` 不使用
- **types.ts は手書き同期**(typeshare 生成は未導入のまま)。各 Phase の Done 条件に
  「types.ts 差分レビュー」を含める。typeshare CLI 導入は独立タスクとして別枠
- **schema/page_definition.schema.json の再生成**を各 Phase の Done 条件に。
  ハーネス(指標1)を回すなら Phase 3 完了後に N=20 再計測が効率的
- **migration 規律**: 適用済み 0001〜0016 は不変。新規は 0017/0018/0019。
  すべて形状ガード付き no-op 安全(定義はユーザ編集され得る実行時データのため)。
  ガードで no-op になった環境では PUT /api/pages/care で同内容を投入して回復
  (`cargo clean -p api` 後の再起動で migration 適用 — README の手順)
- **リリース順序**: 各 Phase 内は「API(スキーマ+hydrate+migration)→ Web」の順で安全
  (新ブロックが先に配信されても未知 type fallback で壊れない)。ロールバックは
  定義を SQL/PUT で旧形へ戻す + コード revert
- **リスク**: (1) 0017 の挿入位置ガードが編集済み定義で no-op → 回復手順上記。
  (2) Phase 2 の resolve_active_group 2回呼びの理論上のずれ → コメントで明記、実害なし。
  (3) Phase 2 単体期間の縦積み表示 → D7 で吸収。
  (4) レガシー specimen_list の選択リセット劣化 → 実利用ゼロのため許容(D1)

---

## 7. 見積り・マイルストーン

| Phase | 内容 | 規模 | 変更ファイル(想定) |
|---|---|---|---|
| 1 | action_button 語彙 | 半日 | api: def/view/mod/hydrate/valid + 0017 / web: types/actions/renderer/specimen/care/css |
| 2 | specimen_list 分割 + URL状態化 | 1〜2日 | api: def/view/mod/hydrate/main/valid + 0018 / web: types/api/renderer/specimen/care |
| 3 | Card.layout トークン | 半日 | api: def/valid + 0019 / web: types/renderer/css |

合計 2〜3日。各 Phase 完了時に: `cargo test` → `dump_schema` → 手動チェックリスト →
指標2 デモ(SQL UPDATE)→ 指標3(ファイル数・所要時間)を記録。

完了時の到達点: 分解図の5部位のうち固定コードに残るのは「フォームの中身」だけ。
見出し・ボタン・タブ帯・行リスト・横並びの有無と並び順は、すべて定義 = エージェントの運用対象。
