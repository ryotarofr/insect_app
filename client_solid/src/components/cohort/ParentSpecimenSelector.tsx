// components/cohort/ParentSpecimenSelector.tsx — 父 / 母 個体の typeahead
//
// **状態** (docs/cohort-implementation-plan.md §11):
//   - empty: input + filter chips (sex / bloodline 自動付与)
//   - typing: dropdown でリアルタイム候補
//   - selected: pill (mono ID + 名前 + sex + size + gen) + clear ✕
//   - free-text: 自由記述モード (= specimens.father_label / mother_label に保存)
//
// **キーボード操作**:
//   - ↑ ↓: 候補移動
//   - Enter: 選択 (free-text 行を選ぶと自由記述化)
//   - Escape: dropdown 閉じる

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { searchSpecimens } from "../../api/specimens-search";
import type { SpecimenSearchResult } from "../../types/cohort";

interface Props {
  /** 役割 (UI のラベル / sex フィルタ自動付与に使う) */
  role: "father" | "mother";
  /** 選択中の specimen id (= specimens.father_id / mother_id, NULL なら未選択) */
  value: string | null;
  /** 自由記述ラベル (= specimens.father_label / mother_label, 個体未登録の親) */
  label: string | null;
  /** 選択値の変更 */
  onChange: (next: { id: string | null; label: string | null }) => void;
  /** 表示用に解決された情報 (id があるとき pill 表示する) */
  resolved?: SpecimenSearchResult | null;
  /** species フィルタ (子個体の species_id と一致させる) */
  speciesId?: string;
  /** 系統フィルタ (任意。チップで OFF にできる) */
  bloodlineName?: string;
  /** 死亡個体を含めるか (default true) */
  includeDeceased?: boolean;
  /** placeholder (デフォルト 「ID / 名前 / 系統で検索...」) */
  placeholder?: string;
}

const DEBOUNCE_MS = 150;

export const ParentSpecimenSelector = (props: Props) => {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<SpecimenSearchResult[]>([]);
  const [open, setOpen] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal(-1);
  let timer: number | undefined;
  let containerEl: HTMLDivElement | undefined;

  const sexFilter = (): "male" | "female" => (props.role === "father" ? "male" : "female");

  // selected pill 表示判定
  const isSelected = createMemo(() => props.value !== null && props.resolved);
  const isFreeText = createMemo(() => props.value === null && props.label && props.label.length > 0);

  // typeahead fetch (debounce)
  createEffect(() => {
    const q = query();
    if (timer !== undefined) window.clearTimeout(timer);
    if (!open()) return;
    timer = window.setTimeout(() => {
      void (async () => {
        try {
          const list = await searchSpecimens({
            q,
            sex: sexFilter(),
            speciesId: props.speciesId,
            bloodlineName: props.bloodlineName,
            includeDeceased: props.includeDeceased ?? true,
            limit: 20,
          });
          setResults(list);
          setHighlighted(list.length > 0 ? 0 : -1);
        } catch (err) {
          console.warn("searchSpecimens failed:", err);
          setResults([]);
        }
      })();
    }, DEBOUNCE_MS);
  });

  // click outside で閉じる
  const onDocClick = (e: MouseEvent) => {
    if (!containerEl) return;
    if (e.target instanceof Node && containerEl.contains(e.target)) return;
    setOpen(false);
  };
  document.addEventListener("click", onDocClick);
  onCleanup(() => {
    document.removeEventListener("click", onDocClick);
    if (timer !== undefined) window.clearTimeout(timer);
  });

  const onKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (e) => {
    if (!open()) {
      if (e.key === "ArrowDown") {
        setOpen(true);
        return;
      }
      return;
    }
    const list = results();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(list.length, h + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(-1, h - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const idx = highlighted();
      if (idx >= 0 && idx < list.length) {
        chooseSpecimen(list[idx]);
      } else {
        // dropdown の最終行 = free-text 選択
        chooseFreeText(query());
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
  };

  const chooseSpecimen = (s: SpecimenSearchResult) => {
    props.onChange({ id: s.publicId, label: null });
    setQuery("");
    setOpen(false);
  };
  const chooseFreeText = (text: string) => {
    if (!text.trim()) {
      setOpen(false);
      return;
    }
    props.onChange({ id: null, label: text.trim() });
    setQuery("");
    setOpen(false);
  };
  const clear = () => {
    props.onChange({ id: null, label: null });
    setQuery("");
  };

  return (
    <div class="parent-selector" ref={containerEl}>
      <Show
        when={isSelected()}
        fallback={
          <Show
            when={isFreeText()}
            fallback={
              <div class="parent-selector__input-wrap">
                <input
                  type="text"
                  class="parent-selector__input mn"
                  value={query()}
                  placeholder={props.placeholder ?? "🔍 ID / 名前 / 系統で検索..."}
                  onInput={(e) => {
                    setQuery(e.currentTarget.value);
                    setOpen(true);
                  }}
                  onFocus={() => setOpen(true)}
                  onKeyDown={onKeyDown}
                  aria-label={props.role === "father" ? "父個体を検索" : "母個体を検索"}
                  aria-expanded={open()}
                  role="combobox"
                  aria-autocomplete="list"
                />
                <Show when={open() && (results().length > 0 || query().trim().length > 0)}>
                  <div class="parent-selector__dropdown" role="listbox">
                    <For each={results()}>
                      {(s, i) => {
                        const active = () => i() === highlighted();
                        return (
                          <button
                            type="button"
                            class={
                              "parent-selector__option" +
                              (active() ? " is-active" : "") +
                              (s.lifeStatus !== "active" ? " is-deceased" : "")
                            }
                            role="option"
                            aria-selected={active()}
                            onMouseEnter={() => setHighlighted(i())}
                            onClick={() => chooseSpecimen(s)}
                          >
                            <span class="parent-selector__opt-id mn">
                              #{s.publicId}
                            </span>
                            <span class="parent-selector__opt-meta">
                              <span class="parent-selector__opt-name">
                                {s.name ?? "—"}
                              </span>
                              <span class="parent-selector__opt-line">
                                {s.bloodlineName ?? "系統未設定"}
                                {s.lifeStatus !== "active" ? " · 死亡" : ""}
                              </span>
                            </span>
                            <span class="parent-selector__opt-tags">
                              <span class="chip chip-forest">
                                {s.sex === "male" ? "♂" : "♀"}{" "}
                                {s.sizeMm !== null ? `${s.sizeMm}mm` : "—"}
                              </span>
                              <Show when={s.generation !== null}>
                                <span class="chip chip-amber">F{s.generation}</span>
                              </Show>
                              <Show when={s.lifeStatus !== "active"}>
                                <span class="chip chip-rose">死亡</span>
                              </Show>
                            </span>
                          </button>
                        );
                      }}
                    </For>
                    <Show when={query().trim().length > 0}>
                      <button
                        type="button"
                        class={
                          "parent-selector__option parent-selector__free" +
                          (highlighted() === results().length ? " is-active" : "")
                        }
                        role="option"
                        aria-selected={highlighted() === results().length}
                        onMouseEnter={() => setHighlighted(results().length)}
                        onClick={() => chooseFreeText(query())}
                      >
                        <span style={{ "font-size": "13px" }}>✎</span>
                        <span>「{query()}」を自由記述として使う</span>
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>
            }
          >
            {/* free-text 表示 */}
            <div class="parent-selector__pill parent-selector__pill--free">
              <span>{props.label}</span>
              <span class="parent-selector__pill-tag">自由記述</span>
              <button
                type="button"
                class="parent-selector__pill-clear"
                onClick={clear}
                aria-label="クリア"
              >
                ✕
              </button>
            </div>
          </Show>
        }
      >
        {/* selected pill */}
        <div class="parent-selector__pill">
          <span class="mn parent-selector__pill-id">#{props.resolved?.publicId}</span>
          <span class="parent-selector__pill-name">
            {props.resolved?.name ?? "—"}
          </span>
          <Show when={props.resolved?.sizeMm !== null && props.resolved?.sizeMm !== undefined}>
            <span class="chip chip-forest" style={{ "font-size": "9px" }}>
              {props.resolved?.sex === "male" ? "♂" : "♀"} {props.resolved?.sizeMm}mm
            </span>
          </Show>
          <button
            type="button"
            class="parent-selector__pill-clear"
            onClick={clear}
            aria-label="選択解除"
          >
            ✕
          </button>
        </div>
      </Show>
    </div>
  );
};
