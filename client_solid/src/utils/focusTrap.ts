// focusTrap.ts — モーダル/シート用のフォーカストラップ
//
// P2-9: 開いている間 Tab / Shift+Tab が外に逃げないようにする最小実装。
//   - 開時に最初のフォーカス可能要素にフォーカス (既に focus 済みなら維持)
//   - 閉時に開いた瞬間の activeElement に戻す
//   - Tab が末尾なら先頭へ、Shift+Tab が先頭なら末尾へループ
//   - aria-modal は呼び元で付ける (このモジュールは focus 管理のみ)

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  "[contenteditable=true]",
].join(",");

/** container 内の tabbable 要素一覧 (visibility / display 不問の単純抽出) */
export const listFocusables = (container: HTMLElement): HTMLElement[] => {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  return nodes.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    // hidden やゼロサイズ要素は除外 (offsetParent が null かつ position:fixed でない場合)
    const rect = el.getBoundingClientRect();
    return rect.width + rect.height > 0;
  });
};

export interface FocusTrapHandle {
  /** 呼ぶと focus を解放 (必ず cleanup で呼ぶこと) */
  release: () => void;
}

/**
 * container に focus trap をインストールする。
 * @param container  モーダル本体 (backdrop ではなく dialog 要素)
 * @param returnFocusTo  閉時に戻すフォーカス (省略時は install 時の activeElement)
 */
export const installFocusTrap = (
  container: HTMLElement,
  returnFocusTo?: HTMLElement | null,
): FocusTrapHandle => {
  const previouslyFocused =
    returnFocusTo ??
    (document.activeElement as HTMLElement | null);

  // 初期フォーカス: container 内の autofocus 属性 → 最初の focusable → container 自身
  const focusables = listFocusables(container);
  const autoFocus = container.querySelector<HTMLElement>("[autofocus]");
  const initial =
    autoFocus ??
    focusables[0] ??
    container;
  // container が tabindex を持たない場合に備えて一時的に tabindex=-1 を付ける
  if (initial === container && !container.hasAttribute("tabindex")) {
    container.setAttribute("tabindex", "-1");
  }
  // マイクロタスク後にフォーカス (レンダリング直後のブラーを避ける)
  queueMicrotask(() => {
    try {
      initial.focus();
    } catch {
      /* ignore */
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const items = listFocusables(container);
    if (items.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  document.addEventListener("keydown", onKey, true);

  return {
    release: () => {
      document.removeEventListener("keydown", onKey, true);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        try {
          previouslyFocused.focus();
        } catch {
          /* ignore */
        }
      }
    },
  };
};
