// SearchBox.tsx — Server-Driven 検索 box のレンダラ (Phase 6)
//
// 詳細: docs/sdui-three-layer-model-v5.md §5.6 (List shell + Search)
//
// **責務**:
//   サーバが返した `SearchBox { query?, placeholder, submitHref, paramName }` を
//   `<form>` + `<input type="search">` + `<button type="submit">` として描画する。
//
// **submitHref の意味**:
//   server から渡される `submitHref` は **q= を抜いた base URL** (例: `/products?category=live`)。
//   filter / sort / perPage 等の他クエリ param は submitHref の query string に含まれている。
//   検索 box はそこに `?q=<入力値>` を上乗せして navigate するだけ。
//
// **JS 無し fallback**:
//   `<form action={submitHref} method="get">` で素朴に submit すれば動く。ただし
//   ブラウザは action の query string を捨てて form fields だけを送るため、
//   submitHref の既存 query は **hidden input として再送する** 必要がある (= filter/sort/perPage を維持)。
//   - action は path-only (= submitHref から query を剥いだもの)
//   - 既存 query は `<input type="hidden" name=k value=v>` で復元
//   - q 入力は `name={paramName}` の visible input
//   これにより JS off ブラウザでも「filter/sort を維持した状態で q を加えて submit」が成立する。
//
// **JS 有り (= 通常)**:
//   `onSubmit` で `e.preventDefault()` → URLSearchParams で組み立て直して `navigate()`。
//   - 既存 query (filter/sort/perPage) を維持
//   - 入力値が空なら q を **付けない** (= q を消す = canonical URL を維持)
//   - 入力値は trim する (= 末尾スペース等で別 URL を生成しない)
//
// **page reset セマンティクス**:
//   server 側 `build_search_box` は submitHref に既に `?page=` を含めていない (= q 変更 = 結果集合変更 = 1 ページ目に戻すべき)。
//   フロントは何も page を意識しなくても OK (= submitHref を信じるだけ)。
//
// **テスト容易性**:
//   - `data-sdui="search-box"` でルート要素を抽出
//   - `data-search-input` で input を抽出
//   - `data-search-submit` で submit ボタンを抽出
//   - hidden input は `data-search-hidden="<key>"` で個別に DOM 検索可能

import { createSignal, For } from "solid-js";
import { useNavigate } from "@solidjs/router";

import type { SearchBox as SearchBoxType } from "./branded";
import { resolveLocalizable } from "./L";
import { recordEvent } from "./analytics";

/** href を path 部と既存 query params (重複可) に分離する純関数。
 *
 * - 入力 `/products?category=live&difficulty=easy` →
 *   `{ path: "/products", params: [["category", "live"], ["difficulty", "easy"]] }`
 * - 入力 `/products` → `{ path: "/products", params: [] }`
 *
 * **複数値**:
 *   `URLSearchParams` を使うと set/append の API が便利だが、ここでは順序を
 *   保ったまま hidden input を出すので生 array で持つ (canonical URL 順序を尊重)。
 *
 * **decode**:
 *   hidden input の value 属性は再 encode されるので、ここでは一度 decode する。
 */
export const splitHref = (
  href: string,
): { path: string; params: Array<[string, string]> } => {
  const qIdx = href.indexOf("?");
  if (qIdx === -1) return { path: href, params: [] };
  const path = href.substring(0, qIdx);
  const qs = href.substring(qIdx + 1);
  const params: Array<[string, string]> = [];
  if (qs.length > 0) {
    for (const part of qs.split("&")) {
      if (part.length === 0) continue;
      const eq = part.indexOf("=");
      if (eq === -1) {
        params.push([safeDecode(part), ""]);
      } else {
        params.push([
          safeDecode(part.substring(0, eq)),
          safeDecode(part.substring(eq + 1)),
        ]);
      }
    }
  }
  return { path, params };
};

/** decodeURIComponent は不正 escape で throw するので safe wrapper。 */
const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s.replace(/\+/g, "%20"));
  } catch {
    return s;
  }
};

/** SDUI SearchBox 全体。 */
export const SearchBoxView = (props: { box: SearchBoxType }) => {
  const navigate = useNavigate();

  // controlled input。初期値は server 側の `query` (現在の `?q=` の値)。
  const [value, setValue] = createSignal(props.box.query ?? "");

  // submitHref は props で来るため、reactive に再評価したい (将来的に sort 切替 etc. で変わる)。
  const split = () => splitHref(props.box.submitHref);

  /** form submit (JS 有効時)。e.preventDefault() で full reload を抑止し SPA navigate。 */
  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();

    const v = value().trim();

    recordEvent({
      analyticsId: props.box.analyticsId,
      eventType: "click",
      context: {
        searchHasQuery: v.length > 0 ? "true" : "false",
        // 衛生上、検索文字列そのものは context に入れない (個人情報 / 長さ無制限)
        searchLength: String(v.length),
      },
    });

    const { path, params } = split();
    const sp = new URLSearchParams();
    for (const [k, val] of params) sp.append(k, val);
    if (v.length > 0) sp.set(props.box.paramName, v);
    const qs = sp.toString();
    navigate(qs.length > 0 ? `${path}?${qs}` : path);
  };

  return (
    <form
      data-sdui="search-box"
      action={split().path}
      method="get"
      role="search"
      onSubmit={onSubmit}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "margin-block": "8px 12px",
        padding: "8px 12px",
        border: "1px solid var(--line)",
        "border-radius": "10px",
        background: "var(--bg-soft)",
      }}
    >
      {/* 既存 query (filter/sort/perPage) を JS 無し fallback 用に hidden で維持 */}
      <For each={split().params}>
        {([k, v]) => (
          <input
            type="hidden"
            name={k}
            value={v}
            data-search-hidden={k}
          />
        )}
      </For>
      <input
        data-search-input
        type="search"
        name={props.box.paramName}
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        placeholder={resolveLocalizable(props.box.placeholder)}
        autocomplete="off"
        style={{
          flex: "1",
          height: "32px",
          padding: "0 10px",
          border: "1px solid var(--line-strong)",
          "border-radius": "6px",
          "font-size": "13px",
          background: "var(--bg)",
          color: "var(--ink)",
        }}
      />
      <button
        type="submit"
        data-search-submit
        style={{
          height: "32px",
          padding: "0 14px",
          border: "1px solid var(--bg-inverse)",
          "border-radius": "6px",
          background: "var(--bg-inverse)",
          color: "var(--ink-inverse)",
          "font-size": "12px",
          "font-weight": "500",
          cursor: "pointer",
        }}
      >
        検索
      </button>
    </form>
  );
};
