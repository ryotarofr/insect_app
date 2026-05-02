// components/CommandPalette.tsx — ⌘K 検索モーダル (P4-5)
//
// 目的:
//   KOCHŪ 全体を横断する即時検索 + 遷移の手段を提供する。
//   サイドバー / BottomTab は ページ単位のナビゲーションだが、
//   個体や商品を ID や名前で直接飛びたい時 (特にキーボード中心の編集作業中) には
//   このコマンドパレットが最速。
//
// 起動方法:
//   - Cmd+K (macOS) / Ctrl+K (Windows・Linux) ⇒ App.tsx の global listener から
//     openCommandPalette() が呼ばれる
//   - トップバーの擬似検索ボタンをクリック
//
// 検索対象:
//   - ページ (マイページ, 商品一覧, 個体カルテ, ショップ管理 ... など RouteKey 全て)
//   - 個体 (listSpecimens — id / 和名 / 学名 / 種)
//   - 商品 (listProducts — id / title / 学名)
//
// 操作:
//   - 入力で絞り込み (大文字小文字を無視した部分一致)
//   - ArrowUp / ArrowDown で選択移動
//   - Enter で選択項目を実行
//   - Esc で閉じる
//   - 背景クリックでも閉じる
//
// フォーカス:
//   - 開いた瞬間に検索 input に autofocus
//   - 既存の focusTrap ユーティリティで Tab をモーダル内に閉じ込める
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  closeCommandPalette,
  isCommandPaletteOpen,
} from "../store/commandPalette";
import { listProducts, listSpecimens } from "../api";
import {
  ROUTE_PATHS,
  productUrl,
  specimenUrl,
} from "../router";
import { installFocusTrap, type FocusTrapHandle } from "../utils/focusTrap";

// ============================================================================
//  Item model
// ============================================================================

export type ItemKind = "page" | "specimen" | "product";

export interface PaletteItem {
  key: string;
  kind: ItemKind;
  label: string;
  sub?: string;
  /** 検索対象に使う小文字化済みの全文。ID / 学名 / 備考などを連結する。 */
  haystack: string;
  /** 選択時の遷移 URL */
  href: string;
}

const KIND_LABEL: Record<ItemKind, string> = {
  page: "ページ",
  specimen: "個体",
  product: "商品",
};

/** ページ列挙 (手書き: サイドバー ラベルと一致させる) */
const PAGE_ITEMS: ReadonlyArray<
  Pick<PaletteItem, "label" | "sub" | "href"> & { tags: string }
> = [
  { label: "マイページ", sub: "ダッシュボード", href: ROUTE_PATHS.mypage, tags: "mypage top home" },
  { label: "生体・用品", sub: "商品一覧", href: ROUTE_PATHS.products, tags: "products 商品 ショップ" },
  // UX-1: 個体カルテは詳細ビューなので "ページ" としては列挙せず、
  //   "個体" セクション (specimen kind) からそれぞれの個体を直接選んでもらう。
  { label: "飼育", sub: "群一覧", href: ROUTE_PATHS.cohort, tags: "cohort 飼育 群 lot" },
  { label: "群を作成", sub: "新規ロット", href: ROUTE_PATHS["cohort-new"], tags: "cohort new 群 ロット 産卵" },
  { label: "個体を登録", sub: "単独個体", href: ROUTE_PATHS["specimen-new"], tags: "specimen new 個体 register" },
  { label: "羽化予測", sub: "予定一覧", href: ROUTE_PATHS.eclosion, tags: "eclosion 羽化" },
  { label: "血統系図", sub: "系統ツリー", href: ROUTE_PATHS.bloodline, tags: "bloodline 血統 family" },
  { label: "ショップ管理", sub: "売上・在庫", href: ROUTE_PATHS.shop, tags: "shop 売上 売り上げ" },
  { label: "C2Cマーケット", sub: "ユーザー間取引", href: ROUTE_PATHS.market, tags: "market c2c マーケット" },
  { label: "カート", sub: "購入手続き", href: ROUTE_PATHS.cart, tags: "cart 決済 checkout" },
  { label: "安心保証", sub: "24h 死着補償", href: ROUTE_PATHS.warranty, tags: "warranty 補償 返金 help" },
] as const;

/** 毎回全件を読み直して最新の specimens/products を反映 */
const buildItems = (): PaletteItem[] => {
  const items: PaletteItem[] = [];
  for (const p of PAGE_ITEMS) {
    items.push({
      key: `page:${p.href}`,
      kind: "page",
      label: p.label,
      sub: p.sub,
      haystack: `${p.label} ${p.sub ?? ""} ${p.tags}`.toLowerCase(),
      href: p.href,
    });
  }
  for (const s of listSpecimens()) {
    items.push({
      key: `specimen:${s.id}`,
      kind: "specimen",
      label: s.name,
      sub: `${s.id} · ${s.species} · ${s.stage}`,
      haystack: `${s.name} ${s.id} ${s.species} ${s.sci} ${s.stage} ${s.generation}`.toLowerCase(),
      href: specimenUrl(s.id),
    });
  }
  for (const p of listProducts()) {
    items.push({
      key: `product:${p.id}`,
      kind: "product",
      label: p.title,
      sub: `${p.id} · ${p.shop} · ¥${p.price.toLocaleString()}`,
      haystack: `${p.title} ${p.id} ${p.shop} ${p.sci ?? ""}`.toLowerCase(),
      href: productUrl(p.id),
    });
  }
  return items;
};

/** 部分一致 + 全トークン AND 検索 (日本語 / 英数字混在対応) */
export const filterItems = (items: PaletteItem[], query: string): PaletteItem[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    // クエリ無しのときは先頭 12 件 (全ページ + 個体 2 + 商品 2) を出す
    return items.slice(0, 12);
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  return items.filter((it) => tokens.every((t) => it.haystack.includes(t)));
};

/** kind → section order (ページ優先 → 個体 → 商品) でグルーピング */
export const groupByKind = (items: PaletteItem[]): Array<[ItemKind, PaletteItem[]]> => {
  const order: ItemKind[] = ["page", "specimen", "product"];
  const buckets = new Map<ItemKind, PaletteItem[]>();
  for (const k of order) buckets.set(k, []);
  for (const it of items) buckets.get(it.kind)!.push(it);
  return order
    .map((k) => [k, buckets.get(k)!] as [ItemKind, PaletteItem[]])
    .filter(([, arr]) => arr.length > 0);
};

// ============================================================================
//  Component
// ============================================================================

export const CommandPalette = () => {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);

  // 起動時のみ全件を構築 — データは in-memory なのでコストは小さい。
  const allItems = createMemo(() => (isCommandPaletteOpen() ? buildItems() : []));
  const results = createMemo(() => filterItems(allItems(), query()));
  const grouped = createMemo(() => groupByKind(results()));

  // クエリが変わったら選択を先頭に戻す
  createEffect(() => {
    query();
    setActiveIndex(0);
  });

  // 開いた瞬間にクエリをリセット + 選択を先頭に
  createEffect(() => {
    if (isCommandPaletteOpen()) {
      setQuery("");
      setActiveIndex(0);
    }
  });

  let dialogRef: HTMLDivElement | undefined;
  let trap: FocusTrapHandle | null = null;

  createEffect(() => {
    if (isCommandPaletteOpen() && dialogRef) {
      trap = installFocusTrap(dialogRef);
    } else if (!isCommandPaletteOpen() && trap) {
      trap.release();
      trap = null;
    }
  });
  onCleanup(() => {
    trap?.release();
    trap = null;
  });

  const run = (item: PaletteItem) => {
    closeCommandPalette();
    // アンマウント後のフォーカス戻り先が古くなるのを避けるため microtask 後に navigate
    queueMicrotask(() => navigate(item.href));
  };

  const onKey = (e: KeyboardEvent) => {
    const list = results();
    if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    if (list.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % list.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + list.length) % list.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = list[activeIndex()];
      if (picked) run(picked);
    }
  };

  return (
    <Show when={isCommandPaletteOpen()}>
      <div
        class="cmdp-backdrop"
        role="presentation"
        onClick={closeCommandPalette}
      >
        <div
          ref={dialogRef}
          class="cmdp-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="コマンド パレット"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKey}
        >
          <div class="cmdp-search">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <input
              type="search"
              class="cmdp-input"
              placeholder="ページ / 個体 ID / 商品を検索..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              autocomplete="off"
              autocorrect="off"
              spellcheck={false}
              // autofocus 属性で focusTrap 初期フォーカスを取得
              autofocus
              aria-label="検索"
              aria-controls="cmdp-results"
            />
            <kbd class="cmdp-hint mono" aria-hidden="true">
              ESC
            </kbd>
          </div>

          <div
            id="cmdp-results"
            class="cmdp-results"
            role="listbox"
            aria-label="検索結果"
          >
            <Show
              when={results().length > 0}
              fallback={
                <div class="cmdp-empty">
                  該当する項目はありません
                  <Show when={query().trim()}>
                    <div class="cmdp-empty-sub mono">「{query().trim()}」</div>
                  </Show>
                </div>
              }
            >
              <For each={grouped()}>
                {([kind, items]) => (
                  <div class="cmdp-group">
                    <div class="cmdp-group-head mono">{KIND_LABEL[kind]}</div>
                    <For each={items}>
                      {(it) => {
                        const globalIndex = () => results().indexOf(it);
                        const isActive = () => globalIndex() === activeIndex();
                        return (
                          <button
                            type="button"
                            class={`cmdp-item ${isActive() ? "is-active" : ""}`}
                            role="option"
                            aria-selected={isActive()}
                            data-kind={it.kind}
                            onMouseEnter={() => setActiveIndex(globalIndex())}
                            onClick={() => run(it)}
                          >
                            <div class="cmdp-item-body">
                              <div class="cmdp-item-label">{it.label}</div>
                              <Show when={it.sub}>
                                <div class="cmdp-item-sub mono">{it.sub}</div>
                              </Show>
                            </div>
                            <span class="cmdp-item-kind mono">
                              {KIND_LABEL[it.kind]}
                            </span>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>

          <div class="cmdp-foot mono">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> 移動
            </span>
            <span>
              <kbd>⏎</kbd> 開く
            </span>
            <span>
              <kbd>Esc</kbd> 閉じる
            </span>
            <span class="cmdp-foot-count">{results().length} 件</span>
          </div>
        </div>
      </div>
    </Show>
  );
};
