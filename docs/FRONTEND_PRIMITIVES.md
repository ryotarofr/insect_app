# フロント primitive 化の実現性検討 — 「Box の組合せでカードを作る」と kuma-ui 思想

「最低限の `<Box />` 等のコンポーネントを組み合わせて動的にカードを作る」が、
現状の実装(SolidStart + 手書き app.css)を前提に実現可能かの検討。
参照実装として挙がった [kuma-ui](https://www.kuma-ui.com/) の思想との噛み合わせを含む。

**結論(先出し)**: 実現可能。ただし論点は2層に分けないと REFACTOR.md で棄却した案ロが
復活してしまう。kuma-ui そのものは React 専用のため SolidStart では使えないが、
同じ書き味は (1) 自作の「閉じたprops」primitive(推奨・1〜2日)、
(2) Panda CSS(Solid 公式対応・zero-runtime)のどちらでも成立する。
現状の app.css 101クラスのうち約4割は primitive に吸収でき、
ブロック実装は「Box/Card の外の世界」から primitive 合成の世界へ戻せる。

---

## 0. 問いの分解 — どの層の話か

「Box の組合せで動的にカードを作る」には2つの解釈があり、結論が真逆になる:

| 層 | 意味 | 判定 |
|---|---|---|
| **定義(DB)層** | `box { direction, gap, children }` を DefBlock 語彙に入れ、エージェントが Box 木を書く | **不採用のまま**(REFACTOR §3 案ロ。検証爆発・カード非再帰の不変条件破壊・原則4違反) |
| **コード(レンダラ実装)層** | ブロックの中身を専用CSSでなく、最小 primitive(Box/Stack/Text…)の合成で書く | **今回の検討対象。実現可能で、やる価値がある** |

kuma-ui が「近い」のはコード層の話。kuma-ui は *開発者が書くコード* の styling を
utility props に寄せるライブラリであって、スタイルを *データとして実行時に受け取る*
仕組みではない。つまり kuma-ui 思想の導入は定義スキーマに一切触れない
(触れさせないことが導入の条件でもある — §4 のガード)。

現在地の確認: PLAN.md の理想「コンテナは **Box(レイアウト)と Card(面)の
2 primitive のみ**、Block はその葉」は、カード/リージョン骨格
(renderer.tsx の `Box` / `CardView` / Phase 3 の sidebar 分割)では実現済み。
未達なのは**ブロックの内部**で、タブ・行・フォーム・モーダルは `sd-*` 専用CSS
(998行・101クラス)で組まれている。REFACTOR §1 の「タブ・行・ボタンのレイアウトは
`sd-speclist-*` 専用CSSで、Box/Card の外の世界」の残りがここ。

## 1. kuma-ui の実像と、この設計との噛み合わせ

調査結果(2026-07 時点):

- **何者か**: "Headless & Zero Runtime UI Component Library"。ビルド時にCSSを静的抽出し
  (動的な値はランタイムへフォールバックするハイブリッド)、`<Box p={4} bg="...">` の
  utility props と Box/Flex/HStack/VStack/Text/Button 等の primitive を提供する
- **対応FW**: **React 専用**(Next.js / RSC / next-plugin が一級市民。Vite 対応も React 前提)。
  Vue/Solid/Svelte 対応は無い → **SolidStart の本プロジェクトには直接導入不可**
- **状況**: 活発(最終リリース 2026-05、1.9k stars)

思想の対応関係を整理すると、合う部分と、**そのまま持ち込むと危険な部分**がある:

| kuma-ui | 本プロジェクト | 噛み合わせ |
|---|---|---|
| 最小 primitive の合成でUIを組む | Box/Card 2 primitive 原則 | ◎ 完全に一致(未達部分を埋める指針になる) |
| zero-runtime(ビルド時抽出) | 手書き静的CSS | ◎ もともとゼロランタイム。書き味だけが問題 |
| headless(見た目は利用者が付与) | ブロック=意味、見た目はCSS | ◎ |
| **utility props が開いた語彙**(`p={4}`, 任意のCSS値) | **原則4: 語彙にCSS値を入れない** | **△ ここだけ衝突**。ただし原則4は定義層の規則。コード層でどこまで閉じるかは選択(§3) |

## 2. 現状の棚卸し — 何が primitive に置き換わるか

app.css 全101クラスを実測分類した:

| 分類 | クラス数 | 例 | primitive 化 |
|---|---|---|---|
| A. 骨格 primitive(実装済み) | 9 | `sd-box` `sd-card(--half/--accent)` `sd-region` `sd-card-cols/side/main` | 済 — Box/Card の props に整理し直すだけ |
| B. 汎用レイアウト | 12 | `sd-form(-row/-grid2/-grid3)` `sd-actionrow` `sd-textwrap` `sd-chips` `sd-speclist*` | **◎ Box/Stack/Row/Grid の props で全滅させられる**(actionrow = `<Row justify="end">` 等) |
| C. 意味部品 | 19 | `sd-btn(--primary/--ghost/--danger)` `sd-cta` `sd-text(--headline/--lead/--caption)` `sd-chip` `sd-field` `sd-status` | **◎ variant 付き primitive(Button/Text/Chip/Field)へ**。variant = 閉じた enum で、SDUI トークンと同型 |
| D. ブロック固有の見た目 | 49 | `sd-vtab*`(タブ) `sd-row*`(行) `sd-collapse`(開閉アニメ) `sd-modal*` `sd-lhero*` `sd-listing-*` `sd-logrow*` `sd-profile*` | **△ 意図的に残す**。ただし内部の「並べ方」だけは primitive を使える(例: `sd-profile-head` → `<Row gap="sm">`) |
| shell / auth / fallback | 13 | `shell__*` | 対象外(固定シェル = コード管理領域) |

つまり **A+B+C = 40クラス(全体の約4割)+ Dの内部レイアウト**が primitive 系に
吸収でき、app.css は体感で半分近く縮む。逆に D の装飾(タブの見た目、行のホバー、
モーダル、開閉アニメ)を Box 原子まで分解するのは、REFACTOR §6 が語彙側で出した結論
「原子まで分解すると逆に運用できない」のコード層版で、**やらないのが正しい**。
タブや行は「それ自体が意味を持つ semantic component」として残す。

## 3. 実装手段の比較(SolidStart で成立するもの)

| 案 | 概要 | 思想適合 | 導入コスト | リスク |
|---|---|---|---|---|
| **案1: 自作 closed-prop primitive**(推奨) | `Box/Stack/Row/Grid/Text/Button/Chip/Field` を自前実装(~150行)+ トークンCSS(~60行)。props は閉じた語彙(`gap="sm"` 等)のみ | ◎ 原則4をコード層まで貫ける | 小(1〜2日、依存ゼロ) | 自前メンテ(ただし閉じた語彙なので面積は小さい) |
| **案2: Panda CSS** | zero-runtime CSS-in-JS。**Solid 公式対応**(postcss + codegen)。`jsxFramework: 'solid'` で `styled.div` + Stack/Flex 等の patterns、**recipes(variants)** | ◎ 特に **recipe の variants は SDUI の閉じた enum と1:1**(`card({ size, tone, layout })`) | 中(ツールチェーン追加・生成物管理・学習) | 静的抽出の制約(下記) |
| 案3: Macaron | vanilla-extract 系 zero-runtime、Solid 対応、Stitches 風 variants | ○ | 小〜中 | **最終リリース 2024-10** で1年半更新なし。POC でも採用しづらい |
| 案4: kuma-ui を直接 | — | — | **不可**(React 専用)。使うならフロントの React 移植が前提で、SDUI のビュー契約(JSON)上は将来可能だが、今やる理由がない | — |

案2の静的抽出制約について1点だけ注意: Panda は「ビルド時に見えない任意値」を
スタイルにできない。ただし本プロジェクトのスタイル入力は**サーバ由来でも閉じたトークン**
(`size: "half"` 等)であり、recipe が全 variant のCSSを事前生成 → 実行時は
variant 名を選ぶだけ、という形で完全に整合する。むしろ「サーバが px を返す」ような
将来の逸脱をビルドが物理的に拒否する防波堤になる。これは偶然ではなく、
閉じた語彙 × 静的抽出は同じ思想の両面(書けるものを先に固定する)だから。

**推奨は二段構え**: まず案1(自作)で書き味と語彙を確立する。POC の規模
(ブロック十数個)に対して Panda のツールチェーンは重く、また props 語彙さえ
固まっていれば、将来スケールした時点で案2へ乗り換える移行面は小さい
(`<Row gap="sm">` → `<HStack gap="2">` の機械的置換に近い)。

## 4. 推奨設計 — 「閉じた props」の Box(kuma-ui の書き味 × 本設計の規律)

kuma-ui と唯一違えるべき点: props を**開かない**。`p={17}` や `bg="#ff0000"` は
コード層でも書けない設計にする。理由は (1) トークン→描画の対応が保たれ、
見た目の一貫性がレビュー不要で担保される、(2) 将来「この並びを定義語彙に昇格させたい」
(Phase 3 の `sidebar` のような意味トークン追加)となったとき、
**primitive の props がそのまま昇格候補の在庫**になるため。

```tsx
// web/src/sdui/primitives.tsx(新規・案1のスケッチ)
// コンテナは Box(とその別名 Stack/Row)のみ — 「Box と Card の2 primitive」原則は不変。
// props は閉じたトークン。任意の CSS 値は型レベルで書けない(原則4のコード層版)。
import { splitProps, type JSX } from "solid-js";

type Space = "none" | "xs" | "sm" | "md" | "lg";          // → --sp-* にマップ
type Justify = "start" | "center" | "end" | "between";
type Align = "start" | "center" | "end" | "stretch";

export interface BoxProps extends JSX.HTMLAttributes<HTMLDivElement> {
  direction?: "col" | "row";
  gap?: Space;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
}

export function Box(props: BoxProps) {
  const [t, rest] = splitProps(props, ["direction", "gap", "align", "justify", "wrap", "class"]);
  return (
    <div
      {...rest}
      class={`ui ${t.class ?? ""}`}
      classList={{
        "ui--row": t.direction === "row",
        [`ui-gap--${t.gap ?? "none"}`]: true,
        [`ui-align--${t.align ?? "stretch"}`]: true,
        [`ui-just--${t.justify ?? "start"}`]: true,
        "ui--wrap": t.wrap === true,
      }}
    />
  );
}
export const Stack = (p: BoxProps) => <Box direction="col" {...p} />;
export const Row = (p: BoxProps) => <Box direction="row" align="center" {...p} />;
// Text(role variants)/ Button(intent variants)/ Chip / Field も同型の
// 「閉じた variant → クラス」写像として実装する(各 ~20行)
```

対応する CSS はトークンの直積ぶんだけの静的クラス(~60行)で、ビルド機構は不要
= 構造的に zero-runtime。SSR(SolidStart)でもそのまま動く。

### Before / After(実物の例)

Phase 1 で入れた action_button の行。専用クラスが consumable な語彙に変わる:

```tsx
// Before(renderer.tsx + app.css の .sd-actionrow 5行)
<div class="sd-actionrow">
  <button class="sd-btn" classList={{ "sd-btn--primary": intent === "primary" }} …>

// After(専用CSSゼロ)
<Row justify="end">
  <Button intent={intent} …>
```

CareLogListView の追加フォーム(`sd-form` + `sd-form-grid3` + `sd-form-row`):

```tsx
// After: フォームの「並べ方」が全部 primitive に(見た目の input 装飾は Field が持つ)
<Stack gap="sm">
  <Grid cols={3} gap="sm">…3つの入力…</Grid>
  <Row gap="sm">…保存/キャンセル…</Row>
</Stack>
```

GroupTabsView / SpecimenRowsView は、タブ1枚・行1本の**見た目**(`sd-vtab` / `sd-row`)は
semantic のまま残し、`sd-vtabs`(縦積み gap 4px)や `sd-profile-head` のような
**並べ方だけ** `<Stack gap="xs">` / `<Row gap="sm">` に置換する — ここが§2の線引き。

### SDUI との接続(この改修が本筋に効く理由)

Phase 3 の `sidebar` は「意味トークン(定義)→ レンダラ内部のレイアウト実装」の
1マッピングだった。primitive 層が整うと、このマッピング先が「専用CSSを書く」から
「`<Row align="start">` を組む」に変わり、**次の意味トークン追加(例: `toolbar` /
`grid` / 将来の `size_compact`)が primitive の組合せ1つで済む** = 指標3
(新語彙のリードタイム)が直接縮む。定義語彙は薄いまま、実装だけが速くなる。

## 5. 移行計画(実施する場合)

- **Step 1(半日)**: `primitives.tsx` + トークンCSS を追加。新規コードから使用開始
  (既存 `sd-*` と共存可能。ビルド変更なし・依存追加なし)
- **Step 2(半日〜1日)**: 分類 B の12クラスと C の19クラスを吸収
  (フォーム系 → Stack/Grid/Row、sd-btn/sd-text 系 → Button/Text variants)。
  app.css から対応クラスを削除。renderer/specimen/listing の該当箇所を置換
- **Step 3(任意・漸進)**: D の内部レイアウトを都度 primitive へ(装飾は残す)。
  レガシー `SpecimenListView` は触らない(削除予定の負債に投資しない)
- **Step 4(将来・任意)**: 画面数がスケールしたら Panda CSS(案2)へ。
  props 語彙が確立済みなら移行は機械的

検証は各 Step で tsc + 目視(スクリーンショット比較)。トークン対応表
(`gap: 12px → md` 等)を先に固定してから始めると差分レビューが楽になる。

## 6. リスクと注意点

- **Solid 固有**: props スプレッドで reactivity を壊さないよう `splitProps` を使う
  (上のスケッチは対応済み)。`class` と `classList` の合成順にも注意
- **やり過ぎ防止**: モーダル・Collapse(開閉アニメ)・タブ/行の装飾・レスポンシブ分岐は
  primitive 化の対象外。メディアクエリと `prefers-reduced-motion` は CSS 側に残す
- **定義層への漏れ出し禁止**(最重要ガード): primitive の props はレンダラの内部命令セット。
  DefBlock / Card に `direction` や `gap` を生やさない。定義に出してよいのは
  `sidebar` のような**意味**トークンだけ — これを破ると案ロの再発明になる
- kuma-ui 本体をどうしても使いたい場合はフロントの React 化が前提。SDUI の
  ビュー契約(JSON)のおかげでクライアント差し替え自体は設計上可能だが、
  レンダラ+ブロック(~2,000行)の書き直しに見合う理由が現状ない

## 7. 決めること

1. Step 1〜2(自作 closed-prop primitive の導入と B/C 吸収)を実施するか
2. props 語彙の初期セット(`Space = xs/sm/md/lg` の刻み、`Grid cols` の上限等)
3. Step 3(Dの内部レイアウト)をどこまでやるか — 推奨は「触るファイルのついでに」の漸進
