---
title: "KOCHŪ UI/UX レビュー — 見た目に絞った版"
description: "UI/UX レビュー — 見た目に絞った版 (デスクトップ 1440x900 / Chrome)。"
sidebar:
  order: 11
---

対象: `http://localhost:5173/` (client_solid / Solid.js)
閲覧条件: デスクトップ 1440×900 相当 (DPR 1)、Chrome、Noto Sans/Serif JP + JetBrains Mono すべてロード済み
レビュー日: 2026-04-23

> 本レビューは **見た目の改善点** (色・余白・タイポグラフィ・整列・装飾・視覚階層) のみを対象にしています。機能的・情報設計的な指摘は既出の `ui-review.md` を参照。

---

## 0. 全体印象 (見た目のみ)

- **カラーパレットは美しい**。oklch で設計された森緑・琥珀・薔薇・藍の 4 アクセントは、落ち着いた紙のような背景 (`oklch(0.985 0.004 80)`) とよく噛み合い、標本ラベル的な質感がある。
- **タイポの系 (Noto Serif JP × JetBrains Mono × Noto Sans JP) は正しい**。学名をセリフ、ID・寸法をモノにする切り分けは、他の EC では見ない情報の格を作っている。
- 一方で **全体的に「軽すぎる / 淡すぎる」**。境界線・影・文字ウェイトが一段階ずつ控えめで、画面全体がふわっとしたグレーに落ち着いてしまい、商品 (特に生体) の存在感が弱い。
- プレースホルダの **斜めストライプ背景がページ主役** になってしまっており、完成品というよりワイヤーフレームに近い印象を与える。

---

## 1. P0 / P1 (見た目のインパクトが大きいもの)

### V1-1. フォーカスリングが全要素で消えている [P0 / S]

- **該当箇所**: 全 `.btn`, `.chip`, `.nav-item`, `.variants button` など。確認結果 `outline: oklch(0.98 0.004 80) none 3px; box-shadow: none`
- **現状**: キーボード操作時にどこに当たっているか**完全に不可視**。マウスでも押下中のフィードバックが弱い。
- **提案**:
  1. `:focus-visible` で 2px の indigo リングを出す。
     ```css
     :where(button, [role="button"], a, input, textarea, select):focus-visible {
       outline: 2px solid var(--accent-indigo);
       outline-offset: 2px;
       border-radius: inherit;
     }
     ```
  2. `:active` も若干 scale(0.98) + 内側シャドウで押下感を出す。
- **優先度**: **P0** (見た目 × a11y の両方に効く)。
- **工数感**: S (30 分)。

---

### V1-2. プレースホルダの斜めストライプが画面を占拠 [P0 / M]

- **該当箇所**: `.ph.forest`, `.ph.amber`, `.hero-feature-ph` — 計 7 箇所。`repeating-linear-gradient(135deg, oklch(...) 0, oklch(...) 1px, transparent 1px 6px)` 相当
- **現状**: 商品画像・Hero ビジュアル・血統カードすべてが斜めストライプで埋まっている。ユーザーは「画像読み込み失敗かな」「まだ準備中かな」と感じる。
- **問題**:
  - 生体 EC は**見た目が商品そのもの**。画像が無い時点で「買いたい」が成立しにくい。
  - forest/amber で色は変わるが、同じストライプパターンなので**ページ全体が単調**に見える。
- **提案**:
  1. **最低でも 1 種は実画像**を入れる (Hero featured と、商品一覧の 3-4 枚だけでも)。実写が難しいなら、生成画像 or イラスト。現状の 100% ストライプよりは何でも良い。
  2. ストライプを残す場合でも、**種類ごとに向き・密度を変える** + 中央に実物の簡易シルエット SVG (ヘラクレス角 / コーカサス角 / 国産ノコギリなど) を半透明で重ねる。これだけで「標本図鑑感」が出る。
     ```css
     .ph.forest {
       background: oklch(0.95 0.02 150)
         url('/img/silhouette-hercules.svg') center/40% no-repeat,
         repeating-linear-gradient(135deg, oklch(0.9 0.03 150) 0 1px, transparent 1px 8px);
     }
     ```
- **優先度**: **P0** (商品性)。
- **工数感**: M (画像集め or SVG 作成)。

---

### V1-3. Hero タイトルの視覚的重量不足 [P1 / S]

- **該当箇所**: `.hero-title` — `font-size: 44px / line-height: 55px / font-weight: 500 / Noto Serif JP`
- **現状**: 「買う、育てる、継ぐ。／ ひとつの場所で。」というブランドコピーが、セリフ 44px weight 500 で表示されていて、**見出しというより本文の太い版**にしか見えない。特に Noto Serif JP の 500 は相当細い。
- **問題**: ランディングで一番大きく載せたい文言なのに、右側の看板カードの方が先に目に入る。
- **提案**:
  1. **font-weight を 700、font-size を 52-56px、letter-spacing を -0.02em**に。`<em>` の「継ぐ。」は変わらずアクセント色 (amber or ink-dark) に。
     ```css
     .hero-title { font-size: clamp(40px, 4.5vw, 56px); line-height: 1.18; font-weight: 700; letter-spacing: -0.02em; }
     .hero-title em { color: var(--accent-amber); font-style: normal; }
     ```
  2. 重くしたくないなら、**代わりに `text-wrap: balance` + サブコピー (hero-lead) を 16px に引き上げて総量で存在感**を作る (今は 14.5px / 25px 行間で散漫)。
- **優先度**: **P1**。
- **工数感**: S。

---

### V1-4. Hero トラストバッジ 11px が小さすぎ + 区切り記号なし [P1 / S]

- **該当箇所**: `.hero-trust li` — `font-size: 11px / color: oklch(0.48 0.01 80) / display:flex; gap:18px`
- **現状**: `累計カルテ 12,480 件  認証ブリーダー 86 名  死着補償 99.2%` が、**18px の空白だけ**で横並びになっている。11px モノ + 薄いグレーで、体感ではほぼ読めない。
- **問題**:
  - 信頼訴求のコピーなのに**最も目立たない場所**に置かれている。
  - 空白のみの区切りは、画面サイズが狭まったとき自然にくっついて読みにくくなる。
- **提案**:
  1. **`font-size: 12px` + mono / 数字部分だけ 13px セリフ**で強調。区切りに `· ` (middle dot) を挿入し、縦線で仕切っても良い。
     ```css
     .hero-trust { gap: 16px; font-size: 12px; }
     .hero-trust li + li { border-left: 1px solid var(--border); padding-left: 16px; }
     .hero-trust b { font-family: var(--font-serif); font-size: 14px; color: var(--ink); margin-right: 4px; }
     ```
     マークアップ側で数値を `<b>` 化する。
  2. あるいは数値を**3 つのミニ KPI カード** (48px 高 / 中央寄せ / amber アイコン付き) に格上げする。
- **優先度**: **P1**。
- **工数感**: S。

---

### V1-5. カード全体が「影なし・境界線もほぼ白」で浮かび上がらない [P1 / S]

- **該当箇所**: `.card` — `background: oklch(1 0 0); border: 1px solid oklch(0.9 0.006 80); border-radius: 10px; box-shadow: none`
- **現状**: 白背景 (`--bg: oklch(0.985 0.004 80)`) に白カードをぼんやりしたグレー 1px で載せているだけで、**カード同士が同じレイヤーに見える**。商品カード、Hero カード、マイページカードすべて同じ質感。
- **問題**:
  - 商品カードのように「触れる / 押せる」要素が、ただのパネルと区別できない。
  - 「注目」「選択中」などの状態も視覚的に弱く見える。
- **提案**:
  1. **極薄シャドウ + hover で持ち上げ**:
     ```css
     .card { box-shadow: 0 1px 2px oklch(0 0 0 / 0.03), 0 1px 0 oklch(0 0 0 / 0.02); transition: box-shadow .15s, transform .15s; }
     .card[role="link"]:hover, a.card:hover { box-shadow: 0 6px 16px oklch(0 0 0 / 0.06); transform: translateY(-1px); }
     ```
  2. あるいは**背景側を一段沈ませる**方針: `--bg: oklch(0.97 0.004 80)` にして、カードは現在の純白を維持。これで境界線無しでもカードが浮く。
- **優先度**: **P1** (視覚階層の根幹)。
- **工数感**: S。

---

### V1-6. chip のサイズ・パディングがバラバラ [P1 / S]

- **該当箇所**: `.chip` 各バリエーション
  - `.chip.ink.mono` → 23px 高 / padding 2px 8px
  - `.chip.amber` / `.chip.forest` → 23px / padding 2px 8px
  - `.chip` (素) → **26px / padding 4px 10px**
- **現状**: 色付き chip と素の chip で**高さが 3px、横パディングが 2px 異なる**。商品カードや詳細画面で並ぶと段差が生まれる。
- **問題**: `注目 / 血統書付 / ヘラクレス系` が 1 行で並んだときにベースラインが揃わない。
- **提案**:
  1. **chip のサイズを 1 本化**し、色 modifier は背景と文字色のみ変える:
     ```css
     .chip { display:inline-flex; align-items:center; gap:4px; height: 24px; padding: 0 10px; font-size: 11px; border-radius: 999px; background: var(--bg-sunken); color: var(--ink-mute); border: 1px solid transparent; }
     .chip.ink    { background: var(--ink); color: var(--bg); }
     .chip.amber  { background: oklch(0.94 0.04 70); color: oklch(0.45 0.1 70); }
     .chip.forest { background: oklch(0.93 0.03 150); color: oklch(0.45 0.08 150); }
     ```
  2. size variant が必要なら `.chip.sm` (20px) を明示して使い分け、default との混在を避ける。
- **優先度**: **P1**。
- **工数感**: S。

---

### V1-7. `🛋` (ソファ絵文字) が蛹のアイコンとして表示 [P1 / S]

- **該当箇所**: 個体カルテ (specimen) 画面の StageBar — `client_solid/src/components/specimen/StageBar.tsx:15`
  実機確認: 画面上に `🛋` が描画されている (emoji スキャン結果にヒット)
- **現状**: ベッド `🛌` の打ち間違いで、ソファのアイコンが「蛹」「前蛹」として表示されている。
- **問題**: 個体カルテはこのアプリの顔。そこに**絵文字の選び間違い**があると、専門サイトの信頼がガクッと落ちる。さらに OS によってソファの絵柄が大きく変わる (Android は座面がはっきりしたソファ)。
- **提案**:
  1. **7 ステージの専用 SVG** を `components/icons/stage/*.svg` として追加 (既存 Icons.tsx と同じ 1.7 px ストローク、currentColor)。卵/幼虫 1-3/前蛹/蛹/成虫。
  2. どうしても絵文字で通したい場合は最低限 `🛌` に直し、**1 色の monochrome font** (例: `font-variant-emoji: text`) を当てる。ただし iOS では効かないので 1 を推奨。
- **優先度**: **P1** (顔の誤字)。
- **工数感**: S (絵文字修正のみ) / M (SVG 一式)。

---

### V1-8. 画像プレースホルダのアスペクトが用途で合っていない [P1 / S]

- **該当箇所**:
  - Hero feature: 522×220 (約 2.37:1, 横長)
  - 商品カード一覧: 446×140 (約 3.19:1, もっと横長)
  - 商品詳細: 755×480 (約 1.57:1, 3:2 相当)
- **現状**: 商品一覧の 3.2:1 は**カブクワの縦長体型 (頭角を含めると縦位)** と合わない。現物写真を入れたときに、標本が小さく見える。
- **提案**:
  1. 商品カード一覧を **aspect-ratio: 4/3** に揃える (幅 446 なら h≈335)。縦長の頭角付き個体に十分なスペースが出る。カード 1 枚の総高は増えるが、グリッドを 4→3 列に寄せて全体のリズムを整える。
  2. Hero feature は **aspect-ratio: 16/9** か 3/2 にし、ひと回り大きくして Hero テキストと**視覚的な重量を同じ**にする (現状は右の方が軽い)。
- **優先度**: **P1**。
- **工数感**: S。

---

### V1-9. 商品カード内のスペックセル幅が 36px しか無い [P1 / S]

- **該当箇所**: 商品カード `.card` (w=448) 内 `DIV [418x34]` > 4 分割の子 `DIV [36x34]`
- **現状**: 「サイズ / 体重 / 累代 / 羽化」のスペック行が 4 等分され、**各セル 36px 幅**。ラベル「サイズ」「体重」はぎりぎり収まるが、値 `CBF3`, `215日` などは縮み込み、視線の滑りが悪い。
- **提案**:
  1. **2 行 × 2 列のグリッド**にし、各セルを約 200px 与える。Sub 情報なので `font-size: 11px / label は ink-faint / 値は mono ink` で統一。
     ```css
     .product-card-specs { display: grid; grid-template-columns: 1fr 1fr; column-gap: 16px; row-gap: 4px; }
     ```
  2. あるいは**横 1 列で `·` (middle dot) 区切り**の inline 表示にする:
     `142mm · 28.4g · CBF2 · 羽化 15日後`
- **優先度**: **P1**。
- **工数感**: S。

---

### V1-10. 本文 14px / input 12-13px の視覚階層が逆転気味 [P1 / S]

- **該当箇所**:
  - `body` → 14px / line-height 21.7px
  - `.topbar .search input` → **12px** (disabled)
  - `Cart` の住所入力 → **13px**
- **現状**: 本文より入力欄の方が小さい。特に検索窓 12px は、本文との対比で**disabled であっても控えめすぎる**。
- **提案**:
  1. **フォームを本文と同等以上にする**:
     ```css
     input, select, textarea { font-size: 14px; line-height: 1.5; }
     /* iOS の自動ズーム対策として 16px 推奨だが、それは ui-review.md の論点。視覚だけなら 14px で十分 */
     ```
  2. 行の呼吸を出すため `padding: 10px 12px` に引き上げ、入力枠の高さを 40px 相当へ。`.btn` の 46px と並んだときに**入力が「本体」に見える**。
- **優先度**: **P1**。
- **工数感**: S。

---

### V1-11. サイドバー nav-item の余白が密 [P1 / S]

- **該当箇所**: `.nav-item` — `padding: 7px 8px / height: 34px / font-size: 13px / gap: 10px`
- **現状**: 9 項目が 34px 行で縦に並び、グループ間の間隔も弱い。全体として**インデントと呼吸**が足りない。
- **問題**:
  - 飼育/運営などグループの視覚的な境目が弱く、「今どのグループ」かが頭に残りにくい。
  - active 状態が暗い塗りつぶし 1 色で、**強すぎる** (下地から浮きすぎる)。
- **提案**:
  1. `padding: 9px 10px` / `font-size: 13.5px` に少し引き上げ、group 間に `margin-top: 14px` + `--nav-title` を `font-size: 10.5px letter-spacing: 0.08em` にして「標本ラベル感」の見出しに。
  2. active 状態を**塗りつぶしから、左に 3px インジケータ + 軽い背景**に変える。
     ```css
     .nav-item { position: relative; border-radius: 6px; }
     .nav-item.active { background: var(--bg-sunken); color: var(--ink); font-weight: 600; }
     .nav-item.active::before { content: ''; position: absolute; left: -6px; top: 6px; bottom: 6px; width: 3px; background: var(--accent-forest); border-radius: 2px; }
     ```
- **優先度**: **P1**。
- **工数感**: S。

---

### V1-12. 血統系図のカードが「世代別の色」で描き分けられていない [P1 / S]

- **該当箇所**: Bloodline ページ。祖先ボタンの `border-color` は 3 種しか出現せず (`ink` 濃 / `amber` / `faint border`)、凡例の **選択個体 / 直接祖先 / その他 / 野生個体** の 4 カテゴリと**個数が合っていない**。
- **現状**: 視覚だけ見ると、どのカードが「野生個体」「直接祖先」かが**色では分からない**。結局ラベル文字を読まないと区別できない。
- **提案**:
  1. **凡例と同じ 4 色** (forest / amber / indigo / rose) を world/generation/selection で使い分ける。例: 野生 → forest 濃い枠、直接祖先 → amber、選択個体 → ink 塗り潰し + 白文字、その他 → neutral。
     ```css
     .pedigree-card[data-kind="wild"]    { border-color: var(--accent-forest); border-left-width: 3px; }
     .pedigree-card[data-kind="direct"]  { border-color: var(--accent-amber);  border-left-width: 3px; }
     .pedigree-card[data-kind="other"]   { border-color: var(--border); }
     .pedigree-card[data-kind="self"]    { background: var(--ink); color: var(--bg); border-color: var(--ink); }
     ```
  2. あるいは**世代 (F0/F1/F2/F3) で段階的にトーンを落としていく**: 濃い → 薄い。`data-generation="0|1|2|3"` でグラデーション。
- **優先度**: **P1** (この画面の花形)。
- **工数感**: S。

---

## 2. P2 中程度 — あると印象がぐっと良くなる

### V2-1. topbar の disabled 検索窓が常時グレーで**完成度を下げる** [P2 / S]
`.search input[disabled]` が `opacity:1, bg: var(--bg-sunken)` で、全画面で中央に居座る。**非表示** か `visibility:hidden` が最短。枠だけ残すなら、`dashed` 枠 1px + 「🔍 Coming soon」に置き換え、視線を奪わない装飾に。

### V2-2. `.btn.primary` と `.btn.ghost` のコントラスト差が強すぎる [P2 / S]
Hero の `生体を探す →` (ink 真っ黒) と `KOCHŪ について` (透明枠 + 透明境界) が並ぶと、**ghost が消えて一人ぼっち**に見える。`ghost` に薄い ink 枠 (`border: 1px solid var(--border-strong)`) を足して "副アクション" らしさを残す。

### V2-3. 価格の通貨記号と単位の組み方 [P2 / S]
`¥48,000` は 38px セリフ、`税込 / 配送料 ¥1,800〜` は 12px で並ぶが、**`¥` のウェイトが数字と同じセリフ 600** なので記号が数字よりやや大きく見える。`¥` を **font-feature-settings "tnum"** の mono にして数字と分離すると、価格らしさが上がる:
```css
.price { font-variant-numeric: tabular-nums; }
.price-yen { font-family: var(--font-mono); font-size: 0.7em; margin-right: 2px; vertical-align: 2px; }
```

### V2-4. Hero 全体の余白が大きく 1 スクロール目に CTA が見えない可能性 [P2 / S]
Hero 742px + page-head 64px = 約 806px 使用。1440×900 では CTA とトラストバッジまでは見えるが、スクロールでも本文 (商品グリッド) まで届きにくい。Hero の `padding-block` を 56→40px に、`hero-promises` を下に寄せる。

### V2-5. emoji が OS 依存で統一感が崩れる [P2 / M]
ログ画面で `⚖ 🍯 👁 ✂ ⛰ 🌱` が混在、specimen で `🛋` が誤表示。**1 色ラインアイコン (Lucide / Phosphor / 自作 SVG) に統一**すると、ブランドの世界観が 1 段上に行く。`Icons.tsx` の現行アイコンと同じストロークで揃える。

### V2-6. `.page-head` の「カテゴリ」ラベルと H1 の視覚階層 [P2 / S]
`.page-head` は `.cat` (小さい薄いテキスト) + `h1` (28px/600) の 2 段だが、`.cat` の letter-spacing・色が薄すぎて**ほぼ消える**。`.cat` を **11px / uppercase / letter-spacing 0.12em / ink-mute** に統一すると、各ページの「所属」が一目で判る。

### V2-7. 日付・ID のモノの字の揃い [P2 / S]
`#DHH-0271`, `08-12`, `142mm` などが画面内にたくさん出る。JetBrains Mono は既に tnum 風だが、明示的に `font-variant-numeric: tabular-nums` を付けておくと**右揃え / 縦一直線**が確実に揃う。特にカートの金額列と Shop の KPI 列で効く。

### V2-8. chip とカードの **border-radius** が不揃い [P2 / S]
`.card` → 10px、`.btn` → 6px、`.chip` → 意匠的には 999px (ピル) だが短い文字列だと**角丸が強すぎて四角に近い**箇所がある。ブランドシェイプとして **.card 12px / .btn 8px / .chip 999px** の 3 段階に固定し、他の radius は中間値を使わない。

### V2-9. Hero promise セクション (`.hero-promise`) が装飾なしでフラット [P2 / S]
padding 0、border 0、bg transparent — **グリッドに置かれただけ**で、3 つのカード感は無い。ナンバリング `01 — 買う` と serif title はあるが、左側に縦罫 or 番号の大きなセリフ数字 (例: `01` を 64px セリフで薄い ink-faint で背景置き) を足すと、ランディングらしい見栄えになる。

### V2-10. Market・Eclosion の同サイズカードが 4-6 個並ぶと単調 [P2 / S]
`grid-cards-2` で 680×200 のカードが並ぶと、**読む手がかりが文字しかない**。バッジ (注目・入札中・まもなく締切) の色をもっと強く、または左ボーダー 3px を`data-state` ごとに切り替えて、同形状の中に多様性を入れる。

### V2-11. Log ページの `tl-day` が 122px 固定で延々と続く [P2 / S]
12 個の 122px ブロックが等間隔で並ぶと、**目が止まる場所がなく**スクロールが機械的。月の境目に `---- 2026-03 ----` のミニラベル、週末は背景を 1 段沈ませる等のリズムを入れると「日記感」が出る。

### V2-12. ボタンのプライマリが全面 ink で、アクセントカラーを使えていない [P2 / S]
`.btn.primary` は ink 真っ黒 (`oklch(0.22)`) で、**せっかく定義した `--accent-forest/amber/indigo` が CTA に一切登場しない**。`カートに追加` や `生体を探す →` のような商取引 CTA だけ `--accent-forest` にすると、色設計がページに活きる。ink 黒は警告や重要な取消ボタンに譲る。

---

## 3. P3 軽微

### V3-1. `.topbar` の透過 (rgba 0.85) がスクロール時に効いていない可能性 [P3 / S]
`background-color: oklch(0.985 0.004 80 / 0.85)` だが `backdrop-filter` が見当たらない (未確認)。スクロール時に下のコンテンツがガラス越しにぼやける効果が無いと、半透明の意味が薄い。`backdrop-filter: blur(10px) saturate(1.1)` を追加。

### V3-2. カードヘッダの `.mono` ID が左、chip が右 の並びに**空白の規則性**がない [P3 / S]
`#DHH-0271` と `血統書付` chip が `justify-content: space-between` 相当で配置されているが、chip の高さ違い (V1-6) で**中央線がズレる**。V1-6 修正と合わせて、`.card-row { align-items: center; }` を確認しておく。

### V3-3. hero-eyebrow の罫線が 10px 幅で存在感が薄い [P3 / S]
`ようこそ KOCHŪ へ` の左に 10px の罫線があるが、画面比率的に**目立たない**。32-40px まで伸ばし、モノ文字と同じく ink-faint から accent-forest に格上げすると、ブランドの入口らしくなる。

### V3-4. 大きな serif 数字 (mypage の `6, 2, 4, 28`) が単独で浮いている [P3 / S]
34px serif の数字があるが、**単位や注記が弱い**。数字を `<data>` 化して右肩に 11px 単位 (`件` `ライン`) を小さく添えると、数字だけの浮き感が消える。

### V3-5. 変更履歴のタイムスタンプが左寄せで本文と重なる [P3 / S]
Bloodline の変更履歴 `11-18 羽化予測登録 by system` のような並びで、**日付が本文と文字幅を共有**している。日付列を **モノ 11px / 固定幅 48px** にすると、視線が一本のガター上を滑る。

### V3-6. Shop の bar chart は色の意味が曖昧 [P3 / S]
棒 3 本が forest 同色で並ぶが、`売上 / 注文数 / 出荷数` のような 3 系列なら色を分ける or 1 系列なら 7 日分すべて同色 + 今日だけアクセント、と使い分けの意図をはっきりさせる。

---

## 4. 視覚サマリー

### すでに美しい部分
- oklch の 4 アクセントと柔らかい紙背景
- セリフ (タイトル) / モノ (ID・寸法) / サンセリフ (本文) の三層構成
- chip の色付け自体 (amber = 血統書、forest = 生体、ink = 注目) は意味とマッチ

### 視覚上の 3 大課題
1. **コントラスト不足**: フォーカスリング非表示・影なしカード・薄い境界線で、**押せる/選べる/浮いている**が視覚だけでは判別できない。
2. **プレースホルダ依存**: 7 箇所の斜めストライプが画面を支配し、商材写真が担うはずの"欲しい"を奪っている。
3. **タイポのウェイト設計**: Hero タイトル 500、トラスト 11px、本文 14px、入力 13px — 大事なもの順に"小さく軽く"なっている箇所が散見される。

### 最短で印象が変わる 5 手 (視覚のみ)

| # | 手 | P | 効果 |
|---|---|---|------|
| 1 | フォーカスリング復活 + カードに極薄シャドウ + hover 持ち上げ (V1-1 / V1-5) | P0 | 画面全体がインタラクティブな立体に見える |
| 2 | プレースホルダに種別シルエット SVG を重ねる (V1-2) | P0 | "商材らしさ" が一気に出る |
| 3 | Hero タイトルを 52-56px / 700 weight に + トラスト 12-13px + 区切り (V1-3 / V1-4) | P1 | ランディングの威厳が戻る |
| 4 | chip サイズを 1 本化 + primary ボタンを forest に + radius 3 段化 (V1-6 / V2-12 / V2-8) | P1 | ページの"同じ呼吸"で読める |
| 5 | StageBar の絵文字を SVG に統一 (V1-7 / V2-5) | P1 | 専門アプリの顔が揃う |

### 一言
現状は **「色は美しいのにコントラストが弱く、タイポのメリハリが惜しい」**。逆に言うと、**影 1 行、フォーカスリング 1 行、Hero タイトル weight 1 段階、primary 色 1 色** を触るだけでも見違える可能性が高い。素地が良いので、装飾ではなく "引き算と 1 段濃く" で仕上げるフェーズだと思います。
