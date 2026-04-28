# docs-site — `insect_app` 設計ドキュメントサイト

Astro Starlight + MDX でビルドする静的ドキュメントサイトです。本リポジトリのコードベースと
**同じリポジトリのサブディレクトリ**として管理し、`main` への push で GitHub Actions が
自動的に GitHub Pages へデプロイします。

## ディレクトリ構成

```
docs-site/
├── astro.config.mjs            # base / site / sidebar の設定はここ
├── package.json
├── tsconfig.json
├── public/
│   └── favicon.svg
└── src/
    ├── content.config.ts        # Starlight コレクションの宣言
    ├── components/              # 図 (.astro)。MDX から import して使う
    │   ├── BrandFlowDiagram.astro
    │   └── RuntimeFlowDiagram.astro
    └── content/
        └── docs/
            ├── index.mdx                     # トップ (template: splash)
            ├── architecture/
            │   ├── sdui-overview.mdx
            │   └── brand-types.mdx           # 図入りページの参照実装
            └── reviews/
                └── 2026-04-deny-unknown-fields.mdx
```

新しいページは `src/content/docs/<section>/<page>.mdx` に置くだけでサイドバーに出ます
(= `astro.config.mjs` の `autogenerate` 指定による)。

## ローカル開発

```bash
cd docs-site
bun install
bun run dev          # http://localhost:4321/insect_app/
```

`base: "/insect_app"` を設定しているため、ローカルでも **必ず `/insect_app/` 配下** で
アクセスしてください。Astro 5 系の dev server は `base` を尊重するので、`/` にアクセス
すると 404 になります。

## 本番ビルドの確認

GitHub Pages の subpath (= `/insect_app/`) で正しく動くかは、必ず本番ビルドで検証します。

```bash
bun run build
bun run preview      # http://localhost:4321/insect_app/
```

**先に必ず本番ビルドで検証してください**。`dev` だけで動作確認すると、CSS / 画像の参照
パスが本番で 404 になる事故 (= base 周りの設定ミス) を発見できません。

## デプロイ (GitHub Pages)

`.github/workflows/docs.yml` が以下のトリガーで動きます:

- `main` ブランチへの push (= `docs-site/**` が変更されたとき限定)
- `workflow_dispatch` (= 手動)

リポジトリの **Settings → Pages** で `Source: GitHub Actions` に切り替えれば自動デプロイ
されます。`gh-pages` ブランチを手動管理する必要はありません (= モダンな Pages 配信)。

## 図を追加する手順

1. `src/components/<Name>.astro` に SVG を書く (= `BrandFlowDiagram.astro` を参考)
2. MDX ページの先頭で `import` する
3. JSX として埋め込む

```mdx
import MyDiagram from "../../../components/MyDiagram.astro";

<MyDiagram />
```

色は **CSS 変数に頼らず明示色 (`#15803d` / `#fef9c3` / `#0f172a` 等)** で書くのが推奨です。
Starlight の light / dark どちらのテーマでも視認できるよう、コントラストは自前で担保します。

## 設定を書き換える前に

`astro.config.mjs` の冒頭コメントを必ず読んでください。とくに次の 2 点はミスると
本番で全 asset が 404 になります:

- `site: "https://<user>.github.io"` を実際の repo owner に合わせる
- `base: "/insect_app"` を repo 名と一致させる
