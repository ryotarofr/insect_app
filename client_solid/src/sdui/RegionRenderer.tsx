// RegionRenderer.tsx — Region (= Block[]) のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §5 (Region)
//
// **責務**:
//   1 つの region (Block[]) を受け取り、各 block を BlockRenderer に渡す。
//   region 自体の "見た目" (gap / direction / padding) はテンプレート側 (CSS class)
//   が決めるので、ここは透明な div で囲うだけ。
//
// **空配列の扱い**:
//   blocks が `[]` の region は親側で `<Show when=...>` で出さない選択ができるよう、
//   ここでは「空でも div を必ず出す」設計にしておく。CSS で :empty を消せばよい。

import { For } from "solid-js";
import type { Block } from "./branded";
import { BlockRenderer } from "./BlockRenderer";

/** region の中の block 群を順に描画する。
 *  - `class` / `style` props は親テンプレートが渡す (region ごとのレイアウト用)。
 *  - block の `key` を Solid の rendering key に流し込む。 */
export const RegionRenderer = (props: {
  blocks: Block[];
  class?: string;
  style?: Record<string, string | number>;
}) => {
  return (
    <div class={props.class} style={props.style}>
      <For each={props.blocks}>
        {(block) => <BlockRenderer block={block} />}
      </For>
    </div>
  );
};
