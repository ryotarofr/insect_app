/**
 * 飼育管理ドメインのブロックレンダラ。
 *
 * タブ = ユーザ定義グループ(虫かご等、自由作成)。ラベルはドメインデータであり
 * SDUI スキーマは関与しない(specimen_list { key } のまま)。
 *
 * フォーム類は SDUI 語彙ではなく固定コード部品。書き込みは通常の REST →成功後に
 * actions.refreshAll() で再fetch(クライアントにローカル状態を残さない)。
 */
import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createResource, createSignal, type JSX } from "solid-js";
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
import { Button, Chip, Empty, Field, FormStack, Grid, Row, Text } from "./primitives";
import type {
  CareLogEntry,
  GroupTabItem,
  SpecimenGroup,
  SpecimenItem,
  SpecimenProfileContent,
} from "./types";

/** APIエラーからユーザ向けメッセージ部分を取り出す("... failed: 422 " 以降) */
const apiMessage = (e: unknown) =>
  String(e)
    .replace(/^Error:\s*/, "")
    .replace(/^[A-Z]+ \S+ failed: \d+\s*/, "");

const today = () => new Date().toISOString().slice(0, 10);

// ── group_tabs / specimen_rows: specimen_list の分割後継(Phase 2)──
//
// ブロック間で共有される状態はページコンテキスト = URL に置く:
//   選択タブ → ?group=(サーバが解決し、view の activeGroupId として返る)
//   行の展開 → ?open=
// 再fetchでコンポーネントが再マウントされても状態は URL にあるため失われない。
// 旧実装のモジュールスコープ signal(アプリ内1箇所前提の負債)はこれで廃止。

/** searchParams の値を単一文字列へ正規化(重複クエリは先頭を採用) */
export const firstParam = (v: string | string[] | undefined | null): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

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

/**
 * group_tabs ブロック: グループタブ帯(specimen_list の分割後継・タブのみ)。
 *
 * 選択表示は content.activeGroupId(サーバ解決値)= 表示のSSOTはビュー。
 * タブ切替は URL(?group=)の更新だけを行い、care 側のリソースが URL に連動して
 * 再fetchする。追加/改名/削除のインラインフォームは固定コードのまま(REFACTOR §2)。
 */
export function GroupTabsView(props: {
  content: { key: string; activeGroupId?: string; groups: GroupTabItem[] };
}) {
  const actions = useSduiActions();
  const [params, setParams] = useSearchParams();
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [addingTab, setAddingTab] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const active = () => props.content.activeGroupId ?? null;
  // タブ切替 = URL 更新のみ。展開(?open=)は別グループへ持ち越さない
  const selectTab = (groupId: string) => setParams({ group: groupId, open: undefined });

  const saveNewTab = async () => {
    if (!draft().trim() || busy()) return;
    setBusy(true);
    try {
      const created = await createGroup(draft().trim());
      setAddingTab(false);
      setDraft("");
      selectTab(created.groupId); // URL 変更で再fetchされ、新タブがアクティブ表示になる
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
      if (firstParam(params.group) === group.groupId) {
        // URL が消えたタブを指していたら既定選択(サーバ解決)へ戻す
        setParams({ group: undefined, open: undefined });
      }
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <nav class="sd-vtabs">
      <For each={props.content.groups}>
        {g => (
          <div
            class="sd-vtab"
            classList={{ "sd-vtab--on": g.groupId === active() }}
            onClick={() => selectTab(g.groupId)}
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
                  if (e.key === "Enter" && !e.isComposing) void saveRename(g.groupId);
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
              if (e.key === "Enter" && !e.isComposing) void saveNewTab();
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
  );
}

/**
 * specimen_rows ブロック: 選択グループの個体行(specimen_list の分割後継・行のみ)。
 * 展開行は ?open= に置く(再fetch・再マウントを跨いで保持。履歴は汚さない replace)。
 * 詳細は従来どおり renderSpecimenDetail 注入で行直下に描画する。
 */
export function SpecimenRowsView(props: {
  content: { key: string; groupId?: string; items: SpecimenItem[]; emptyText?: string };
}) {
  const actions = useSduiActions();
  const [params, setParams] = useSearchParams();
  const openId = () => firstParam(params.open) ?? null;
  const toggle = (specimenId: string) =>
    setParams({ open: openId() === specimenId ? undefined : specimenId }, { replace: true });

  return (
    <div class="sd-rowlist">
      <For each={props.content.items}>
        {item => {
          const open = () => openId() === item.specimenId;
          return (
            <div class="sd-rowitem">
              <button
                class="sd-row"
                classList={{ "sd-row--open": open() }}
                onClick={() => toggle(item.specimenId)}
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
      <Show when={props.content.items.length === 0}>
        {/* 空状態の文言は定義側 emptyText を優先(未指定はコード既定) */}
        <Empty>{props.content.emptyText ?? "このグループの個体はいません"}</Empty>
      </Show>
    </div>
  );
}

/**
 * 【非推奨】specimen_list ブロックのレンダラ。Phase 2 で group_tabs + specimen_rows に
 * 分割され、標準定義からは使われていない(古い定義の後方互換のためにのみ残す。
 * 語彙からの削除は schemaVersion++ の破壊的変更で行う)。
 * 選択/展開はコンポーネントローカルのため、再fetchによる再マウントで失われる(許容)。
 */
export function SpecimenListView(props: { groups: SpecimenGroup[] }) {
  const actions = useSduiActions();
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [openId, setOpenId] = createSignal<string | null>(null);
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
      {/* 「+ 個体を追加」ボタンは定義管理の action_button ブロックへ移行(Phase 1)。
          このブロックはタブ+行リストの描画に専念する */}
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
                      if (e.key === "Enter" && !e.isComposing) void saveRename(g.groupId);
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
                  if (e.key === "Enter" && !e.isComposing) void saveNewTab();
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
    </div>
  );
}

/**
 * 個体追加モーダル。詳細のプロフィール編集と同じ項目構成
 * (飼育記録セクションのみ無し)。グループ初期値は現在のタブ。
 *
 * action_button("add_specimen")の動詞実装としてページ(care)が開く固定コード部品
 * (フォームの中身の語彙化は Phase 4 のテーマ = docs/REFACTOR.md §2 の線引き)。
 * グループ一覧は自分で fetch する(呼び出し側が hydrate 済み groups を持つ前提を無くす)。
 */
export function AddSpecimenModal(props: {
  defaultGroupId: string | null;
  onClose: () => void;
}) {
  const actions = useSduiActions();
  const [groups] = createResource(fetchGroups);
  const [busy, setBusy] = createSignal(false);
  const [d, setD] = createSignal<Record<string, string>>({
    groupId: props.defaultGroupId ?? "",
  });
  // グループ一覧の到着後、未確定/無効なら先頭グループへ補完(d は追跡しない: 関数型 setD)
  createEffect(() => {
    const gs = groups();
    if (!gs || gs.length === 0) return;
    setD(prev =>
      prev.groupId && gs.some(g => g.groupId === prev.groupId)
        ? prev
        : { ...prev, groupId: gs[0].groupId },
    );
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
    <Field label={label}>
      <input
        value={d()[key] ?? ""}
        placeholder={placeholder}
        onInput={e => set(key, e.currentTarget.value)}
      />
    </Field>
  );

  return (
    <div class="sd-modal-backdrop" onClick={props.onClose}>
      <div class="sd-modal" onClick={e => e.stopPropagation()}>
        <Button class="sd-modal-close" onClick={props.onClose}>
          ✕
        </Button>
        <div class="sd-region">
          <section class="sd-card">
            <Text role="headline">個体を追加</Text>
            <FormStack>
              <Grid cols={2}>
                {field("ID *", "code", "例: DHH-015")}
                {field("名前 *", "name", "例: ヘラクレス 3令 ♂")}
                {field("種名 *", "speciesName", "例: ヘラクレスヘラクレス")}
                {field("学名", "scientificName", "例: Dynastes hercules hercules")}
                {field("性別", "sex", "♂ / ♀")}
                <Field label="グループ">
                  <select value={d().groupId} onChange={e => set("groupId", e.currentTarget.value)}>
                    <For each={groups() ?? []}>
                      {g => <option value={g.groupId}>{g.label}</option>}
                    </For>
                  </select>
                </Field>
                {field("累代", "line", "例: CB F2")}
                {field("最終計測", "measure", "例: 98g(3令)")}
                <Field label="採卵日">
                  <input
                    type="date"
                    value={d().eggDate ?? ""}
                    onInput={e => set("eggDate", e.currentTarget.value)}
                  />
                </Field>
                {field("次のアクション", "nextAction", "例: 割出予定 7/20")}
              </Grid>
            </FormStack>
          </section>
          <section class="sd-card sd-card--half">
            <Text role="headline">種の飼育メモ</Text>
            <FormStack>
              <textarea
                rows={4}
                placeholder="任意。保存時にこの種のメモとして登録されます"
                value={d().speciesNote ?? ""}
                onInput={e => set("speciesNote", e.currentTarget.value)}
              />
            </FormStack>
          </section>
          <section class="sd-card sd-card--half">
            <Text role="headline">写真</Text>
            <Text role="caption">写真アップロードは準備中です。</Text>
          </section>
        </div>
        <Row gap="sm" class="sd-modal-actions">
          <Button intent="primary" disabled={!canSave()} onClick={save}>
            保存
          </Button>
          <Button disabled={busy()} onClick={props.onClose}>
            キャンセル
          </Button>
        </Row>
      </div>
    </div>
  );
}

// ── specimen_profile: プロフィール + 編集フォーム + 削除 ──────

export function SpecimenProfileView(props: { profile: SpecimenProfileContent }) {
  const actions = useSduiActions();
  const [, setParams] = useSearchParams();
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
      setParams({ open: undefined }, { replace: true }); // アコーディオン(?open=)を閉じる
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
    <Field label={label}>
      <input
        value={d()[key] ?? ""}
        placeholder={placeholder}
        onInput={e => setD({ ...d(), [key]: e.currentTarget.value })}
      />
    </Field>
  );

  return (
    <div class="sd-profile">
      <div class="sd-profile-head">
        <span class="sd-profile-code">{props.profile.code}</span>
        <span class="sd-text sd-text--caption">{props.profile.name}</span>
        <Show when={!editing()}>
          <Button class="sd-profile-edit" onClick={() => void startEdit()}>
            編集
          </Button>
          <Button
            intent="ghost"
            class="sd-profile-del"
            onClick={() => {
              setDelError(null);
              setConfirming(true);
            }}
          >
            削除
          </Button>
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
            <Text role="headline">
              「{props.profile.code} {props.profile.name}」を削除しますか?
            </Text>
            <Text>飼育記録もすべて削除されます。この操作は取り消せません。</Text>
            <Show when={delError()}>
              <p class="sd-dialog-error">⚠ {delError()}</p>
            </Show>
            <Row gap="sm" class="sd-modal-actions">
              <Button disabled={deleting()} onClick={() => setConfirming(false)}>
                キャンセル
              </Button>
              <Button intent="danger" disabled={deleting()} onClick={() => void doDelete()}>
                削除する
              </Button>
            </Row>
          </div>
        </div>
      </Show>

      <Show
        when={!editing()}
        fallback={
          <FormStack>
            <Grid cols={2}>
              {field("種名", "speciesName")}
              {field("学名", "scientificName")}
              {field("性別", "sex", "♂ / ♀")}
              <Field label="グループ">
                <select
                  value={d().groupId}
                  onChange={e => setD({ ...d(), groupId: e.currentTarget.value })}
                >
                  <For each={groups()}>{g => <option value={g.groupId}>{g.label}</option>}</For>
                </select>
              </Field>
              {field("累代", "line", "CB F2")}
              {field("最終計測", "measure", "98g(3令)")}
              <Field label="採卵日">
                <input
                  type="date"
                  value={d().eggDate ?? ""}
                  onInput={e => setD({ ...d(), eggDate: e.currentTarget.value })}
                />
              </Field>
              {field("次のアクション", "nextAction")}
            </Grid>
            <Row gap="sm">
              <Button intent="primary" disabled={busy()} onClick={save}>
                保存
              </Button>
              <Button disabled={busy()} onClick={() => setEditing(false)}>
                キャンセル
              </Button>
            </Row>
          </FormStack>
        }
      >
        <Text>
          {props.profile.speciesName}{" "}
          <span class="sd-text--caption">{props.profile.scientificName ?? ""}</span>
        </Text>
        <Row wrap gap="sm">
          <Show when={props.profile.sex}>
            <Chip>{props.profile.sex}</Chip>
          </Show>
          <Chip>
            グループ: <b>{props.profile.groupLabel}</b>
          </Chip>
          <Show when={props.profile.line}>
            <Chip>累代: {props.profile.line}</Chip>
          </Show>
          <Show when={props.profile.measure}>
            <Chip>最終計測: {props.profile.measure}</Chip>
          </Show>
          <Show when={props.profile.eggDate}>
            <Chip>採卵: {props.profile.eggDate}</Chip>
          </Show>
        </Row>
        <Show when={props.profile.nextAction}>
          <div class="sd-next">次のアクション: {props.profile.nextAction}</div>
        </Show>
      </Show>
    </div>
  );
}

// ── care_log_list: 記録の一覧 + 追加 + 削除 ──────────────────

export function CareLogListView(props: {
  specimenId: string;
  entries: CareLogEntry[];
  emptyText?: string;
}) {
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
      <Row justify="end" gap="sm">
        <Button onClick={() => setAdding(!adding())}>＋ 記録を追加</Button>
      </Row>
      <Show when={adding()}>
        <FormStack boxed>
          <Grid cols={3}>
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
          </Grid>
          <Row gap="sm">
            <Button intent="primary" disabled={busy()} onClick={save}>
              追加
            </Button>
            <Button disabled={busy()} onClick={() => setAdding(false)}>
              キャンセル
            </Button>
          </Row>
        </FormStack>
      </Show>
      <Show
        when={props.entries.length > 0}
        fallback={<Text role="caption">{props.emptyText ?? "記録はまだありません"}</Text>}
      >
        <div>
          <For each={props.entries}>
            {log => (
              <div class="sd-logrow">
                <span class="sd-logrow-date">{log.at}</span>
                <span class="sd-logrow-kind">{log.kind}</span>
                <span class="sd-logrow-body">{log.body}</span>
                <Button intent="ghost" title="この記録を削除" onClick={() => del(log.logId)}>
                  ✕
                </Button>
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
          <Text>{props.note}</Text>
          <Button
            intent="ghost"
            class="sd-editbtn"
            onClick={() => {
              setDraft(props.note);
              setEditing(true);
            }}
          >
            編集
          </Button>
        </div>
      }
    >
      <FormStack>
        <textarea rows={4} value={draft()} onInput={e => setDraft(e.currentTarget.value)} />
        <Row gap="sm">
          <Button intent="primary" disabled={busy()} onClick={save}>
            保存
          </Button>
          <Button disabled={busy()} onClick={() => setEditing(false)}>
            キャンセル
          </Button>
        </Row>
      </FormStack>
    </Show>
  );
}
