// BloodlineSummary.tsx — 商品詳細ページ inline 血統サマリー (案 A)
//
// 商品詳細 (= /products/:id) の SDUI カードの直下に配置される、客向けの
// 血統「ピンとくる」用ブロック。表示するのは:
//   - 親 2 個体 (父♂ / 母♀) のミニカード
//   - F値 (= 近交係数) のバー + バンドラベル (安全 / 注意 / 濃い)
//   - 世代タグ (CBF2 等)
//   - ブリーダー認証 / 第三者認証バッジ
//   - 血統メモ (= 起源・累代の要約 2-3 行)
//   - 「詳細血統を見る ▸」ボタン → BloodlineLineageModal を開く
//
// 用品 (= 血統 fixture が無い商品) には何も表示しない (Show で吸収)。
//
// **CSS**:
//   `styles/product-bloodline.css` を import 済 (ProductDetail 側で 1 回読む)。

import { createMemo, Show } from "solid-js";
import {
  fBand,
  fBandLabel,
  getProductBloodline,
  type BlAncestor,
} from "./bloodline-fixture";

interface Props {
  productId: string;
  onOpenFull: () => void;
}

const sexGlyph = (sex: BlAncestor["sex"]): string =>
  sex === "m" ? "♂" : "♀";

/** 親個体ミニカード (父 / 母 共通)。 */
const ParentCard = (p: { role: string; ancestor: BlAncestor }) => {
  return (
    <div class="pbl-parent-card" data-wild={p.ancestor.isWild ? "true" : "false"}>
      <div class="pbl-parent-role">
        {p.role}
        <span class="pbl-parent-sex">{sexGlyph(p.ancestor.sex)}</span>
      </div>
      <div class="pbl-parent-name">{p.ancestor.name}</div>
      <div class="pbl-parent-meta">
        <span class="pbl-parent-id">{p.ancestor.id}</span>
        <Show when={!p.ancestor.isWild && p.ancestor.gen}>
          <span class="pbl-parent-gen">{p.ancestor.gen}</span>
        </Show>
        <Show when={p.ancestor.sizeMm != null}>
          <span class="pbl-parent-size">{p.ancestor.sizeMm}mm</span>
        </Show>
      </div>
    </div>
  );
};

export const BloodlineSummary = (props: Props) => {
  const data = createMemo(() => getProductBloodline(props.productId));

  return (
    <Show when={data()}>
      {(d) => {
        const band = () => fBand(d().inbreedingCoef);
        const fPct = () => Math.min(100, Math.round(d().inbreedingCoef / 0.25 * 100));
        return (
          <section class="pbl-summary" aria-label="血統情報">
            <header class="pbl-summary-head">
              <div class="pbl-summary-eyebrow">血統情報</div>
              <button
                type="button"
                class="pbl-summary-cta"
                onClick={props.onOpenFull}
              >
                詳細血統を見る <span aria-hidden="true">▸</span>
              </button>
            </header>

            <div class="pbl-parents">
              <ParentCard role="父" ancestor={d().father} />
              <span class="pbl-cross" aria-hidden="true">×</span>
              <ParentCard role="母" ancestor={d().mother} />
            </div>

            <div class="pbl-meta">
              <div class="pbl-fmeter" data-band={band()}>
                <div class="pbl-fmeter-row">
                  <span class="pbl-fmeter-label">F値 (近交係数)</span>
                  <span class="pbl-fmeter-value">
                    {d().inbreedingCoef.toFixed(2)}
                    <span class="pbl-fmeter-band">{fBandLabel(band())}</span>
                  </span>
                </div>
                <div class="pbl-fmeter-bar">
                  <div class="pbl-fmeter-fill" style={{ width: `${fPct()}%` }} />
                </div>
              </div>

              <div class="pbl-chips">
                <span class="pbl-chip pbl-chip-gen">{d().generation}</span>
                <Show when={d().breederCertified}>
                  <span class="pbl-chip pbl-chip-cert" title="ブリーダー本人による血統書発行済">
                    ✓ ブリーダー認証
                  </span>
                </Show>
                <Show when={d().thirdPartyVerified}>
                  <span class="pbl-chip pbl-chip-3rd" title="第三者血統認証団体による監査済">
                    ✓ 第三者認証
                  </span>
                </Show>
              </div>
            </div>

            <p class="pbl-notes">{d().pedigreeNotes}</p>
          </section>
        );
      }}
    </Show>
  );
};
