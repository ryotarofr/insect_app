/**
 * ユーザウィジェットのブロックレンダラ(todo_list / care_alerts)。
 *
 * 定義が持つのは配置だけで、中身(TODO)と設定(通知のしきい値)はユーザ毎の
 * ドメインデータ。書き込みは通常の REST → 成功後に refreshAll(既存パターン)。
 * フォームは固定コード部品(REFACTOR §2 の線引き)。
 */
import { For, Show, createSignal } from "solid-js";
import { addTodo, deleteTodo, patchNotificationPrefs, patchTodo } from "./api";
import { useSduiActions } from "./actions";
import { Button, FormStack, Row, Text } from "./primitives";
import type { AlertItem, TodoItem } from "./types";

// ── todo_list: 個人TODO(追加/チェック/削除)──────────────────

export function TodoListView(props: {
  content: { key: string; items: TodoItem[]; emptyText?: string };
}) {
  const actions = useSduiActions();
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const add = async () => {
    if (!draft().trim() || busy()) return;
    setBusy(true);
    try {
      await addTodo(draft().trim());
      setDraft("");
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };
  // Enter は追加のみ(暗黙のフォーム送信等の既定動作は常に抑止)

  const toggle = async (t: TodoItem) => {
    try {
      await patchTodo(t.todoId, { done: !t.done });
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    }
  };

  const del = async (t: TodoItem) => {
    try {
      await deleteTodo(t.todoId);
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <FormStack>
      <Row gap="sm">
        <input
          class="sd-todo-input"
          placeholder="やることを追加"
          value={draft()}
          onInput={e => setDraft(e.currentTarget.value)}
          onKeyDown={e => {
            // isComposing: IME変換確定の Enter では追加しない
            if (e.key === "Enter" && !e.isComposing) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <Button intent="primary" disabled={busy()} onClick={() => void add()}>
          追加
        </Button>
      </Row>
      <Show
        when={props.content.items.length > 0}
        fallback={<Text role="caption">{props.content.emptyText ?? "TODOはありません"}</Text>}
      >
        <div>
          <For each={props.content.items}>
            {t => (
              <Row gap="sm" class="sd-todorow">
                <label class="sd-todo-label" classList={{ "sd-todo--done": t.done }}>
                  <input type="checkbox" checked={t.done} onChange={() => void toggle(t)} />
                  {t.body}
                </label>
                <Button intent="ghost" title="このTODOを削除" onClick={() => void del(t)}>
                  ✕
                </Button>
              </Row>
            )}
          </For>
        </div>
      </Show>
    </FormStack>
  );
}

// ── care_alerts: アプリ内通知(警告リスト+しきい値設定)──────

export function CareAlertsView(props: {
  content: {
    key: string;
    enabled: boolean;
    staleDays: number;
    items: AlertItem[];
    emptyText?: string;
  };
}) {
  const actions = useSduiActions();
  // 画面遷移(タブ切替+展開)は actions provider 経由。プレビュー等、
  // provider が revealSpecimen を持たない文脈では行は静的表示になる
  const reveal = () => actions?.revealSpecimen;
  const [days, setDays] = createSignal(String(props.content.staleDays));
  const [busy, setBusy] = createSignal(false);

  const applyDays = async () => {
    const d = Number(days());
    if (!Number.isInteger(d) || d < 1 || d > 365) {
      alert("日数は1〜365で入力してください");
      return;
    }
    setBusy(true);
    try {
      await patchNotificationPrefs({ staleDays: d });
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async () => {
    try {
      await patchNotificationPrefs({ enabled: !props.content.enabled });
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <FormStack>
      <Show when={props.content.enabled} fallback={<Text role="caption">通知は無効です</Text>}>
        <Show
          when={props.content.items.length > 0}
          fallback={
            <Text role="caption">{props.content.emptyText ?? "警告はありません"}</Text>
          }
        >
          <div>
            {/* クリックで該当タブへ切替+行を展開(実装は care ページの revealSpecimen) */}
            <For each={props.content.items}>
              {a => (
                <button
                  class="sd-alertrow"
                  disabled={!reveal()}
                  onClick={() => reveal()?.(a.groupId, a.specimenId)}
                >
                  <span class="sd-row-code">{a.code}</span>
                  <span class="sd-alertrow-name">{a.name}</span>
                  <span class="sd-alertrow-reason">⚠ {a.reason}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
      <Row wrap gap="sm">
        <label class="sd-alert-toggle">
          <input
            type="checkbox"
            checked={props.content.enabled}
            onChange={() => void toggleEnabled()}
          />
          通知を有効にする
        </label>
        <Show when={props.content.enabled}>
          <span class="sd-text sd-text--caption">最終記録から</span>
          <input
            class="sd-alert-days"
            type="number"
            min="1"
            max="365"
            value={days()}
            onInput={e => setDays(e.currentTarget.value)}
          />
          <span class="sd-text sd-text--caption">日で警告</span>
          <Button disabled={busy()} onClick={() => void applyDays()}>
            適用
          </Button>
        </Show>
      </Row>
    </FormStack>
  );
}
