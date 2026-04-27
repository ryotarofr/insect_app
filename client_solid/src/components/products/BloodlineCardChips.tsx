// BloodlineCardChips.tsx — 商品一覧カードに重ねる血統バッジ (案 Phase 2)
//
// 商品一覧 (= /products) のグリッドで、各カードの右下に小さく
// 「世代 / F値 / 認証」を示すバッジを重ねる。狙い:
//   - 血統情報がある生体カードを一覧の段階で識別できる
//   - F値が「濃い (= 近交)」個体を購入前に視覚的に区別できる
//   - クリック自体はカードに到達させたいので pointer-events: none
//
// 用品 (= 血統 fixture が無い商品) には何も描画しない (Show で吸収)。
//
// **CSS**:
//   `styles/product-bloodline.css` の `.pbl-card-chips` 系セレクタ参照。
//   ProductsList 側で 1 度 import されている。

import { createMemo, Show } from "solid-js";
import { fBand, fBandLabel, getProductBloodline } from "./bloodline-fixture";

interface Props {
  productId: string;
}

export const BloodlineCardChips = (props: Props) => {
  const data = createMemo(() => getProductBloodline(props.productId));

  return (
    <Show when={data()}>
      {(d) => {
        const band = () => fBand(d().inbreedingCoef);
        return (
          <div
            class="pbl-card-chips"
            data-band={band()}
            aria-hidden="true"
            // タイトルでバッジの意味を補足 (= マウスホバーで読める)
            title={
              `${d().generation} · F値 ${d().inbreedingCoef.toFixed(2)} (${fBandLabel(band())})` +
              (d().breederCertified ? " · ブリーダー認証" : "") +
              (d().thirdPartyVerified ? " · 第三者認証" : "")
            }
          >
            {/* 世代 (= "CBF2" / "WF1" 等) */}
            <span class="pbl-card-chip pbl-card-chip--gen">{d().generation}</span>
            {/* F値 (= バンドに応じて色) */}
            <span class="pbl-card-chip pbl-card-chip--f">
              <span class="pbl-card-chip-dot" aria-hidden="true" />
              <span class="pbl-card-chip-flabel">F</span>
              <span class="pbl-card-chip-fval">{d().inbreedingCoef.toFixed(2)}</span>
            </span>
            {/* 認証バッジ (= ブリーダー認証 + 第三者認証 が揃ってる時だけ強調) */}
            <Show when={d().breederCertified}>
              <span class="pbl-card-chip pbl-card-chip--cert" title="ブリーダー認証">
                ✓
              </span>
            </Show>
          </div>
        );
      }}
    </Show>
  );
};
