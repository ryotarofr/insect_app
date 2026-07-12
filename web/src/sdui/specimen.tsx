/**
 * 飼育管理ドメインのブロックレンダラ。
 *
 * タブ = ユーザ定義グループ(虫かご等、自由作成)。ラベルはドメインデータであり
 * SDUI スキーマは関与しない(specimen_list { key } のまま)。
 *
 * フォーム類は SDUI 語彙ではなく固定コード部品。書き込みは通常の REST →成功後に
 * actions.refreshAll() で再fetch(クライアントにローカル状態を残さない)。
 */
import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import {
  addCareLog,
  createGroup,
  createSpecimen,
  deleteCareLog,
  deleteGroup,
  deleteSpecimen,
  fetchGroups,
  patchGroup,
  patchSpecimen,
  putSpeciesNote,
  type GroupInfo,
} from "./api";
import { useSduiActions } from "./actions";
import type { CareLogEntry, SpecimenGroup, SpecimenProfileContent } from "./types";

/** APIエラーからユーザ向けメッセージ部分を取り出す("... failed: 422 " 以降) */
const apiMessage = (e: unknown) =>
  String(e)
    .replace(/^Error:\s*/, "")
    .replace(/^[A-Z]+ \S+ failed: \d+\s*/, "");

const today = () => new Date().toISOString().slice(0, 10);

// ── specimen_list: グループタブ + 行リスト + 追加モーダル ──────

// 選択状態はモジュールスコープに置く: 保存後の再fetchで <For> がカードを再生成
// (=コンポーネント再マウント)しても、タブ選択とアコーディオン展開を維持するため。
// specimen_list はアプリ内1箇所の前提(複数配置するなら block key 毎の Map にする)。
const [activeId, setActiveId] = createSignal<string | null>(null);
const [openId, setOpenId] = createSignal<string | null>(null);

/**
 * なめらかな開閉。grid-template-rows 0fr↔1fr で高さautoをアニメーションし、
 * 閉じる時はトランジション完了までアンマウントを遅延させる。
 */
function Collapse(props: { open: boolean; children: JSX.Element }) {
  const [mounted, setMounted] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  createEffect(() => {
    if (props.open) {
      setMounted(true);
      // 一度 0fr で描画してから 1fr へ(初回マウント時にトランジションを効かせる)
      requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    } else {
      setExpanded(false); // 0fr へ遷移。アンマウントは onTransitionEnd で
    }
  });

  return (
    <Show when={mounted()}>
      <div
        class="sd-collapse"
        classList={{ "sd-collapse--open": expanded() }}
        onTransitionEnd={e => {
          if (e.target === e.currentTarget && !props.open) setMounted(false);
        }}
      >
        <div class="sd-collapse-inner">{props.children}</div>
      </div>
    </Show>
  );
}

export function SpecimenListView(props: { groups: SpecimenGroup[] }) {
  const actions = useSduiActions();
  const [adding, setAdding] = createSignal(false); // 個体追加モーダル
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [addingTab, setAddingTab] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  // アクティブタブ。削除等で消えた場合は最初の空でないグループへフォールバック
  const active = () => {
    const id = activeId();
    if (id && props.groups.some(g => g.groupId === id)) return id;
    return (props.groups.find(g => g.count > 0) ?? props.groups[0])?.groupId ?? null;
  };
  const current = () => props.groups.find(g => g.groupId === active());

  const saveNewTab = async () => {
    if (!draft().trim() || busy()) return;
    setBusy(true);
    try {
      const created = await createGroup(draft().trim());
      setAddingTab(false);
      setDraft("");
      setActiveId(created.groupId);
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (groupId: string) => {
    if (!draft().trim() || busy()) return;
    setBusy(true);
    try {
      await patchGroup(groupId, draft().trim());
      setRenamingId(null);
      setDraft("");
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeTab = async (group: { groupId: string; label: string }) => {
    if (!confirm(`タブ「${group.label}」を削除しますか?`)) return;
    try {
      await deleteGroup(group.groupId);
      if (activeId() === group.groupId) setActiveId(null);
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div class="sd-speclist">
      <div class="sd-speclist-toolbar">
        <button class="sd-btn" onClick={() => setAdding(true)}>
          ＋ 個体を追加
        </button>
      </div>

      <div class="sd-speclist-layout">
        <nav class="sd-vtabs">
          <For each={props.groups}>
            {g => (
              <div
                class="sd-vtab"
                classList={{ "sd-vtab--on": g.groupId === active() }}
                onClick={() => setActiveId(g.groupId)}
              >
                <Show
                  when={renamingId() === g.groupId}
                  fallback={
                    <>
                      <span class="sd-vtab-label">{g.label}</span>
                      <Show when={g.groupId === active()}>
                        <button
                          class="sd-vtab-tool"
                          title="タブ名を変更"
                          onClick={e => {
                            e.stopPropagation();
                            setAddingTab(false);
                            setDraft(g.label);
                            setRenamingId(g.groupId);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          class="sd-vtab-tool"
                          title={
                            g.count > 0
                              ? "個体が所属しているタブは削除できません"
                              : "タブを削除"
                          }
                          disabled={g.count > 0}
                          onClick={e => {
                            e.stopPropagation();
                            void removeTab(g);
                          }}
                        >
                          ✕
                        </button>
                      </Show>
                      <span class="sd-vtab-badge">{g.count}</span>
                    </>
                  }
                >
                  <input
                    value={draft()}
                    onClick={e => e.stopPropagation()}
                    onInput={e => setDraft(e.currentTarget.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") void saveRename(g.groupId);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                  <button
                    class="sd-vtab-tool"
                    title="保存"
                    onClick={e => {
                      e.stopPropagation();
                      void saveRename(g.groupId);
                    }}
                  >
                    ✓
                  </button>
                  <button
                    class="sd-vtab-tool"
                    title="キャンセル"
                    onClick={e => {
                      e.stopPropagation();
                      setRenamingId(null);
                    }}
                  >
                    ✕
                  </button>
                </Show>
              </div>
            )}
          </For>

          <Show
            when={addingTab()}
            fallback={
              <div
                class="sd-vtab sd-vtab--add"
                onClick={() => {
                  setRenamingId(null);
                  setDraft("");
                  setAddingTab(true);
                }}
              >
                ＋ タブを追加
              </div>
            }
          >
            <div class="sd-vtab">
              <input
                placeholder="例: 虫かご1"
                value={draft()}
                onInput={e => setDraft(e.currentTarget.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") void saveNewTab();
                  if (e.key === "Escape") setAddingTab(false);
                }}
              />
              <button class="sd-vtab-tool" title="追加" onClick={() => void saveNewTab()}>
                ✓
              </button>
              <button class="sd-vtab-tool" title="キャンセル" onClick={() => setAddingTab(false)}>
                ✕
              </button>
            </div>
          </Show>
        </nav>

        <div class="sd-rowlist">
          <For each={current()?.items ?? []}>
            {item => {
              const open = () => openId() === item.specimenId;
              return (
                <div class="sd-rowitem">
                  <button
                    class="sd-row"
                    classList={{ "sd-row--open": open() }}
                    onClick={() => setOpenId(open() ? null : item.specimenId)}
                  >
                    <span class="sd-row-main">
                      <span class="sd-row-code">{item.code}</span>
                      <span class="sd-row-name">{item.name}</span>
                    </span>
                    <span class="sd-row-meta" classList={{ "sd-row-meta--alert": item.alert }}>
                      {item.alert ? "⚠ " : ""}
                      {item.hint ?? ""}
                    </span>
                    <span class="sd-row-chevron" classList={{ "sd-row-chevron--open": open() }}>
                      ▾
                    </span>
                  </button>
                  <Collapse open={open() && !!actions?.renderSpecimenDetail}>
                    <div class="sd-row-detail">
                      {actions?.renderSpecimenDetail?.(item.specimenId)}
                    </div>
                  </Collapse>
                </div>
              );
            }}
          </For>
          <Show when={(current()?.items.length ?? 0) === 0}>
            <div class="sd-empty">このグループの個体はいません</div>
          </Show>
        </div>
      </div>

      <Show when={adding()}>
        <AddSpecimenModal
          groups={props.groups.map(g => ({ groupId: g.groupId, label: g.label }))}
          defaultGroupId={active()}
          onClose={() => setAdding(false)}
        />
      </Show>
    </div>
  );
}

/**
 * 個体追加モーダル。詳細のプロフィール編集と同じ項目構成
 * (飼育記録セクションのみ無し)。グループ初期値は現在のタブ。
 */
function AddSpecimenModal(props: {
  groups: GroupInfo[];
  defaultGroupId: string | null;
  onClose: () => void;
}) {
  const actions = useSduiActions();
  const [busy, setBusy] = createSignal(false);
  const [d, setD] = createSignal<Record<string, string>>({
    groupId: props.defaultGroupId ?? props.groups[0]?.groupId ?? "",
  });
  const set = (key: string, value: string) => setD({ ...d(), [key]: value });
  const canSave = () =>
    !!(d().code?.trim() && d().name?.trim() && d().speciesName?.trim() && d().groupId) && !busy();

  const save = async () => {
    if (!canSave()) return;
    setBusy(true);
    try {
      const v = d();
      await createSpecimen({
        code: v.code,
        name: v.name,
        speciesName: v.speciesName,
        groupId: v.groupId,
        scientificName: v.scientificName || undefined,
        sex: v.sex || undefined,
        line: v.line || undefined,
        measure: v.measure || undefined,
        eggDate: v.eggDate || undefined,
        nextAction: v.nextAction || undefined,
      });
      if (v.speciesNote?.trim()) {
        await putSpeciesNote(v.speciesName, v.speciesNote.trim());
      }
      actions?.refreshAll();
      props.onClose();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: string, placeholder = ""): JSX.Element => (
    <label class="sd-field">
      {label}
      <input
        value={d()[key] ?? ""}
        placeholder={placeholder}
        onInput={e => set(key, e.currentTarget.value)}
      />
    </label>
  );

  return (
    <div class="sd-modal-backdrop" onClick={props.onClose}>
      <div class="sd-modal" onClick={e => e.stopPropagation()}>
        <button class="sd-btn sd-modal-close" onClick={props.onClose}>
          ✕
        </button>
        <div class="sd-region">
          <section class="sd-card">
            <h2 class="sd-text sd-text--headline">個体を追加</h2>
            <div class="sd-form">
              <div class="sd-form-grid2">
                {field("ID *", "code", "例: DHH-015")}
                {field("名前 *", "name", "例: ヘラクレス 3令 ♂")}
                {field("種名 *", "speciesName", "例: ヘラクレスヘラクレス")}
                {field("学名", "scientificName", "例: Dynastes hercules hercules")}
                {field("性別", "sex", "♂ / ♀")}
                <label class="sd-field">
                  グループ
                  <select value={d().groupId} onChange={e => set("groupId", e.currentTarget.value)}>
                    <For each={props.groups}>
                      {g => <option value={g.groupId}>{g.label}</option>}
                    </For>
                  </select>
                </label>
                {field("累代", "line", "例: CB F2")}
                {field("最終計測", "measure", "例: 98g(3令)")}
                <label class="sd-field">
                  採卵日
                  <input
                    type="date"
                    value={d().eggDate ?? ""}
                    onInput={e => set("eggDate", e.currentTarget.value)}
                  />
                </label>
                {field("次のアクション", "nextAction", "例: 割出予定 7/20")}
              </div>
            </div>
          </section>
          <section class="sd-card sd-card--half">
            <h2 class="sd-text sd-text--headline">種の飼育メモ</h2>
            <div class="sd-form">
              <textarea
                rows={4}
                placeholder="任意。保存時にこの種のメモとして登録されます"
                value={d().speciesNote ?? ""}
                onInput={e => set("speciesNote", e.currentTarget.value)}
              />
            </div>
          </section>
          <section class="sd-card sd-card--half">
            <h2 class="sd-text sd-text--headline">写真</h2>
            <p class="sd-text sd-text--caption">写真アップロードは準備中です。</p>
          </section>
        </div>
        <div class="sd-form-row sd-modal-actions">
          <button class="sd-btn sd-btn--primary" disabled={!canSave()} onClick={save}>
            保存
          </button>
          <button class="sd-btn" disabled={busy()} onClick={props.onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// ── specimen_profile: プロフィール + 編集フォーム + 削除 ──────

export function SpecimenProfileView(props: { profile: SpecimenProfileContent }) {
  const actions = useSduiActions();
  const [editing, setEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [d, setD] = createSignal<Record<string, string>>({});
  const [groups, setGroups] = createSignal<GroupInfo[]>([]);
  const [confirming, setConfirming] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [delError, setDelError] = createSignal<string | null>(null);

  const doDelete = async () => {
    setDeleting(true);
    setDelError(null);
    try {
      await deleteSpecimen(props.profile.specimenId);
      setConfirming(false);
      setOpenId(null); // アコーディオンを閉じる(モジュールスコープの展開状態)
      actions?.refreshAll();
    } catch (e) {
      // 出品中(422)等はダイアログ内に表示
      setDelError(apiMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const startEdit = async () => {
    const p = props.profile;
    try {
      setGroups(await fetchGroups());
    } catch (e) {
      alert(String(e));
      return;
    }
    setD({
      speciesName: p.speciesName,
      scientificName: p.scientificName ?? "",
      sex: p.sex ?? "",
      groupId: p.groupId,
      line: p.line ?? "",
      measure: p.measure ?? "",
      eggDate: p.eggDate ? p.eggDate.replaceAll("/", "-") : "",
      nextAction: p.nextAction ?? "",
    });
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const v = d();
      await patchSpecimen(props.profile.specimenId, {
        speciesName: v.speciesName || undefined,
        scientificName: v.scientificName || undefined,
        sex: v.sex || undefined,
        groupId: v.groupId || undefined,
        line: v.line || undefined,
        measure: v.measure || undefined,
        eggDate: v.eggDate || undefined,
        nextAction: v.nextAction || undefined,
      });
      setEditing(false);
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: string, placeholder = "") => (
    <label class="sd-field">
      {label}
      <input
        value={d()[key] ?? ""}
        placeholder={placeholder}
        onInput={e => setD({ ...d(), [key]: e.currentTarget.value })}
      />
    </label>
  );

  return (
    <div class="sd-profile">
      <div class="sd-profile-head">
        <span class="sd-profile-code">{props.profile.code}</span>
        <span class="sd-text sd-text--caption">{props.profile.name}</span>
        <Show when={!editing()}>
          <button class="sd-btn sd-profile-edit" onClick={() => void startEdit()}>
            編集
          </button>
          <button
            class="sd-btn sd-btn--ghost sd-profile-del"
            onClick={() => {
              setDelError(null);
              setConfirming(true);
            }}
          >
            削除
          </button>
        </Show>
      </div>

      <Show when={confirming()}>
        <div
          class="sd-modal-backdrop"
          onClick={() => {
            if (!deleting()) setConfirming(false);
          }}
        >
          <div class="sd-modal sd-dialog" onClick={e => e.stopPropagation()}>
            <h2 class="sd-text sd-text--headline">
              「{props.profile.code} {props.profile.name}」を削除しますか?
            </h2>
            <p class="sd-text">
              飼育記録もすべて削除されます。この操作は取り消せません。
            </p>
            <Show when={delError()}>
              <p class="sd-dialog-error">⚠ {delError()}</p>
            </Show>
            <div class="sd-form-row sd-modal-actions">
              <button class="sd-btn" disabled={deleting()} onClick={() => setConfirming(false)}>
                キャンセル
              </button>
              <button
                class="sd-btn sd-btn--danger"
                disabled={deleting()}
                onClick={() => void doDelete()}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show
        when={!editing()}
        fallback={
          <div class="sd-form">
            <div class="sd-form-grid2">
              {field("種名", "speciesName")}
              {field("学名", "scientificName")}
              {field("性別", "sex", "♂ / ♀")}
              <label class="sd-field">
                グループ
                <select
                  value={d().groupId}
                  onChange={e => setD({ ...d(), groupId: e.currentTarget.value })}
                >
                  <For each={groups()}>{g => <option value={g.groupId}>{g.label}</option>}</For>
                </select>
              </label>
              {field("累代", "line", "CB F2")}
              {field("最終計測", "measure", "98g(3令)")}
              <label class="sd-field">
                採卵日
                <input
                  type="date"
                  value={d().eggDate ?? ""}
                  onInput={e => setD({ ...d(), eggDate: e.currentTarget.value })}
                />
              </label>
              {field("次のアクション", "nextAction")}
            </div>
            <div class="sd-form-row">
              <button class="sd-btn sd-btn--primary" disabled={busy()} onClick={save}>
                保存
              </button>
              <button class="sd-btn" disabled={busy()} onClick={() => setEditing(false)}>
                キャンセル
              </button>
            </div>
          </div>
        }
      >
        <p class="sd-text">
          {props.profile.speciesName}{" "}
          <span class="sd-text--caption">{props.profile.scientificName ?? ""}</span>
        </p>
        <div class="sd-chips">
          <Show when={props.profile.sex}>
            <span class="sd-chip">{props.profile.sex}</span>
          </Show>
          <span class="sd-chip">
            グループ: <b>{props.profile.groupLabel}</b>
          </span>
          <Show when={props.profile.line}>
            <span class="sd-chip">累代: {props.profile.line}</span>
          </Show>
          <Show when={props.profile.measure}>
            <span class="sd-chip">最終計測: {props.profile.measure}</span>
          </Show>
          <Show when={props.profile.eggDate}>
            <span class="sd-chip">採卵: {props.profile.eggDate}</span>
          </Show>
        </div>
        <Show when={props.profile.nextAction}>
          <div class="sd-next">次のアクション: {props.profile.nextAction}</div>
        </Show>
      </Show>
    </div>
  );
}

// ── care_log_list: 記録の一覧 + 追加 + 削除 ──────────────────

export function CareLogListView(props: { specimenId: string; entries: CareLogEntry[] }) {
  const actions = useSduiActions();
  const [adding, setAdding] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [d, setD] = createSignal({ at: today(), kind: "メモ", body: "" });

  const save = async () => {
    if (!d().kind.trim()) return;
    setBusy(true);
    try {
      await addCareLog(props.specimenId, d());
      setAdding(false);
      setD({ at: today(), kind: "メモ", body: "" });
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (logId: string) => {
    try {
      await deleteCareLog(logId);
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div class="sd-loglist">
      <div class="sd-speclist-toolbar">
        <button class="sd-btn" onClick={() => setAdding(!adding())}>
          ＋ 記録を追加
        </button>
      </div>
      <Show when={adding()}>
        <div class="sd-form sd-form--boxed">
          <div class="sd-form-grid3">
            <input
              type="date"
              value={d().at}
              onInput={e => setD({ ...d(), at: e.currentTarget.value })}
            />
            <input
              placeholder="種別 (例: メモ / マット交換)"
              value={d().kind}
              onInput={e => setD({ ...d(), kind: e.currentTarget.value })}
            />
            <input
              placeholder="内容"
              value={d().body}
              onInput={e => setD({ ...d(), body: e.currentTarget.value })}
            />
          </div>
          <div class="sd-form-row">
            <button class="sd-btn sd-btn--primary" disabled={busy()} onClick={save}>
              追加
            </button>
            <button class="sd-btn" disabled={busy()} onClick={() => setAdding(false)}>
              キャンセル
            </button>
          </div>
        </div>
      </Show>
      <Show
        when={props.entries.length > 0}
        fallback={<p class="sd-text sd-text--caption">記録はまだありません</p>}
      >
        <div>
          <For each={props.entries}>
            {log => (
              <div class="sd-logrow">
                <span class="sd-logrow-date">{log.at}</span>
                <span class="sd-logrow-kind">{log.kind}</span>
                <span class="sd-logrow-body">{log.body}</span>
                <button
                  class="sd-btn sd-btn--ghost"
                  title="この記録を削除"
                  onClick={() => del(log.logId)}
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// ── species_note: 種ごとのメモ(ドメインデータ)+ 編集 ────────

export function SpeciesNoteView(props: { speciesName: string; note: string }) {
  const actions = useSduiActions();
  const [editing, setEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const save = async () => {
    setBusy(true);
    try {
      await putSpeciesNote(props.speciesName, draft());
      setEditing(false);
      actions?.refresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show
      when={editing()}
      fallback={
        <div class="sd-textwrap">
          <p class="sd-text">{props.note}</p>
          <button
            class="sd-btn sd-btn--ghost sd-editbtn"
            onClick={() => {
              setDraft(props.note);
              setEditing(true);
            }}
          >
            編集
          </button>
        </div>
      }
    >
      <div class="sd-form">
        <textarea rows={4} value={draft()} onInput={e => setDraft(e.currentTarget.value)} />
        <div class="sd-form-row">
          <button class="sd-btn sd-btn--primary" disabled={busy()} onClick={save}>
            保存
          </button>
          <button class="sd-btn" disabled={busy()} onClick={() => setEditing(false)}>
            キャンセル
          </button>
        </div>
      </div>
    </Show>
  );
}
