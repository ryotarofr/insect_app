// QuickLogSheet.tsx — 個体カルテ／FABから起動する「記録追加」モーダル
// 対象個体は props.specimenId で事前プリセット可能。未指定の場合は select で変更可。
import { createEffect, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { addLog, listSpecimens, type LogType } from "../../api";
import { LOG_TYPES, buildLogTitle } from "./types";

interface QuickLogSheetProps {
  open: boolean;
  onClose: () => void;
  /** 指定すると対象個体を固定 (個体カルテから起動した場合) */
  specimenId?: string;
  /** 保存成功時のコールバック */
  onSaved?: () => void;
}

export const QuickLogSheet = (p: QuickLogSheetProps) => {
  const specimens = listSpecimens();
  const [type, setType] = createSignal<LogType>("weight");
  const [target, setTarget] = createSignal(p.specimenId ?? specimens[0]?.id ?? "");
  const [value, setValue] = createSignal("28.4");
  const [memo, setMemo] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  // propsの specimenId が変われば追従
  createEffect(() => {
    if (p.specimenId) setTarget(p.specimenId);
  });

  // open が false になったらフォーム初期化、true になったら weight の初期値に
  createEffect(() => {
    if (!p.open) {
      setType("weight");
      setValue("28.4");
      setMemo("");
      setError(null);
    }
  });

  // 種別変更時、値を種別ごとのデフォルトへ
  const selectType = (t: LogType) => {
    setType(t);
    setValue(t === "weight" ? "28.4" : "");
    setError(null);
  };

  // Esc で閉じる
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && p.open) p.onClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const currentMeta = () => LOG_TYPES.find((t) => t.key === type())!;

  const submit = (e: Event) => {
    e.preventDefault();
    const t = type();
    const v = value().trim();
    if (!v) {
      setError("内容を入力してください");
      return;
    }
    addLog({
      type: t,
      title: buildLogTitle(t, v),
      body: memo().trim() || v,
      specimen: target(),
    });
    p.onSaved?.();
    p.onClose();
  };

  const targetSpec = () => specimens.find((s) => s.id === target());

  return (
    <Show when={p.open}>
      <div
        class="sheet-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="飼育ログを追加"
        onClick={p.onClose}
      >
        <form
          class="sheet-dialog"
          onClick={(e) => e.stopPropagation()}
          onSubmit={submit}
        >
          <div class="sheet-head">
            <div>
              <div class="for">NEW ENTRY</div>
              <h3>記録を追加</h3>
            </div>
            <button
              type="button"
              class="sheet-close"
              aria-label="閉じる"
              onClick={p.onClose}
            >
              ×
            </button>
          </div>

          {/* 対象個体 */}
          <div style={{ "margin-top": "10px" }}>
            <Show
              when={!p.specimenId}
              fallback={
                <div
                  class="mono"
                  style={{
                    "font-size": "11px",
                    color: "var(--ink-mute)",
                    padding: "8px 10px",
                    background: "var(--bg-sunken)",
                    "border-radius": "var(--r-md)",
                  }}
                >
                  対象:{" "}
                  <span style={{ "font-weight": 600, color: "var(--ink)" }}>
                    {target()} · {targetSpec()?.name ?? ""}
                  </span>
                </div>
              }
            >
              <label class="label" for="qs-target">対象個体</label>
              <select
                id="qs-target"
                class="select"
                value={target()}
                onChange={(e) => setTarget(e.currentTarget.value)}
              >
                <For each={specimens}>
                  {(s) => (
                    <option value={s.id}>
                      {s.id} · {s.name}
                    </option>
                  )}
                </For>
              </select>
            </Show>
          </div>

          {/* 種別 picker */}
          <div style={{ "margin-top": "14px" }}>
            <span class="label">種別</span>
            <div class="type-picker" role="tablist">
              <For each={LOG_TYPES}>
                {(t) => (
                  <button
                    type="button"
                    class="tp"
                    aria-pressed={type() === t.key}
                    onClick={() => selectType(t.key)}
                  >
                    <span class="ico">{t.icon}</span>
                    {t.label}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* 値 */}
          <div style={{ "margin-top": "14px" }}>
            <label class="label" for="qs-value">
              {currentMeta().inputLabel}
            </label>
            <Show
              when={type() === "weight"}
              fallback={
                <textarea
                  id="qs-value"
                  class="textarea"
                  placeholder={currentMeta().hint}
                  value={value()}
                  onInput={(e) => setValue(e.currentTarget.value)}
                />
              }
            >
              <input
                id="qs-value"
                class="input mono"
                type="number"
                step="0.1"
                placeholder="28.4"
                value={value()}
                onInput={(e) => setValue(e.currentTarget.value)}
              />
            </Show>
          </div>

          {/* 追加メモ (weight のときだけ別欄。他種別は value がメモ兼用) */}
          <Show when={type() === "weight"}>
            <div style={{ "margin-top": "12px" }}>
              <label class="label" for="qs-memo">メモ (任意)</label>
              <input
                id="qs-memo"
                class="input"
                placeholder="気付きを一言"
                value={memo()}
                onInput={(e) => setMemo(e.currentTarget.value)}
              />
            </div>
          </Show>

          <Show when={error()}>
            <div
              role="alert"
              style={{
                "margin-top": "10px",
                padding: "8px 10px",
                "font-size": "12px",
                color: "var(--accent-rose)",
                background: "var(--accent-rose-soft)",
                "border-radius": "var(--r-md)",
              }}
            >
              {error()}
            </div>
          </Show>

          <div style={{ display: "flex", gap: "8px", "margin-top": "18px" }}>
            <button type="button" class="btn ghost" onClick={p.onClose} style={{ flex: 1 }}>
              キャンセル
            </button>
            <button type="submit" class="btn primary" style={{ flex: 2 }}>
              ＋ 記録する
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
};
