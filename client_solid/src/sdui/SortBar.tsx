// SortBar.tsx — Server-Driven 並び替えセグメント列のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §5.6 (List shell + Filter + Sort)
//
// **責務**:
//   サーバが返した `SortBar { current, options: [...] }` をそのまま `<a>` 列として描画する。
//   - 各 option の `href` は **その sort に置き換えた状態** の URL (server が事前計算済み)。
//   - クライアントは `<a href>` するだけ → progressive enhancement (JS off でも動く)。
//   - 見た目は radio 的 / segmented control: selected 1 件だけが primary inverted。
//   - クリック時に analytics (option.analyticsId) を 1 件 enqueue する。
//
// **FilterBar との違い**:
//   - filter chip は「toggle (on/off)」だが、sort option は「置き換え (radio)」。
//     analytics の context にも `from / to` の sort key を記録して挙動を区別。
//   - 1 行に横並び (= filter のような複数軸ではない単一軸 UI)。
//
// **Solid Router との関係**:
//   FilterBar.tsx と同様に `useNavigate` で full reload を避ける。
//   middle-click / Cmd+click / 修飾キー click はブラウザに委ねる (= 新タブで開ける)。
//
// **テスト容易性**:
//   - `data-sdui="sort-bar"` でルート要素を抽出
//   - `data-sort-option="<key>"` で option ごとに DOM 検索
//   - `data-selected="true|false"` で選択状態を assert
//   - `data-current="<key>"` で SortBar.current が反映されていることを検証

import { For } from "solid-js";
import { useNavigate } from "@solidjs/router";

import type { SortBar as SortBarType, SortOption } from "./branded";
import { L } from "./L";
import { recordEvent } from "./analytics";

/** 1 option の見た目を決める style。selected = primary inverted、not selected = outlined。 */
const optionStyle = (selected: boolean): Record<string, string> =>
  selected
    ? {
        background: "var(--bg-inverse)",
        color: "var(--ink-inverse)",
        border: "1px solid var(--bg-inverse)",
      }
    : {
        background: "var(--bg)",
        color: "var(--ink)",
        border: "1px solid var(--line-strong)",
      };

const baseOptionStyle: Record<string, string> = {
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  height: "30px",
  padding: "0 12px",
  "border-radius": "6px",
  "font-size": "12px",
  "font-weight": "500",
  "text-decoration": "none",
  cursor: "pointer",
};

/** 単一 sort option。`<a href={option.href}>` で純ナビ + click event を記録。 */
const SortOptionView = (props: {
  currentKey: string;
  option: SortOption;
}) => {
  const navigate = useNavigate();

  const onClick = (e: MouseEvent) => {
    // analytics: option 側に analyticsId が付いていれば click を記録。
    recordEvent({
      analyticsId: props.option.analyticsId,
      eventType: "click",
      context: {
        sortFrom: props.currentKey,
        sortTo: props.option.key,
      },
    });

    // SPA navigate にフック (FilterBar と同じパターン)
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // `scroll: false` で「並び替え後にページ先頭まで戻される」挙動を抑止。
    //   FilterBar と同じく、同一一覧の見せ方を変えるだけのアクションでは
    //   ユーザの現在位置を維持する方が自然 (= sort 適用後も視線の位置に該当するカードが見える)。
    navigate(props.option.href, { scroll: false });
  };

  return (
    <a
      href={props.option.href}
      data-sort-option={props.option.key}
      data-selected={String(props.option.selected)}
      aria-pressed={props.option.selected}
      role="radio"
      aria-checked={props.option.selected}
      onClick={onClick}
      style={{ ...baseOptionStyle, ...optionStyle(props.option.selected) }}
    >
      <L value={props.option.label} />
    </a>
  );
};

/** SDUI SortBar 全体。options を横に並べる。 */
export const SortBarView = (props: { bar: SortBarType }) => {
  return (
    <div
      data-sdui="sort-bar"
      data-current={props.bar.current}
      role="radiogroup"
      aria-label="並び替え"
      style={{
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        gap: "6px",
        "margin-block": "8px 16px",
        padding: "8px 12px",
        border: "1px solid var(--line)",
        "border-radius": "10px",
        background: "var(--bg-soft)",
      }}
    >
      <span
        style={{
          "font-size": "12px",
          color: "var(--ink-mute)",
          "min-width": "72px",
        }}
      >
        並び替え
      </span>
      <For each={props.bar.options}>
        {(opt) => (
          <SortOptionView currentKey={props.bar.current} option={opt} />
        )}
      </For>
    </div>
  );
};
