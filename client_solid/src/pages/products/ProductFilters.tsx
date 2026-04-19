// ProductFilters.tsx — 種類 (tab) + 種 (active species chip) + placeholder chips
import { For, Show } from "solid-js";
import type { Product } from "../../api";

export type Tab = "all" | "live" | "goods";

export interface SpeciesFilter {
  label: string;
  match: (p: Product) => boolean;
}

/** タイトル/学名にキーワードが含まれるかでフィルタする */
export const SPECIES_FILTERS: SpeciesFilter[] = [
  {
    label: "ヘラクレス系",
    match: (p) => /Dynastes hercules/i.test(p.sci ?? "") || /ヘラクレス/.test(p.title),
  },
  {
    label: "コーカサス系",
    match: (p) => /Chalcosoma/i.test(p.sci ?? "") || /コーカサス/.test(p.title),
  },
  {
    label: "ネプチューン系",
    match: (p) => /Dynastes neptunus/i.test(p.sci ?? "") || /ネプチューン/.test(p.title),
  },
  {
    label: "国産",
    match: (p) => /Trypoxylus/i.test(p.sci ?? "") || /国産/.test(p.title),
  },
];

// 未実装のフィルタ：UI 表示はするが title で「準備中」と知らせる
const PLACEHOLDER_FILTERS = ["♂", "♀", "成虫", "幼虫", "CBF以上", "即決"];

export const TabSwitcher = (p: { tab: Tab; setTab: (t: Tab) => void }) => (
  <div class="variants">
    <button class={p.tab === "all" ? "active" : ""} onClick={() => p.setTab("all")}>
      ALL
    </button>
    <button class={p.tab === "live" ? "active" : ""} onClick={() => p.setTab("live")}>
      生体
    </button>
    <button class={p.tab === "goods" ? "active" : ""} onClick={() => p.setTab("goods")}>
      用品
    </button>
  </div>
);

export const SpeciesFilterBar = (p: {
  activeSpecies: string | null;
  setActiveSpecies: (v: string | null) => void;
  resultCount: number;
}) => {
  const toggle = (label: string) =>
    p.setActiveSpecies(p.activeSpecies === label ? null : label);

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        "margin-bottom": "20px",
        "align-items": "center",
        "flex-wrap": "wrap",
      }}
    >
      <span
        class="mono"
        style={{ "font-size": "11px", color: "var(--ink-faint)", "letter-spacing": "0.08em" }}
      >
        FILTER
      </span>
      <For each={SPECIES_FILTERS}>
        {(f) => {
          const isActive = () => p.activeSpecies === f.label;
          return (
            <button
              class={`chip ${isActive() ? "ink" : ""}`}
              style={{ cursor: "pointer", padding: "4px 10px" }}
              aria-pressed={isActive()}
              onClick={() => toggle(f.label)}
            >
              {f.label}
            </button>
          );
        }}
      </For>
      <For each={PLACEHOLDER_FILTERS}>
        {(f) => (
          <button
            class="chip"
            style={{ padding: "4px 10px", opacity: 0.5, cursor: "not-allowed" }}
            title="準備中"
            aria-disabled="true"
          >
            {f}
          </button>
        )}
      </For>
      <Show when={p.activeSpecies}>
        <button
          class="btn sm ghost"
          style={{ "font-size": "11px", color: "var(--ink-mute)" }}
          onClick={() => p.setActiveSpecies(null)}
        >
          クリア
        </button>
      </Show>
      <span style={{ "margin-left": "auto", "font-size": "12px", color: "var(--ink-mute)" }}>
        {p.resultCount} 点 · 並び: <b>おすすめ</b>
      </span>
    </div>
  );
};
