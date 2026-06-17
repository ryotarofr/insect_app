// Media.tsx — Block.type === "media" のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §4.4 (Media)
//
// **kind の分岐**:
//   - image / video → src があれば描画。無ければ placeholder と同じ扱い
//   - icon          → icon_name を data-icon に渡す (アイコンセット未配線なので alt fallback)
//   - placeholder   → 既存 .ph クラス (グラデーション + ラベル) で見せる
//
// MVP では image でも 200px 固定高、object-fit: cover の単純表示。
// alt は `<L value={alt} />` で解決し、無ければ空文字 (a11y 上 decorative 扱い)。

import { Show } from "solid-js";
import type { Block } from "../branded";
import { resolveLocalizable } from "../L";

type MediaBlock = Extract<Block, { type: "media" }>;

/** alt は Localizable optional。未指定なら decorative ("") にする。 */
const altText = (block: MediaBlock): string =>
  block.alt ? resolveLocalizable(block.alt) : "";

export const MediaBlockView = (props: { block: MediaBlock }) => {
  const block = () => props.block;
  const hasImage = () => block().kind === "image" && !!block().src;
  const hasVideo = () => block().kind === "video" && !!block().src;
  const isIcon = () => block().kind === "icon";

  return (
    <Show
      when={hasImage()}
      fallback={
        <Show
          when={hasVideo()}
          fallback={
            // icon / placeholder / image-without-src はまとめて .ph に倒す
            <div
              class="ph forest"
              role={isIcon() ? "img" : "presentation"}
              aria-label={altText(block()) || undefined}
              data-icon={isIcon() ? block().iconName : undefined}
              style={{
                width: "100%",
                height: "200px",
                "border-radius": 0,
                border: "none",
                "border-bottom": "1px solid var(--line)",
              }}
            >
              <span class="ph-label">{altText(block()) || "画像なし"}</span>
            </div>
          }
        >
          <video
            src={block().src}
            controls
            style={{
              width: "100%",
              height: "200px",
              "object-fit": "cover",
              "border-bottom": "1px solid var(--line)",
            }}
            aria-label={altText(block()) || undefined}
          />
        </Show>
      }
    >
      <img
        src={block().src}
        alt={altText(block())}
        loading="lazy"
        style={{
          width: "100%",
          height: "200px",
          "object-fit": "cover",
          display: "block",
          "border-bottom": "1px solid var(--line)",
        }}
      />
    </Show>
  );
};
