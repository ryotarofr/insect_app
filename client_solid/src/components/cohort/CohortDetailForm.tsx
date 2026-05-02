// components/cohort/CohortDetailForm.tsx — 群登録フォーム
//
// **セクション** (docs/cohort-implementation-plan.md §3.6 + §8):
//   1. 基本情報: LOT ID、種、名前、系統
//   2. 由来: 産卵 / 購入 / 採集 (segmented) + 関連フィールド (親交配 selector など)
//   3. 規模・ステージ: 初期数 (spinner)、ステージ (segmented)、開始日 (date)
//   4. 備考 (textarea)
//
// **保存して続けて登録**:
//   種 / 由来 / 親交配 / 系統 を localStorage に残し、次の登録でプリフィル。

import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { LS_KEYS, readJSON, writeJSON } from "../../api/storage";
import { SpecimenSpinner } from "../recording/SpecimenSpinner";
import type {
  CohortInsert,
  CohortStage,
  OriginKind,
} from "../../types/cohort";

interface Props {
  /** 自動採番の候補値 (mock) */
  suggestedPublicId: string;
  /** 親交配 selector の選択肢 (mock では固定リスト) */
  matingOptions: Array<{ id: string; label: string }>;
  /** 保存ハンドラ */
  onSubmit: (input: CohortInsert) => Promise<void>;
  /** キャンセル */
  onCancel: () => void;
}

interface ContextDraft {
  speciesId?: string;
  bloodlineName?: string;
  originKind?: OriginKind;
  parentMatingId?: string | null;
}

const CTX_KEY = "kochu:cohort-form-context";

const SPECIES_OPTIONS = [
  { id: "sp_dorcus_hopei", name: "国産オオクワガタ" },
  { id: "sp_dorcus_titanus", name: "外産オオクワガタ" },
  { id: "sp_prosopocoilus", name: "国産ノコギリクワガタ" },
  { id: "sp_tarandus", name: "タランドゥス" },
  { id: "sp_dynastes", name: "ヘラクレスオオカブト" },
];

const ORIGIN_OPTIONS: Array<{ value: OriginKind; label: string }> = [
  { value: "egg_lay", label: "産卵" },
  { value: "purchase", label: "購入" },
  { value: "field_collected", label: "採集" },
];

const STAGE_OPTIONS: Array<{ value: CohortStage; label: string }> = [
  { value: "egg", label: "卵" },
  { value: "larva_l1", label: "1齢" },
  { value: "larva_l2", label: "2齢" },
  { value: "larva_l3", label: "3齢" },
  { value: "pupa", label: "蛹" },
  { value: "mixed", label: "混合" },
];

const todayISO = (): string => new Date().toISOString().slice(0, 10);

export const CohortDetailForm = (props: Props) => {
  const initialCtx = readJSON<ContextDraft>(CTX_KEY, {});

  const [publicId, setPublicId] = createSignal(props.suggestedPublicId);
  const [speciesId, setSpeciesId] = createSignal<string>(
    initialCtx.speciesId ?? SPECIES_OPTIONS[0].id,
  );
  const [name, setName] = createSignal("");
  const [bloodlineName, setBloodlineName] = createSignal(initialCtx.bloodlineName ?? "");
  const [originKind, setOriginKind] = createSignal<OriginKind>(initialCtx.originKind ?? "egg_lay");
  const [parentMatingId, setParentMatingId] = createSignal<string | null>(initialCtx.parentMatingId ?? null);
  const [initialCount, setInitialCount] = createSignal<number | undefined>(100);
  const [stage, setStage] = createSignal<CohortStage>("egg");
  const [startDate, setStartDate] = createSignal<string>(todayISO());
  const [notes, setNotes] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const buildInsert = (): CohortInsert => ({
    publicId: publicId() || undefined,
    speciesId: speciesId(),
    bloodlineName: bloodlineName() || undefined,
    originKind: originKind(),
    parentMatingId,
    initialCount: initialCount() ?? 0,
    stage: stage(),
    startDate: startDate(),
    notes: notes() || undefined,
  });

  const persistContext = () => {
    const ctx: ContextDraft = {
      speciesId: speciesId(),
      bloodlineName: bloodlineName() || undefined,
      originKind: originKind(),
      parentMatingId: parentMatingId(),
    };
    writeJSON(CTX_KEY, ctx);
  };

  const submit = async (continueAfter: boolean) => {
    if (submitting()) return;
    if ((initialCount() ?? 0) <= 0) {
      setError("初期数は 1 以上で指定してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const insert = buildInsert();
      await props.onSubmit(insert);
      if (continueAfter) {
        persistContext();
        // 残すフィールド: speciesId / bloodlineName / originKind / parentMatingId
        // リセット: publicId / name / initialCount / stage / startDate / notes
        setPublicId("");
        setName("");
        setInitialCount(100);
        setStage("egg");
        setStartDate(todayISO());
        setNotes("");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitForm: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (e) => {
    e.preventDefault();
    void submit(false);
  };

  const previewId = createMemo(() => publicId() || props.suggestedPublicId || "—");

  return (
    <form class="reg-form" onSubmit={onSubmitForm}>
      <div class="page-head">
        <div>
          <div class="cat">飼育</div>
          <h1>群を作成</h1>
          <p class="page-head-sub">産卵セットや一括購入をロット単位で登録</p>
        </div>
        <div class="reg-form__preview">
          <span class="reg-form__preview-label">プレビュー</span>
          <span class="reg-form__preview-id mn">{previewId()}</span>
        </div>
      </div>

      <section class="card reg-form__section">
        <p class="reg-form__section-label">基本情報</p>
        <div class="reg-form__grid reg-form__grid--3">
          <div class="reg-form__field">
            <label class="reg-form__label" for="reg-lot-id">LOT ID</label>
            <input
              id="reg-lot-id"
              type="text"
              class="reg-form__input mn"
              value={publicId()}
              placeholder={props.suggestedPublicId}
              onInput={(e) => setPublicId(e.currentTarget.value)}
            />
            <p class="reg-form__hint">自動採番 / 上書き可</p>
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label" for="reg-species">種</label>
            <select
              id="reg-species"
              class="reg-form__input"
              value={speciesId()}
              onChange={(e) => setSpeciesId(e.currentTarget.value)}
            >
              <For each={SPECIES_OPTIONS}>
                {(opt) => <option value={opt.id}>{opt.name}</option>}
              </For>
            </select>
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label" for="reg-bloodline">系統 (任意)</label>
            <input
              id="reg-bloodline"
              type="text"
              class="reg-form__input"
              placeholder="例: 能勢 YG"
              value={bloodlineName()}
              onInput={(e) => setBloodlineName(e.currentTarget.value)}
            />
          </div>
        </div>
        <div class="reg-form__field" style={{ "margin-top": "10px" }}>
          <label class="reg-form__label" for="reg-name">名前 (任意)</label>
          <input
            id="reg-name"
            type="text"
            class="reg-form__input"
            placeholder="例: 能勢 YG 2026 春ロット"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </div>
      </section>

      <section class="card reg-form__section">
        <p class="reg-form__section-label">由来</p>
        <div class="reg-form__field" style={{ "margin-bottom": "12px" }}>
          <div class="seg" role="radiogroup">
            <For each={ORIGIN_OPTIONS}>
              {(opt) => (
                <button
                  type="button"
                  class={"seg__btn" + (originKind() === opt.value ? " is-active" : "")}
                  role="radio"
                  aria-checked={originKind() === opt.value}
                  onClick={() => setOriginKind(opt.value)}
                >
                  {opt.label}
                </button>
              )}
            </For>
          </div>
        </div>
        <Show when={originKind() === "egg_lay"}>
          <div class="reg-form__field">
            <label class="reg-form__label" for="reg-mating">親交配 (任意)</label>
            <select
              id="reg-mating"
              class="reg-form__input"
              value={parentMatingId() ?? ""}
              onChange={(e) =>
                setParentMatingId(
                  e.currentTarget.value === "" ? null : e.currentTarget.value,
                )
              }
            >
              <option value="">選択しない</option>
              <For each={props.matingOptions}>
                {(opt) => <option value={opt.id}>{opt.label}</option>}
              </For>
            </select>
            <p class="reg-form__hint">
              選ぶと父母情報・系統・累代が個体化時に自動継承されます
            </p>
          </div>
        </Show>
        <Show when={originKind() === "purchase"}>
          <p class="reg-form__hint">
            購入元・購入日・購入価格の入力は Phase 5 で実装予定 (現状は記録のみ)。
          </p>
        </Show>
        <Show when={originKind() === "field_collected"}>
          <p class="reg-form__hint">
            採集地・採集日の入力は Phase 5 で実装予定 (現状は記録のみ)。
          </p>
        </Show>
      </section>

      <section class="card reg-form__section">
        <p class="reg-form__section-label">規模・ステージ</p>
        <div class="reg-form__grid reg-form__grid--regime">
          <div class="reg-form__field">
            <label class="reg-form__label">初期数</label>
            <SpecimenSpinner value={initialCount()} onChange={setInitialCount} step={1} />
            <p class="reg-form__hint">産卵 / 入荷時の個数</p>
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label">ステージ</label>
            <div class="seg seg--small" role="radiogroup">
              <For each={STAGE_OPTIONS}>
                {(opt) => (
                  <button
                    type="button"
                    class={"seg__btn" + (stage() === opt.value ? " is-active" : "")}
                    role="radio"
                    aria-checked={stage() === opt.value}
                    onClick={() => setStage(opt.value)}
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label" for="reg-start">開始日</label>
            <input
              id="reg-start"
              type="date"
              class="reg-form__input mn"
              value={startDate()}
              onInput={(e) => setStartDate(e.currentTarget.value)}
            />
          </div>
        </div>
      </section>

      <section class="card reg-form__section">
        <p class="reg-form__section-label">備考</p>
        <textarea
          class="reg-form__input reg-form__textarea"
          placeholder="例: 4/22 の産卵セットから取り出し。産卵木 2 本割出。"
          value={notes()}
          onInput={(e) => setNotes(e.currentTarget.value)}
        />
      </section>

      <Show when={error()}>
        <p class="reg-form__error">{error()}</p>
      </Show>

      <div class="reg-form__actions">
        <button
          type="button"
          class="btn"
          onClick={props.onCancel}
          disabled={submitting()}
        >
          キャンセル
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => void submit(true)}
          disabled={submitting()}
        >
          保存して続けて登録
        </button>
        <button type="submit" class="btn primary" disabled={submitting()}>
          {submitting() ? "送信中…" : "作成する  ⏎"}
        </button>
      </div>
    </form>
  );
};
