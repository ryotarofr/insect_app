// ProductDetailCard.tsx — `template === "product_detail"` のレイアウト
//
// 詳細: docs/sdui-three-layer-model-v5.md §5.5 (ProductDetail)
//
// **6 リージョンの並び**:
//   gallery → hero → spec → pricing → promise → cta
//   (画面上は左右 2 カラムで再構成: gallery が左、残りが右で縦積み)
//
// **UX 強化要素**:
//   - Gallery: hero image + thumbnail strip。1 枚目を hero として大きく出し、
//     2 枚目以降を下にサムネ列で並べる。サムネクリックで hero を入れ替え (createSignal)。
//   - Promise: 安心保証の mini card 区画。eyebrow text + caption text 数行 + 末尾 CTA。
//     視覚的に hero/cta とは独立した「保証 card」として描画する。
//   - Watch CTA: cta region に intent=tertiary で並ぶだけ。renderer 側は touch 不要
//     (CtaBlockView が intent ごとのスタイル分岐を持っている)。
//
// **TODO (未対応)**:
//   - Gallery に動画 (Media kind=video) を混在させる
//   - ウォッチ状態の永続化 (現状は href 遷移のみ)
//   - カート追加 → Toast + Undo 連携

import { For, Show, createMemo, createSignal } from "solid-js";
import type { Block, CardBlock } from "../branded";
import { BlockRenderer } from "../BlockRenderer";
import { RegionRenderer } from "../RegionRenderer";

type ProductDetailCardBlock = Extract<CardBlock, { template: "product_detail" }>;
type MediaBlock = Extract<Block, { type: "media" }>;
type BadgeBlock = Extract<Block, { type: "badge" }>;

/**
 * Hero region 専用レイアウト。
 *
 * 親が `flex-direction: column` の flex container だと、`.chip` (= inline-flex) が
 * blockify されて 100% 幅に伸びる (= align-items: stretch のデフォルト挙動)。
 * 結果、badge が「横幅いっぱいの色帯」になり価格/CTA より視覚重みが勝ってしまう。
 *
 * 対策: badge 系 block を非 badge 系と分離し、badges だけ
 * `display: flex; flex-wrap: wrap` の inline 行で並べる。非 badge は従来通り column。
 *
 * テスト fixture (= ProductDetailCard.test.tsx) では badge は hero の末尾に並ぶため
 * 「非 badge を先に → badges を後に」で順序が崩れない。 */
const ProductHero = (props: { blocks: Block[] }) => {
  const split = createMemo(() => {
    const nonBadges: Block[] = [];
    const badges: BadgeBlock[] = [];
    for (const b of props.blocks) {
      if (b.type === "badge") badges.push(b);
      else nonBadges.push(b);
    }
    return { nonBadges, badges };
  });
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
      <For each={split().nonBadges}>
        {(block) => <BlockRenderer block={block} />}
      </For>
      <Show when={split().badges.length > 0}>
        <div
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            gap: "6px",
            "margin-top": "4px",
          }}
        >
          <For each={split().badges}>
            {(block) => <BlockRenderer block={block} />}
          </For>
        </div>
      </Show>
    </div>
  );
};

/**
 * Gallery sub-component — hero + thumbnail strip。
 *
 * **方針**:
 *   gallery region の Block[] のうち `type === "media"` を抽出して扱う。
 *   将来 video kind が増えた時、ここで kind 別に扱いを分けられる入口として
 *   `mediaBlocks` を一本通しておく。
 *
 * **createMemo を使う理由**:
 *   filter は毎呼び出しで新配列を返すため、`<For each={mediaBlocks()}>` に
 *   直接渡すと参照が毎回変わって全項目を再生成する。memo で参照同一性を保つ。
 */
const ProductGallery = (props: { blocks: Block[] }) => {
  const mediaBlocks = createMemo<MediaBlock[]>(() =>
    props.blocks.filter((b): b is MediaBlock => b.type === "media"),
  );
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const heroMedia = createMemo(() => mediaBlocks()[selectedIdx()] ?? mediaBlocks()[0]);

  return (
    <div data-region="gallery">
      <Show when={heroMedia()}>
        <div data-gallery-hero>
          {/* Show の when は truthy 判定だけで narrowing は手動。
              heroMedia() は memo なので 2 回呼んでも同じ値。 */}
          <BlockRenderer block={heroMedia() as MediaBlock} />
        </div>
      </Show>

      <Show when={mediaBlocks().length > 1}>
        <div
          data-gallery-thumbs
          aria-label="商品画像のサムネイル"
          role="tablist"
          style={{
            display: "flex",
            gap: "8px",
            "margin-top": "12px",
            "flex-wrap": "wrap",
          }}
        >
          <For each={mediaBlocks()}>
            {(media, i) => {
              const active = () => selectedIdx() === i();
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active()}
                  aria-label={`画像 ${i() + 1} を表示`}
                  data-thumb-idx={i()}
                  data-thumb-active={active() ? "true" : "false"}
                  onClick={() => setSelectedIdx(i())}
                  style={{
                    width: "84px",
                    height: "63px",
                    padding: 0,
                    border: active()
                      ? "2px solid var(--ink)"
                      : "1px solid var(--line)",
                    background: "transparent",
                    cursor: "pointer",
                    overflow: "hidden",
                    "border-radius": "4px",
                  }}
                >
                  <BlockRenderer block={media} />
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

/**
 * Promise sub-section — 安心保証 mini card。
 *
 * **設計**:
 *   region 内の text/cta を素直に流すだけ。card style box でラップして「保証」と
 *   分かる視覚的グルーピングを作る。
 *   横並びレイアウト (`flex-wrap`) で「✓ 死着補償」「✓ 温度制御便」… を一行に並べ、
 *   末尾に「詳細を見る →」CTA が右寄せで来る (CTA は flex item として伸びる)。
 *
 * **`<aside>` を使う理由**:
 *   主役 (購入導線 = cta region) に対して補足情報なので、セマンティックには aside。
 *   SR (スクリーンリーダ) は landmark として扱える。
 */
const ProductPromise = (props: { blocks: Block[] }) => {
  return (
    <aside
      data-region="promise"
      class="card"
      aria-label="安心保証"
      style={{
        padding: "16px",
        background: "var(--bg-sunken)",
        "border-color": "transparent",
        "border-radius": "var(--r-md, 8px)",
      }}
    >
      <RegionRenderer
        blocks={props.blocks}
        style={{
          display: "flex",
          "flex-wrap": "wrap",
          "align-items": "center",
          gap: "12px",
        }}
      />
    </aside>
  );
};

export const ProductDetailCard = (props: { card: ProductDetailCardBlock }) => {
  const regions = () => props.card.regions;

  return (
    <article
      data-template="product_detail"
      data-variant={props.card.variant ?? "default"}
      data-card-id={props.card.id}
      style={{
        display: "grid",
        // 既存の `.grid-detail` (480px + 1fr) と整合する 2 カラム。
        // 画面幅が狭い時は 1 カラムに畳む (= grid-template-columns に minmax を使う)。
        "grid-template-columns": "minmax(0, 480px) minmax(0, 1fr)",
        gap: "32px",
      }}
    >
      {/* ── 左カラム: gallery (hero + thumbs) ─────────── */}
      <div>
        <Show when={regions().gallery.length > 0}>
          <ProductGallery blocks={regions().gallery} />
        </Show>
      </div>

      {/* ── 右カラム: hero / pricing / cta / promise / spec を縦に積む ── */}
      <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
        <Show when={regions().hero.length > 0}>
          <ProductHero blocks={regions().hero} />
        </Show>

        <Show when={regions().pricing.length > 0}>
          <RegionRenderer
            blocks={regions().pricing}
            style={{ display: "flex", "flex-direction": "column", gap: "4px" }}
          />
        </Show>

        <Show when={regions().cta.length > 0}>
          <RegionRenderer
            blocks={regions().cta}
            style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}
          />
        </Show>

        {/* promise は購入導線の **直後** に配置。
            「カート追加 → 保証で背中を押す → 個体詳細でディテール確認」の動線。 */}
        <Show when={regions().promise.length > 0}>
          <ProductPromise blocks={regions().promise} />
        </Show>

        <Show when={regions().spec.length > 0}>
          <div>
            <div class="sec-head">
              <span class="num">§</span>
              <h2>個体詳細</h2>
            </div>
            <RegionRenderer blocks={regions().spec} />
          </div>
        </Show>
      </div>
    </article>
  );
};
