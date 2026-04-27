// BloodlineLineageModal.tsx — 商品詳細から開く 3 世代血統ツリーのモーダル (案 C)
//
// /bloodline (= 自分が育てている個体の編集マップ) と違い、こちらは
// **viewer-only / read-only** の購入動線専用ビュー。
//   - 編集機能なし
//   - 3 世代固定 (= 祖父母 4 + 父母 2 + 当該個体 1)
//   - クリックでノード展開しない (= シンプルに眺めるだけ)
//   - F値 + 認証 + メモ + ブリーダー一言コメントを下部に
//
// 親側の系図が無い (= WILD 起点) の場合は祖父母列を「不明」として描画する。
//
// **CSS**:
//   `styles/product-bloodline.css` の `.pbl-modal-*` セレクタ参照。

import { createMemo, onCleanup, onMount, Show } from "solid-js";
import { listProducts } from "../../api";
import { getProductBloodline, fBand, fBandLabel, type BlAncestor } from "./bloodline-fixture";

interface Props {
  open: boolean;
  productId: string;
  onClose: () => void;
}

const sexGlyph = (sex: BlAncestor["sex"]): string =>
  sex === "m" ? "♂" : "♀";

/** ツリーノードの表示。WILD は破線で識別。 */
const TreeNode = (p: { ancestor?: BlAncestor; placeholder?: string }) => {
  return (
    <Show
      when={p.ancestor}
      fallback={
        <div class="pbl-tree-node pbl-tree-node--unknown">
          <div class="pbl-tree-node-name">{p.placeholder ?? "不明"}</div>
        </div>
      }
    >
      {(n) => (
        <div
          class="pbl-tree-node"
          data-wild={n().isWild ? "true" : "false"}
          data-deceased={n().deceasedNote ? "true" : "false"}
        >
          <div class="pbl-tree-node-gen">{n().gen}</div>
          <div class="pbl-tree-node-name">
            {n().name}
            <span class="pbl-tree-node-sex">{sexGlyph(n().sex)}</span>
          </div>
          <div class="pbl-tree-node-meta">
            <span class="pbl-tree-node-id">{n().id}</span>
            <Show when={n().sizeMm != null}>
              <span class="pbl-tree-node-size">{n().sizeMm}mm</span>
            </Show>
          </div>
          <Show when={n().deceasedNote}>
            <div class="pbl-tree-node-deceased">{n().deceasedNote}</div>
          </Show>
        </div>
      )}
    </Show>
  );
};

export const BloodlineLineageModal = (props: Props) => {
  const data = createMemo(() => (props.open ? getProductBloodline(props.productId) : undefined));
  const product = createMemo(() => listProducts().find((p) => p.id === props.productId));

  // Esc で閉じる (capture: true で内側の onKeyDown より優先)
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => {
      document.removeEventListener("keydown", onKey, {
        capture: true,
      } as EventListenerOptions);
    });
  });

  return (
    <Show when={props.open && data()}>
      {(d) => (
        <div class="bl-dialog-backdrop" onClick={props.onClose}>
          <div
            class="bl-dialog pbl-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`血統情報 ${product()?.title ?? ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <header class="pbl-modal-head">
              <div class="pbl-modal-eyebrow">
                血統書 · 3 世代
                <span class="pbl-modal-eyebrow-sep" aria-hidden="true">·</span>
                <span class="pbl-modal-product">{product()?.title ?? d().productId}</span>
              </div>
              <button
                type="button"
                class="pbl-modal-close"
                onClick={props.onClose}
                aria-label="閉じる"
              >
                ✕
              </button>
            </header>

            {/* 3 世代ツリー (祖父母 → 父母 → 当該個体) */}
            <div class="pbl-tree" role="figure" aria-label="3 世代血統ツリー">
              {/* 行 1: 祖父母 4 (= 父方ペア + 母方ペア) */}
              <div class="pbl-tree-row pbl-tree-row--gp">
                <div class="pbl-tree-pair">
                  <TreeNode ancestor={d().grandparents?.paternalFather} placeholder="父方祖父 不明" />
                  <span class="pbl-tree-cross" aria-hidden="true">×</span>
                  <TreeNode ancestor={d().grandparents?.paternalMother} placeholder="父方祖母 不明" />
                </div>
                <div class="pbl-tree-pair">
                  <TreeNode ancestor={d().grandparents?.maternalFather} placeholder="母方祖父 不明" />
                  <span class="pbl-tree-cross" aria-hidden="true">×</span>
                  <TreeNode ancestor={d().grandparents?.maternalMother} placeholder="母方祖母 不明" />
                </div>
              </div>

              {/* 行 1 → 行 2 への接続ライン (CSS で描画) */}
              <div class="pbl-tree-edges-gp" aria-hidden="true" />

              {/* 行 2: 父 + 母 */}
              <div class="pbl-tree-row pbl-tree-row--parents">
                <TreeNode ancestor={d().father} />
                <span class="pbl-tree-cross-large" aria-hidden="true">×</span>
                <TreeNode ancestor={d().mother} />
              </div>

              {/* 行 2 → 行 3 への接続 */}
              <div class="pbl-tree-edges-parents" aria-hidden="true" />

              {/* 行 3: 当該個体 (= focal) */}
              <div class="pbl-tree-row pbl-tree-row--focal">
                <div class="pbl-tree-focal" data-band={fBand(d().inbreedingCoef)}>
                  <div class="pbl-tree-focal-eyebrow">この商品</div>
                  <div class="pbl-tree-focal-title">
                    {product()?.title ?? "—"}
                  </div>
                  <div class="pbl-tree-focal-meta">
                    <span class="pbl-tree-node-gen">{d().generation}</span>
                    <span>F値 {d().inbreedingCoef.toFixed(2)} ({fBandLabel(fBand(d().inbreedingCoef))})</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 認証 + メモ */}
            <section class="pbl-modal-section">
              <h4 class="pbl-modal-section-title">認証</h4>
              <div class="pbl-modal-certs">
                <div
                  class="pbl-modal-cert"
                  data-active={d().breederCertified ? "true" : "false"}
                >
                  <span class="pbl-modal-cert-mark">{d().breederCertified ? "✓" : "—"}</span>
                  <span>ブリーダー認証 (= 出品者本人による血統書発行)</span>
                </div>
                <div
                  class="pbl-modal-cert"
                  data-active={d().thirdPartyVerified ? "true" : "false"}
                >
                  <span class="pbl-modal-cert-mark">{d().thirdPartyVerified ? "✓" : "—"}</span>
                  <span>第三者血統認証 (= 業界団体による監査済)</span>
                </div>
              </div>
            </section>

            <section class="pbl-modal-section">
              <h4 class="pbl-modal-section-title">血統メモ</h4>
              <p class="pbl-modal-notes">{d().pedigreeNotes}</p>
            </section>

            <footer class="bl-dialog-actions">
              {/* 商品詳細ページから開く前提なので「商品ページへ」は冗長。閉じるのみ。 */}
              <button type="button" class="bl-btn-primary" onClick={props.onClose}>
                閉じる
              </button>
            </footer>
          </div>
        </div>
      )}
    </Show>
  );
};
