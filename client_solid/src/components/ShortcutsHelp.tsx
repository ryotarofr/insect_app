// components/ShortcutsHelp.tsx — ? キーで開くショートカット一覧モーダル (P4-19)
//
// 目的:
//   KOCHŪ で使える全キーボードショートカットを一覧化。
//   キーボード中心で操作するユーザー向けに "覚えなくても確認できる" 場所を提供する。
//
// 起動方法:
//   - ? キー (Shift+/) ⇒ App.tsx の global listener から toggleShortcutsHelp()
//   - フォーム内フォーカス中 / 既に他のモーダルが開いている間は起動しない
//     (App.tsx 側で shouldSkipShortcut を通している)
//
// 操作:
//   - Esc / 背景クリック / 閉じるボタン で閉じる
//   - Tab は focusTrap でモーダル内に閉じ込める (installFocusTrap)
//
// 表示内容:
//   - 画面遷移: 1-8 (マイページ / 生体・用品 / 飼育ログ / 羽化予測 /
//                   血統系図 / C2Cマーケット / ショップ管理 / カート)
//     ※ 個体カルテは詳細ビュー (`:id` パラメトリック) なので除外。
//        マイページの所有個体カード等から id 付きで開く。
//   - 検索: ⌘K / Ctrl+K
//   - ヘルプ: ? / Esc
import { createEffect, For, onCleanup, Show } from "solid-js";
import {
  closeShortcutsHelp,
  isShortcutsHelpOpen,
} from "../store/shortcutsHelp";
import { installFocusTrap, type FocusTrapHandle } from "../utils/focusTrap";

// キーボード OS 判定 (⌘ / Ctrl 表記切り替え)
const isMacLike = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = (navigator as Navigator & { platform?: string }).platform || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(ua);
};

interface ShortcutRow {
  keys: string[];
  label: string;
  sub?: string;
}

interface ShortcutSection {
  title: string;
  rows: ShortcutRow[];
}

const buildSections = (): ShortcutSection[] => {
  const modKey = isMacLike() ? "⌘" : "Ctrl";
  return [
    {
      title: "画面遷移",
      rows: [
        { keys: ["1"], label: "マイページ", sub: "ダッシュボード" },
        { keys: ["2"], label: "生体・用品", sub: "商品一覧" },
        { keys: ["3"], label: "飼育ログ", sub: "タイムライン" },
        { keys: ["4"], label: "羽化予測", sub: "予定一覧" },
        { keys: ["5"], label: "血統系図", sub: "系統ツリー" },
        { keys: ["6"], label: "C2Cマーケット", sub: "ユーザー間取引" },
        { keys: ["7"], label: "ショップ管理", sub: "売上・在庫" },
        { keys: ["8"], label: "カート", sub: "購入手続き" },
      ],
    },
    {
      title: "検索・パレット",
      rows: [
        { keys: [modKey, "K"], label: "コマンドパレット", sub: "ページ / 個体 / 商品を横断検索" },
      ],
    },
    {
      title: "ヘルプ",
      rows: [
        { keys: ["?"], label: "ショートカット一覧", sub: "このダイアログを開く" },
        { keys: ["Esc"], label: "閉じる", sub: "開いているモーダル / シートを閉じる" },
      ],
    },
  ];
};

export const ShortcutsHelp = () => {
  let dialogRef: HTMLDivElement | undefined;
  let trap: FocusTrapHandle | null = null;

  createEffect(() => {
    if (isShortcutsHelpOpen() && dialogRef) {
      trap = installFocusTrap(dialogRef);
    } else if (!isShortcutsHelpOpen() && trap) {
      trap.release();
      trap = null;
    }
  });
  onCleanup(() => {
    trap?.release();
    trap = null;
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeShortcutsHelp();
    }
  };

  return (
    <Show when={isShortcutsHelpOpen()}>
      <div
        class="shelp-backdrop"
        role="presentation"
        onClick={closeShortcutsHelp}
      >
        <div
          ref={dialogRef}
          class="shelp-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shelp-title"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKey}
        >
          <div class="shelp-head">
            <div>
              <div class="u-eyebrow">キーボード ショートカット</div>
              <h2
                id="shelp-title"
                class="serif"
                style={{ "font-size": "20px", "font-weight": 600, "margin-top": "4px" }}
              >
                ショートカット一覧
              </h2>
            </div>
            <button
              type="button"
              class="shelp-close"
              onClick={closeShortcutsHelp}
              aria-label="ショートカット一覧を閉じる"
              autofocus
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          <div class="shelp-body">
            <For each={buildSections()}>
              {(sec) => (
                <div class="shelp-section">
                  <div class="shelp-section-head mono">{sec.title}</div>
                  <div class="shelp-rows">
                    <For each={sec.rows}>
                      {(r) => (
                        <div class="shelp-row">
                          <div class="shelp-keys">
                            <For each={r.keys}>
                              {(k, i) => (
                                <>
                                  <Show when={i() > 0}>
                                    <span class="shelp-plus" aria-hidden="true">
                                      +
                                    </span>
                                  </Show>
                                  <kbd class="shelp-kbd mono">{k}</kbd>
                                </>
                              )}
                            </For>
                          </div>
                          <div class="shelp-row-body">
                            <div class="shelp-row-label">{r.label}</div>
                            <Show when={r.sub}>
                              <div class="shelp-row-sub">{r.sub}</div>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>

          <div class="shelp-foot mono">
            <span>
              <kbd>?</kbd> でいつでも表示
            </span>
            <span class="shelp-foot-esc">
              <kbd>Esc</kbd> で閉じる
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
};
