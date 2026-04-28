//! 商品一覧ページの response shell (Phase 4 + Phase 5 + Phase 6 — Search / Filter / Sort / Pagination)。
//!
//! 詳細: docs/sdui-three-layer-model-v6.md §5.6 (List shell + Filter + Sort + Pagination)
//!
//! **なぜ Card 型に乗せないのか**:
//!   `CardBlock` は「商品 1 件」を表すテンプレート単位。一覧ページ全体のレイアウト
//!   (絞り込み chip + cards + sort dropdown) は Card より一段上のページシェル概念。
//!   既存の Card 型 (`product_feature` / `product_detail`) を汚染しないため、
//!   別構造体 `ProductListResponse` で wrap する。
//!
//! **filter_bar の表現**:
//!   - `FilterBar { groups: [..] }` — 1 ページに複数の絞り軸 (例: カテゴリ / 飼育難度)
//!   - `FilterGroup { key, label, chips: [..] }` — 1 軸ぶんのチップ群
//!   - `FilterChipItem { key, label, selected, href, count?, analyticsId? }` — 個々のチップ
//!
//! **sort_bar の表現** (Phase 5):
//!   - `SortBar { current, options: [..] }` — 1 ページに 1 つの並び替え軸
//!   - `SortOption { key, label, selected, href, analyticsId? }` — 1 つの並び順候補
//!   - 選択は単独 (= radio 的 / segmented control 想定)。multi-sort はやらない。
//!
//! **count (faceted) の表現** (Phase 5):
//!   - `FilterChipItem.count = Some(n)` — 「他軸の絞り込みは維持したまま、この軸の値を
//!     **この chip に切り替えた** 場合に何件マッチするか」。chip クリック前に件数が見える。
//!   - 自分のグループ内の他チップを置き換える方式 (= single-select の自然な「if I picked this」)。
//!   - 0 件のチップも非表示にせず `count: 0` を返す (= UI 側で disabled 表示する余地を残す)。
//!
//! **toggle URL は必ず server が返す**:
//!   フロントは「現状の選択」と「クリックすべき URL」を server から受け取って
//!   `<a href>` するだけ。toggle 演算 (どの param を残す/抜く / sort をどう保存するか) は
//!   server に集約。理由は (a) progressive enhancement: JS 無しでも飛べる
//!   (b) URL canonicalization の責務をフロント・サーバ両方に置きたくない、の 2 つ。
//!
//! **sort 値の保存**:
//!   filter chip クリック時 → 現在の `?sort=` を保持したまま filter だけ切替。
//!   sort option クリック時 → 現在の `?category=` 等を保持したまま sort だけ切替。
//!   どちらも server 側 `build_list_href` に集約する。
//!
//! **chip の `selected` field の意味**:
//!   現在のクエリ (`?category=live` 等) に対してこの chip 値が選択中なら true。
//!   client renderer は selected=true を「primary inverted」、false を「outlined」として描く。
//!
//! **Pagination の表現** (Phase 6):
//!   - `Pagination { page, perPage, totalCount, totalPages, prevHref?, nextHref?, pages: [..] }`
//!   - `pages: Vec<PageLink>` は最大 7 件 (1 / current ±2 / last) で省略は ellipsis (PageLink.kind = Ellipsis)
//!   - default の `?page=1`, `?per_page=20` は URL から省略 (canonical URL 維持)
//!   - first page は `prevHref = None`, last page は `nextHref = None` (= disabled)
//!
//! **SearchBox の表現** (Phase 6):
//!   - `SearchBox { query?, placeholder, submitHref, paramName }`
//!   - `query` は現在の `?q=` の値 (空 / 未指定なら None)
//!   - `submitHref` は「検索 box を空にした時の base URL」(= q= を取り除いた URL)
//!   - フロントは form `action=submitHref&q=<入力値>` で submit すれば動く (JS 無し fallback)
//!   - JS 有り時は debounce 後に navigate
//!
//! **filter chain の順序**:
//!   filter (chip 選択) → search (q substring) → sort → paginate
//!   - faceted count は「filter のみ適用後」の母集団に対して計算 (= search/sort/paginate は count に影響しない)
//!   - これにより検索 box に文字を打っても filter chip の数字は揺らがず、
//!     「全体の絞り込み構造」と「検索のヒット件数」を別レイヤとして扱える。

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::blocks::{CardBlock, Href, Localizable};

/// 一覧 endpoint (`GET /api/v1/cards/products?...`) のレスポンス shell。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProductListResponse {
    /// 絞り込み UI 群。
    /// `None` の時はフロント側で filter bar を描かない (= フィルタ機能 OFF)。
    /// MVP では常に Some で返す (= ページにフィルタが見えている状態)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub filter_bar: Option<FilterBar>,
    /// 並び替え UI (Phase 5)。
    /// `None` の時はフロント側で sort dropdown を描かない (= 並び替え機能 OFF)。
    /// MVP では常に Some で返す。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sort_bar: Option<SortBar>,
    /// 検索 box (Phase 6)。`None` の時は SearchBox 非表示。
    /// 現クエリの `?q=` の値もここに入って戻ってくる (= controlled input の初期値)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub search_box: Option<SearchBox>,
    /// ページング情報 (Phase 6)。`None` の時はフロント側で PageBar を描かない。
    /// 結果が 1 ページ以下でも返す (PageBar 側で「<=1 ならコンパクト表示 / 非表示」を選ぶ)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pagination: Option<Pagination>,
    /// 現在のクエリで絞られた商品カード列。サーバ側で `sort_bar.current` の指示通りに並べ済み。
    pub cards: Vec<CardBlock>,
}

/// 絞り込みエリア全体。複数の `FilterGroup` を縦に並べる想定。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FilterBar {
    pub groups: Vec<FilterGroup>,
}

/// 絞り込み 1 軸ぶん (例: 「カテゴリ」「飼育難度」)。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FilterGroup {
    /// クエリパラメータ名 (`?category=...` の "category")。group 内ユニーク。
    pub key: String,
    /// この group のラベル (例: "カテゴリ" / "飼育難度")。
    pub label: Localizable,
    /// この軸の選択肢たち。少なくとも 1 件以上を期待する。
    pub chips: Vec<FilterChipItem>,
}

/// 1 つのチップ = 1 つの絞り込み値。
///
/// **なぜ既存の `Block::Cta` を流用しないか**:
///   Cta は「ページ遷移 or サーバ反映 action」を表す汎用部品。filter chip は
///   「現在の選択を toggle して URL を書き換える」という固有の挙動を持ち、
///   `selected` flag や `count` (faceted search) など固有データも持つ。
///   将来 chip 専用の UI (削除 X ボタン / カウント badge など) を追加する余地を
///   残すため、独立 struct とする。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FilterChipItem {
    /// chip の値識別子 (例: "live" / "supply" / "easy")。group 内一意。
    pub key: String,
    /// 表示ラベル (例: "生体" / "用品" / "初心者向け")。
    pub label: Localizable,
    /// 現在のクエリでこの値が選択中なら true。
    /// クライアントは true → primary inverse、false → outlined のように描き分ける。
    pub selected: bool,
    /// クリック先 URL。**toggle 後の状態** を表す:
    ///   - 自分が selected → 自分を除いた URL (= 解除)
    ///   - 自分が not selected → 自分を追加した URL (= 適用)
    pub href: Href,
    /// 現クエリ条件下でこの値を選んだ場合の該当件数 (faceted search / Phase 5)。
    /// 「他軸の絞り込みは維持し、この軸の値を **この chip に切り替えた** ら何件か」。
    /// 0 件のチップも非表示にせず `Some(0)` を返す (= UI 側で disabled 表示する余地)。
    /// 集計を切る (= 全削除して None に戻す) 場合は handler 側の build_filter_bar を変える。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub count: Option<u32>,
    /// click analytics 用 ID。`filter.<group_key>.<chip_key>` 形式を推奨。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub analytics_id: Option<String>,
}

/// 並び替え UI 全体 (Phase 5)。1 ページに 1 つだけ。
///
/// **current** はクエリ未指定時のデフォルトを含めた「現在適用中の sort key」を返す。
/// クライアントは current === option.key で selected を判定できるが、
/// `SortOption.selected` も明示的に持たせて renderer の責務を減らしている。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SortBar {
    /// 現在適用中の sort key (例: "name" / "price_asc" / "new")。
    /// クエリ未指定時は default value で埋まる。
    pub current: String,
    /// 並び順候補。少なくとも 1 件以上。
    pub options: Vec<SortOption>,
}

/// 1 つの並び順候補。filter chip と似ているが、selected 切替時に
/// 「自分を抜く / 自分を追加する」のではなく「自分に置き換える」のが違い。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SortOption {
    /// sort 値識別子 (例: "name" / "price_asc" / "price_desc" / "new")。
    pub key: String,
    /// 表示ラベル (例: "名前順" / "価格(安い順)")。
    pub label: Localizable,
    /// 現在の `?sort=` がこの値なら true。クエリ未指定時は default 値が selected。
    pub selected: bool,
    /// クリック先 URL — この sort に **置き換えた** 状態の URL。
    /// filter chip 群 (`?category=` 等) は維持される。
    pub href: Href,
    /// click analytics 用 ID。`sort.<key>` 形式を推奨。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub analytics_id: Option<String>,
}

/// 検索 box (Phase 6)。
///
/// **submitHref** はクエリから `q` を「抜いた」base URL を返す。フロントは:
///   - JS 無し: `<form action="{submitHref}" method="get">` + 内部の input name=`paramName`
///     で送信。filter / sort 等の他 params は submitHref に含まれているので維持される。
///   - JS 有り: input change を debounce → `submitHref` の query string を URLSearchParams で
///     parse → `q` を上書き → navigate。
///
/// `paramName` を field として持つ理由: 将来 `?keyword=` 等にリネームしたくなった時、
/// クライアントを変えずに移行できる (= server だけで決められる)。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchBox {
    /// 現在の検索文字列 (空 / 未指定なら None)。controlled input の初期値として使う。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub query: Option<String>,
    /// 入力欄の placeholder。空文字でも構わない。
    pub placeholder: Localizable,
    /// submit 先 (q を抜いた base URL)。filter / sort などは含まれている。
    pub submit_href: Href,
    /// query string のパラメータ名 (通常 "q")。
    pub param_name: String,
    /// click/submit analytics ID。`search.submit` 形式を推奨。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub analytics_id: Option<String>,
}

/// 1 ページ分のリンク (= ページャに並ぶ各セル)。
///
/// **kind** で「数字リンク」「ellipsis (...)」を区別する:
///   - `Page { number, href, selected }` — クリック可能なページ番号
///   - `Ellipsis` — 省略表示 (1 ... 4 5 6 ... 10 のような中略)
///
/// page link を flat な Vec<PageLink> で表現するのは、render 側で `for (link of pages)`
/// するだけで済むようにするため。range collapse のロジックは server に集約。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum PageLink {
    /// 数字リンク。
    #[serde(rename_all = "camelCase")]
    Page {
        /// 1 始まりのページ番号。
        number: u32,
        /// 遷移先 URL。
        href: Href,
        /// 現在ページなら true (= aria-current="page" / disabled link 想定)。
        selected: bool,
    },
    /// 省略 (..)。クリック不可。
    Ellipsis,
}

/// ページング UI 全体 (Phase 6)。
///
/// **prevHref / nextHref が None** の時は disabled (first/last page を超えるリンクを描かない)。
/// クライアントは `data-disabled="true"` 付きの span などで render すればよい。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Pagination {
    /// 現在のページ番号 (1 始まり)。
    pub page: u32,
    /// 1 ページあたり件数。
    pub per_page: u32,
    /// 全件数 (filter + search 適用後 / sort・paginate 前)。
    pub total_count: u32,
    /// 全ページ数 (= ceil(total_count / per_page); 0 件なら 1)。
    pub total_pages: u32,
    /// 前ページへの URL。first page なら None (= disabled)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prev_href: Option<Href>,
    /// 次ページへの URL。last page なら None (= disabled)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_href: Option<Href>,
    /// ページ番号リンクのリスト (collapse 済み: 1 / current±2 / last + ellipsis)。
    pub pages: Vec<PageLink>,
    /// click analytics 用 ID prefix。`pagination.page` 形式を推奨 (個別ページは context に number を入れる)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub analytics_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdui::blocks::Href;

    fn raw(t: &str) -> Localizable {
        Localizable::Raw {
            text: t.to_string(),
        }
    }

    #[test]
    fn filter_chip_serializes_camel_case_with_selected_false_as_explicit_field() {
        // selected は bool (not Option) なので、false でも JSON に明示的に出る。
        // クライアントが `chip.selected` の存在を前提にできることが大事。
        let chip = FilterChipItem {
            key: "live".to_string(),
            label: raw("生体"),
            selected: false,
            href: Href::parse("/products?category=live").expect("href"),
            count: None,
            analytics_id: Some("filter.category.live".to_string()),
        };
        let json = serde_json::to_string(&chip).expect("serialize");
        assert!(
            json.contains(r#""selected":false"#),
            "selected:false must be emitted: {json}"
        );
        assert!(json.contains(r#""analyticsId":"filter.category.live""#));
        assert!(json.contains(r#""href":"/products?category=live""#));
        assert!(
            !json.contains(r#""count":"#),
            "None count must be omitted: {json}"
        );
    }

    #[test]
    fn product_list_response_round_trips() {
        let resp = ProductListResponse {
            filter_bar: Some(FilterBar {
                groups: vec![FilterGroup {
                    key: "category".to_string(),
                    label: raw("カテゴリ"),
                    chips: vec![FilterChipItem {
                        key: "live".to_string(),
                        label: raw("生体"),
                        selected: true,
                        href: Href::parse("/products").expect("href"),
                        count: Some(4),
                        analytics_id: Some("filter.category.live".to_string()),
                    }],
                }],
            }),
            sort_bar: Some(SortBar {
                current: "name".to_string(),
                options: vec![SortOption {
                    key: "name".to_string(),
                    label: raw("名前順"),
                    selected: true,
                    href: Href::parse("/products?sort=name").expect("href"),
                    analytics_id: Some("sort.name".to_string()),
                }],
            }),
            search_box: None,
            pagination: None,
            cards: vec![],
        };
        let json = serde_json::to_string(&resp).expect("serialize");
        let parsed: ProductListResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, resp);
        // count は Some(4) なので `"count":4` が出ているはず
        assert!(
            json.contains(r#""count":4"#),
            "count must be emitted: {json}"
        );
        // sortBar も camelCase で出ること
        assert!(
            json.contains(r#""sortBar":"#),
            "sortBar must be emitted: {json}"
        );
        assert!(
            json.contains(r#""current":"name""#),
            "sort_bar.current must be present: {json}",
        );
    }

    #[test]
    fn sort_option_serializes_camel_case_with_selected_explicit() {
        // selected は bool なので false でも明示出力される (FilterChipItem と同じ理由)。
        let opt = SortOption {
            key: "price_asc".to_string(),
            label: raw("価格(安い順)"),
            selected: false,
            href: Href::parse("/products?sort=price_asc").expect("href"),
            analytics_id: Some("sort.price_asc".to_string()),
        };
        let json = serde_json::to_string(&opt).expect("serialize");
        assert!(json.contains(r#""key":"price_asc""#));
        assert!(json.contains(r#""selected":false"#));
        assert!(json.contains(r#""href":"/products?sort=price_asc""#));
        assert!(json.contains(r#""analyticsId":"sort.price_asc""#));
    }

    #[test]
    fn empty_sort_bar_omits_field() {
        // sort_bar = None の時はキー自体を出さない (= フロントは「無し」と判別できる)。
        let resp = ProductListResponse {
            filter_bar: None,
            sort_bar: None,
            search_box: None,
            pagination: None,
            cards: vec![],
        };
        let json = serde_json::to_string(&resp).expect("serialize");
        assert!(
            !json.contains("sortBar"),
            "sortBar should be omitted: {json}"
        );
    }

    #[test]
    fn empty_filter_bar_omits_field() {
        let resp = ProductListResponse {
            filter_bar: None,
            sort_bar: None,
            search_box: None,
            pagination: None,
            cards: vec![],
        };
        let json = serde_json::to_string(&resp).expect("serialize");
        assert!(
            !json.contains("filterBar"),
            "filterBar should be omitted: {json}"
        );
    }

    // ── Phase 6 ──────────────────────────────────────────────────

    #[test]
    fn search_box_serializes_with_query_omit_when_none() {
        let sb = SearchBox {
            query: None,
            placeholder: raw("商品名で検索"),
            submit_href: Href::parse("/products").expect("href"),
            param_name: "q".to_string(),
            analytics_id: Some("search.submit".to_string()),
        };
        let json = serde_json::to_string(&sb).expect("serialize");
        assert!(
            !json.contains(r#""query":"#),
            "query=None should be omitted: {json}"
        );
        assert!(json.contains(r#""paramName":"q""#));
        assert!(json.contains(r#""submitHref":"/products""#));
    }

    #[test]
    fn search_box_serializes_with_query_when_some() {
        let sb = SearchBox {
            query: Some("ヘラクレス".to_string()),
            placeholder: raw("商品名で検索"),
            submit_href: Href::parse("/products").expect("href"),
            param_name: "q".to_string(),
            analytics_id: None,
        };
        let json = serde_json::to_string(&sb).expect("serialize");
        assert!(json.contains(r#""query":"ヘラクレス""#));
    }

    #[test]
    fn page_link_page_serializes_with_kind_tag() {
        let l = PageLink::Page {
            number: 2,
            href: Href::parse("/products?page=2").expect("href"),
            selected: true,
        };
        let json = serde_json::to_string(&l).expect("serialize");
        // tag は "kind" でディスクリミネート (camelCase)
        assert!(
            json.contains(r#""kind":"page""#),
            "kind tag missing: {json}"
        );
        assert!(json.contains(r#""number":2"#));
        assert!(json.contains(r#""selected":true"#));
    }

    #[test]
    fn page_link_ellipsis_serializes_compactly() {
        let l = PageLink::Ellipsis;
        let json = serde_json::to_string(&l).expect("serialize");
        // ellipsis variant にはペイロードが無いので kind だけが出る
        assert_eq!(json, r#"{"kind":"ellipsis"}"#);
    }

    #[test]
    fn pagination_round_trips() {
        let p = Pagination {
            page: 2,
            per_page: 3,
            total_count: 6,
            total_pages: 2,
            prev_href: Some(Href::parse("/products").expect("href")),
            next_href: None,
            pages: vec![
                PageLink::Page {
                    number: 1,
                    href: Href::parse("/products").expect("href"),
                    selected: false,
                },
                PageLink::Page {
                    number: 2,
                    href: Href::parse("/products?page=2").expect("href"),
                    selected: true,
                },
            ],
            analytics_id: Some("pagination.page".to_string()),
        };
        let json = serde_json::to_string(&p).expect("serialize");
        let parsed: Pagination = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, p);
        // last page なので nextHref は出ないこと (skip_serializing_if)
        assert!(
            !json.contains("nextHref"),
            "nextHref=None must be omitted: {json}"
        );
        assert!(json.contains(r#""prevHref":"/products""#));
        assert!(json.contains(r#""totalPages":2"#));
        assert!(json.contains(r#""perPage":3"#));
    }

    #[test]
    fn empty_pagination_and_search_box_omit_fields() {
        // Phase 4 までの response shape との後方互換性確認
        let resp = ProductListResponse {
            filter_bar: None,
            sort_bar: None,
            search_box: None,
            pagination: None,
            cards: vec![],
        };
        let json = serde_json::to_string(&resp).expect("serialize");
        assert!(
            !json.contains("searchBox"),
            "searchBox should be omitted: {json}"
        );
        assert!(
            !json.contains("pagination"),
            "pagination should be omitted: {json}"
        );
    }
}
