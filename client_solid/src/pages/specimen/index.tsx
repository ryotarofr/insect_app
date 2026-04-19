// specimen/index.tsx — 個体カルテ詳細のコンテナ (V1〜V5 を切り替え)
import { createSignal, For, Show } from "solid-js";
import { type RouteKey } from "../../data";
import { getSpecimen, listSpecimens, listLogsBySpecimen } from "../../api";
import { Icons } from "../../components/Icons";
import { VariantStandard } from "./VariantStandard";
import { VariantField } from "./VariantField";
import { VariantData } from "./VariantData";
import { VariantTimeline } from "./VariantTimeline";
import { VariantMinimal } from "./VariantMinimal";

type Variant = "V1" | "V2" | "V3" | "V4" | "V5";

const VARIANT_LABEL: Record<Variant, string> = {
  V1: "標準カルテ",
  V2: "博物誌レイアウト",
  V3: "データリッチ",
  V4: "タイムライン中心",
  V5: "ミニマル図鑑",
};

interface SpecimenDetailProps {
  specimenId: string;
  setRoute: (r: RouteKey) => void;
}

export const SpecimenDetail = (props: SpecimenDetailProps) => {
  const s = () => getSpecimen(props.specimenId) ?? listSpecimens()[0];
  const [variant, setVariant] = createSignal<Variant>("V1");
  const specimenLogs = () => listLogsBySpecimen(s().id);

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">INDIVIDUAL CARTE · {s().id}</div>
          <h1>{s().name}</h1>
          <div
            class="mono"
            style={{ "font-size": "12px", color: "var(--ink-mute)", "font-style": "italic", "margin-top": "4px" }}
          >
            {s().sci}
          </div>
        </div>
        <div class="page-actions">
          <span
            class="mono"
            style={{
              "font-size": "10px",
              color: "var(--ink-faint)",
              "align-self": "center",
              "margin-right": "8px",
            }}
          >
            LAYOUT: {VARIANT_LABEL[variant()]}
          </span>
          <div class="variants">
            <For each={["V1", "V2", "V3", "V4", "V5"] as Variant[]}>
              {(v) => (
                <button class={variant() === v ? "active" : ""} onClick={() => setVariant(v)}>
                  {v}
                </button>
              )}
            </For>
          </div>
          <button class="btn">{Icons.plus()} ログ追加</button>
        </div>
      </div>

      <Show when={variant() === "V1"}>
        <VariantStandard s={s()} logs={specimenLogs()} setRoute={props.setRoute} />
      </Show>
      <Show when={variant() === "V2"}>
        <VariantField s={s()} />
      </Show>
      <Show when={variant() === "V3"}>
        <VariantData s={s()} />
      </Show>
      <Show when={variant() === "V4"}>
        <VariantTimeline s={s()} logs={specimenLogs()} />
      </Show>
      <Show when={variant() === "V5"}>
        <VariantMinimal s={s()} />
      </Show>
    </>
  );
};
