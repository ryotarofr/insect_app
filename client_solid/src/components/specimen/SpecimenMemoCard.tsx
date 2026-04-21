// SpecimenMemoCard.tsx — 個体メモ（自動保存）
// 保存ボタンを廃止し、600ms debounce で localStorage に書き込む。
// ステータスは「保存中…」→「● 保存済み · HH:mm」と遷移する。
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { getSpecimenMemo, updateSpecimenMemo } from "../../api";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string };

const nowHM = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const SpecimenMemoCard = (p: { specimenId: string }) => {
  const [draft, setDraft] = createSignal(getSpecimenMemo(p.specimenId));
  const [state, setState] = createSignal<SaveState>({ kind: "idle" });

  // 個体を切り替えたらドラフトをリセット
  createEffect(() => {
    setDraft(getSpecimenMemo(p.specimenId));
    setState({ kind: "idle" });
  });

  // debounce 自動保存
  createEffect(() => {
    const text = draft();
    const current = getSpecimenMemo(p.specimenId);
    if (text === current) return; // 変更なし
    setState({ kind: "saving" });
    const timer = window.setTimeout(() => {
      updateSpecimenMemo(p.specimenId, text);
      setState({ kind: "saved", at: nowHM() });
    }, 600);
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <div class="card" style={{ padding: "18px" }}>
      <div
        style={{
          display: "flex",
          "align-items": "baseline",
          gap: "8px",
          "margin-bottom": "8px",
        }}
      >
        <span
          class="mono"
          style={{ "font-size": "10px", color: "var(--ink-faint)", "letter-spacing": "0.12em" }}
        >
          メモ
        </span>
        <span
          class="serif"
          style={{ "font-size": "18px", "font-weight": 600 }}
        >
          観察ノート
        </span>
        <Show when={state().kind === "saving"}>
          <span
            role="status"
            aria-live="polite"
            class="mono"
            style={{ "font-size": "10px", color: "var(--ink-faint)", "margin-left": "auto" }}
          >
            保存中…
          </span>
        </Show>
        <Show when={state().kind === "saved" ? (state() as { kind: "saved"; at: string }) : null}>
          {(s) => (
            <span
              role="status"
              aria-live="polite"
              class="mono"
              style={{
                "font-size": "10px",
                color: "var(--accent-forest)",
                "margin-left": "auto",
              }}
            >
              ● 自動保存 · {s().at}
            </span>
          )}
        </Show>
      </div>
      <textarea
        class="textarea"
        aria-label="個体メモ"
        placeholder="観察メモ・世話メモ・気付き…"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        style={{ "min-height": "110px" }}
      />
    </div>
  );
};
