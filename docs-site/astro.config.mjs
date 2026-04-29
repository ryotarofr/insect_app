// astro.config.mjs — Astro Starlight 設定
//
// **GitHub Pages デプロイ前のチェックリスト**:
//   1. `site` を実際の GitHub Pages URL (= https://<user>.github.io) に書き換える
//   2. `base` を repo 名と一致させる (= "/insect_app")。subpath 配信される
//   3. ローカル検証は `npm run dev` ではなく `npm run build && npm run preview` で
//      本番相当パス (= /insect_app/) の動作確認を行う (= asset 404 を早期発見)
//
// **GitHub Pages 以外で配信する場合 (例: 独自ドメイン / Vercel)**:
//   - `base` を "/" に戻す
//   - `site` を独自ドメインに置換する

import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";

export default defineConfig({
  // ── GitHub Pages 配信先 ────────────────────────────────────────
  // ⚠ 仮値。実際の repo owner に合わせて差し替えてください。
  site: "https://ryory.github.io",
  // ⚠ repo 名と必ず一致させること (= subpath 配信される)。
  base: "/insect_app",

  output: "static",

  integrations: [
    // Mermaid 統合は Starlight の前に置く必要あり (= remark/rehype の処理順)。
    // ```mermaid フェンスをクライアント側で SVG にレンダリングする。
    // autoTheme=true で Starlight の light/dark 切替に追従。
    mermaid({
      theme: "default",
      autoTheme: true,
    }),
    starlight({
      title: "昆虫EC × 飼育管理 — 設計ドキュメント",
      description:
        "SDUI 三層モデル v6 を中核とした、Rust + Solid.js プラットフォーム (insect_app) の内部設計資料。",

      // 既定のロケール = 日本語。i18n を増やす場合は locales を拡張する。
      defaultLocale: "ja",
      locales: {
        ja: { label: "日本語", lang: "ja" },
      },

      // 右上の社外リンク。GitHub repo URL に書き換えてください。
      social: {
        github: "https://github.com/ryory/insect_app",
      },

      // サイドバー: section ごとに directory を autogenerate する。
      // 新しいページを `src/content/docs/<section>/<page>.mdx` に置けば自動で出る。
      sidebar: [
        {
          label: "はじめに",
          // `link: "/"` は Starlight が base を自動で前置する (= "/insect_app/")。
          // index.mdx は template: splash なので、サイドバーから戻れるエントリだけ用意する。
          items: [{ label: "このサイトについて", link: "/" }],
        },
        {
          label: "アーキテクチャ",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "計画 / ロードマップ",
          autogenerate: { directory: "planning" },
        },
        {
          label: "運用",
          autogenerate: { directory: "operations" },
        },
        {
          label: "レビュー記録",
          autogenerate: { directory: "reviews" },
        },
        {
          label: "履歴 (legacy)",
          // collapsed: true で初期は畳んでおく。読者が間違って v5 を引かないようノイズを下げる。
          collapsed: true,
          autogenerate: { directory: "legacy" },
        },
      ],

      // フッター末尾のリンク等を入れたければここに足す。
      // editLink: { baseUrl: "https://github.com/ryory/insect_app/edit/main/docs-site/" },

      // Starlight 既定の dark/light テーマで運用。
      // カスタム CSS が必要になったら customCss: ["./src/styles/custom.css"] を追加。
    }),
  ],
});
