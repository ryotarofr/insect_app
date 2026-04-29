// QuickLogSheet.tsx — 個体カルテ／FABから起動する「記録追加」モーダル
// 対象個体は props.specimenId で事前プリセット可能。未指定の場合は select で変更可。
//
// P2-9: open 時に focusTrap をインストール。閉じたらトリガー要素にフォーカスを戻す。
import { createEffect, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { listSpecimens, type LogType } from "../../api";
import { LOG_TYPES, buildLogTitle } from "./types";
import { installFocusTrap, type FocusTrapHandle } from "../../utils/focusTrap";

// Phase 9.D 連携: server-backed specimen が target の時は POST /specimens/{id}/logs
//   を叩いて、終わったら飼育ログ cache を refresh する。
// PR #6: anonymous / cache miss の mock fallback (= localStorage) は廃止。
//   未 login or cache miss は inline error で「ログインしてください」を出す。
import { SduiFetchError, postSpecimenLog } from "../../sdui/api";
import { isLoggedIn } from "../../store/auth";
import { findServerSpecimenByPublicId } from "../../store/specimens";
import { refreshLogsForSpecimen } from "../../store/specimenLogs";
import { triggerMyLogsRefresh } from "../../store/myLogs";

interface QuickLogSheetProps {
  open: boolean;
  onClose: () => void;
  /** 指定すると対象個体を固定 (個体カルテから起動した場合) */
  specimenId?: string;
  /** P4-10: 初期選択される LogType。個体カルテの 5 ボタンショートカットから
   *  "体重" / "給餌" など、目的別に開くために使う。 */
  initialType?: LogType;
  /** 保存成功時のコールバック */
  onSaved?: () => void;
}

export const QuickLogSheet = (p: QuickLogSheetProps) => {
  const specimens = listSpecimens();
  const [type, setType] = createSignal<LogType>(p.initialType ?? "weight");
  const [target, setTarget] = createSignal(p.specimenId ?? specimens[0]?.id ?? "");
  // 値は空で開始し、placeholder "28.4" に留める (誤送信防止)
  const [value, setValue] = createSignal("");
  const [memo, setMemo] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  // propsの specimenId が変われば追従
  createEffect(() => {
    if (p.specimenId) setTarget(p.specimenId);
  });

  // P4-10: 開いた瞬間に props.initialType を反映する。
  //   - initialType が無ければ weight にリセット。
  //   - open の false → true 遷移でのみ走る (閉じている間の型変更は無視)。
  createEffect(() => {
    if (p.open) {
      setType(p.initialType ?? "weight");
      setValue("");
      setError(null);
    }
  });

  // open が false になったらフォーム初期化
  createEffect(() => {
    if (!p.open) {
      setType(p.initialType ?? "weight");
      setValue("");
      setMemo("");
      setError(null);
    }
  });

  // 種別変更時はフィールドをクリアし、placeholder が見える状態にする
  const selectType = (t: LogType) => {
    setType(t);
    setValue("");
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

  // Focus trap: open 中は Tab/Shift+Tab を dialog 内にとどめる
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

  const currentMeta = () => LOG_TYPES.find((t) => t.key === type())!;

  // 投稿中フラグ (= 二重 submit 防止 + ボタン disable)。
  const [busy, setBusy] = createSignal(false);

  /** YYYY-MM-DD ローカル日付を返す (= server の `loggedAt: NaiveDate` と整合)。 */
  const todayIso = (): string => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  /** "HH:MM:SS" ローカル時刻 (= server の `loggedAtTime: NaiveTime` 互換)。 */
  const nowHms = (): string => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const submit = (e: Event) => {
    e.preventDefault();
    const t = type();
    const v = value().trim();
    if (!v) {
      setError("内容を入力してください");
      return;
    }
    if (busy()) return; // 二重 submit 防止

    const targetId = target();
    const title = buildLogTitle(t, v);
    const body = memo().trim() || v;

    // 対象が **server-backed specimen** (= login 中 + cache hit) なら server POST。
    //   `target()` は publicId (= "#DHH-0271")、server は internal UUID を要求する。
    //   findServerSpecimenByPublicId で UUID を解決し、無ければ mock fallback。
    const sv = isLoggedIn() ? findServerSpecimenByPublicId(targetId) : undefined;

    if (!sv) {
      // PR #6: anonymous / cache miss は localStorage fallback を廃止 → 明示エラー。
      setError(
        isLoggedIn()
          ? "個体情報がまだ読み込まれていません。少し待って再試行してください。"
          : "ログインが必要です。",
      );
      return;
    }

    // server 経路: POST → 成功で refresh して close。失敗は sheet 内 banner に出す。
    setBusy(true);
    setError(null);
    // weight log なら metrics を最低限詰めておく (= server が JSONB で受ける)。
    const metrics: Record<string, unknown> =
      t === "weight" && /^\d+(\.\d+)?$/.test(v) ? { weight_g: Number(v) } : {};
    postSpecimenLog(sv.id, {
      logType: t,
      loggedAt: todayIso(),
      loggedAtTime: nowHms(),
      title,
      body,
      hasPhoto: false,
      metrics,
    })
      .then(async () => {
        // server cache を最新化 (= SpecimenDetail の log timeline と
        // マイページの「今月のログ」KPI を即座に反映)。
        await refreshLogsForSpecimen(sv.id).catch(() => {
          // 取得 retry の失敗は致命でない (= 次の page 描画で取り直せる)。
        });
        triggerMyLogsRefresh();
        p.onSaved?.();
        p.onClose();
      })
      .catch((err: unknown) => {
        // 401 (= cookie が切れた) は「再ログインしてください」、それ以外は素の文言。
        if (err instanceof SduiFetchError && err.status === 401) {
          setError("ログインの有効期限が切れました。もう一度ログインしてください。");
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`記録できませんでした (${msg})`);
        }
      })
      .finally(() => setBusy(false));
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
          ref={dialogRef}
          class="sheet-dialog"
          onClick={(e) => e.stopPropagation()}
          onSubmit={submit}
        >
          <div class="sheet-head">
            <div>
              <div class="for">新規記録</div>
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
                /* P4-14: 数字キーパッド (iOS/Android 共通) に小数点ドットを出す。
                 * inputmode="decimal" は type="number" と併用可能で、
                 * iOS Safari で "." を含むテンキーが出る。 */
                inputmode="decimal"
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
            <button type="submit" class="btn primary" style={{ flex: 2 }} disabled={busy()}>
              {busy() ? "送信中..." : "＋ 記録する"}
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
};
