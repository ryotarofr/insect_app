// LifeStatusBadge.tsx — 個体のライフ状態 (終了バッジ) 表示
//
// P4-2: Specimen.lifeStatus を受けて、"故" "譲渡済" "脱走" 等の
// 終了バッジを表示する。lifeStatus が "active" または未設定なら null を返す。
// StageBar の隣に置くと、"今どのステージか" と "そもそも生存しているか" を
// 同じ視界で読み取れる。
import { Show } from "solid-js";
import type { LifeStatus, LifeStatusDetail } from "../../api";

const LABELS: Record<LifeStatus, string> = {
  active: "生存中",
  deceased: "故",
  transferred: "譲渡済",
  escaped: "脱走中",
};

const TONES: Record<LifeStatus, string> = {
  active: "forest",
  deceased: "",
  transferred: "indigo",
  escaped: "rose",
};

export const LifeStatusBadge = (p: {
  status: LifeStatus | undefined | null;
  detail?: LifeStatusDetail;
}) => {
  const s = () => p.status ?? "active";
  return (
    <Show when={s() !== "active"}>
      <span
        class={`chip life-badge ${TONES[s()]}`}
        data-life={s()}
        role="status"
        aria-label={`ライフ状態: ${LABELS[s()]}`}
      >
        <Show when={s() === "deceased"}>
          <span aria-hidden="true" style={{ "margin-right": "4px" }}>✝</span>
        </Show>
        <Show when={s() === "transferred"}>
          <span aria-hidden="true" style={{ "margin-right": "4px" }}>→</span>
        </Show>
        <Show when={s() === "escaped"}>
          <span aria-hidden="true" style={{ "margin-right": "4px" }}>!</span>
        </Show>
        {LABELS[s()]}
        <Show when={p.detail?.date}>
          <span class="mono" style={{ "margin-left": "6px", "font-size": "10px", opacity: 0.85 }}>
            {p.detail!.date}
          </span>
        </Show>
      </span>
    </Show>
  );
};
