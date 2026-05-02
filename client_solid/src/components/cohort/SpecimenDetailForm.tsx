// components/cohort/SpecimenDetailForm.tsx — 個体登録フォーム
//
// **配置**:
//   - /specimens/new (単独個体登録) で標準モード
//   - 個体化モードの「詳細設定 ▾」展開で compact モード (Phase 5 で予定)
//
// **セクション** (docs/cohort-implementation-plan.md §8.2):
//   1. 基本情報: 個体ID (mono input)、名前、性別 (segmented)
//   2. 血統情報: 累代、父個体 (typeahead)、母個体 (typeahead)
//   3. 初期計測 (任意): 体重、体長、ステージ
//   4. 個別メモ (textarea)
//
// **保存して続けて登録**:
//   父個体 / 母個体 / 累代 / species を localStorage に残し、次の登録で同じ親情報をプリフィル。

import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { LS_KEYS } from "../../api/storage";
import { writeJSON, readJSON } from "../../api/storage";
import { ParentSpecimenSelector } from "./ParentSpecimenSelector";
import { SpecimenSpinner } from "../recording/SpecimenSpinner";
import { serverSpecies } from "../../store/species";
import type { SpecimenDraft } from "../../types/cohort";

interface Props {
  /** 由来 cohort id (URL クエリから渡される) */
  cohortId?: string;
  /** species のデフォルト */
  defaultSpeciesId?: string;
  /** 自動採番された具体値 (mock) */
  suggestedPublicId?: string;
  /** 保存ハンドラ — 成功時の Promise を返す */
  onSubmit: (draft: SpecimenDraft) => Promise<void>;
  /** キャンセル時 */
  onCancel: () => void;
}

interface ContextDraft {
  speciesId?: string;
  fatherId?: string;
  motherId?: string;
  fatherLabel?: string;
  motherLabel?: string;
  generation?: number;
}

const CTX_KEY = "kochu:specimen-form-context";

const SEX_OPTIONS: Array<{ value: "male" | "female" | "unknown"; label: string }> = [
  { value: "male", label: "♂ オス" },
  { value: "female", label: "♀ メス" },
  { value: "unknown", label: "不明" },
];

const STAGE_OPTIONS: Array<{
  value: NonNullable<SpecimenDraft["stage"]>;
  label: string;
}> = [
  { value: "larva_l1", label: "L1" },
  { value: "larva_l2", label: "L2" },
  { value: "larva_l3", label: "L3" },
  { value: "pupa", label: "蛹" },
  { value: "adult", label: "成虫" },
];

/** server から取得できなかった場合のフォールバック (= 1 件だけ表示) */
const FALLBACK_SPECIES = [
  { id: "dhh", name: "ヘラクレスオオカブト" },
];

export const SpecimenDetailForm = (props: Props) => {
  // 連続登録時のコンテキスト復元
  const initialCtx = readJSON<ContextDraft>(CTX_KEY, {});

  // publicId は空 = server 自動採番に任せる。`suggestedPublicId` は placeholder のヒント表示用。
  const [publicId, setPublicId] = createSignal("");
  const [name, setName] = createSignal("");
  const [sex, setSex] = createSignal<"male" | "female" | "unknown">("unknown");
  const [generation, setGeneration] = createSignal<number | undefined>(
    initialCtx.generation,
  );
  const [fatherId, setFatherId] = createSignal<string | null>(initialCtx.fatherId ?? null);
  const [fatherLabel, setFatherLabel] = createSignal<string | null>(initialCtx.fatherLabel ?? null);
  const [motherId, setMotherId] = createSignal<string | null>(initialCtx.motherId ?? null);
  const [motherLabel, setMotherLabel] = createSignal<string | null>(initialCtx.motherLabel ?? null);
  // 種マスタは store から取得、空ならフォールバック 1 件
  const speciesOptions = createMemo(() => {
    const list = serverSpecies();
    if (list.length > 0) {
      return list.map((s) => ({ id: s.id, name: s.name }));
    }
    return FALLBACK_SPECIES;
  });
  const [speciesId, setSpeciesId] = createSignal<string>(
    props.defaultSpeciesId ?? initialCtx.speciesId ?? speciesOptions()[0]?.id ?? "dhh",
  );
  const [weight, setWeight] = createSignal<number | undefined>(undefined);
  const [length, setLength] = createSignal<number | undefined>(undefined);
  const [stage, setStage] = createSignal<NonNullable<SpecimenDraft["stage"]>>("larva_l3");
  const [notes, setNotes] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const buildDraft = (): SpecimenDraft => ({
    publicId: publicId() || (props.suggestedPublicId ?? ""),
    name: name() || undefined,
    sex: sex(),
    generation: generation(),
    fatherId: fatherId() ?? undefined,
    motherId: motherId() ?? undefined,
    fatherLabel: fatherLabel() ?? undefined,
    motherLabel: motherLabel() ?? undefined,
    speciesId: speciesId(),
    cohortId: props.cohortId,
    weightG: weight(),
    sizeMm: length(),
    stage: stage(),
    notes: notes() || undefined,
  });

  const persistContext = () => {
    const ctx: ContextDraft = {
      speciesId: speciesId(),
      fatherId: fatherId() ?? undefined,
      motherId: motherId() ?? undefined,
      fatherLabel: fatherLabel() ?? undefined,
      motherLabel: motherLabel() ?? undefined,
      generation: generation(),
    };
    writeJSON(CTX_KEY, ctx);
  };

  const submit = async (continueAfter: boolean) => {
    if (submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      await props.onSubmit(buildDraft());
      if (continueAfter) {
        // コンテキスト保持 + リセット
        persistContext();
        setPublicId(""); // 次の自動採番に任せる
        setName("");
        setSex("unknown");
        setWeight(undefined);
        setLength(undefined);
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

  const previewId = createMemo(() => publicId() || (props.suggestedPublicId ?? "—"));

  return (
    <form class="reg-form" onSubmit={onSubmitForm}>
      <div class="page-head">
        <div>
          <div class="cat">飼育</div>
          <h1>個体を登録</h1>
          <p class="page-head-sub">
            所有する個体を 1 件ずつ登録 — 群からの個体化は群詳細から
          </p>
        </div>
        <div class="reg-form__preview">
          <span class="reg-form__preview-label">プレビュー</span>
          <span class="reg-form__preview-id mn">{previewId()}</span>
        </div>
      </div>

      {/* 基本情報 */}
      <section class="card reg-form__section">
        <p class="reg-form__section-label">基本情報</p>
        <div class="reg-form__grid reg-form__grid--3">
          <div class="reg-form__field">
            <label class="reg-form__label" for="reg-public-id">個体 ID</label>
            <input
              id="reg-public-id"
              type="text"
              class="reg-form__input mn"
              value={publicId()}
              placeholder={props.suggestedPublicId ?? ""}
              onInput={(e) => setPublicId(e.currentTarget.value)}
            />
            <p class="reg-form__hint">自動採番 / 上書き可</p>
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label" for="reg-name">名前 (任意)</label>
            <input
              id="reg-name"
              type="text"
              class="reg-form__input"
              placeholder="例: ボス雄"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label">性別</label>
            <div class="seg" role="radiogroup">
              <For each={SEX_OPTIONS}>
                {(opt) => (
                  <button
                    type="button"
                    class={"seg__btn" + (sex() === opt.value ? " is-active" : "")}
                    role="radio"
                    aria-checked={sex() === opt.value}
                    onClick={() => setSex(opt.value)}
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </section>

      {/* 血統情報 */}
      <section class="card reg-form__section">
        <p class="reg-form__section-label">血統情報</p>
        <div class="reg-form__grid reg-form__grid--blood">
          <div class="reg-form__field">
            <label class="reg-form__label" for="reg-gen">累代</label>
            <select
              id="reg-gen"
              class="reg-form__input ser"
              value={generation() ?? ""}
              onChange={(e) =>
                setGeneration(
                  e.currentTarget.value === ""
                    ? undefined
                    : Number(e.currentTarget.value),
                )
              }
            >
              <option value="">—</option>
              <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8]}>
                {(n) => <option value={n}>F{n}</option>}
              </For>
            </select>
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label">父個体 (任意)</label>
            <ParentSpecimenSelector
              role="father"
              value={fatherId()}
              label={fatherLabel()}
              speciesId={speciesId()}
              onChange={({ id, label }) => {
                setFatherId(id);
                setFatherLabel(label);
              }}
            />
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label">母個体 (任意)</label>
            <ParentSpecimenSelector
              role="mother"
              value={motherId()}
              label={motherLabel()}
              speciesId={speciesId()}
              onChange={({ id, label }) => {
                setMotherId(id);
                setMotherLabel(label);
              }}
            />
          </div>
        </div>
      </section>

      {/* 初期計測 */}
      <section class="card reg-form__section">
        <p class="reg-form__section-label">初期計測 (任意)</p>
        <div class="reg-form__grid reg-form__grid--3">
          <div class="reg-form__field">
            <label class="reg-form__label">体重 <span class="reg-form__unit">(g)</span></label>
            <SpecimenSpinner value={weight()} onChange={setWeight} step={0.1} decimals={2} min={0} />
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label">体長 <span class="reg-form__unit">(mm)</span></label>
            <SpecimenSpinner value={length()} onChange={setLength} step={1} min={0} />
          </div>
          <div class="reg-form__field">
            <label class="reg-form__label">ステージ</label>
            <div class="seg" role="radiogroup">
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
        </div>
      </section>

      {/* 個別メモ */}
      <section class="card reg-form__section">
        <p class="reg-form__section-label">個別メモ</p>
        <textarea
          class="reg-form__input reg-form__textarea"
          placeholder="例: 兄弟より一回り大きい・前胸幅広め"
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
          {submitting() ? "送信中…" : "登録する  ⏎"}
        </button>
      </div>
    </form>
  );
};
