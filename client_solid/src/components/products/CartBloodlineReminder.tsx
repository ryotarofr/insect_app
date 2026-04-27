// CartBloodlineReminder.tsx — カート画面で表示する血統リマインダ (Phase 3)
//
// 設計仕様 (= 3 段階フローの最終ステップ) より:
//   購入直前に「この個体は CBF3 · F値 0.05 です」を視覚的に確認できるようにする。
//   購入後に「思っていた血統と違う」というギャップを生まないための最後の関所。
//
// **責務**:
//   - cart card の line_item block 列から productId を抽出
//   - 各 productId に bloodline fixture があれば 1 行のリマインダを描画
//   - 「系図を確認 ▸」ボタン → BloodlineLineageModal を開く
//
// 用品 (= 血統 fixture が無い商品) は表示されない。空カートでも何も出ない。
//
// **CSS**:
//   styles/product-bloodline.css の `.pbl-cart-*` 系セレクタ参照。

import { createMemo, createSignal, For, Show } from "solid-js";
import type { CardBlock } from "../../sdui/branded";
import { BloodlineLineageModal } from "./BloodlineLineageModal";
import { fBand, fBandLabel, getProductBloodline } from "./bloodline-fixture";

interface Props {
  /** useCartSnapshot から渡される cart card. undefined はローディング中 / 不明. */
  card: CardBlock | undefined;
}

/** cart card の regions.items から line_item の productId を順序維持で抽出. */
const extractProductIds = (card: CardBlock | undefined): string[] => {
  if (!card) return [];
  if (card.template !== "cart") return [];
  const items = card.regions.items;
  const out: string[] = [];
  for (const b of items) {
    if (b.type === "line_item") {
      out.push(b.productId);
    }
  }
  return out;
};

export const CartBloodlineReminder = (props: Props) => {
  // モーダルで開く対象 productId. null = 閉じている.
  const [openProductId, setOpenProductId] = createSignal<string | null>(null);

  // 血統情報がある productId だけに絞り込む (= 用品はスキップ).
  const bloodlineIds = createMemo(() =>
    extractProductIds(props.card).filter((id) => getProductBloodline(id) !== undefined),
  );

  return (
    <Show when={bloodlineIds().length > 0}>
      <section
        class="pbl-cart-reminder"
        aria-label="血統情報の確認"
        // CSS scope のため pbl-summary 系の変数を継承させる
      >
        <header class="pbl-cart-reminder-head">
          <div class="pbl-cart-reminder-eyebrow">血統リマインダ</div>
          <p class="pbl-cart-reminder-lede">
            購入前にもう一度、各個体の血統情報をご確認ください。
          </p>
        </header>

        <ul class="pbl-cart-reminder-list">
          <For each={bloodlineIds()}>
            {(productId) => {
              // 上で undefined を弾いてあるが TS 上は再 lookup するのが安全
              const data = getProductBloodline(productId)!;
              const band = fBand(data.inbreedingCoef);
              return (
                <li class="pbl-cart-reminder-row" data-band={band}>
                  <div class="pbl-cart-reminder-row-main">
                    <div class="pbl-cart-reminder-row-title">
                      {data.father.name} × {data.mother.name}
                      <span class="pbl-cart-reminder-row-id">{productId}</span>
                    </div>
                    <div class="pbl-cart-reminder-row-meta">
                      <span class="pbl-cart-reminder-chip pbl-cart-reminder-chip--gen">
                        {data.generation}
                      </span>
                      <span class="pbl-cart-reminder-chip pbl-cart-reminder-chip--f">
                        <span class="pbl-cart-reminder-dot" aria-hidden="true" />
                        F値 {data.inbreedingCoef.toFixed(2)} ({fBandLabel(band)})
                      </span>
                      <Show when={data.breederCertified}>
                        <span class="pbl-cart-reminder-chip pbl-cart-reminder-chip--cert">
                          ✓ ブリーダー認証
                        </span>
                      </Show>
                      <Show when={data.thirdPartyVerified}>
                        <span class="pbl-cart-reminder-chip pbl-cart-reminder-chip--cert">
                          ✓ 第三者認証
                        </span>
                      </Show>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="pbl-cart-reminder-cta"
                    onClick={() => setOpenProductId(productId)}
                  >
                    系図を確認 <span aria-hidden="true">▸</span>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>

        {/* 「濃い」バンドが含まれていたら追加注意書き */}
        <Show when={bloodlineIds().some((id) => fBand(getProductBloodline(id)!.inbreedingCoef) === "dense")}>
          <p class="pbl-cart-reminder-warn">
            ※ F値が高い個体 (= 近交が進んでいる) が含まれます。繁殖目的の場合は別系統との
            交配を推奨します。
          </p>
        </Show>

        {/* モーダル: 開いている productId のフル系図を表示 */}
        <BloodlineLineageModal
          open={openProductId() !== null}
          productId={openProductId() ?? ""}
          onClose={() => setOpenProductId(null)}
        />
      </section>
    </Show>
  );
};
