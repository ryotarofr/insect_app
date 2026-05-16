// MatingRecordModal.tsx — Bloodline 「+ 交配記録」
//
// Bloodline ページから、系統に残すための交配記録を新規作成するモーダル。
// - 父 (♂) / 母 (♀) を系統内の個体から選択
// - 日付 (既定: 今日)
// - メモ (任意)
// 保存したレコードは store/matingRecords.ts に積まれ localStorage に永続化。
// 実際の Individual ツリーは POC なので書き換えず、右パネルに軽いトーストで反映。
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  listBloodlineIndividuals,
  getBloodlineIndividual,
  type Individual,
  type Sex,
} from "../../pages/Bloodline";
import { addMatingRecord } from "../../store/matingRecords";
import { showToast } from "../../store/toast";
import { installFocusTrap, type FocusTrapHandle } from "../../utils/focusTrap";

interface MatingRecordModalProps {
  open: boolean;
  onClose: () => void;
  /** モーダル起動時に選ばれている個体。性別に応じて父 or 母に自動プリセットする */
  seedSelectedId?: string;
}

const todayISO = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 生存中 (deceased 以外) + 性別が明確な個体のみ。親候補に使う。 */
const eligibleParents = (sex: Sex): Individual[] =>
  listBloodlineIndividuals()
    .filter((i) => i.sex === sex && i.lifeStatus !== "deceased")
    .sort((a, b) => a.id.localeCompare(b.id));

export const MatingRecordModal = (p: MatingRecordModalProps) => {
  const males = createMemo<Individual[]>(() => eligibleParents("m"));
  const females = createMemo<Individual[]>(() => eligibleParents("f"));

  const [fatherId, setFatherId] = createSignal("");
  const [motherId, setMotherId] = createSignal("");
  const [date, setDate] = createSignal(todayISO());
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  // open 変化時: フォーム初期化 + seed から父/母プリセット
  createEffect(() => {
    if (p.open) {
      setDate(todayISO());
      setNote("");
      setError(null);
      setSubmitting(false);

      // seed から性別に応じて初期選択
      const seed = p.seedSelectedId
        ? getBloodlineIndividual(p.seedSelectedId)
        : undefined;
      if (seed && seed.lifeStatus !== "deceased") {
        if (seed.sex === "m") {
          setFatherId(seed.id);
          setMotherId(females()[0]?.id ?? "");
        } else {
          setMotherId(seed.id);
          setFatherId(males()[0]?.id ?? "");
        }
      } else {
        setFatherId(males()[0]?.id ?? "");
        setMotherId(females()[0]?.id ?? "");
      }
    }
  });

  // Esc で閉じる
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && p.open) p.onClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // focus trap
  let dialogRef: HTMLFormElement | undefined;
  let trap: FocusTrapHandle | null = null;
  createEffect(() => {
    if (p.open && dialogRef) {
      trap = installFocusTrap(dialogRef);
    } else if (!p.open && trap) {
      trap.release();
      trap = null;
    }
  });
  onCleanup(() => {
    trap?.release();
    trap = null;
  });

  const onBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) p.onClose();
  };

  const onSubmit = (e: Event) => {
    e.preventDefault();
    if (submitting()) return;

    // バリデーション
    if (!fatherId() || !motherId()) {
      setError("父個体と母個体を選択してください");
      return;
    }
    if (fatherId() === motherId()) {
      setError("父と母に同じ個体は選択できません");
      return;
    }
    if (!date() || !/^\d{4}-\d{2}-\d{2}$/.test(date())) {
      setError("日付を入力してください");
      return;
    }
    if (date() > todayISO()) {
      setError("未来の日付は記録できません");
      return;
    }

    setSubmitting(true);
    const rec = addMatingRecord({
      fatherId: fatherId(),
      motherId: motherId(),
      date: date(),
      note: note().trim() || undefined,
    });
    const f = getBloodlineIndividual(rec.fatherId);
    const m = getBloodlineIndividual(rec.motherId);
    showToast({
      message: `交配記録を保存: ${f?.id ?? rec.fatherId} × ${m?.id ?? rec.motherId}`,
      tone: "success",
    });
    p.onClose();
  };

  return (
    <Show when={p.open}>
      <div
        class="sheet-backdrop"
        role="presentation"
        onClick={onBackdropClick}
      >
        <form
          ref={dialogRef}
          class="sheet-dialog mating-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mating-title"
          onSubmit={onSubmit}
        >
          <div class="sheet-head">
            <h3 id="mating-title">交配記録を追加</h3>
            <span class="for">Bloodline</span>
            <button
              type="button"
              class="sheet-close"
              aria-label="閉じる"
              onClick={p.onClose}
            >
              ✕
            </button>
          </div>

          <div class="mating-fields">
            <div class="mating-field">
              <label class="label" for="mating-father">
                父 (♂)
              </label>
              <select
                id="mating-father"
                class="select"
                value={fatherId()}
                onChange={(e) => {
                  setFatherId(e.currentTarget.value);
                  setError(null);
                }}
                autofocus
              >
                <For each={males()}>
                  {(ind) => (
                    <option value={ind.id}>
                      {ind.name} {ind.id}
                      {ind.isWild ? " · 野生" : ` · ${ind.generation}`}
                    </option>
                  )}
                </For>
              </select>
            </div>

            <div class="mating-field">
              <label class="label" for="mating-mother">
                母 (♀)
              </label>
              <select
                id="mating-mother"
                class="select"
                value={motherId()}
                onChange={(e) => {
                  setMotherId(e.currentTarget.value);
                  setError(null);
                }}
              >
                <For each={females()}>
                  {(ind) => (
                    <option value={ind.id}>
                      {ind.name} {ind.id}
                      {ind.isWild ? " · 野生" : ` · ${ind.generation}`}
                    </option>
                  )}
                </For>
              </select>
            </div>

            <div class="mating-field">
              <label class="label" for="mating-date">
                交配日
              </label>
              <input
                id="mating-date"
                type="date"
                class="input mono"
                value={date()}
                max={todayISO()}
                onInput={(e) => {
                  setDate(e.currentTarget.value);
                  setError(null);
                }}
              />
            </div>

            <div class="mating-field">
              <label class="label" for="mating-note">
                メモ (任意)
              </label>
              <textarea
                id="mating-note"
                class="textarea"
                placeholder="例: ペアリング環境 27℃ / ゼリー 16g"
                value={note()}
                onInput={(e) => setNote(e.currentTarget.value)}
                rows={3}
                maxLength={400}
              />
            </div>
          </div>

          <Show when={error()}>
            <div
              role="alert"
              class="mono"
              style={{
                color: "var(--accent-rose)",
                "font-size": "12px",
                "margin-top": "10px",
              }}
            >
              {error()}
            </div>
          </Show>

          <div class="mating-actions">
            <button
              type="button"
              class="btn ghost"
              onClick={p.onClose}
              disabled={submitting()}
            >
              キャンセル
            </button>
            <button
              type="submit"
              class="btn primary"
              disabled={submitting()}
              aria-disabled={submitting()}
            >
              {submitting() ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
};
