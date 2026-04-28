// content.config.ts — Astro Content Collections の宣言
//
// Starlight が要求する `docs` コレクションを最小構成で登録する。
// schema は Starlight 既定 (= title / description / template / sidebar 等) のまま。
// frontmatter の独自フィールドを増やしたい時は extend で拡張する:
//
//   import { z } from "astro:content";
//   schema: docsSchema({
//     extend: z.object({
//       reviewedBy: z.string().optional(),
//     }),
//   }),

import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema(),
  }),
};
