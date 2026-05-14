// FilterBar.tsx — Server-Driven 絞り込みチップ列のレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §5.6 (List shell + Filter)
//
// **責務**:
//   サーバが返した `FilterBar { groups: [...] }` をそのまま `<a>` のチップ列として描画する。
//   - 各 `chip.href` は **toggle 後の URL** (selected を抜く / 加える) を server が事前計算済み。
//   - クライアントは `<a href>` するだけ → progressive enhancement (JS off でも動く)。
//   - チップの見た目は `chip.selected` で primary inverted / outlined を切り替え。
//   - クリック時に analytics (chip.analyticsId) を 1 件 enqueue する。
//
// **なぜ Block::filter_chip にしないか**:
//   filter は「商品カードの中身」ではなく「ページ全体のシェル」。
//   Card 型 (`product_feature` / `product_detail`) を汚染しないため
//   `ProductListResponse` で wrap し、ここで独立にレンダリングする。
//
// **Solid Router との関係**:
//   `<a>` の click をブラウザに任せると full reload が走るため、
//   `useNavigate` でクライアント遷移にフックする (アプリ全体の SPA 体感を維持)。
//   middleClick / Cmd+click / 外部 modifier はブラウザに委ねる。
//
// **テスト容易性**:
//   - `data-filter-group="<group_key>"` / `data-filter-chip="<chip_key>"` で DOM 探索可能
//   - `data-selected="true|false"` で selected 状態を assert 可能

import { For } from "solid-js";
import { useNavigate } from "@solidjs/router";

import type {
  FilterBar as FilterBarType,
  FilterChipItem,
  Localizable,
} from "./branded";
import { L } from "./L";
import { recordEvent } from "./analytics";

/** 1 chip の見た目を決める style。
 *  selected = primary inverted (= ink 反転で塗りつぶし)。
 *  not selected = outlined (= 線だけ)。 */
const chipStyle = (selected: boolean): Record<string, string> =>
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

const baseChipStyle: Record<string, string> = {
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  height: "30px",
  padding: "0 12px",
  "border-radius": "999px",
  "font-size": "12px",
  "font-weight": "500",
  "text-decoration": "none",
  cursor: "pointer",
  gap: "6px",
};

/** 単一チップ。`<a href={chip.href}>` で純ナビ + click event を記録。
 *
 * **count badge**:
 *   `chip.count` が `Some(n)` のとき、ラベル右側に件数を出す
 *   (例: `生体 (4)`)。これは「他軸を維持したまま、この chip に切り替えたら何件か」
 *   を表す faceted count。0 件チップも消さず `(0)` で表示し disabled は
 *   サーバの意図 (= ユーザに 0 でも見せる) を尊重して付けない。
 *   - `data-count="<n>"` を chip に付け、テストから件数を抽出可能にする。
 *   - count を持たないチップ (= サーバが送ってこなかった) は `(n)` を出さない。 */
const FilterChip = (props: { groupKey: string; chip: FilterChipItem }) => {
  const navigate = useNavigate();

  const onClick = (e: MouseEvent) => {
    // analytics: chip 側に analyticsId が付いていれば click を記録。
    // ここで sync に buffer に積むだけなので navigate を遅らせない。
    recordEvent({
      analyticsId: props.chip.analyticsId,
      eventType: "click",
      context: {
        filterGroup: props.groupKey,
        filterChip: props.chip.key,
        // toggle 方向 (= server が href に込めた意味) を analytics にも残す
        toggleTo: props.chip.selected ? "off" : "on",
      },
    });

    // SPA navigate にフック: ブラウザの full reload を避ける。
    // ただし modifier-click (新タブ / 別 window) と middle-click はブラウザに委ねる。
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // `scroll: false` で「絞り込み後にページ先頭まで戻される」挙動を抑止。
    //   @solidjs/router の navigate は default で scroll-to-top するため、
    //   filter chip クリックのような「同じ一覧を絞り込み直す」UX では明示的に
    //   off にし、ユーザの現在位置 (= 見ていたカード周辺) を維持する。
    navigate(props.chip.href, { scroll: false });
  };

  // count は number | undefined。`!= null` で 0 を残しつつ undefined を弾く。
  const countLabel = (): string | null => {
    const c = props.chip.count;
    return c == null ? null : ` (${c})`;
  };

  return (
    <a
      href={props.chip.href}
      data-filter-chip={props.chip.key}
      data-selected={String(props.chip.selected)}
      data-count={props.chip.count == null ? undefined : String(props.chip.count)}
      aria-pressed={props.chip.selected}
      onClick={onClick}
      style={{ ...baseChipStyle, ...chipStyle(props.chip.selected) }}
    >
      <L value={props.chip.label} />
      {countLabel() !== null && (
        <span
          data-filter-chip-count
          style={{
            "font-size": "11px",
            "font-variant-numeric": "tabular-nums",
            opacity: "0.85",
          }}
        >
          {countLabel()}
        </span>
      )}
    </a>
  );
};

/** 1 軸ぶん (例: 「カテゴリ」 + chips)。 */
const FilterGroupRow = (props: {
  groupKey: string;
  label: Localizable;
  chips: readonly FilterChipItem[];
}) => {
  return (
    <div
      data-filter-group={props.groupKey}
      style={{
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        gap: "8px",
        "padding-block": "4px",
      }}
    >
      <span
        style={{
          "font-size": "12px",
          color: "var(--ink-mute)",
          "min-width": "72px",
        }}
      >
        <L value={props.label} />
      </span>
      <For each={props.chips as FilterChipItem[]}>
        {(chip) => <FilterChip groupKey={props.groupKey} chip={chip} />}
      </For>
    </div>
  );
};

/** SDUI FilterBar 全体。groups を縦に並べる。 */
export const FilterBarView = (props: { bar: FilterBarType }) => {
  return (
    <div
      data-sdui="filter-bar"
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "4px",
        "margin-block": "12px 16px",
        padding: "12px",
        border: "1px solid var(--line)",
        "border-radius": "10px",
        background: "var(--bg-soft)",
      }}
    >
      <For each={props.bar.groups}>
        {(g) => (
          <FilterGroupRow
            groupKey={g.key}
            label={g.label}
            chips={g.chips}
          />
        )}
      </For>
    </div>
  );
};
