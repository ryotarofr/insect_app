// SpecimenCarteModal.tsx — 個体カルテのインライン表示モーダル
//
// **目的**:
//   血統マインドマップ (= /bloodline) から「カルテを開く」を押した時に、
//   /specimen/{id} へ navigate せずに同 page 上のオーバーレイで内容を表示する。
//   ページ遷移しないので「戻る」操作が不要 = mindmap の閲覧コンテキストを保てる。
//
// **表示する情報**:
//   - ヘッダ: 個体カルテ · {id}
//   - 大見出し: 名前 + 性別記号
//   - 学名 + 種別
//   - Specs grid (Sex / Stage / Size / Weight / Birth / Eclosion / Generation / Shop)
//   - 直近のログ 5 件 (date + title)
//   - メモ
//   - フッタ: 閉じる + 詳細ページへ
//
// **データ源**:
//   - `getSpecimen(id)`: data.ts の Specimen レコード
//   - `listLogsBySpecimen(id)`: 飼育ログ
//   いずれも data.ts に登録された個体 (= specimenExists が true) でだけ動く。
//   呼び出し側 (Bloodline.tsx) で `disabled={!specimenExists}` ガードしている前提。
//
// **CSS**:
//   `bloodline.css` 内の `.bl-dialog` + `.bl-carte-*` スタイルを再利用。
//   このコンポーネントは /bloodline 専用なので、CSS 名前空間も bl-* に揃えている。
//
// **キーボード**:
//   - Esc: 閉じる
//   - capture フェーズでバインドして、内側のフォーカス要素より優先する。

import { createMemo, For, onCleanup, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { getSpecimen, listLogsBySpecimen } from "../../api";
import { specimenUrl } from "../../router";

interface SpecimenCarteModalProps {
  open: boolean;
  /** 表示対象の specimen id (例: "#DHH-0271")。`open=false` の時は無視される。 */
  specimenId: string;
  onClose: () => void;
}

/** 性別記号と日本語ラベル。data.ts の Specimen.sex は "♂" / "♀" の文字列。 */
const sexLabel = (sex: string): string =>
  sex === "♂" ? "オス" : sex === "♀" ? "メス" : "未確定";

export const SpecimenCarteModal = (p: SpecimenCarteModalProps) => {
  const navigate = useNavigate();

  // open=true の時のみ data を引く (= 不要な list 走査を避ける)
  const spec = createMemo(() => (p.open ? getSpecimen(p.specimenId) : undefined));
  const logs = createMemo(() =>
    p.open ? listLogsBySpecimen(p.specimenId).slice(0, 5) : [],
  );

  // Esc キーで閉じる。capture: true で内側コンポーネントの onKeyDown より優先。
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!p.open) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        p.onClose();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => {
      document.removeEventListener("keydown", onKey, {
        capture: true,
      } as EventListenerOptions);
    });
  });

  /** 「詳細ページへ」ボタン: モーダルを閉じてから /specimen/{id} に遷移。 */
  const goDetail = () => {
    const id = p.specimenId;
    p.onClose();
    navigate(specimenUrl(id));
  };

  return (
    <Show when={p.open && spec()}>
      {(s) => (
        <div class="bl-dialog-backdrop" onClick={p.onClose}>
          <div
            class="bl-dialog bl-dialog--carte"
            role="dialog"
            aria-modal="true"
            aria-label={`個体カルテ ${s().name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <header class="bl-carte-header">
              <div class="bl-carte-eyebrow">
                個体カルテ
                <span class="bl-carte-id-sep" aria-hidden="true">·</span>
                <span class="bl-carte-id">{s().id}</span>
              </div>
              <button
                type="button"
                class="bl-carte-close"
                onClick={p.onClose}
                aria-label="閉じる"
              >
                ✕
              </button>
            </header>

            <h3 class="bl-carte-title">
              {s().name}
              <span class="bl-carte-sex">{s().sex}</span>
            </h3>
            <div class="bl-carte-sci">
              {s().species}
              <span class="bl-carte-sci-sep" aria-hidden="true"> · </span>
              <span class="bl-carte-sci-italic">{s().sci}</span>
            </div>

            <dl class="bl-carte-specs">
              <dt>Sex</dt>
              <dd>{sexLabel(s().sex)}</dd>

              <dt>Stage</dt>
              <dd>
                {s().stage}
                {" "}
                <span class="bl-carte-progress">
                  {Math.round(s().stageProgress * 100)}%
                </span>
              </dd>

              <dt>Size</dt>
              <dd class="bl-mono">{s().sizeMm} mm</dd>

              <dt>Weight</dt>
              <dd class="bl-mono">{s().weightG} g</dd>

              <dt>Birth</dt>
              <dd class="bl-mono">{s().birthDate}</dd>

              <Show when={s().eclosionETA}>
                <dt>Eclosion</dt>
                <dd class="bl-mono">
                  {s().eclosionETA}
                  <Show when={s().eclosionInDays !== null}>
                    <span class="bl-carte-eta-suffix">
                      {" "}(あと {s().eclosionInDays} 日)
                    </span>
                  </Show>
                </dd>
              </Show>

              <dt>Generation</dt>
              <dd class="bl-mono">{s().generation}</dd>

              <dt>Shop</dt>
              <dd>{s().shop}</dd>
            </dl>

            <Show when={logs().length > 0}>
              <section class="bl-carte-section">
                <h4 class="bl-carte-section-title">直近のログ</h4>
                <ul class="bl-carte-logs">
                  <For each={logs()}>
                    {(l) => (
                      <li>
                        <span class="bl-carte-log-date">{l.date}</span>
                        <span class="bl-carte-log-title">{l.title}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            </Show>

            <Show when={s().notes}>
              <section class="bl-carte-section">
                <h4 class="bl-carte-section-title">メモ</h4>
                <p class="bl-carte-notes">{s().notes}</p>
              </section>
            </Show>

            <footer class="bl-dialog-actions">
              <button
                type="button"
                class="bl-btn-ghost"
                onClick={p.onClose}
              >
                閉じる
              </button>
              <button
                type="button"
                class="bl-btn-primary"
                onClick={goDetail}
              >
                詳細ページへ
              </button>
            </footer>
          </div>
        </div>
      )}
    </Show>
  );
};
