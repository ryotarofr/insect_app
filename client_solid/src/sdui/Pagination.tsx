// Pagination.tsx — Server-Driven ページャのレンダラ
//
// 詳細: docs/sdui-three-layer-model-v5.md §5.6 (List shell + Pagination)
//
// **責務**:
//   サーバが返した `Pagination { page, perPage, totalCount, totalPages, prevHref?, nextHref?, pages: [...] }`
//   をそのままページネーション UI として描画する。
//
// **link 種別**:
//   - prev / next: `prevHref` / `nextHref` が undefined の時は disabled (= span で出して link 化しない)。
//   - 数字 link: `pages: PageLink[]` の各要素 (kind="page" / kind="ellipsis")。
//   - ellipsis は span として描画 (= クリック不可)。
//   - 数字 link の selected = 現在ページ。aria-current="page" + 視覚的にハイライト。
//
// **range collapse**:
//   server 側で `pages` は既に collapse 済み (1 / current ±2 / last + ellipsis)。
//   フロントは for loop するだけ。
//
// **link 先 URL の構築**:
//   各 PageLink.href には filter / sort / q / perPage が既に server 側で含まれている。
//   フロントは何も加工しない (= server を信じる)。
//
// **Solid Router との関係**:
//   FilterBar / SortBar と同じく `useNavigate` で full reload を抑止。
//   modifier-click / 中クリック はブラウザに委ねる (新タブで開ける)。
//
// **テスト容易性**:
//   - `data-sdui="pagination"` でルート要素を抽出
//   - `data-page-prev` / `data-page-next` で prev/next を抽出
//   - `data-page-link="<number>"` で数字 link を抽出
//   - `data-page-ellipsis` で省略を抽出
//   - `data-selected="true|false"` で現在ページを assert
//   - `data-page="<page>"` / `data-per-page="<n>"` / `data-total-count="<n>"` をルートに付与
//
// **0 件時の挙動**:
//   server 側で totalPages は 1 にフロアされる (= 0 件でも "1 / 1" として表示する)。
//   結果カードが 0 でもページャ shell は描画される (= 検索 box との文脈一貫性)。

import { For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";

import type {
  Pagination as PaginationType,
  PageLink,
} from "./branded";
import { recordEvent } from "./analytics";

/** prev/next/数字 link 共通の click ハンドラ。
 *  modifier 付き click はブラウザに委ねて新タブを開ける。 */
const onPageClick = (
  href: string,
  navigate: ReturnType<typeof useNavigate>,
  log: () => void,
) => (e: MouseEvent) => {
  log();
  if (e.defaultPrevented) return;
  if (e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(href);
};

/** prev / next ボタン共通。href が undefined の時は disabled span として描画。 */
const PrevNextLink = (props: {
  href: string | undefined;
  label: string;
  testId: "data-page-prev" | "data-page-next";
  analyticsId: string | undefined;
  direction: "prev" | "next";
  page: number;
}) => {
  const navigate = useNavigate();

  const log = () => {
    recordEvent({
      analyticsId: props.analyticsId,
      eventType: "click",
      context: {
        paginationDirection: props.direction,
        paginationFromPage: String(props.page),
      },
    });
  };

  const baseStyle: Record<string, string> = {
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    height: "30px",
    padding: "0 10px",
    "border-radius": "6px",
    "font-size": "12px",
    "font-weight": "500",
    "text-decoration": "none",
    border: "1px solid var(--line-strong)",
  };

  return (
    <Show
      when={props.href != null}
      fallback={
        <span
          {...{ [props.testId]: "" }}
          data-disabled="true"
          aria-disabled="true"
          style={{
            ...baseStyle,
            color: "var(--ink-mute)",
            background: "var(--bg-soft)",
            cursor: "not-allowed",
            opacity: "0.5",
          }}
        >
          {props.label}
        </span>
      }
    >
      <a
        {...{ [props.testId]: "" }}
        href={props.href!}
        data-disabled="false"
        onClick={onPageClick(props.href!, navigate, log)}
        style={{
          ...baseStyle,
          color: "var(--ink)",
          background: "var(--bg)",
          cursor: "pointer",
        }}
      >
        {props.label}
      </a>
    </Show>
  );
};

/** 1 つの数字 link または ellipsis。 */
const PageLinkView = (props: {
  link: PageLink;
  analyticsId: string | undefined;
  fromPage: number;
}) => {
  const navigate = useNavigate();

  const numStyle = (selected: boolean): Record<string, string> => ({
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    "min-width": "30px",
    height: "30px",
    padding: "0 8px",
    "border-radius": "6px",
    "font-size": "12px",
    "font-weight": selected ? "600" : "500",
    "text-decoration": "none",
    border: "1px solid",
    "border-color": selected ? "var(--bg-inverse)" : "var(--line-strong)",
    background: selected ? "var(--bg-inverse)" : "var(--bg)",
    color: selected ? "var(--ink-inverse)" : "var(--ink)",
    cursor: selected ? "default" : "pointer",
    "font-variant-numeric": "tabular-nums",
  });

  return (
    <Show
      when={props.link.kind === "page"}
      fallback={
        <span
          data-page-ellipsis=""
          aria-hidden="true"
          style={{
            display: "inline-flex",
            "align-items": "center",
            "justify-content": "center",
            "min-width": "20px",
            height: "30px",
            color: "var(--ink-mute)",
            "font-size": "12px",
          }}
        >
          …
        </span>
      }
    >
      {(() => {
        // ↑ Show の when=true 側でだけ評価される。Extract 相当の絞り込み。
        const link = props.link as Extract<PageLink, { kind: "page" }>;
        const log = () => {
          recordEvent({
            analyticsId: props.analyticsId,
            eventType: "click",
            context: {
              paginationToPage: String(link.number),
              paginationFromPage: String(props.fromPage),
            },
          });
        };

        return (
          <a
            data-page-link={String(link.number)}
            data-selected={String(link.selected)}
            href={link.href}
            aria-current={link.selected ? "page" : undefined}
            onClick={
              link.selected
                ? // selected はクリックしても意味が無いので preventDefault のみ
                  (e: MouseEvent) => e.preventDefault()
                : onPageClick(link.href, navigate, log)
            }
            style={numStyle(link.selected)}
          >
            {link.number}
          </a>
        );
      })()}
    </Show>
  );
};

/** SDUI Pagination 全体。 */
export const PaginationView = (props: { pagination: PaginationType }) => {
  return (
    <nav
      data-sdui="pagination"
      data-page={String(props.pagination.page)}
      data-per-page={String(props.pagination.perPage)}
      data-total-count={String(props.pagination.totalCount)}
      data-total-pages={String(props.pagination.totalPages)}
      aria-label="ページャ"
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "flex-wrap": "wrap",
        gap: "6px",
        "margin-block": "16px 0",
        padding: "12px",
        "border-top": "1px solid var(--line)",
      }}
    >
      <PrevNextLink
        href={props.pagination.prevHref}
        label="‹ 前へ"
        testId="data-page-prev"
        analyticsId={props.pagination.analyticsId}
        direction="prev"
        page={props.pagination.page}
      />
      <For each={props.pagination.pages}>
        {(link) => (
          <PageLinkView
            link={link}
            analyticsId={props.pagination.analyticsId}
            fromPage={props.pagination.page}
          />
        )}
      </For>
      <PrevNextLink
        href={props.pagination.nextHref}
        label="次へ ›"
        testId="data-page-next"
        analyticsId={props.pagination.analyticsId}
        direction="next"
        page={props.pagination.page}
      />
    </nav>
  );
};
