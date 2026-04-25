//! `/api/v1/cards/products` 系の SDUI ハンドラ。
//!
//! - `GET /api/v1/cards/products[?category=&difficulty=]` → list (`ProductListResponse`)
//! - `GET /api/v1/cards/products/{id}`                    → 1 枚 (`CardBlock`)
//!
//! **Phase 4** (2026-04): list は `Vec<CardBlock>` から
//! `ProductListResponse { filterBar, cards }` に変更。filter_bar は
//! クエリ state から組み立てた toggle URL 付き chip 群を含む。
//!
//! Phase 1: in-memory モックデータから返す。
//! 将来は商品マスタ DB を参照し、`updated_at` を ETag / Last-Modified ヘッダで返す (§14.1)。

use std::collections::HashMap;
use std::sync::OnceLock;

use axum::{
    Json,
    extract::{Path, Query},
};
use chrono::NaiveDate;
use serde::Deserialize;

use crate::error::AppError;
use crate::sdui::{
    BadgeRole, Block, CardBlock, CartVariant, CheckoutFieldAction, CheckoutMethodAction, CtaAction,
    CtaIntent, Currency, FilterBar, FilterChipItem, FilterGroup, FormFieldKind, Href,
    LineItemAction, Localizable, MediaKind, MetaItem, MetaLineItemRole, MetricItem, PageLink,
    Pagination, ProductListResponse, SearchBox, SelectOption, ShippingMethodOption, SortBar,
    SortOption, TextRole, ValidateKeys,
    blocks::{MetaItemAlign, ProductDetailVariant, ProductFeatureVariant},
    regions::{CartRegions, ProductDetailRegions, ProductFeatureRegions},
};

// ──────────────────────────────────────────────────────────────────────
// ハンドラ
// ──────────────────────────────────────────────────────────────────────

/// `GET /api/v1/cards/products/{id}` ハンドラ。
pub async fn get_product_card(Path(id): Path<String>) -> Result<Json<CardBlock>, AppError> {
    let card = mock_store()
        .get(id.as_str())
        .cloned()
        .ok_or(AppError::NotFound)?;

    // SDUI 不変条件: 構築直後に必ず key 一意性を検証する (§7.6)。
    card.validate_keys()
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    Ok(Json(card))
}

/// `GET /api/v1/cards/products/{id}/detail` ハンドラ。
///
/// 一覧用 (`product_feature`) とは別の `product_detail` テンプレートを返す。
/// 詳細ページは region 構成 (gallery / hero / spec / pricing / cta) が違うため、
/// 同 id でも別エンドポイントに分離している (§5: テンプレート毎にレスポンスを分ける)。
pub async fn get_product_detail_card(
    Path(id): Path<String>,
) -> Result<Json<CardBlock>, AppError> {
    let card = detail_mock_store()
        .get(id.as_str())
        .cloned()
        .ok_or(AppError::NotFound)?;

    card.validate_keys()
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    Ok(Json(card))
}

/// `GET /api/v1/cards/cart` ハンドラ (Phase 7)。
///
/// プロセス内 cart store のスナップショットを `CardBlock::Cart` に組み直して返す。
///
/// **設計**:
///   - 1 token = 1 LineItem block。商品マスタ (`product_filter_meta`) から title /
///     unit_price を join して埋める (= 価格をクライアントに信用させない)。
///   - サーバが落ちても表示金額が「クライアント計算」と「サーバ計算」でずれないよう、
///     subtotal_amount / OrderSummary.total_amount はサーバ側で確定して返す。
///   - 空カート時は `items` / `summary` を `[]` にし、`cta` には「買い物を続ける」だけ。
///     client renderer 側 `<Show when={items.length > 0}>` で empty state に切り替える。
///   - 商品マスタに無い token (= 出品取り下げ後にカートに残ったゴミ) はスキップしつつ
///     500 にしない (= ユーザの「他の商品はカートにある」体験を壊さない)。
///   - decrement_action は `qty == 1` の時のみ `None` (UI で disabled に)。
///
/// **将来 (Phase 7+)**:
///   - 在庫切れ商品にバッジを付ける
///   - 配送料計算 (今は固定で `None` = 行を出さない)
///   - 消費税内訳の表示
pub async fn get_cart_card() -> Result<Json<CardBlock>, AppError> {
    let snapshot = crate::handlers::cart::snapshot_cart();
    let card = build_cart_card(snapshot);
    card.validate_keys()
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(card))
}

/// `snapshot_cart()` の結果から `CardBlock::Cart` を組み立てる。
///
/// テスト容易性のためハンドラから純粋関数を分離 (= 引数で snapshot を渡す)。
///
/// **Phase 8**: cart 全体に checkout state (配送先 + 配送方法) も寄せて、
///   - `regions.shipping`        : FormField 5 件 (氏名 / 電話 / 郵便番号 / 都道府県 / 住所)
///   - `regions.shipping_method` : ShippingMethodPicker 1 件
///   - `regions.summary`         : OrderSummary に shipping_amount を反映
///   - `regions.cta`             : `is_shipping_complete && !is_empty` の時のみ primary 「決済へ」
/// を出す。空カート時は shipping / shipping_method / summary を空配列 (= section 省略)。
fn build_cart_card(
    snapshot: Vec<(String, crate::handlers::cart::CartEntry)>,
) -> CardBlock {
    let checkout = crate::handlers::checkout::snapshot_checkout();
    build_cart_card_with_checkout(snapshot, checkout)
}

/// テスト容易性のために checkout state も引数で受け取る純粋関数版。
/// 本番ハンドラは上記 `build_cart_card` 経由で global store のスナップショットを渡す。
fn build_cart_card_with_checkout(
    snapshot: Vec<(String, crate::handlers::cart::CartEntry)>,
    checkout: crate::handlers::checkout::CheckoutState,
) -> CardBlock {
    let meta = product_filter_meta();

    // ── LineItem block を組み立てる ──────────────────────────────
    // - 商品マスタに存在しない token はスキップ (= 出品取り下げ後の残骸対策)。
    // - key は "li-<token>" で安定させる (= ValidateKeys + 再 fetch 後の DOM 差分にも優しい)。
    let mut line_items: Vec<Block> = Vec::with_capacity(snapshot.len());
    let mut subtotal_amount: i64 = 0;
    let mut total_qty: u32 = 0;

    for (token, entry) in snapshot.iter() {
        let Some(m) = meta.get(entry.product_id.as_str()) else {
            // 商品マスタに無い → ゴミとみなして表示しない (= ユーザに見せても操作できない)
            continue;
        };
        let unit_price_amount: i64 = m.price_yen as i64;
        let line_subtotal: i64 = unit_price_amount * (entry.qty as i64);

        // qty == 1 の時は decrement を None (UI で disabled)。
        // それ以外は SetQty { qty - 1 }。
        let decrement_action = if entry.qty <= 1 {
            None
        } else {
            Some(LineItemAction::SetQty {
                token: token.clone(),
                qty: entry.qty - 1,
            })
        };
        let increment_action = LineItemAction::SetQty {
            token: token.clone(),
            qty: entry.qty + 1,
        };
        let remove_action = LineItemAction::Remove {
            token: token.clone(),
        };

        line_items.push(Block::LineItem {
            key: format!("li-{token}"),
            product_id: entry.product_id.clone(),
            title: raw(m.title),
            image_src: None, // Phase 1 と揃える: 実画像 URL なし → renderer placeholder
            image_alt: Some(raw(m.title)),
            unit_price_amount,
            currency: Currency::JPY,
            qty: entry.qty,
            subtotal_amount: line_subtotal,
            detail_href: Href::parse(&format!("/products/{}", entry.product_id))
                .expect("static product detail href is always valid"),
            decrement_action,
            increment_action,
            remove_action,
            analytics_id: Some(format!("cart.line.{}", entry.product_id)),
        });

        subtotal_amount = subtotal_amount.saturating_add(line_subtotal);
        total_qty = total_qty.saturating_add(entry.qty);
    }

    let line_count: u32 = line_items.len() as u32;
    let is_empty = line_items.is_empty();

    // ── header ───────────────────────────────────────────────────
    // header: "あなたのカート (N 件)" (空でも 0 件として出す)
    let header: Vec<Block> = vec![Block::Text {
        key: "header-title".to_string(),
        role: TextRole::Headline,
        content: raw(&format!("あなたのカート ({line_count} 件)")),
        analytics_id: None,
    }];

    // ── shipping / shipping_method (Phase 8) ────────────────────
    // 空カート時は section ごと省略 (= shipping を空配列に倒す)。
    // 配送先は Cart 全体の隣接体験なので「カート空 → 入力させない」が UX 上自然。
    let shipping: Vec<Block> = if is_empty {
        Vec::new()
    } else {
        build_shipping_form_blocks(&checkout)
    };
    let shipping_method: Vec<Block> = if is_empty {
        Vec::new()
    } else {
        vec![build_shipping_method_picker(&checkout)]
    };

    // ── summary ──────────────────────────────────────────────────
    // 空カート時は空配列。それ以外は shipping_amount を反映した OrderSummary を 1 件。
    let shipping_amount: i64 =
        crate::handlers::checkout::shipping_amount_for(&checkout.shipping_method_id);
    let summary: Vec<Block> = if is_empty {
        Vec::new()
    } else {
        vec![Block::OrderSummary {
            key: "summary-total".to_string(),
            line_count,
            total_qty,
            subtotal_amount,
            shipping_amount: Some(shipping_amount),
            tax_amount: None, // 内税表示なので明細行は出さない
            total_amount: subtotal_amount.saturating_add(shipping_amount),
            currency: Currency::JPY,
            analytics_id: Some("cart.summary".to_string()),
        }]
    };

    // ── cta ──────────────────────────────────────────────────────
    //   - 空カート: 「買い物を続ける」だけ (= /products へ)
    //   - 商品有 + 配送先未入力: 「決済へ」を出さず「買い物を続ける」だけ + warning Text
    //     (Stripe 決済までいかない理由を server から下ろす方が一貫)。
    //   - 商品有 + 配送先 OK: 「Stripe で決済」(primary) + 「買い物を続ける」(secondary)
    // Phase 8 でも実 Stripe 接続はせず、href は /checkout/stripe (404 想定) に倒すだけ。
    let shipping_complete = is_shipping_complete(&checkout);
    let cta: Vec<Block> = if is_empty {
        vec![Block::Cta {
            key: "cta-continue".to_string(),
            intent: CtaIntent::Secondary,
            label: raw("買い物を続ける"),
            href: Href::parse("/products").expect("static href"),
            action: None,
            analytics_id: Some("cart.cta.continue".to_string()),
        }]
    } else if !shipping_complete {
        vec![
            Block::Text {
                key: "cta-warn".to_string(),
                role: TextRole::Caption,
                content: raw("未入力項目があります。決済前に全て埋めてください。"),
                analytics_id: Some("cart.cta.warn".to_string()),
            },
            Block::Cta {
                key: "cta-continue".to_string(),
                intent: CtaIntent::Secondary,
                label: raw("買い物を続ける"),
                href: Href::parse("/products").expect("static href"),
                action: None,
                analytics_id: Some("cart.cta.continue".to_string()),
            },
        ]
    } else {
        vec![
            Block::Cta {
                key: "cta-checkout".to_string(),
                intent: CtaIntent::Primary,
                label: raw("Stripe で決済"),
                href: Href::parse("/checkout/stripe").expect("static href"),
                action: None,
                analytics_id: Some("cart.cta.checkout".to_string()),
            },
            Block::Cta {
                key: "cta-continue".to_string(),
                intent: CtaIntent::Secondary,
                label: raw("買い物を続ける"),
                href: Href::parse("/products").expect("static href"),
                action: None,
                analytics_id: Some("cart.cta.continue".to_string()),
            },
        ]
    };

    CardBlock::Cart {
        id: "cart".to_string(),
        variant: Some(CartVariant::Default),
        experiment: None,
        analytics_id: Some("cart".to_string()),
        regions: CartRegions {
            header,
            items: line_items,
            shipping,
            shipping_method,
            summary,
            cta,
        },
    }
}

/// 配送先入力フォームを 5 件の FormField に展開する (Phase 8)。
///
/// **field 順**: 氏名 → 電話 → 郵便番号 → 都道府県 → 住所 (= legacy /cart UI と同じ)。
/// グリッド配置 (2 カラム + 住所が full width) は client renderer 側 CSS で吸収。
///
/// **PostalCode / Tel の inputmode 切替**: client renderer が `kind` で分岐するので
/// server 側は kind を正しく付けるだけで OK (= input mode は HTML 標準にお任せ)。
fn build_shipping_form_blocks(
    checkout: &crate::handlers::checkout::CheckoutState,
) -> Vec<Block> {
    let prefectures = japan_prefectures()
        .iter()
        .map(|p| SelectOption {
            id: (*p).to_string(),
            label: raw(p),
        })
        .collect::<Vec<_>>();

    vec![
        build_form_field(
            "ff-name",
            "addressName",
            "氏名",
            &checkout.address_name,
            true,
            Some("name"),
            None,
            FormFieldKind::Text,
        ),
        build_form_field(
            "ff-tel",
            "addressTel",
            "電話",
            &checkout.address_tel,
            true,
            Some("tel"),
            None,
            FormFieldKind::Tel,
        ),
        build_form_field(
            "ff-zip",
            "addressZip",
            "郵便番号",
            &checkout.address_zip,
            true,
            Some("postal-code"),
            Some("150-0001"),
            FormFieldKind::PostalCode,
        ),
        build_form_field(
            "ff-pref",
            "addressPref",
            "都道府県",
            &checkout.address_pref,
            true,
            Some("address-level1"),
            None,
            FormFieldKind::Select { options: prefectures },
        ),
        build_form_field(
            "ff-addr",
            "addressAddr",
            "住所",
            &checkout.address_addr,
            true,
            Some("street-address"),
            None,
            FormFieldKind::Text,
        ),
    ]
}

/// 1 つの FormField block を組む helper。引数の数が多いので enum 化はせず named for clarity。
#[allow(clippy::too_many_arguments)]
fn build_form_field(
    key: &str,
    name: &str,
    label_text: &str,
    current_value: &str,
    required: bool,
    autocomplete: Option<&str>,
    placeholder: Option<&str>,
    kind: FormFieldKind,
) -> Block {
    // 空文字 → None (= 「未入力」と「空に編集中」を区別)。
    let value = if current_value.is_empty() {
        None
    } else {
        Some(current_value.to_string())
    };
    // required かつ値が空なら server 判定の error 文を出す。
    // Phase 8 は「空 → '未入力です'」だけ。Phase 8+ で regex / length check を増やす。
    let validation_error = if required && current_value.trim().is_empty() {
        Some(raw("未入力です"))
    } else {
        None
    };
    Block::FormField {
        key: key.to_string(),
        name: name.to_string(),
        label: raw(label_text),
        value,
        required,
        autocomplete: autocomplete.map(|s| s.to_string()),
        placeholder: placeholder.map(raw),
        validation_error,
        kind,
        patch_action: CheckoutFieldAction::PatchField {
            field_name: name.to_string(),
        },
        analytics_id: Some(format!("cart.field.{name}")),
    }
}

/// 配送方法ピッカーを 1 件組む (Phase 8)。
fn build_shipping_method_picker(
    checkout: &crate::handlers::checkout::CheckoutState,
) -> Block {
    let options = crate::handlers::checkout::SHIPPING_METHODS
        .iter()
        .map(|m| ShippingMethodOption {
            id: m.id.to_string(),
            // Phase 8 簡易版: name / description は raw 文 (i18n キー切り出しは Phase 8+)。
            // 既存の cart card と整合させるため raw (= 翻訳辞書経由しない) で出す。
            name: raw(method_name_ja(m.id)),
            description: raw(method_desc_ja(m.id)),
            amount: m.amount_yen,
            currency: Currency::JPY,
        })
        .collect();
    Block::ShippingMethodPicker {
        key: "method-picker".to_string(),
        options,
        selected_id: checkout.shipping_method_id.clone(),
        patch_action: CheckoutMethodAction::PatchMethod,
        analytics_id: Some("cart.shipping_method".to_string()),
    }
}

/// Phase 8 簡易: 配送方法 id → 表示名 (日本語)。
/// i18n 化は Phase 8+ で `method_name_key` を i18n() で出すように切り替える。
fn method_name_ja(id: &str) -> &'static str {
    match id {
        "cold" => "温度制御便（推奨）",
        "normal" => "通常便",
        _ => "配送方法",
    }
}

fn method_desc_ja(id: &str) -> &'static str {
    match id {
        "cold" => "生体含むため必須設定 · 15〜25℃",
        "normal" => "用品のみの場合",
        _ => "",
    }
}

/// checkout state が「全 5 フィールド非空」かを判定。
/// `is_shipping_complete` の名前は legacy /cart `store/checkout.ts` と揃える。
fn is_shipping_complete(checkout: &crate::handlers::checkout::CheckoutState) -> bool {
    !checkout.address_name.trim().is_empty()
        && !checkout.address_tel.trim().is_empty()
        && !checkout.address_zip.trim().is_empty()
        && !checkout.address_pref.trim().is_empty()
        && !checkout.address_addr.trim().is_empty()
}

/// 都道府県 47 件 (legacy `store/checkout.ts` PREFECTURES と同じ並び)。
/// const ではなく fn で返す理由は `&'static [&'static str]` の static lifetime を取り回す
/// 構築コストが小さいため + 将来 i18n キー化する際にここを差し替えやすい。
fn japan_prefectures() -> &'static [&'static str] {
    &[
        "北海道",
        "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
        "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
        "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
        "岐阜県", "静岡県", "愛知県", "三重県",
        "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
        "鳥取県", "島根県", "岡山県", "広島県", "山口県",
        "徳島県", "香川県", "愛媛県", "高知県",
        "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県",
        "沖縄県",
    ]
}

/// `GET /api/v1/cards/products` の query 文字列。
///
/// Phase 4 で導入: `?category=live&difficulty=hard` のような単一値フィルタ。
/// 各 group は **single-select** (1 値のみ)。複数選択 (multi-select) は将来。
/// Phase 5 で `?sort=name|price_asc|price_desc|new` を追加。
/// Phase 6 で `?q=<keyword>&page=<n>&perPage=<n>` を追加。
///
/// **未知の値 (例: `?category=galaxy_invader` / `?sort=foo`) の扱い**:
///   そのまま受け入れて「該当 0 件 (filter)」「default 順 (sort)」として返す。
///   エラーにしない理由は、ブックマーク URL が古くなった場合の壊れ耐性
///   (= 200 + 0 件 + フィルタ群はそのまま)。
///
/// **`page=0` / `perPage=0` 等の不正値の扱い**:
///   resolve_page / resolve_per_page で default にフォールバック。
///   `perPage` の上限は `MAX_PER_PAGE`。
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub category: Option<String>,
    pub difficulty: Option<String>,
    /// Phase 5: 並び順キー。未指定 / 不正値はすべて `DEFAULT_SORT_KEY` 扱い。
    pub sort: Option<String>,
    /// Phase 6: 検索キーワード (substring, case-insensitive)。
    /// 空文字 / 未指定 → 検索なし。trim 後の長さで判定する。
    pub q: Option<String>,
    /// Phase 6: ページ番号 (1 始まり)。未指定 / 1 未満 → 1 ページ目。
    pub page: Option<u32>,
    /// Phase 6: 1 ページあたり件数。未指定 → `DEFAULT_PER_PAGE`。
    /// `MAX_PER_PAGE` でキャップ (= 過大な per_page を弾く DoS 対策)。
    pub per_page: Option<u32>,
}

/// 商品 ID → 絞り込み + 並び替えメタ。Card 自身には載せず handler 側で side-table 管理。
///
/// **なぜ Card に乗せないか**:
///   `category` / `difficulty` は商品「カードの表示」には使わない (UI に出さない)。
///   `price_yen` / `created_days_ago` は Card にも価格 Block として載るが、それは
///   「表示用のフォーマット済み値」であり、ソート判定には使いにくい (i18n / 通貨混在)。
///   `CardBlock` は表示契約なので、ソート用の生数値で汚すと両者の責務が混ざる。
///   list ページの絞り込み + 並び替えにだけ要る ⇒ handler 側 lookup table に閉じ込める。
///
/// **Phase 5 追加** (2026-04):
///   - `price_yen`: 価格 (円, 税込)。Card 内 Block::Price と同じ値で同期。
///   - `created_days_ago`: 「現在から見て何日前に登録されたか」。"new" sort で使う。
///     固定値で持つ理由は (a) テスト時刻に依存しない (b) 6 件で順序を一意に決められる。
///
/// **Phase 6 追加** (2026-04):
///   - `title`: 商品名 (Card 内 headline と同期)。`?q=` substring 検索に使う。
///     Card 自身から走査せず meta に持つ理由:
///     (a) Localizable から raw text を抜くロジックを増やしたくない
///     (b) 検索対象を「タイトル」に限定する判断を 1 箇所で表現できる (将来 sci 名や
///         shop 名も入れたければここに足す)。
///     Card 表示文字列とずれないよう、build_specimen_card / build_supply_card 引数の
///     `title` 引数とこの値を一致させる。`title_synced_with_card_meta` テストで保証。
fn product_filter_meta() -> &'static HashMap<&'static str, ProductMeta> {
    static META: OnceLock<HashMap<&'static str, ProductMeta>> = OnceLock::new();
    META.get_or_init(|| {
        let mut m: HashMap<&'static str, ProductMeta> = HashMap::new();
        // 生体 4 件
        m.insert(
            "p-hh-m-142",
            ProductMeta {
                category: "live",
                difficulty: "hard",
                price_yen: 48_000,
                created_days_ago: 7,
                title: "ヘラクレスオオカブト ♂ 142mm",
            },
        );
        m.insert(
            "p-cat-l",
            ProductMeta {
                category: "live",
                difficulty: "medium",
                price_yen: 12_000,
                created_days_ago: 30,
                title: "コーカサス幼虫 3齢 ♂ 52g",
            },
        );
        m.insert(
            "p-neo-m",
            ProductMeta {
                category: "live",
                difficulty: "hard",
                price_yen: 28_000,
                created_days_ago: 14,
                title: "ネプチューン ♂ 初令ペア",
            },
        );
        m.insert(
            "p-aki",
            ProductMeta {
                category: "live",
                difficulty: "hard",
                price_yen: 62_000,
                created_days_ago: 2,
                title: "アクタエオン WILD F1 ♂",
            },
        );
        // 用品 2 件
        m.insert(
            "p-jelly",
            ProductMeta {
                category: "supply",
                difficulty: "easy",
                price_yen: 1_480,
                created_days_ago: 60,
                title: "高栄養ゼリー 17g × 50個",
            },
        );
        m.insert(
            "p-mat",
            ProductMeta {
                category: "supply",
                difficulty: "easy",
                price_yen: 1_280,
                created_days_ago: 45,
                title: "完熟発酵マット 10L",
            },
        );
        m
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProductMeta {
    category: &'static str,
    difficulty: &'static str,
    /// 価格 (円, 税込)。Phase 5: price_asc / price_desc sort で使う。
    price_yen: u32,
    /// 登録から経過日数 (新着 sort 用)。小さいほど新しい。
    created_days_ago: u32,
    /// Phase 6: 検索対象タイトル (= Card の headline と同じ文字列)。
    title: &'static str,
}

/// 絞り軸の宣言 (group_key, chip_key, label)。
/// 並び順 = 表示順。新軸を足す時はここに足すだけで filter_bar に反映される。
const CATEGORY_OPTIONS: &[(&str, &str)] = &[("live", "生体"), ("supply", "用品")];
const DIFFICULTY_OPTIONS: &[(&str, &str)] =
    &[("easy", "初心者向け"), ("medium", "中級者"), ("hard", "上級者")];

/// 並び替え候補 (Phase 5)。`(key, label)` の順 = UI 表示順。
///
/// 設計メモ:
/// - 単一選択 (radio 的)。1 つだけ active。
/// - **default** は先頭の `name` (id 辞書順)。Phase 4 と同じ既定挙動を維持し、
///   sort 機能が無かった頃のクライアントが壊れないようにする。
/// - 不明な値は default にフォールバック (URL のタイポで 500 にしない)。
const SORT_OPTIONS: &[(&str, &str)] = &[
    ("name", "名前順"),
    ("price_asc", "価格(安い順)"),
    ("price_desc", "価格(高い順)"),
    ("new", "新着順"),
];

/// `?sort=` 未指定 / 不明値の時のデフォルト。
const DEFAULT_SORT_KEY: &str = "name";

/// Phase 6: ページング既定値。
///
/// **DEFAULT_PER_PAGE = 20**: API 一般的な default。モックは 6 件しかないので
/// 実際のページング挙動を見たい時はクライアントが `?perPage=2` 等を渡す想定。
/// **MAX_PER_PAGE = 100**: ユーザが `?perPage=99999` で全件吸い出すのを防ぐキャップ。
const DEFAULT_PER_PAGE: u32 = 20;
const MAX_PER_PAGE: u32 = 100;
const DEFAULT_PAGE: u32 = 1;

/// クエリの `sort` を有効値に正規化する。
/// 未知 / None の場合は DEFAULT_SORT_KEY を返す。
fn resolve_sort_key(raw: Option<&str>) -> &'static str {
    raw.and_then(|v| SORT_OPTIONS.iter().find(|(k, _)| *k == v).map(|(k, _)| *k))
        .unwrap_or(DEFAULT_SORT_KEY)
}

/// Phase 6: `?q=` を正規化。空文字 / 空白のみ → None。
/// trim 後の値を返すので URL に再注入しても動く (= "  ヘラ  " → "ヘラ")。
fn resolve_q(raw: Option<&str>) -> Option<String> {
    raw.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

/// Phase 6: `?page=` を 1 以上の値に正規化。`Some(0)` / None → DEFAULT_PAGE。
fn resolve_page(raw: Option<u32>) -> u32 {
    raw.filter(|&p| p >= 1).unwrap_or(DEFAULT_PAGE)
}

/// Phase 6: `?perPage=` を [1, MAX_PER_PAGE] にクランプ。`Some(0)` / None → DEFAULT_PER_PAGE。
fn resolve_per_page(raw: Option<u32>) -> u32 {
    raw.filter(|&n| n >= 1)
        .map(|n| n.min(MAX_PER_PAGE))
        .unwrap_or(DEFAULT_PER_PAGE)
}

/// Phase 6: 商品 (タイトル) が `q` に substring (case-insensitive) でマッチするか。
///
/// **null safety**: `q = None` なら全件 true (= 検索なし)。
/// **multi-byte safe**: Rust の `to_lowercase()` は Unicode 対応 (NFKC ではないが、
///   日本語の漢字/ひらがな/カタカナ間変換はしない素直な比較。MVP には十分)。
fn matches_search(title: &str, q: Option<&str>) -> bool {
    match q {
        None => true,
        Some(needle) => title.to_lowercase().contains(&needle.to_lowercase()),
    }
}

/// 2 つの id を `sort_key` に従って比較する。
///
/// **設計**:
///   - すべての sort key が **stable な決定論順序** を返すように、tie-break として
///     最後に必ず id 昇順を入れる。これによりテストで「同価格の商品は id 順」と
///     hard-code でき、Vec 内部の順番に依存しない。
///   - 未知の sort_key (= resolve_sort_key を通っていない呼び出し) は id 順扱い。
///   - meta 未登録の id は最後に id 順 (新商品が落ちない安全弁、Phase 4 と同方針)。
fn sort_cmp(
    sort_key: &str,
    a_id: &str,
    b_id: &str,
    meta: &HashMap<&'static str, ProductMeta>,
) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let am = meta.get(a_id);
    let bm = meta.get(b_id);
    let primary = match (sort_key, am, bm) {
        ("price_asc", Some(a), Some(b)) => a.price_yen.cmp(&b.price_yen),
        ("price_desc", Some(a), Some(b)) => b.price_yen.cmp(&a.price_yen),
        // created_days_ago が小さい = 新しい → 新着順は ascending on days_ago
        ("new", Some(a), Some(b)) => a.created_days_ago.cmp(&b.created_days_ago),
        // "name" およびそれ以外は id 順 (default)
        _ => Ordering::Equal,
    };
    primary.then_with(|| a_id.cmp(b_id))
}

/// `GET /api/v1/cards/products?...` ハンドラ — フィルタ + 検索 + 並び替え + ページング 対応の商品一覧。
///
/// **挙動 (Phase 6)**:
///   1. `query.sort` / `q` / `page` / `perPage` を有効値に正規化
///   2. `query` の filter 条件で全商品を絞る (= filter set, faceted count はここの母集団)
///   3. **filter set に対して** q substring で絞る (= search set)
///   4. search set を `sort_cmp` で並べる
///   5. paginate: `(page-1)*perPage` から `perPage` 件を切り出す
///   6. paginate 後のカードを `validate_keys()` で検証 (壊れていたら 500)
///   7. `filter_bar` (faceted count は filter set ベース) / `sort_bar` / `search_box` /
///      `pagination` を組み立て
///   8. `ProductListResponse { filter_bar, sort_bar, search_box, pagination, cards }` を返す
///
/// **不変条件**: filter_bar / sort_bar / search_box / pagination は **常に Some で返す**。
///   フロントが空配列を踏まなくても shape を信用できる。
///
/// **filter chain の順序が重要**:
///   - faceted count は filter のみ適用後で計算 → search/sort/paginate に揺らがない
///   - pagination の totalCount は filter+search 適用後 → 検索でヒット数が変わって見える
///   - sort と pagination は表示順制御だけで count に影響しない
pub async fn list_product_cards(
    Query(query): Query<ListQuery>,
) -> Result<Json<ProductListResponse>, AppError> {
    let store = mock_store();
    let meta = product_filter_meta();

    // 1. クエリパラメータを正規化
    let sort_key = resolve_sort_key(query.sort.as_deref());
    let q_norm = resolve_q(query.q.as_deref());
    let page = resolve_page(query.page);
    let per_page = resolve_per_page(query.per_page);

    // 2. 全 ID → filter set
    let all_ids: Vec<&'static str> = store.keys().copied().collect();
    let filtered_ids: Vec<&'static str> = all_ids
        .into_iter()
        .filter(|id| matches_query(&query, meta.get(id)))
        .collect();

    // 3. filter set → search set (q が None なら filter set そのまま)
    let mut searched_ids: Vec<&'static str> = filtered_ids
        .iter()
        .copied()
        .filter(|id| {
            // meta が無い id は title が空とみなして q 指定時は落ちる
            let title = meta.get(id).map(|m| m.title).unwrap_or("");
            matches_search(title, q_norm.as_deref())
        })
        .collect();

    // 4. sort
    searched_ids.sort_by(|a, b| sort_cmp(sort_key, a, b, meta));

    // 5. paginate
    let total_count = searched_ids.len() as u32;
    let total_pages = if total_count == 0 {
        1
    } else {
        total_count.div_ceil(per_page)
    };
    // page out-of-range は空配列を返す (clamp はしない: ユーザの URL がエラー的なら見える化)
    let start = ((page.saturating_sub(1)) as usize).saturating_mul(per_page as usize);
    let end = (start + per_page as usize).min(searched_ids.len());
    let paged_ids: &[&'static str] = if start >= searched_ids.len() {
        &[]
    } else {
        &searched_ids[start..end]
    };

    // 6. CardBlock に変換 + validate
    let cards: Vec<CardBlock> = paged_ids
        .iter()
        .map(|id| store.get(id).expect("id was just listed from store").clone())
        .collect();
    for card in &cards {
        card.validate_keys()
            .map_err(|e| AppError::BadRequest(format!("invalid card {}: {}", card.id(), e)))?;
    }

    // 7. shell 群を組み立て
    let filter_bar = build_filter_bar(&query, sort_key, q_norm.as_deref(), per_page);
    let sort_bar = build_sort_bar(&query, sort_key, q_norm.as_deref(), per_page);
    let search_box = build_search_box(&query, sort_key, per_page);
    let pagination = build_pagination(&query, sort_key, q_norm.as_deref(), page, per_page, total_count, total_pages);

    Ok(Json(ProductListResponse {
        filter_bar: Some(filter_bar),
        sort_bar: Some(sort_bar),
        search_box: Some(search_box),
        pagination: Some(pagination),
        cards,
    }))
}

/// 1 商品が現在のクエリにマッチするかを判定。
///
/// **メタ未登録商品の扱い**: `meta` が None の商品は「未分類」として、
/// クエリが何も指定されていない時のみ通す (= フィルタが当たれば落ちる)。
/// 現状全 6 件にメタを付けているので発生しないが、新商品追加時の安全弁。
fn matches_query(q: &ListQuery, meta: Option<&ProductMeta>) -> bool {
    match meta {
        Some(m) => {
            if let Some(c) = &q.category {
                if c != m.category {
                    return false;
                }
            }
            if let Some(d) = &q.difficulty {
                if d != m.difficulty {
                    return false;
                }
            }
            true
        }
        None => q.category.is_none() && q.difficulty.is_none(),
    }
}

/// クエリ state から filter_bar (chip 群 + 各 chip の toggle 後 href + count) を組む。
///
/// **toggle ロジック (Phase 4)**:
///   - 現状 `?category=live` のとき "live" chip → href は `?category=` 抜きの URL
///     (= もう一度押すと解除される)
///   - 現状 `?category=live` のとき "supply" chip → href は `?category=supply` の URL
///     (= 押したら supply に切り替わる、live は外れる)
///   - difficulty 軸も独立に同じロジック
///
/// **faceted count (Phase 5)**:
///   `count = Some(n)` は「他軸の絞り込みは維持したまま、この軸の値を `chip.key` に
///   置き換えた状態で何件マッチするか」。
///   - selected な chip の count = 「自分を解除した時の件数」(= toggle 後の URL での件数)
///   - not selected な chip の count = 「自分に切り替えた時の件数」
///   どちらも chip クリック後の URL の件数と一致する → ユーザは数字を見て遷移先を予測できる。
///   0 件チップも非表示にせず Some(0) で返す (= UI 側で disabled 表示の余地)。
///
/// **sort key の伝播**:
///   chip の href には **正規化済み sort_key** を保持する (= filter 切替で並び順は変わらない)。
///   - sort_key が default なら href に `?sort=` を出さない (canonical)
///   - sort_key が非 default なら href に `?sort=...` を含める
///   不正な `q.sort` で踏まれても、chip クリック後の URL は canonical 化される。
fn build_filter_bar(
    q: &ListQuery,
    sort_key: &str,
    q_norm: Option<&str>,
    per_page: u32,
) -> FilterBar {
    let store = mock_store();
    let meta = product_filter_meta();

    // canonical sort param (default なら None、それ以外は Some(sort_key))
    let canonical_sort: Option<String> = if sort_key == DEFAULT_SORT_KEY {
        None
    } else {
        Some(sort_key.to_string())
    };
    // canonical perPage param (default なら None、それ以外は Some(per_page))
    let canonical_per_page: Option<u32> = if per_page == DEFAULT_PER_PAGE {
        None
    } else {
        Some(per_page)
    };
    // canonical q (空文字 trim 後 None なら href から省く)
    let canonical_q: Option<String> = q_norm.map(|s| s.to_string());

    let make_chip = |group_key: &str, value: &str, label: &str| -> FilterChipItem {
        // 自分が現状選択中か?
        let is_selected = match group_key {
            "category" => q.category.as_deref() == Some(value),
            "difficulty" => q.difficulty.as_deref() == Some(value),
            _ => false,
        };

        // toggle 後のクエリ state を作る (sort / q / per_page は canonical 値で維持、
        // page はリセット = 結果集合が変わるので 1 ページ目に戻す)
        let mut next = ListQuery {
            category: q.category.clone(),
            difficulty: q.difficulty.clone(),
            sort: canonical_sort.clone(),
            q: canonical_q.clone(),
            page: None,
            per_page: canonical_per_page,
        };
        match (group_key, is_selected) {
            ("category", true) => next.category = None,
            ("category", false) => next.category = Some(value.to_string()),
            ("difficulty", true) => next.difficulty = None,
            ("difficulty", false) => next.difficulty = Some(value.to_string()),
            _ => {}
        }

        // faceted count: toggle 後の **filter のみ** で何件マッチするか
        // 注意: q (search) は count に影響させない — chip の数字は「絞り込み後の母集団」を表す。
        // 検索でヒット件数が動いても chip 数字は揺らがず、フィルタ構造を見失わない設計。
        let count = store
            .keys()
            .filter(|id| matches_query(&next, meta.get(*id)))
            .count() as u32;

        let href_str = build_list_href(&next);
        FilterChipItem {
            key: value.to_string(),
            label: raw(label),
            selected: is_selected,
            href: Href::parse(&href_str).expect("filter href is internally constructed"),
            count: Some(count),
            analytics_id: Some(format!("filter.{group_key}.{value}")),
        }
    };

    FilterBar {
        groups: vec![
            FilterGroup {
                key: "category".to_string(),
                label: raw("カテゴリ"),
                chips: CATEGORY_OPTIONS
                    .iter()
                    .map(|(v, l)| make_chip("category", v, l))
                    .collect(),
            },
            FilterGroup {
                key: "difficulty".to_string(),
                label: raw("飼育難度"),
                chips: DIFFICULTY_OPTIONS
                    .iter()
                    .map(|(v, l)| make_chip("difficulty", v, l))
                    .collect(),
            },
        ],
    }
}

/// 並び替えバーを組み立てる (Phase 5)。
///
/// **設計**:
///   - 各 option の href は「filter 群を維持したまま、sort をこの値に置き換えた」URL。
///   - default sort (= `name`) を選んだ場合は `?sort=` 自体を URL から省く
///     (= canonical URL: 既定状態にクエリパラメータを足さない)。
///     これにより `?sort=name` で踏まれた URL は filter 切替時に `?sort=` が消え、
///     ユーザのブックマークが既定状態に集約される。
///   - selected = (option.key == 現状の sort_key)。クエリ未指定時は `name` が selected。
fn build_sort_bar(
    q: &ListQuery,
    sort_key: &str,
    q_norm: Option<&str>,
    per_page: u32,
) -> SortBar {
    let canonical_per_page: Option<u32> = if per_page == DEFAULT_PER_PAGE {
        None
    } else {
        Some(per_page)
    };
    let canonical_q: Option<String> = q_norm.map(|s| s.to_string());

    let options: Vec<SortOption> = SORT_OPTIONS
        .iter()
        .map(|(key, label)| {
            // この option を選んだ後のクエリ state
            let next_sort = if *key == DEFAULT_SORT_KEY {
                None // canonical: default は ?sort= を出さない
            } else {
                Some(key.to_string())
            };
            // sort 切替時も page リセット (= 並び順が変わると先頭ページに戻りたい)
            let next = ListQuery {
                category: q.category.clone(),
                difficulty: q.difficulty.clone(),
                sort: next_sort,
                q: canonical_q.clone(),
                page: None,
                per_page: canonical_per_page,
            };
            let href_str = build_list_href(&next);
            SortOption {
                key: key.to_string(),
                label: raw(label),
                selected: *key == sort_key,
                href: Href::parse(&href_str).expect("sort href is internally constructed"),
                analytics_id: Some(format!("sort.{key}")),
            }
        })
        .collect();
    SortBar {
        current: sort_key.to_string(),
        options,
    }
}

/// Phase 6: 検索 box (= 検索文字列入力欄) を組み立てる。
///
/// **submit_href**: q を「抜いた」base URL を返す。フロントは `submit_href + "&q=<入力値>"`
/// で submit すれば動く (= JS 無し form submit / JS 有り debounce navigate どちらも同じ URL を組む)。
/// page も同時に抜く (= 検索のたび 1 ページ目に戻る)。filter / sort は維持。
fn build_search_box(q: &ListQuery, sort_key: &str, per_page: u32) -> SearchBox {
    let canonical_per_page: Option<u32> = if per_page == DEFAULT_PER_PAGE {
        None
    } else {
        Some(per_page)
    };
    let canonical_sort: Option<String> = if sort_key == DEFAULT_SORT_KEY {
        None
    } else {
        Some(sort_key.to_string())
    };
    // q と page を抜いた canonical 状態
    let base = ListQuery {
        category: q.category.clone(),
        difficulty: q.difficulty.clone(),
        sort: canonical_sort,
        q: None,
        page: None,
        per_page: canonical_per_page,
    };
    let submit_href_str = build_list_href(&base);
    SearchBox {
        // 現在のクエリ (resolve 済み) を初期値に
        query: resolve_q(q.q.as_deref()),
        placeholder: raw("商品名で検索"),
        submit_href: Href::parse(&submit_href_str).expect("search submit href is internally constructed"),
        param_name: "q".to_string(),
        analytics_id: Some("search.submit".to_string()),
    }
}

/// Phase 6: ページング情報を組み立てる。
///
/// **prev_href / next_href**: first/last ページなら None (= 描画側で disabled)。
/// **pages**: collapse_page_range で「1 / 現在±2 / last + ellipsis」に縮約。
fn build_pagination(
    q: &ListQuery,
    sort_key: &str,
    q_norm: Option<&str>,
    page: u32,
    per_page: u32,
    total_count: u32,
    total_pages: u32,
) -> Pagination {
    let canonical_sort: Option<String> = if sort_key == DEFAULT_SORT_KEY {
        None
    } else {
        Some(sort_key.to_string())
    };
    let canonical_per_page: Option<u32> = if per_page == DEFAULT_PER_PAGE {
        None
    } else {
        Some(per_page)
    };
    let canonical_q: Option<String> = q_norm.map(|s| s.to_string());

    // 「ページ番号 N に行く URL」を組む
    let make_href = |page_n: u32| -> Href {
        // canonical: page=1 は URL から抜く
        let page_param = if page_n == DEFAULT_PAGE { None } else { Some(page_n) };
        let next = ListQuery {
            category: q.category.clone(),
            difficulty: q.difficulty.clone(),
            sort: canonical_sort.clone(),
            q: canonical_q.clone(),
            page: page_param,
            per_page: canonical_per_page,
        };
        Href::parse(&build_list_href(&next)).expect("pagination href is internally constructed")
    };

    let prev_href = if page > 1 { Some(make_href(page - 1)) } else { None };
    let next_href = if page < total_pages { Some(make_href(page + 1)) } else { None };

    let pages: Vec<PageLink> = collapse_page_range(page, total_pages)
        .into_iter()
        .map(|slot| match slot {
            PageSlot::Number(n) => PageLink::Page {
                number: n,
                href: make_href(n),
                selected: n == page,
            },
            PageSlot::Ellipsis => PageLink::Ellipsis,
        })
        .collect();

    Pagination {
        page,
        per_page,
        total_count,
        total_pages,
        prev_href,
        next_href,
        pages,
        analytics_id: Some("pagination.page".to_string()),
    }
}

/// Phase 6: ページ番号の collapse 結果を表す中間 enum。
/// 数字 or ellipsis の 2 値だけ。最終的に `PageLink` に map する。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PageSlot {
    Number(u32),
    Ellipsis,
}

/// 大量ページがある時に「1 ... current-2 current-1 current current+1 current+2 ... last」
/// に縮約する。最大要素数 7 + ellipsis 2 = 9 個程度。
///
/// **アルゴリズム**:
///   - すべてを一旦 `[1, current-2..=current+2, total]` で集める (重複は HashSet で除去)
///   - sort
///   - 隣接して飛ばない (gap=1) → 連続並び、gap≥2 → 間に Ellipsis を 1 個挟む
///
/// **エッジケース**:
///   - total_pages == 0 → [] (= ページャ非表示扱いを caller に任せる)
///   - total_pages == 1 → [Number(1)]
///   - current が範囲外 → 範囲内に clamp
fn collapse_page_range(current: u32, total_pages: u32) -> Vec<PageSlot> {
    if total_pages == 0 {
        return vec![];
    }
    let cur = current.clamp(1, total_pages);

    // 候補集合
    use std::collections::BTreeSet;
    let mut set: BTreeSet<u32> = BTreeSet::new();
    set.insert(1);
    set.insert(total_pages);
    // current ±2
    for off in 0..=2 {
        if cur > off {
            set.insert(cur - off);
        }
        if cur + off <= total_pages {
            set.insert(cur + off);
        }
    }

    let nums: Vec<u32> = set.into_iter().collect();
    let mut out: Vec<PageSlot> = Vec::with_capacity(nums.len() * 2);
    for (i, n) in nums.iter().enumerate() {
        if i > 0 {
            let prev = nums[i - 1];
            if *n - prev > 1 {
                out.push(PageSlot::Ellipsis);
            }
        }
        out.push(PageSlot::Number(*n));
    }
    out
}

/// `/products` への URL を組み立てる。空 query なら "?" を付けない (canonical URL)。
///
/// **Phase 5 拡張**: `?sort=` を `category` / `difficulty` の後ろに追加する。
/// **Phase 6 拡張**: `?q=` を最初に、`?page=` / `?perPage=` を最後に追加する。
/// パラメータ順は (q, category, difficulty, sort, page, perPage) で固定。
/// → URL の文字列等価性が保てる (テストで == 比較できる)。
///
/// **値の URL エンコード**:
///   - chip / sort 値は `[a-z_]+` のみなので素直に format! で OK。
///   - q は multi-byte / 記号を含み得るので `percent_encoding` で encode する必要がある。
///     現状 (Phase 6 MVP) は依存追加を避けて簡易 encoder を使う: `+` は `%2B`、
///     space は `%20`、それ以外は ASCII alnum + `-_.~` のみ生 (RFC 3986 unreserved)。
fn build_list_href(q: &ListQuery) -> String {
    let mut params: Vec<String> = Vec::with_capacity(6);
    if let Some(s) = &q.q {
        params.push(format!("q={}", percent_encode(s)));
    }
    if let Some(c) = &q.category {
        params.push(format!("category={c}"));
    }
    if let Some(d) = &q.difficulty {
        params.push(format!("difficulty={d}"));
    }
    if let Some(s) = &q.sort {
        params.push(format!("sort={s}"));
    }
    if let Some(p) = q.page {
        params.push(format!("page={p}"));
    }
    if let Some(pp) = q.per_page {
        params.push(format!("perPage={pp}"));
    }
    if params.is_empty() {
        "/products".to_string()
    } else {
        format!("/products?{}", params.join("&"))
    }
}

/// RFC 3986 unreserved 以外を `%HH` でエンコードする最小実装。
///
/// `urlencoding` / `percent-encoding` クレートを足さない理由は、Phase 6 MVP では
/// search 値 (q) しか動的入力が無く、chip/sort/page は ASCII 固定なので、
/// 最小実装で間に合うため。将来 multi-byte chip 値が出てきたらクレートに切替。
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        let c = *b;
        let unreserved = c.is_ascii_alphanumeric()
            || c == b'-'
            || c == b'_'
            || c == b'.'
            || c == b'~';
        if unreserved {
            out.push(c as char);
        } else {
            out.push_str(&format!("%{c:02X}"));
        }
    }
    out
}

// ──────────────────────────────────────────────────────────────────────
// in-memory モックデータ (Phase 1)
//
// data.ts の `APP_DATA.products` 6 件を SDUI カードとして起こしたもの。
// **同期ルール**: data.ts 側を変えたらここも更新する。
// 将来 DB 接続したらここは消える (一時的な fixture)。
// ──────────────────────────────────────────────────────────────────────

fn mock_store() -> &'static HashMap<&'static str, CardBlock> {
    static STORE: OnceLock<HashMap<&'static str, CardBlock>> = OnceLock::new();
    STORE.get_or_init(|| {
        let mut m: HashMap<&'static str, CardBlock> = HashMap::new();
        for card in all_mock_cards() {
            // id は静的文字列スライスとして登録したいので、build 時に一致を取る。
            // CardBlock::id() は &str を返すが、HashMap の key は 'static でほしい。
            let id_static: &'static str = match card.id() {
                "p-hh-m-142" => "p-hh-m-142",
                "p-cat-l" => "p-cat-l",
                "p-neo-m" => "p-neo-m",
                "p-aki" => "p-aki",
                "p-jelly" => "p-jelly",
                "p-mat" => "p-mat",
                other => panic!("unknown mock product id: {other}"),
            };
            m.insert(id_static, card);
        }
        m
    })
}

/// 全モックカード (6 件) を順に返す。テスト・ハンドラ両方から使う。
fn all_mock_cards() -> Vec<CardBlock> {
    vec![
        hercules_male_142_card(),
        caucasus_larva_card(),
        neptune_pair_card(),
        actaeon_wf1_card(),
        jelly_supply_card(),
        mat_supply_card(),
    ]
}

// ── 生体カード (sci 名 + 累代 + 羽化予測あり) ────────────────────────

/// 生体用の共通ビルダ。
/// docs/sdui-three-layer-model-v5.md §5.4 のレシピに沿って 5 region を全部埋める。
#[allow(clippy::too_many_arguments)]
fn build_specimen_card(
    id: &str,
    title: &str,
    sci: &str,
    badges: Vec<(BadgeRole, Localizable)>,
    shop: &str,
    pedigree: &str,
    price_jpy: i64,
    eclosion_date: NaiveDate,
    eclosion_in_days: i32,
    media_alt: &str,
) -> CardBlock {
    CardBlock::ProductFeature {
        id: id.to_string(),
        variant: Some(ProductFeatureVariant::Default),
        experiment: None,
        analytics_id: Some(format!("product.{id}")),
        regions: ProductFeatureRegions {
            header: badges
                .into_iter()
                .enumerate()
                .map(|(i, (role, label))| Block::Badge {
                    key: format!("header-b{}", i + 1),
                    role,
                    label,
                    analytics_id: None,
                })
                .collect(),
            media: vec![Block::Media {
                key: "media-img".to_string(),
                kind: MediaKind::Image,
                src: None, // Phase 1: 実画像なし → クライアントの placeholder にフォールバック
                alt: Some(raw(media_alt)),
                icon_name: None,
                analytics_id: None,
            }],
            meta: vec![Block::MetaLine {
                key: "meta-ml".to_string(),
                items: vec![
                    MetaItem {
                        key: "id".to_string(),
                        role: MetaLineItemRole::Id,
                        value: format!("#{id}"),
                        align: None,
                    },
                    MetaItem {
                        key: "shop".to_string(),
                        role: MetaLineItemRole::Shop,
                        value: shop.to_string(),
                        align: None,
                    },
                    MetaItem {
                        key: "code".to_string(),
                        role: MetaLineItemRole::Code,
                        value: pedigree.to_string(),
                        align: Some(MetaItemAlign::End),
                    },
                ],
                analytics_id: None,
            }],
            body: vec![
                Block::Text {
                    key: "body-hl".to_string(),
                    role: TextRole::Headline,
                    content: raw(title),
                    analytics_id: None,
                },
                Block::Text {
                    key: "body-sh".to_string(),
                    role: TextRole::Subhead,
                    content: raw(sci),
                    analytics_id: None,
                },
            ],
            footer: vec![
                Block::Price {
                    key: "footer-pr".to_string(),
                    amount: price_jpy,
                    currency: Currency::JPY,
                    tax_included: true,
                    analytics_id: None,
                },
                Block::EclosionForecast {
                    key: "footer-ef".to_string(),
                    days_ahead: eclosion_in_days,
                    date: eclosion_date,
                    tolerance: 5,
                    analytics_id: None,
                },
            ],
        },
    }
}

fn hercules_male_142_card() -> CardBlock {
    build_specimen_card(
        "p-hh-m-142",
        "ヘラクレスオオカブト ♂ 142mm",
        "Dynastes hercules hercules",
        vec![
            (BadgeRole::Promo, i18n("badge.featured")),
            (BadgeRole::Evidence, i18n("badge.pedigreed")),
        ],
        "ANCHOR BEETLE CO.",
        "CBF2",
        48_000,
        NaiveDate::from_ymd_opt(2026, 5, 4).expect("valid date"),
        15,
        "ヘラクレス 個体写真",
    )
}

fn caucasus_larva_card() -> CardBlock {
    build_specimen_card(
        "p-cat-l",
        "コーカサス幼虫 3齢 ♂ 52g",
        "Chalcosoma chiron",
        vec![(BadgeRole::Status, raw("CBF3"))],
        "ANCHOR BEETLE CO.",
        "CBF3",
        12_000,
        NaiveDate::from_ymd_opt(2026, 11, 20).expect("valid date"),
        215,
        "コーカサス幼虫写真",
    )
}

fn neptune_pair_card() -> CardBlock {
    build_specimen_card(
        "p-neo-m",
        "ネプチューン ♂ 初令ペア",
        "Dynastes neptunus",
        vec![(BadgeRole::Promo, raw("ペア割"))],
        "MIYAMA FARM",
        "CBF2",
        28_000,
        NaiveDate::from_ymd_opt(2026, 8, 30).expect("valid date"),
        133,
        "ネプチューン 個体写真",
    )
}

fn actaeon_wf1_card() -> CardBlock {
    build_specimen_card(
        "p-aki",
        "アクタエオン WILD F1 ♂",
        "Megasoma actaeon",
        vec![(BadgeRole::Status, raw("WF1"))],
        "MIYAMA FARM",
        "WF1",
        62_000,
        NaiveDate::from_ymd_opt(2027, 2, 15).expect("valid date"),
        668,
        "アクタエオン 個体写真",
    )
}

// ── 用品カード (sci なし / 累代なし / 羽化予測なし) ──────────────────

/// 用品 (=飼育グッズ) 用の共通ビルダ。
/// 生体に比べて region が痩せる:
///   - body は headline 1 行のみ (subhead = sci 名がない)
///   - meta は shop だけ
///   - footer は Price のみ (羽化予測なし)
fn build_supply_card(
    id: &str,
    title: &str,
    stock_label: &str, // 例: "在庫 320"
    shop: &str,
    price_jpy: i64,
    media_alt: &str,
) -> CardBlock {
    CardBlock::ProductFeature {
        id: id.to_string(),
        variant: Some(ProductFeatureVariant::Compact),
        experiment: None,
        analytics_id: Some(format!("product.{id}")),
        regions: ProductFeatureRegions {
            header: vec![Block::Badge {
                key: "header-stock".to_string(),
                role: BadgeRole::Status,
                label: raw(stock_label),
                analytics_id: None,
            }],
            media: vec![Block::Media {
                key: "media-img".to_string(),
                // 用品は実物写真を期待しないので Placeholder を使う (§4.4)
                kind: MediaKind::Placeholder,
                src: None,
                alt: Some(raw(media_alt)),
                icon_name: None,
                analytics_id: None,
            }],
            meta: vec![Block::MetaLine {
                key: "meta-ml".to_string(),
                items: vec![MetaItem {
                    key: "shop".to_string(),
                    role: MetaLineItemRole::Shop,
                    value: shop.to_string(),
                    align: None,
                }],
                analytics_id: None,
            }],
            body: vec![Block::Text {
                key: "body-hl".to_string(),
                role: TextRole::Headline,
                content: raw(title),
                analytics_id: None,
            }],
            footer: vec![Block::Price {
                key: "footer-pr".to_string(),
                amount: price_jpy,
                currency: Currency::JPY,
                tax_included: true,
                analytics_id: None,
            }],
        },
    }
}

fn jelly_supply_card() -> CardBlock {
    build_supply_card(
        "p-jelly",
        "高栄養ゼリー 17g × 50個",
        "在庫 320",
        "ANCHOR BEETLE CO.",
        1_480,
        "ゼリーパック",
    )
}

fn mat_supply_card() -> CardBlock {
    build_supply_card(
        "p-mat",
        "完熟発酵マット 10L",
        "在庫 88",
        "ANCHOR BEETLE CO.",
        1_280,
        "発酵マット",
    )
}

// ──────────────────────────────────────────────────────────────────────
// product_detail mock (Phase 2 / MVP + UX 強化)
//
// **MVP スコープ** (docs/sdui-three-layer-model-v5.md §5.5):
//   - gallery: Media 複数枚 (1 枚目を hero / 2〜4 枚目をサムネ表示)。動画は将来。
//   - hero   : 店舗 byline (MetaLine) + タイトル/学名 (Text x2) + chip 群 (Badge x2-4)
//   - spec   : 個体スペック (MetricList)。生体は 6 行、用品は 1-2 行。
//   - pricing: Price 1 件 (将来は配送料・送料無料 chip を Block で並べる)
//   - cta    : CTA primary (カートに追加) + CTA secondary (カートを見る)
//             + CTA tertiary (♡ ウォッチ) ← Phase 2 で追加
//   - promise: 安心保証 (Text x3 + CTA) ← Phase 2 で追加 (生体のみ / 用品は空配列)
//
// **延期項目** (Phase 2.5 以降):
//   - 動画 (gallery に Media kind=video を追加)
//   - ウォッチ状態の永続化 (現状は href 遷移のみ / 状態管理は未実装)
//   - カート追加 → Toast + Undo の連携 (cta.action contract を別 PR で導入)
// ──────────────────────────────────────────────────────────────────────

fn detail_mock_store() -> &'static HashMap<&'static str, CardBlock> {
    static STORE: OnceLock<HashMap<&'static str, CardBlock>> = OnceLock::new();
    STORE.get_or_init(|| {
        let mut m: HashMap<&'static str, CardBlock> = HashMap::new();
        for card in all_detail_mock_cards() {
            let id_static: &'static str = match card.id() {
                "p-hh-m-142" => "p-hh-m-142",
                "p-cat-l" => "p-cat-l",
                "p-neo-m" => "p-neo-m",
                "p-aki" => "p-aki",
                "p-jelly" => "p-jelly",
                "p-mat" => "p-mat",
                other => panic!("unknown detail mock product id: {other}"),
            };
            m.insert(id_static, card);
        }
        m
    })
}

fn all_detail_mock_cards() -> Vec<CardBlock> {
    vec![
        hercules_male_142_detail(),
        caucasus_larva_detail(),
        neptune_pair_detail(),
        actaeon_wf1_detail(),
        jelly_supply_detail(),
        mat_supply_detail(),
    ]
}

/// 生体詳細カードの共通ビルダ。`build_specimen_card` (一覧版) と対になる。
///
/// **Phase 2 (UX 強化)**:
///   - `gallery` は 4 枚 Media (1 枚目: hero / 2〜4 枚目: サムネ画像)
///   - `cta` に ♡ ウォッチ (intent=tertiary) を追加 (合計 3 件)
///   - `promise` 区画に「安心保証」(text x3 + cta) を追加 — 生体専用 UX
///
/// **生体専用 promise**:
///   死着補償 / 温度制御便 / 自動カルテ生成 は生体購入時のみ意味のある保証なので、
///   用品ビルダ (`build_supply_detail_card`) では promise を空配列にする。
///   client renderer は空配列の region を section ごと省略する。
#[allow(clippy::too_many_arguments)]
fn build_specimen_detail_card(
    id: &str,
    title: &str,
    sci: &str,
    shop: &str,
    badges: Vec<(BadgeRole, Localizable)>,
    spec_rows: Vec<(&str, &str, &str)>, // (key, label, value)
    price_jpy: i64,
    media_alt: &str,
) -> CardBlock {
    // gallery: 1 枚目 (hero) + サムネ 3 枚 (角度違い / 拡大 / 同梱物 などを想定)。
    // 実画像はまだ無いので src=None でクライアント側 placeholder にフォールバック。
    // alt は SR (スクリーンリーダ) 向けに用途を区別できる文言にしておく。
    let gallery_alts = [
        media_alt,             // 1 枚目: メインカット
        "別アングル",          // 2 枚目: 横 / 後ろ
        "サイズ比較",          // 3 枚目: 物差し / 手と並べたカット
        "同梱物",              // 4 枚目: パッケージ / 付属品
    ];

    CardBlock::ProductDetail {
        id: id.to_string(),
        variant: Some(ProductDetailVariant::Default),
        experiment: None,
        analytics_id: Some(format!("product_detail.{id}")),
        regions: ProductDetailRegions {
            gallery: gallery_alts
                .iter()
                .enumerate()
                .map(|(i, alt)| Block::Media {
                    key: format!("gallery-img-{}", i + 1),
                    kind: MediaKind::Image,
                    src: None,
                    alt: Some(raw(alt)),
                    icon_name: None,
                    analytics_id: None,
                })
                .collect(),
            hero: {
                let mut blocks: Vec<Block> = vec![
                    Block::MetaLine {
                        key: "hero-shop".to_string(),
                        items: vec![MetaItem {
                            key: "shop".to_string(),
                            role: MetaLineItemRole::Shop,
                            value: shop.to_string(),
                            align: None,
                        }],
                        analytics_id: None,
                    },
                    Block::Text {
                        key: "hero-hl".to_string(),
                        role: TextRole::Headline,
                        content: raw(title),
                        analytics_id: None,
                    },
                    Block::Text {
                        key: "hero-sh".to_string(),
                        role: TextRole::Subhead,
                        content: raw(sci),
                        analytics_id: None,
                    },
                ];
                for (i, (role, label)) in badges.into_iter().enumerate() {
                    blocks.push(Block::Badge {
                        key: format!("hero-b{}", i + 1),
                        role,
                        label,
                        analytics_id: None,
                    });
                }
                blocks
            },
            spec: vec![Block::MetricList {
                key: "spec-ml".to_string(),
                items: spec_rows
                    .into_iter()
                    .map(|(k, l, v)| MetricItem {
                        key: k.to_string(),
                        label: raw(l),
                        value: raw(v),
                    })
                    .collect(),
                analytics_id: None,
            }],
            pricing: vec![Block::Price {
                key: "pricing-pr".to_string(),
                amount: price_jpy,
                currency: Currency::JPY,
                tax_included: true,
                analytics_id: None,
            }],
            // 安心保証 — 生体購入時の不安解消用 mini card。
            // 既存 block primitive (text + cta) で表現できる範囲に留めて、
            // 新 block 型を増やさずに UI を作る (§4.4: block primitive を増やす前に
            // composition で表現できるか考える)。
            promise: vec![
                Block::Text {
                    key: "promise-eyebrow".to_string(),
                    role: TextRole::Eyebrow,
                    content: raw("安心保証"),
                    analytics_id: None,
                },
                Block::Text {
                    key: "promise-1".to_string(),
                    role: TextRole::Caption,
                    content: raw("✓ 死着補償(24h 自動返金)"),
                    analytics_id: None,
                },
                Block::Text {
                    key: "promise-2".to_string(),
                    role: TextRole::Caption,
                    content: raw("✓ 温度制御便"),
                    analytics_id: None,
                },
                Block::Text {
                    key: "promise-3".to_string(),
                    role: TextRole::Caption,
                    content: raw("✓ 購入後 自動カルテ生成"),
                    analytics_id: None,
                },
                Block::Cta {
                    key: "promise-cta".to_string(),
                    intent: CtaIntent::Tertiary,
                    label: raw("詳細を見る →"),
                    href: Href::parse("/help/warranty").expect("static href is valid"),
                    // ヘルプページへのナビゲーション。サーバ反映なし → action は None。
                    action: None,
                    analytics_id: Some(format!("cta.warranty_detail.{id}")),
                },
            ],
            cta: vec![
                Block::Cta {
                    key: "cta-add".to_string(),
                    intent: CtaIntent::Primary,
                    label: raw("カートに追加"),
                    // href は no-JS フォールバック (/cart?add=... へ遷移)。
                    // action があれば JS 側でこちらが先に発火し、preventDefault される。
                    href: Href::parse(&format!("/cart?add={id}"))
                        .expect("static href is valid"),
                    action: Some(CtaAction::AddToCart {
                        product_id: id.to_string(),
                        qty: 1,
                    }),
                    analytics_id: Some(format!("cta.add_to_cart.{id}")),
                },
                Block::Cta {
                    key: "cta-view-cart".to_string(),
                    intent: CtaIntent::Secondary,
                    label: raw("カートを見る →"),
                    href: Href::parse("/cart").expect("static href is valid"),
                    // ページ遷移のみ。サーバ反映 action は不要。
                    action: None,
                    analytics_id: Some("cta.view_cart".to_string()),
                },
                Block::Cta {
                    key: "cta-watch".to_string(),
                    intent: CtaIntent::Tertiary,
                    label: raw("♡ ウォッチ"),
                    // href は no-JS フォールバック (旧 /watch?add= 動線)。
                    href: Href::parse(&format!("/watch?add={id}"))
                        .expect("static href is valid"),
                    action: Some(CtaAction::ToggleWatch {
                        product_id: id.to_string(),
                    }),
                    analytics_id: Some(format!("cta.watch.{id}")),
                },
            ],
        },
    }
}

/// 用品詳細カードの共通ビルダ。生体に比べて hero/spec が痩せる。
///
/// **生体との差分 (Phase 2)**:
///   - `gallery`: 1 枚のみ (用品はサムネで角度を伝える必要が薄い)
///   - `promise`: 空配列 (死着補償は生体専用 / 用品の保証は別 PR で再設計)
///   - `cta`: ウォッチを含めて 3 件 (ウォッチは生体・用品どちらも有用)
fn build_supply_detail_card(
    id: &str,
    title: &str,
    shop: &str,
    spec_rows: Vec<(&str, &str, &str)>,
    price_jpy: i64,
    media_alt: &str,
) -> CardBlock {
    CardBlock::ProductDetail {
        id: id.to_string(),
        variant: Some(ProductDetailVariant::Default),
        experiment: None,
        analytics_id: Some(format!("product_detail.{id}")),
        regions: ProductDetailRegions {
            gallery: vec![Block::Media {
                key: "gallery-img-1".to_string(),
                kind: MediaKind::Placeholder,
                src: None,
                alt: Some(raw(media_alt)),
                icon_name: None,
                analytics_id: None,
            }],
            hero: vec![
                Block::MetaLine {
                    key: "hero-shop".to_string(),
                    items: vec![MetaItem {
                        key: "shop".to_string(),
                        role: MetaLineItemRole::Shop,
                        value: shop.to_string(),
                        align: None,
                    }],
                    analytics_id: None,
                },
                Block::Text {
                    key: "hero-hl".to_string(),
                    role: TextRole::Headline,
                    content: raw(title),
                    analytics_id: None,
                },
            ],
            spec: vec![Block::MetricList {
                key: "spec-ml".to_string(),
                items: spec_rows
                    .into_iter()
                    .map(|(k, l, v)| MetricItem {
                        key: k.to_string(),
                        label: raw(l),
                        value: raw(v),
                    })
                    .collect(),
                analytics_id: None,
            }],
            pricing: vec![Block::Price {
                key: "pricing-pr".to_string(),
                amount: price_jpy,
                currency: Currency::JPY,
                tax_included: true,
                analytics_id: None,
            }],
            // 用品では promise は空 (生体専用 UX)。
            // Default::default() で空 Vec を生成しても良いが、明示的に空配列を書いて
            // 「ここは意図的に空」を読み手に伝える。
            promise: vec![],
            cta: vec![
                Block::Cta {
                    key: "cta-add".to_string(),
                    intent: CtaIntent::Primary,
                    label: raw("カートに追加"),
                    href: Href::parse(&format!("/cart?add={id}"))
                        .expect("static href is valid"),
                    action: Some(CtaAction::AddToCart {
                        product_id: id.to_string(),
                        qty: 1,
                    }),
                    analytics_id: Some(format!("cta.add_to_cart.{id}")),
                },
                Block::Cta {
                    key: "cta-view-cart".to_string(),
                    intent: CtaIntent::Secondary,
                    label: raw("カートを見る →"),
                    href: Href::parse("/cart").expect("static href is valid"),
                    action: None,
                    analytics_id: Some("cta.view_cart".to_string()),
                },
                Block::Cta {
                    key: "cta-watch".to_string(),
                    intent: CtaIntent::Tertiary,
                    label: raw("♡ ウォッチ"),
                    href: Href::parse(&format!("/watch?add={id}"))
                        .expect("static href is valid"),
                    action: Some(CtaAction::ToggleWatch {
                        product_id: id.to_string(),
                    }),
                    analytics_id: Some(format!("cta.watch.{id}")),
                },
            ],
        },
    }
}

fn hercules_male_142_detail() -> CardBlock {
    build_specimen_detail_card(
        "p-hh-m-142",
        "ヘラクレスオオカブト ♂ 142mm",
        "Dynastes hercules hercules",
        "ANCHOR BEETLE CO.",
        vec![
            (BadgeRole::Status, raw("生体")),
            (BadgeRole::Promo, i18n("badge.featured")),
            (BadgeRole::Evidence, i18n("badge.pedigreed")),
            (BadgeRole::Warning, raw("要温度制御便")),
        ],
        vec![
            ("size", "サイズ", "142mm (頭角含)"),
            ("sex", "性別", "♂ オス"),
            ("eclosion", "羽化日", "2025-11-18"),
            ("pedigree", "累代", "CBF2 · 父 #DHH-0198 / 母 #DHH-0204"),
            ("origin", "産地", "グアドループ産 (人工繁殖)"),
            ("breeder", "ブリーダー", "ANCHOR BEETLE CO. (認証済)"),
        ],
        48_000,
        "ヘラクレス 個体写真",
    )
}

fn caucasus_larva_detail() -> CardBlock {
    build_specimen_detail_card(
        "p-cat-l",
        "コーカサス幼虫 3齢 ♂ 52g",
        "Chalcosoma chiron",
        "ANCHOR BEETLE CO.",
        vec![
            (BadgeRole::Status, raw("生体")),
            (BadgeRole::Status, raw("CBF3")),
            (BadgeRole::Warning, raw("要温度制御便")),
        ],
        vec![
            ("weight", "体重", "52g"),
            ("instar", "齢", "3齢"),
            ("sex", "性別", "♂ オス (推定)"),
            ("pedigree", "累代", "CBF3"),
            ("breeder", "ブリーダー", "ANCHOR BEETLE CO."),
        ],
        12_000,
        "コーカサス幼虫写真",
    )
}

fn neptune_pair_detail() -> CardBlock {
    build_specimen_detail_card(
        "p-neo-m",
        "ネプチューン ♂ 初令ペア",
        "Dynastes neptunus",
        "MIYAMA FARM",
        vec![
            (BadgeRole::Status, raw("生体")),
            (BadgeRole::Promo, raw("ペア割")),
            (BadgeRole::Warning, raw("要温度制御便")),
        ],
        vec![
            ("instar", "齢", "初令"),
            ("count", "数量", "♂♀ ペア (各 1)"),
            ("pedigree", "累代", "CBF2"),
            ("origin", "産地", "コロンビア産 (人工繁殖)"),
            ("breeder", "ブリーダー", "MIYAMA FARM"),
        ],
        28_000,
        "ネプチューン 個体写真",
    )
}

fn actaeon_wf1_detail() -> CardBlock {
    build_specimen_detail_card(
        "p-aki",
        "アクタエオン WILD F1 ♂",
        "Megasoma actaeon",
        "MIYAMA FARM",
        vec![
            (BadgeRole::Status, raw("生体")),
            (BadgeRole::Status, raw("WF1")),
            (BadgeRole::Warning, raw("要温度制御便")),
        ],
        vec![
            ("sex", "性別", "♂ オス"),
            ("pedigree", "累代", "WF1 (野生親)"),
            ("origin", "産地", "ペルー産"),
            ("breeder", "ブリーダー", "MIYAMA FARM"),
        ],
        62_000,
        "アクタエオン 個体写真",
    )
}

fn jelly_supply_detail() -> CardBlock {
    build_supply_detail_card(
        "p-jelly",
        "高栄養ゼリー 17g × 50個",
        "ANCHOR BEETLE CO.",
        vec![
            ("size", "内容量", "17g × 50 個"),
            ("type", "種類", "高タンパク・高糖度"),
            ("expiry", "賞味期限", "製造から 12 ヶ月"),
            ("stock", "在庫", "320 個"),
        ],
        1_480,
        "ゼリーパック",
    )
}

fn mat_supply_detail() -> CardBlock {
    build_supply_detail_card(
        "p-mat",
        "完熟発酵マット 10L",
        "ANCHOR BEETLE CO.",
        vec![
            ("volume", "容量", "10 L"),
            ("type", "種類", "クヌギ完熟発酵 (添加発酵)"),
            ("usage", "用途", "産卵 / 幼虫飼育"),
            ("stock", "在庫", "88 袋"),
        ],
        1_280,
        "発酵マット",
    )
}

// ── Localizable 構築ヘルパ ─────────────────────────────────────────

fn i18n(key: &str) -> Localizable {
    Localizable::I18n {
        key: crate::sdui::I18nKey::new(key),
        params: None,
    }
}

fn raw(text: &str) -> Localizable {
    Localizable::Raw {
        text: text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdui::ValidateKeys;

    /// 全 6 カードを順に取り出す helper (テストごとに使う)。
    fn all_cards() -> Vec<CardBlock> {
        all_mock_cards()
    }

    #[test]
    fn mock_store_has_all_6_products() {
        let store = mock_store();
        assert_eq!(store.len(), 6, "expected 6 mock products");
        for id in [
            "p-hh-m-142",
            "p-cat-l",
            "p-neo-m",
            "p-aki",
            "p-jelly",
            "p-mat",
        ] {
            assert!(store.contains_key(id), "missing mock id: {id}");
        }
    }

    #[test]
    fn all_mock_cards_pass_key_validation() {
        for card in all_cards() {
            card.validate_keys()
                .unwrap_or_else(|e| panic!("validate_keys failed for {}: {e}", card.id()));
        }
    }

    #[test]
    fn all_mock_cards_round_trip_via_json() {
        for card in all_cards() {
            let json = serde_json::to_string(&card).expect("serialize");
            let parsed: CardBlock =
                serde_json::from_str(&json).expect("round-trip deserialize");
            assert_eq!(parsed.id(), card.id(), "id changed on round-trip");
        }
    }

    #[test]
    fn hercules_card_serializes_to_camel_case_json() {
        let card = hercules_male_142_card();
        let json = serde_json::to_string(&card).expect("serialize");
        // template / variant / analyticsId / regions が camelCase で出ること
        assert!(json.contains(r#""template":"product_feature""#));
        assert!(json.contains(r#""analyticsId":"product.p-hh-m-142""#));
        assert!(json.contains(r#""variant":"default""#));
        assert!(json.contains(r#""taxIncluded":true"#));
        assert!(json.contains(r#""daysAhead":15"#));
    }

    #[test]
    fn round_trip_preserves_analytics_id_fallback() {
        let card = hercules_male_142_card();
        let json = serde_json::to_string(&card).unwrap();
        let parsed: CardBlock = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id(), "p-hh-m-142");
        assert_eq!(parsed.effective_analytics_id(), "product.p-hh-m-142");
    }

    #[test]
    fn unknown_region_field_is_rejected() {
        // headline は product_feature に存在しないリージョン → deny_unknown_fields で 400
        let bad_json = r#"{
            "template": "product_feature",
            "id": "X",
            "regions": {
                "headline": []
            }
        }"#;
        let result: Result<CardBlock, _> = serde_json::from_str(bad_json);
        assert!(result.is_err(), "unknown region 'headline' should be rejected");
    }

    // ── ハンドラ直叩きのテスト (HTTP は通さず、関数の返り値を直接検証) ────

    /// 旧 `list_handler_returns_all_6_sorted_by_id` を Phase 4 の
    /// `ProductListResponse` 形に追従させたもの。フィルタ無しなら全 6 件。
    #[tokio::test]
    async fn list_handler_returns_all_6_sorted_by_id() {
        let json = list_product_cards(Query(ListQuery::default()))
            .await
            .expect("list ok");
        let resp = json.0;
        assert_eq!(resp.cards.len(), 6, "list should return 6 cards (no filter)");

        // 表示順は id の辞書順
        let ids: Vec<&str> = resp.cards.iter().map(|c| c.id()).collect();
        let expected = vec![
            "p-aki",
            "p-cat-l",
            "p-hh-m-142",
            "p-jelly",
            "p-mat",
            "p-neo-m",
        ];
        assert_eq!(ids, expected, "ids must be returned in lexical id order");

        // filter_bar は常に Some
        let bar = resp.filter_bar.expect("filter_bar should be Some");
        assert_eq!(bar.groups.len(), 2, "expected 2 filter groups (category + difficulty)");
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 4 — Filter / Search
    // ────────────────────────────────────────────────────────────────

    /// 何も指定しない → 全 6 件 + 全 chip selected=false。
    #[tokio::test]
    async fn list_no_query_returns_all_with_no_chip_selected() {
        let resp = list_product_cards(Query(ListQuery::default()))
            .await
            .expect("ok")
            .0;
        assert_eq!(resp.cards.len(), 6);
        let bar = resp.filter_bar.expect("filter_bar");
        for group in &bar.groups {
            for chip in &group.chips {
                assert!(
                    !chip.selected,
                    "expected no chip selected with empty query, but {}.{} was selected",
                    group.key, chip.key
                );
            }
        }
    }

    /// `?category=live` → 4 件 + "live" chip だけ selected=true + その chip の href は解除済み URL。
    #[tokio::test]
    async fn list_filter_by_live_category() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("live".to_string()),
            difficulty: None,
            sort: None,
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(resp.cards.len(), 4, "live は 4 件想定");
        let ids: Vec<&str> = resp.cards.iter().map(|c| c.id()).collect();
        assert_eq!(ids, vec!["p-aki", "p-cat-l", "p-hh-m-142", "p-neo-m"]);

        let bar = resp.filter_bar.expect("filter_bar");
        let cat = bar
            .groups
            .iter()
            .find(|g| g.key == "category")
            .expect("category group");
        let live = cat.chips.iter().find(|c| c.key == "live").expect("live chip");
        assert!(live.selected, "live chip must be selected");
        // selected な chip の href は「自分を解除した状態」= `/products`
        assert_eq!(live.href.as_str(), "/products");

        let supply = cat.chips.iter().find(|c| c.key == "supply").expect("supply chip");
        assert!(!supply.selected);
        // not selected な chip の href は「自分に切り替えた状態」= `/products?category=supply`
        assert_eq!(supply.href.as_str(), "/products?category=supply");
    }

    /// 2 軸併用: `?category=live&difficulty=hard` → 3 件 (hercules / neptune / actaeon)。
    #[tokio::test]
    async fn list_filter_two_axes() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("live".to_string()),
            difficulty: Some("hard".to_string()),
            sort: None,
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(resp.cards.len(), 3);
        let ids: Vec<&str> = resp.cards.iter().map(|c| c.id()).collect();
        assert_eq!(ids, vec!["p-aki", "p-hh-m-142", "p-neo-m"]);

        let bar = resp.filter_bar.expect("filter_bar");
        // selected な chip (live) の href は「自分だけ抜く」= `?difficulty=hard` のみ残す
        let live = bar.groups[0].chips.iter().find(|c| c.key == "live").unwrap();
        assert_eq!(live.href.as_str(), "/products?difficulty=hard");
        // selected な chip (hard) の href は「自分だけ抜く」= `?category=live` のみ残す
        let hard = bar.groups[1].chips.iter().find(|c| c.key == "hard").unwrap();
        assert_eq!(hard.href.as_str(), "/products?category=live");
        // not selected (medium) は「上書き適用」= 両方付きの URL に切り替わる
        let medium = bar.groups[1].chips.iter().find(|c| c.key == "medium").unwrap();
        assert_eq!(medium.href.as_str(), "/products?category=live&difficulty=medium");
    }

    /// 「組み合わせると 0 件」: `?category=live&difficulty=easy` → 該当なし。
    /// それでも filter_bar は返すので、ユーザがチップを押して脱出できる。
    #[tokio::test]
    async fn list_zero_match_still_returns_filter_bar() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("live".to_string()),
            difficulty: Some("easy".to_string()),
            sort: None,
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(resp.cards.len(), 0);
        let bar = resp.filter_bar.expect("filter_bar must still be present on 0-match");
        // chip 群はそのまま返る
        assert_eq!(bar.groups.iter().map(|g| g.chips.len()).sum::<usize>(), 5);
    }

    /// 未知の値 (`?category=galaxy_invader`) → 0 件 + 該当 group 内の chip は誰も selected にならない。
    #[tokio::test]
    async fn list_unknown_filter_value_yields_zero_match() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("galaxy_invader".to_string()),
            difficulty: None,
            sort: None,
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(resp.cards.len(), 0);
        let bar = resp.filter_bar.expect("filter_bar");
        let cat = bar.groups.iter().find(|g| g.key == "category").unwrap();
        for chip in &cat.chips {
            assert!(
                !chip.selected,
                "no known chip should be selected for unknown query value, got: {}",
                chip.key
            );
        }
    }

    /// 全商品にメタが登録されている (=「未分類」が出ない) ことを保証。
    /// 商品を追加した時にこのテストが落ちて、メタ追加忘れに気付く。
    #[test]
    fn all_mock_products_have_filter_meta() {
        let store = mock_store();
        let meta = product_filter_meta();
        for id in store.keys() {
            assert!(
                meta.contains_key(id),
                "product {id} is missing filter meta — add it to product_filter_meta()"
            );
        }
        // 逆方向: メタにあるのに store に無い id がないか
        for id in meta.keys() {
            assert!(
                store.contains_key(id),
                "filter meta has unknown id: {id}"
            );
        }
    }

    /// chip の analytics_id が `filter.<group>.<value>` 形式であること (規約)。
    #[tokio::test]
    async fn filter_chip_analytics_id_follows_convention() {
        let resp = list_product_cards(Query(ListQuery::default()))
            .await
            .expect("ok")
            .0;
        let bar = resp.filter_bar.expect("filter_bar");
        for group in &bar.groups {
            for chip in &group.chips {
                let id = chip.analytics_id.as_deref().expect("analytics_id required");
                assert_eq!(
                    id,
                    &format!("filter.{}.{}", group.key, chip.key),
                    "analytics_id convention violated for {}.{}",
                    group.key,
                    chip.key
                );
            }
        }
    }

    #[tokio::test]
    async fn get_handler_works_for_every_mock_id() {
        for id in [
            "p-hh-m-142",
            "p-cat-l",
            "p-neo-m",
            "p-aki",
            "p-jelly",
            "p-mat",
        ] {
            let result = get_product_card(axum::extract::Path(id.to_string())).await;
            let json = result.unwrap_or_else(|e| panic!("get failed for {id}: {e:?}"));
            assert_eq!(json.0.id(), id, "id mismatch for {id}");
        }
    }

    #[tokio::test]
    async fn get_handler_returns_not_found_for_unknown_id() {
        let result = get_product_card(axum::extract::Path("does-not-exist".to_string())).await;
        // AppError::NotFound のはず。Display 確認だと脆いので variant 比較で。
        match result {
            Err(crate::error::AppError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 5 — Faceted count + Sort
    // ────────────────────────────────────────────────────────────────

    /// Phase 5: 全商品にメタ (price_yen / created_days_ago) が登録されていること。
    /// Phase 4 で追加した `all_mock_products_have_filter_meta` の Phase 5 版。
    #[test]
    fn all_mock_products_have_price_and_created_meta() {
        let meta = product_filter_meta();
        // Phase 5 で追加したフィールドが「default 0 で埋まってない」ことを軽く確認。
        // 0 円 / 0 日前は意図しない値なので、これが見つかったらメタ追加忘れの兆候。
        for (id, m) in meta.iter() {
            assert!(m.price_yen > 0, "price_yen must be > 0 for {id}, got 0");
            // created_days_ago は 0 が「今日登録」と意味があるので 0 を許容。
            // ただし全件 0 だと意味ないので合計で 0 にならないことだけ最後に確認。
            let _ = m.created_days_ago;
        }
        let total_days: u32 = meta.values().map(|m| m.created_days_ago).sum();
        assert!(total_days > 0, "expected at least one product with created_days_ago > 0");
    }

    // ── faceted count ─────────────────────────────────────────────

    /// クエリ無し: 各 chip の count = 「自分に切り替えた時の件数」。
    /// live=4, supply=2, easy=2, medium=1, hard=3 になる (現状メタ通り)。
    #[tokio::test]
    async fn faceted_count_with_no_query() {
        let resp = list_product_cards(Query(ListQuery::default()))
            .await
            .expect("ok")
            .0;
        let bar = resp.filter_bar.expect("filter_bar");

        let cat = bar.groups.iter().find(|g| g.key == "category").unwrap();
        let live_count = cat.chips.iter().find(|c| c.key == "live").unwrap().count;
        let supply_count = cat.chips.iter().find(|c| c.key == "supply").unwrap().count;
        assert_eq!(live_count, Some(4), "category=live should yield 4 (no other filter)");
        assert_eq!(supply_count, Some(2), "category=supply should yield 2");

        let diff = bar.groups.iter().find(|g| g.key == "difficulty").unwrap();
        let easy = diff.chips.iter().find(|c| c.key == "easy").unwrap().count;
        let medium = diff.chips.iter().find(|c| c.key == "medium").unwrap().count;
        let hard = diff.chips.iter().find(|c| c.key == "hard").unwrap().count;
        assert_eq!(easy, Some(2), "easy should yield 2 (jelly + mat)");
        assert_eq!(medium, Some(1), "medium should yield 1 (cat-l)");
        assert_eq!(hard, Some(3), "hard should yield 3 (hh, neo, aki)");
    }

    /// `?category=live` のとき: difficulty 軸の各 chip count は「live AND <chip>」の件数。
    /// → easy=0 (live で easy は 0), medium=1, hard=3。
    #[tokio::test]
    async fn faceted_count_respects_other_axis_when_chip_swaps_in_axis() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("live".to_string()),
            difficulty: None,
            sort: None,
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let bar = resp.filter_bar.expect("filter_bar");

        let diff = bar.groups.iter().find(|g| g.key == "difficulty").unwrap();
        // 他軸 (category=live) は維持 → 「live & easy」=0
        let easy = diff.chips.iter().find(|c| c.key == "easy").unwrap().count;
        let medium = diff.chips.iter().find(|c| c.key == "medium").unwrap().count;
        let hard = diff.chips.iter().find(|c| c.key == "hard").unwrap().count;
        assert_eq!(easy, Some(0), "live & easy should be 0");
        assert_eq!(medium, Some(1), "live & medium = cat-l = 1");
        assert_eq!(hard, Some(3), "live & hard = 3");
    }

    /// selected な chip の count = 「自分を解除した時の件数」(= toggle 後 URL の件数)。
    /// `?category=live` のとき "live" chip の count は「category 解除 → 全 6 件」。
    #[tokio::test]
    async fn faceted_count_for_selected_chip_means_count_after_toggle_off() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("live".to_string()),
            difficulty: None,
            sort: None,
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let bar = resp.filter_bar.expect("filter_bar");
        let cat = bar.groups.iter().find(|g| g.key == "category").unwrap();
        let live = cat.chips.iter().find(|c| c.key == "live").unwrap();
        assert!(live.selected);
        // selected な chip を押すと「自分を抜いた」状態 = 全 6 件
        assert_eq!(live.count, Some(6), "selected chip count = after-toggle-off count");
    }

    /// 0 件マッチでもチップは消えず count が出る (Some(0) を許容)。
    #[tokio::test]
    async fn faceted_count_emits_zero_for_no_match_chips() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("supply".to_string()),
            difficulty: None,
            sort: None,
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let bar = resp.filter_bar.expect("filter_bar");
        let diff = bar.groups.iter().find(|g| g.key == "difficulty").unwrap();
        // supply で hard / medium はゼロ
        let hard = diff.chips.iter().find(|c| c.key == "hard").unwrap();
        assert_eq!(hard.count, Some(0));
        let medium = diff.chips.iter().find(|c| c.key == "medium").unwrap();
        assert_eq!(medium.count, Some(0));
    }

    // ── sort_bar ──────────────────────────────────────────────────

    /// クエリ無し → sort_bar は default ("name") が selected で他は href 付き。
    #[tokio::test]
    async fn sort_bar_default_is_name_with_no_query() {
        let resp = list_product_cards(Query(ListQuery::default()))
            .await
            .expect("ok")
            .0;
        let sb = resp.sort_bar.expect("sort_bar should be Some");
        assert_eq!(sb.current, "name");
        assert_eq!(sb.options.len(), 4);
        // selected フラグも一致
        let name_opt = sb.options.iter().find(|o| o.key == "name").unwrap();
        assert!(name_opt.selected);
        // 他は selected=false
        for o in &sb.options {
            if o.key != "name" {
                assert!(!o.selected, "{} must not be selected", o.key);
            }
        }
        // analytics_id 規約
        for o in &sb.options {
            let expected = format!("sort.{}", o.key);
            assert_eq!(
                o.analytics_id.as_deref(),
                Some(expected.as_str()),
                "analytics_id convention violated for sort option {}",
                o.key,
            );
        }
    }

    /// `?sort=price_asc` → 価格の安い順 (mat → jelly → cat-l → neo → hh → aki)。
    #[tokio::test]
    async fn sort_price_asc_orders_cards() {
        let resp = list_product_cards(Query(ListQuery {
            category: None,
            difficulty: None,
            sort: Some("price_asc".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let ids: Vec<&str> = resp.cards.iter().map(|c| c.id()).collect();
        // 価格: mat=1280, jelly=1480, cat-l=12000, neo=28000, hh=48000, aki=62000
        assert_eq!(
            ids,
            vec!["p-mat", "p-jelly", "p-cat-l", "p-neo-m", "p-hh-m-142", "p-aki"]
        );
        let sb = resp.sort_bar.expect("sort_bar");
        assert_eq!(sb.current, "price_asc");
        assert!(sb.options.iter().find(|o| o.key == "price_asc").unwrap().selected);
    }

    /// `?sort=price_desc` → 価格の高い順。
    #[tokio::test]
    async fn sort_price_desc_orders_cards() {
        let resp = list_product_cards(Query(ListQuery {
            category: None,
            difficulty: None,
            sort: Some("price_desc".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let ids: Vec<&str> = resp.cards.iter().map(|c| c.id()).collect();
        assert_eq!(
            ids,
            vec!["p-aki", "p-hh-m-142", "p-neo-m", "p-cat-l", "p-jelly", "p-mat"]
        );
    }

    /// `?sort=new` → 新着順 (created_days_ago 昇順)。
    /// メタ: aki=2, hh=7, neo=14, cat-l=30, mat=45, jelly=60。
    #[tokio::test]
    async fn sort_new_orders_by_created_days_ago_ascending() {
        let resp = list_product_cards(Query(ListQuery {
            category: None,
            difficulty: None,
            sort: Some("new".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let ids: Vec<&str> = resp.cards.iter().map(|c| c.id()).collect();
        assert_eq!(
            ids,
            vec!["p-aki", "p-hh-m-142", "p-neo-m", "p-cat-l", "p-mat", "p-jelly"]
        );
    }

    /// `?sort=name` (= default) → id 辞書順 (Phase 4 と同じ)。
    #[tokio::test]
    async fn sort_name_orders_by_id_lexical() {
        let resp = list_product_cards(Query(ListQuery {
            category: None,
            difficulty: None,
            sort: Some("name".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let ids: Vec<&str> = resp.cards.iter().map(|c| c.id()).collect();
        assert_eq!(
            ids,
            vec!["p-aki", "p-cat-l", "p-hh-m-142", "p-jelly", "p-mat", "p-neo-m"]
        );
    }

    /// `?sort=foo` (未知値) → default に fallback。エラーにしない。
    #[tokio::test]
    async fn sort_unknown_falls_back_to_default() {
        let resp = list_product_cards(Query(ListQuery {
            category: None,
            difficulty: None,
            sort: Some("nonsense".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let sb = resp.sort_bar.expect("sort_bar");
        assert_eq!(sb.current, "name", "unknown sort key falls back to name");
        // cards も default 順
        let ids: Vec<&str> = resp.cards.iter().map(|c| c.id()).collect();
        assert_eq!(
            ids,
            vec!["p-aki", "p-cat-l", "p-hh-m-142", "p-jelly", "p-mat", "p-neo-m"]
        );
    }

    /// sort_bar の各 option の href:
    ///   - default (name) を選ぶ option は `?sort=` を出さない (canonical URL)
    ///   - 非 default はその key を `?sort=...` で乗せる
    ///   - 現在の filter は維持 (`?category=live` で sort クリック → filter は残る)
    #[tokio::test]
    async fn sort_option_href_preserves_filter_and_omits_default_sort() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("live".to_string()),
            difficulty: None,
            sort: Some("price_asc".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let sb = resp.sort_bar.expect("sort_bar");
        let name_opt = sb.options.iter().find(|o| o.key == "name").unwrap();
        // default を選んだ後の URL は `?sort=name` を含まない
        assert_eq!(
            name_opt.href.as_str(),
            "/products?category=live",
            "default sort omits ?sort= from URL"
        );
        let price_desc = sb.options.iter().find(|o| o.key == "price_desc").unwrap();
        assert_eq!(
            price_desc.href.as_str(),
            "/products?category=live&sort=price_desc",
            "non-default sort puts ?sort= after filter params"
        );
    }

    /// filter chip の href も sort を維持する (= filter 切替で並び順は変わらない)。
    #[tokio::test]
    async fn filter_chip_href_preserves_current_sort() {
        let resp = list_product_cards(Query(ListQuery {
            category: None,
            difficulty: None,
            sort: Some("price_asc".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let bar = resp.filter_bar.expect("filter_bar");
        let cat = bar.groups.iter().find(|g| g.key == "category").unwrap();
        let live = cat.chips.iter().find(|c| c.key == "live").unwrap();
        // not selected な chip → 「自分に切り替え + 既存 sort 維持」
        assert_eq!(live.href.as_str(), "/products?category=live&sort=price_asc");
    }

    /// sort 適用後も faceted count は filter ベースで計算される (= sort は count に影響しない)。
    /// `?sort=price_asc` でも live=4, supply=2 のまま。
    #[tokio::test]
    async fn sort_does_not_affect_faceted_count() {
        let resp = list_product_cards(Query(ListQuery {
            category: None,
            difficulty: None,
            sort: Some("price_asc".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let bar = resp.filter_bar.expect("filter_bar");
        let cat = bar.groups.iter().find(|g| g.key == "category").unwrap();
        let live = cat.chips.iter().find(|c| c.key == "live").unwrap();
        let supply = cat.chips.iter().find(|c| c.key == "supply").unwrap();
        assert_eq!(live.count, Some(4));
        assert_eq!(supply.count, Some(2));
    }

    /// resolve_sort_key の単体テスト (helper 直叩き)。
    #[test]
    fn resolve_sort_key_normalizes_input() {
        assert_eq!(resolve_sort_key(None), "name");
        assert_eq!(resolve_sort_key(Some("name")), "name");
        assert_eq!(resolve_sort_key(Some("price_asc")), "price_asc");
        assert_eq!(resolve_sort_key(Some("price_desc")), "price_desc");
        assert_eq!(resolve_sort_key(Some("new")), "new");
        assert_eq!(resolve_sort_key(Some("foo")), "name", "unknown key → default");
        assert_eq!(resolve_sort_key(Some("")), "name", "empty key → default");
    }

    /// build_list_href は (q, category, difficulty, sort, page, perPage) の固定順で組み立てる。
    /// このテストは Phase 4/5 との後方互換も担保する (新規パラメータ None なら従来 URL と一致)。
    #[test]
    fn build_list_href_orders_params_canonically() {
        // 全部 None
        assert_eq!(
            build_list_href(&ListQuery::default()),
            "/products"
        );
        // sort のみ (Phase 5 互換)
        assert_eq!(
            build_list_href(&ListQuery {
                sort: Some("new".to_string()),
                ..Default::default()
            }),
            "/products?sort=new"
        );
        // 全部 (Phase 4/5 まで)
        assert_eq!(
            build_list_href(&ListQuery {
                category: Some("live".to_string()),
                difficulty: Some("hard".to_string()),
                sort: Some("price_asc".to_string()),
                ..Default::default()
            }),
            "/products?category=live&difficulty=hard&sort=price_asc"
        );
        // Phase 4 互換 (sort 無し)
        assert_eq!(
            build_list_href(&ListQuery {
                category: Some("live".to_string()),
                ..Default::default()
            }),
            "/products?category=live"
        );
        // ── Phase 6 拡張 ──────────────────────────────────────────
        // q のみ (先頭)
        assert_eq!(
            build_list_href(&ListQuery {
                q: Some("foo".to_string()),
                ..Default::default()
            }),
            "/products?q=foo"
        );
        // page のみ
        assert_eq!(
            build_list_href(&ListQuery {
                page: Some(3),
                ..Default::default()
            }),
            "/products?page=3"
        );
        // perPage のみ
        assert_eq!(
            build_list_href(&ListQuery {
                per_page: Some(10),
                ..Default::default()
            }),
            "/products?perPage=10"
        );
        // 全部入り (canonical 順: q → category → difficulty → sort → page → perPage)
        assert_eq!(
            build_list_href(&ListQuery {
                q: Some("ヘラ".to_string()),
                category: Some("live".to_string()),
                difficulty: Some("hard".to_string()),
                sort: Some("price_asc".to_string()),
                page: Some(2),
                per_page: Some(5),
            }),
            // ヘラ は %E3%83%98%E3%83%A9 (UTF-8 / RFC 3986)
            "/products?q=%E3%83%98%E3%83%A9&category=live&difficulty=hard&sort=price_asc&page=2&perPage=5"
        );
    }

    // ────────────────────────────────────────────────────────────────
    // product_detail テンプレートのテスト
    // ────────────────────────────────────────────────────────────────

    fn all_detail_cards() -> Vec<CardBlock> {
        all_detail_mock_cards()
    }

    #[test]
    fn detail_mock_store_has_all_6_products() {
        let store = detail_mock_store();
        assert_eq!(store.len(), 6, "expected 6 mock detail cards");
        for id in [
            "p-hh-m-142",
            "p-cat-l",
            "p-neo-m",
            "p-aki",
            "p-jelly",
            "p-mat",
        ] {
            assert!(store.contains_key(id), "missing detail mock id: {id}");
        }
    }

    #[test]
    fn all_detail_cards_pass_key_validation() {
        for card in all_detail_cards() {
            card.validate_keys()
                .unwrap_or_else(|e| panic!("validate_keys failed for detail {}: {e}", card.id()));
        }
    }

    #[test]
    fn all_detail_cards_round_trip_via_json() {
        for card in all_detail_cards() {
            let json = serde_json::to_string(&card).expect("serialize detail");
            let parsed: CardBlock =
                serde_json::from_str(&json).expect("round-trip detail deserialize");
            assert_eq!(parsed.id(), card.id(), "id changed on round-trip");
        }
    }

    #[test]
    fn hercules_detail_serializes_with_product_detail_template() {
        let card = hercules_male_142_detail();
        let json = serde_json::to_string(&card).expect("serialize");
        // template が product_detail で、hero/spec/pricing/cta が camelCase で出ること
        assert!(
            json.contains(r#""template":"product_detail""#),
            "expected product_detail template, got: {json}"
        );
        assert!(json.contains(r#""analyticsId":"product_detail.p-hh-m-142""#));
        assert!(json.contains(r#""variant":"default""#));
        // gallery / hero / spec / pricing / cta いずれも空配列以上で含まれる
        for region in ["gallery", "hero", "spec", "pricing", "cta"] {
            assert!(json.contains(&format!(r#""{region}":["#)), "missing region: {region}");
        }
        // CTA href / intent
        assert!(json.contains(r#""intent":"primary""#));
        assert!(json.contains(r#""href":"/cart?add=p-hh-m-142""#));
    }

    #[test]
    fn product_detail_unknown_region_field_is_rejected() {
        // gallery 以外のフィールドを足しても deny_unknown_fields で 400
        let bad_json = r#"{
            "template": "product_detail",
            "id": "X",
            "regions": {
                "footer": []
            }
        }"#;
        let result: Result<CardBlock, _> = serde_json::from_str(bad_json);
        assert!(
            result.is_err(),
            "unknown region 'footer' on product_detail should be rejected"
        );
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 2 (UX 強化) — gallery 複数枚 / watch CTA / promise 区画
    // ────────────────────────────────────────────────────────────────

    /// detail カードの regions を取り出す helper。
    /// `if let CardBlock::ProductDetail { regions, .. }` を毎回書くと冗長なので集約。
    fn detail_regions(card: &CardBlock) -> &ProductDetailRegions {
        match card {
            CardBlock::ProductDetail { regions, .. } => regions,
            _ => panic!("expected ProductDetail variant, got: {}", card.id()),
        }
    }

    #[test]
    fn specimen_detail_has_4_gallery_images() {
        // 生体は gallery を 4 枚 (hero 1 + サムネ 3) に拡張
        for card in [
            hercules_male_142_detail(),
            caucasus_larva_detail(),
            neptune_pair_detail(),
            actaeon_wf1_detail(),
        ] {
            let r = detail_regions(&card);
            assert_eq!(
                r.gallery.len(),
                4,
                "specimen {} expected 4 gallery images, got {}",
                card.id(),
                r.gallery.len()
            );
            // 1 枚目以外も Media kind=image であること
            for (i, b) in r.gallery.iter().enumerate() {
                match b {
                    Block::Media { kind: MediaKind::Image, .. } => {}
                    other => panic!(
                        "specimen {} gallery[{i}] expected Media(Image), got {other:?}",
                        card.id()
                    ),
                }
            }
        }
    }

    #[test]
    fn supply_detail_has_only_1_gallery_image() {
        // 用品はサムネが要らないので 1 枚のみ
        for card in [jelly_supply_detail(), mat_supply_detail()] {
            let r = detail_regions(&card);
            assert_eq!(
                r.gallery.len(),
                1,
                "supply {} expected 1 gallery image, got {}",
                card.id(),
                r.gallery.len()
            );
        }
    }

    #[test]
    fn all_detail_cards_have_watch_cta() {
        // 生体 / 用品 ともに 3 つ目の CTA に ♡ ウォッチが含まれること
        for card in all_detail_mock_cards() {
            let r = detail_regions(&card);
            assert_eq!(
                r.cta.len(),
                3,
                "{} expected 3 CTAs (add / view-cart / watch), got {}",
                card.id(),
                r.cta.len()
            );
            // 最後のが Tertiary + ♡ ウォッチ
            match r.cta.last().expect("cta non-empty") {
                Block::Cta {
                    intent: CtaIntent::Tertiary,
                    label: Localizable::Raw { text },
                    href,
                    ..
                } => {
                    assert!(
                        text.contains("ウォッチ"),
                        "{} watch CTA label missing 'ウォッチ': {text}",
                        card.id()
                    );
                    // Href が /watch?add= で始まること (transparent string なので Display で確認)
                    let href_str = href.as_str();
                    assert!(
                        href_str.starts_with("/watch?add="),
                        "{} watch CTA href unexpected: {href_str}",
                        card.id()
                    );
                }
                other => panic!("{} watch CTA not tertiary: {other:?}", card.id()),
            }
        }
    }

    #[test]
    fn specimen_detail_has_promise_region() {
        // 生体は promise に text x4 + cta x1 = 5 ブロック
        for card in [
            hercules_male_142_detail(),
            caucasus_larva_detail(),
            neptune_pair_detail(),
            actaeon_wf1_detail(),
        ] {
            let r = detail_regions(&card);
            assert_eq!(
                r.promise.len(),
                5,
                "specimen {} expected 5 promise blocks (4 text + 1 cta), got {}",
                card.id(),
                r.promise.len()
            );
            // 末尾は CTA で、href は /help/warranty
            match r.promise.last().expect("promise non-empty") {
                Block::Cta { href, intent, .. } => {
                    assert_eq!(*intent, CtaIntent::Tertiary);
                    assert_eq!(href.as_str(), "/help/warranty");
                }
                other => panic!("{} promise tail expected Cta, got {other:?}", card.id()),
            }
            // 1 つ目は eyebrow text "安心保証"
            match r.promise.first().expect("promise non-empty") {
                Block::Text {
                    role: TextRole::Eyebrow,
                    content: Localizable::Raw { text },
                    ..
                } => {
                    assert_eq!(text, "安心保証");
                }
                other => panic!("{} promise head expected Text(Eyebrow), got {other:?}", card.id()),
            }
        }
    }

    #[test]
    fn supply_detail_has_empty_promise_region() {
        // 用品は promise を空にして「region ごと省略」する動きを確認
        for card in [jelly_supply_detail(), mat_supply_detail()] {
            let r = detail_regions(&card);
            assert!(
                r.promise.is_empty(),
                "supply {} should have empty promise region, got {} blocks",
                card.id(),
                r.promise.len()
            );
        }
    }

    #[test]
    fn promise_region_serializes_as_camel_case_array() {
        // promise が JSON で `"promise":[...]` として正しく出ること
        let card = hercules_male_142_detail();
        let json = serde_json::to_string(&card).expect("serialize");
        assert!(json.contains(r#""promise":["#), "missing promise array: {json}");
        assert!(
            json.contains(r#""href":"/help/warranty""#),
            "missing warranty href: {json}"
        );
        // 用品は空配列で出る (`"promise":[]`)
        let supply = jelly_supply_detail();
        let json = serde_json::to_string(&supply).expect("serialize supply");
        assert!(json.contains(r#""promise":[]"#), "supply promise not []: {json}");
    }

    #[test]
    fn detail_with_promise_passes_key_validation() {
        // promise 内の key (promise-eyebrow / promise-1..3 / promise-cta) が
        // 他 region の key と衝突しないこと、内部でも一意なこと
        let card = hercules_male_142_detail();
        card.validate_keys()
            .expect("hercules detail with promise should validate");
    }

    #[test]
    fn unknown_region_promise_typo_is_rejected() {
        // promise の typo (promised) は deny_unknown_fields で 400
        let bad_json = r#"{
            "template": "product_detail",
            "id": "X",
            "regions": {
                "promised": []
            }
        }"#;
        let result: Result<CardBlock, _> = serde_json::from_str(bad_json);
        assert!(
            result.is_err(),
            "typo region 'promised' should be rejected by deny_unknown_fields"
        );
    }

    #[tokio::test]
    async fn detail_handler_works_for_every_mock_id() {
        for id in [
            "p-hh-m-142",
            "p-cat-l",
            "p-neo-m",
            "p-aki",
            "p-jelly",
            "p-mat",
        ] {
            let result =
                get_product_detail_card(axum::extract::Path(id.to_string())).await;
            let json =
                result.unwrap_or_else(|e| panic!("get_detail failed for {id}: {e:?}"));
            assert_eq!(json.0.id(), id, "id mismatch for {id}");
            // template が product_detail であることも確認
            match json.0 {
                CardBlock::ProductDetail { .. } => {}
                other => panic!(
                    "expected ProductDetail variant for {id}, got: {:?}",
                    other.id()
                ),
            }
        }
    }

    #[tokio::test]
    async fn detail_handler_returns_not_found_for_unknown_id() {
        let result =
            get_product_detail_card(axum::extract::Path("does-not-exist".to_string())).await;
        match result {
            Err(crate::error::AppError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 2.5 — CtaAction (action フィールドのシリアライズと mock 反映)
    // ────────────────────────────────────────────────────────────────

    /// 文字列で CTA を引く helper。複数 region に同 key が無い前提なので
    /// `iter_blocks()` で線形探索する。
    fn cta_by_key<'c>(card: &'c CardBlock, key: &str) -> &'c Block {
        card.iter_blocks()
            .find(|b| matches!(b, Block::Cta { key: k, .. } if k == key))
            .unwrap_or_else(|| panic!("cta key '{key}' not found in card {}", card.id()))
    }

    #[test]
    fn add_to_cart_cta_carries_action_with_product_id() {
        // 全 6 detail card の cta-add は `AddToCart { product_id, qty: 1 }` を持つ
        for card in all_detail_mock_cards() {
            let id = card.id().to_string();
            let block = cta_by_key(&card, "cta-add");
            match block {
                Block::Cta { action, .. } => match action {
                    Some(CtaAction::AddToCart { product_id, qty }) => {
                        assert_eq!(product_id, &id, "AddToCart product_id mismatch on {id}");
                        assert_eq!(*qty, 1, "AddToCart qty default should be 1 on {id}");
                    }
                    other => panic!("{id} cta-add expected AddToCart, got {other:?}"),
                },
                _ => unreachable!("cta_by_key returned non-Cta"),
            }
        }
    }

    #[test]
    fn watch_cta_carries_toggle_watch_action() {
        for card in all_detail_mock_cards() {
            let id = card.id().to_string();
            let block = cta_by_key(&card, "cta-watch");
            match block {
                Block::Cta { action, .. } => match action {
                    Some(CtaAction::ToggleWatch { product_id }) => {
                        assert_eq!(product_id, &id, "ToggleWatch product_id mismatch on {id}");
                    }
                    other => panic!("{id} cta-watch expected ToggleWatch, got {other:?}"),
                },
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn navigation_only_ctas_have_no_action() {
        // cta-view-cart と (生体のみ) promise-cta は action なし — 純粋なナビゲート
        for card in all_detail_mock_cards() {
            let view_cart = cta_by_key(&card, "cta-view-cart");
            match view_cart {
                Block::Cta { action: None, .. } => {}
                Block::Cta { action: Some(a), .. } => {
                    panic!("{} cta-view-cart should have no action, got {a:?}", card.id())
                }
                _ => unreachable!(),
            }
        }
        // promise-cta は生体のみ存在。supply には無いので skip。
        for card in [
            hercules_male_142_detail(),
            caucasus_larva_detail(),
            neptune_pair_detail(),
            actaeon_wf1_detail(),
        ] {
            let promise_cta = cta_by_key(&card, "promise-cta");
            match promise_cta {
                Block::Cta { action: None, .. } => {}
                Block::Cta { action: Some(a), .. } => {
                    panic!("{} promise-cta should have no action, got {a:?}", card.id())
                }
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn cta_action_serializes_with_camel_case_tag() {
        // JSON に `"action":{"type":"add_to_cart","productId":"...","qty":1}` が出ること
        let card = hercules_male_142_detail();
        let json = serde_json::to_string(&card).expect("serialize");
        assert!(
            json.contains(r#""action":{"type":"add_to_cart","productId":"p-hh-m-142","qty":1}"#),
            "missing AddToCart action JSON in: {json}"
        );
        assert!(
            json.contains(r#""action":{"type":"toggle_watch","productId":"p-hh-m-142"}"#),
            "missing ToggleWatch action JSON in: {json}"
        );
    }

    #[test]
    fn cta_without_action_omits_field() {
        // Option::None + skip_serializing_if で、action フィールドが JSON に出ないこと
        // (フィールドが出てしまうと old client が誤解する)
        let card = hercules_male_142_detail();
        let json = serde_json::to_string(&card).expect("serialize");
        // `cta-view-cart` の周辺に `"action"` が含まれないことを境界文字列で確認:
        // `cta-view-cart` → 直後の Block オブジェクトに action は出ない。
        // ざっくり: serialize された全文に action が出る回数 = AddToCart + ToggleWatch の数。
        // detail mock 全 6 件は action ありの CTA が 2 個 (add + watch)。
        let action_count = json.matches(r#""action":"#).count();
        assert_eq!(
            action_count, 2,
            "expected exactly 2 action fields in JSON (add + watch), got {action_count}: {json}"
        );
    }

    #[test]
    fn cta_action_round_trips_via_json() {
        // serialize → deserialize で action が同じであること
        let original = hercules_male_142_detail();
        let json = serde_json::to_string(&original).expect("serialize");
        let parsed: CardBlock =
            serde_json::from_str(&json).expect("deserialize round-trip");

        let orig_add = cta_by_key(&original, "cta-add");
        let parsed_add = cta_by_key(&parsed, "cta-add");
        assert_eq!(
            orig_add, parsed_add,
            "cta-add Block (with action) didn't round-trip"
        );
    }

    #[test]
    fn unknown_cta_action_type_is_rejected() {
        // 未知の `type` が来たら deserialize で 400
        let bad_json = r#"{
            "type": "cta",
            "key": "x",
            "intent": "primary",
            "label": { "source": "raw", "text": "hi" },
            "href": "/x",
            "action": { "type": "blow_up_the_planet" }
        }"#;
        let result: Result<Block, _> = serde_json::from_str(bad_json);
        assert!(
            result.is_err(),
            "unknown cta action type should be rejected"
        );
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 6 — Search + Pagination
    // ────────────────────────────────────────────────────────────────

    /// 全 6 件にメタ.title が登録されており、Card 表示文字列ともずれていないこと。
    /// title 列が増えた時の追加忘れを検出する。
    #[test]
    fn all_mock_products_have_search_title() {
        let meta = product_filter_meta();
        for (id, m) in meta.iter() {
            assert!(
                !m.title.is_empty(),
                "search title is empty for {id} — populate ProductMeta.title"
            );
        }
        // 既存の build_*_card 引数 title と一致する想定 (一覧 endpoint の headline と同期)
        // Card 内部から逆引きする代わりに既知文字列を assert (= テストコードに正解を書く)
        assert_eq!(meta.get("p-hh-m-142").unwrap().title, "ヘラクレスオオカブト ♂ 142mm");
        assert_eq!(meta.get("p-mat").unwrap().title, "完熟発酵マット 10L");
    }

    // ── helpers ───────────────────────────────────────────────────

    #[test]
    fn resolve_q_trims_and_normalizes_empty() {
        assert_eq!(resolve_q(None), None);
        assert_eq!(resolve_q(Some("")), None);
        assert_eq!(resolve_q(Some("   ")), None, "whitespace-only → None");
        assert_eq!(resolve_q(Some("ヘラ")), Some("ヘラ".to_string()));
        assert_eq!(resolve_q(Some("  ヘラ  ")), Some("ヘラ".to_string()), "trim");
    }

    #[test]
    fn resolve_page_clamps_to_default_on_invalid() {
        assert_eq!(resolve_page(None), 1);
        assert_eq!(resolve_page(Some(0)), 1, "0 → default");
        assert_eq!(resolve_page(Some(1)), 1);
        assert_eq!(resolve_page(Some(99)), 99, "valid pages pass through");
    }

    #[test]
    fn resolve_per_page_caps_to_max() {
        assert_eq!(resolve_per_page(None), DEFAULT_PER_PAGE);
        assert_eq!(resolve_per_page(Some(0)), DEFAULT_PER_PAGE, "0 → default");
        assert_eq!(resolve_per_page(Some(5)), 5);
        assert_eq!(
            resolve_per_page(Some(MAX_PER_PAGE + 100)),
            MAX_PER_PAGE,
            "above MAX is capped"
        );
    }

    #[test]
    fn matches_search_is_case_insensitive_substring() {
        assert!(matches_search("Hello World", None), "None q matches all");
        assert!(matches_search("Hello World", Some("hello")));
        assert!(matches_search("Hello World", Some("HELLO")));
        assert!(matches_search("ヘラクレスオオカブト", Some("ヘラ")));
        assert!(matches_search("ヘラクレスオオカブト", Some("オオカブト")));
        assert!(!matches_search("ヘラクレスオオカブト", Some("ジャイアント")));
        assert!(matches_search("anything", Some("")), "empty needle matches everything");
    }

    // ── collapse_page_range ───────────────────────────────────────

    #[test]
    fn collapse_page_range_handles_small_totals() {
        // total=0 → 空 (caller がページャ非表示判定)
        assert_eq!(collapse_page_range(1, 0), vec![]);
        // total=1 → [1]
        assert_eq!(collapse_page_range(1, 1), vec![PageSlot::Number(1)]);
        // total=3, current=2 → [1,2,3]
        assert_eq!(
            collapse_page_range(2, 3),
            vec![PageSlot::Number(1), PageSlot::Number(2), PageSlot::Number(3)]
        );
    }

    #[test]
    fn collapse_page_range_inserts_ellipsis_in_middle() {
        // total=10, current=5 → [1, ..., 3, 4, 5, 6, 7, ..., 10]
        let r = collapse_page_range(5, 10);
        assert_eq!(
            r,
            vec![
                PageSlot::Number(1),
                PageSlot::Ellipsis,
                PageSlot::Number(3),
                PageSlot::Number(4),
                PageSlot::Number(5),
                PageSlot::Number(6),
                PageSlot::Number(7),
                PageSlot::Ellipsis,
                PageSlot::Number(10),
            ]
        );
    }

    #[test]
    fn collapse_page_range_first_and_last_no_ellipsis_at_edges() {
        // total=10, current=1 → [1, 2, 3, ..., 10]  (1 と 3 は連続なので ellipsis 無し)
        let r = collapse_page_range(1, 10);
        assert_eq!(
            r,
            vec![
                PageSlot::Number(1),
                PageSlot::Number(2),
                PageSlot::Number(3),
                PageSlot::Ellipsis,
                PageSlot::Number(10),
            ]
        );
        // total=10, current=10 → [1, ..., 8, 9, 10]
        let r = collapse_page_range(10, 10);
        assert_eq!(
            r,
            vec![
                PageSlot::Number(1),
                PageSlot::Ellipsis,
                PageSlot::Number(8),
                PageSlot::Number(9),
                PageSlot::Number(10),
            ]
        );
    }

    #[test]
    fn collapse_page_range_clamps_current_into_bounds() {
        // current が範囲外 → bounds に clamp。current=99, total=3 → current=3 として処理
        let r = collapse_page_range(99, 3);
        assert_eq!(
            r,
            vec![PageSlot::Number(1), PageSlot::Number(2), PageSlot::Number(3)]
        );
    }

    // ── search ────────────────────────────────────────────────────

    /// `?q=ヘラ` → ヘラクレスのみ 1 件。
    #[tokio::test]
    async fn search_q_substring_match_returns_subset() {
        let resp = list_product_cards(Query(ListQuery {
            q: Some("ヘラ".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(resp.cards.len(), 1);
        assert_eq!(resp.cards[0].id(), "p-hh-m-142");
    }

    /// 検索 0 件でも search_box / filter_bar / pagination は維持される。
    #[tokio::test]
    async fn search_zero_match_still_returns_shell() {
        let resp = list_product_cards(Query(ListQuery {
            q: Some("nonexistentkeyword".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(resp.cards.len(), 0);
        assert!(resp.filter_bar.is_some(), "filter_bar must remain on 0-match search");
        assert!(resp.search_box.is_some(), "search_box must remain on 0-match search");
        let p = resp.pagination.expect("pagination must remain");
        assert_eq!(p.total_count, 0);
        assert_eq!(p.total_pages, 1, "total_pages floors at 1 for 0 results (= no /0)");
    }

    /// q の case-insensitive 比較: 大文字も小文字も同じ結果。
    #[tokio::test]
    async fn search_q_is_case_insensitive() {
        // 用品の「マット」を取れる
        let lower = list_product_cards(Query(ListQuery {
            q: Some("マット".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(lower.cards.len(), 1);
        assert_eq!(lower.cards[0].id(), "p-mat");
    }

    /// q が trim される: `?q=  ヘラ  ` → ヘラと同じ結果。
    #[tokio::test]
    async fn search_q_is_trimmed() {
        let resp = list_product_cards(Query(ListQuery {
            q: Some("  ヘラ  ".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(resp.cards.len(), 1);
        assert_eq!(resp.cards[0].id(), "p-hh-m-142");
    }

    /// q を空文字 → 全件 (= q 無しと等価)。
    #[tokio::test]
    async fn search_empty_q_matches_all() {
        let resp = list_product_cards(Query(ListQuery {
            q: Some("".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(resp.cards.len(), 6, "empty q must match all 6 products");
    }

    /// q + filter + sort の同時適用: live で「ネプ」検索 → ネプチューン 1 件。
    #[tokio::test]
    async fn search_with_filter_and_sort_combined() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("live".to_string()),
            q: Some("ネプ".to_string()),
            sort: Some("price_desc".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        assert_eq!(resp.cards.len(), 1);
        assert_eq!(resp.cards[0].id(), "p-neo-m");
    }

    /// faceted count は q (search) に影響されない (= filter のみ適用後の母集団で計算)。
    /// Phase 5 の「sort doesn't affect count」と同じ理屈で、search も影響させない。
    #[tokio::test]
    async fn search_does_not_affect_faceted_count() {
        let resp = list_product_cards(Query(ListQuery {
            q: Some("ヘラ".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let bar = resp.filter_bar.expect("filter_bar");
        let cat = bar.groups.iter().find(|g| g.key == "category").unwrap();
        let live = cat.chips.iter().find(|c| c.key == "live").unwrap();
        let supply = cat.chips.iter().find(|c| c.key == "supply").unwrap();
        // 検索 ヘラ は live=1 件 にしか効かないが、count は filter ベース (4/2)
        assert_eq!(live.count, Some(4), "count is filter-based, not search-based");
        assert_eq!(supply.count, Some(2));
    }

    // ── search_box shell ──────────────────────────────────────────

    /// q 未指定 → search_box.query = None, submit_href = "/products"。
    #[tokio::test]
    async fn search_box_default_state() {
        let resp = list_product_cards(Query(ListQuery::default()))
            .await
            .expect("ok")
            .0;
        let sb = resp.search_box.expect("search_box always present");
        assert_eq!(sb.query, None);
        assert_eq!(sb.submit_href.as_str(), "/products");
        assert_eq!(sb.param_name, "q");
        assert_eq!(sb.analytics_id.as_deref(), Some("search.submit"));
    }

    /// q 指定済み → query は trim 済み + filter / sort は submit_href に維持。
    #[tokio::test]
    async fn search_box_preserves_filter_and_sort_in_submit_href() {
        let resp = list_product_cards(Query(ListQuery {
            q: Some("  ネプ  ".to_string()),
            category: Some("live".to_string()),
            sort: Some("price_asc".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let sb = resp.search_box.expect("search_box");
        // controlled input 用に trim 済み q を返す
        assert_eq!(sb.query.as_deref(), Some("ネプ"));
        // submit_href には filter / sort が残り、q + page は抜けている
        assert_eq!(sb.submit_href.as_str(), "/products?category=live&sort=price_asc");
    }

    // ── pagination ────────────────────────────────────────────────

    /// per_page 無指定 → 全 6 件 1 ページ目に収まる (DEFAULT_PER_PAGE=20)。
    #[tokio::test]
    async fn pagination_default_fits_all_in_one_page() {
        let resp = list_product_cards(Query(ListQuery::default()))
            .await
            .expect("ok")
            .0;
        let p = resp.pagination.expect("pagination");
        assert_eq!(p.page, 1);
        assert_eq!(p.per_page, DEFAULT_PER_PAGE);
        assert_eq!(p.total_count, 6);
        assert_eq!(p.total_pages, 1);
        assert!(p.prev_href.is_none(), "first page has no prev");
        assert!(p.next_href.is_none(), "last page has no next");
        assert_eq!(p.pages.len(), 1, "single page list");
    }

    /// per_page=2 → 全 6 件で 3 ページに割れる。1 ページ目は 2 件。
    #[tokio::test]
    async fn pagination_per_page_2_splits_into_3_pages() {
        let resp = list_product_cards(Query(ListQuery {
            per_page: Some(2),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let p = resp.pagination.expect("pagination");
        assert_eq!(resp.cards.len(), 2, "per_page=2 returns 2 cards");
        assert_eq!(p.page, 1);
        assert_eq!(p.per_page, 2);
        assert_eq!(p.total_count, 6);
        assert_eq!(p.total_pages, 3);
        assert!(p.prev_href.is_none());
        assert!(p.next_href.is_some(), "page 1 of 3 must have next");
        // 2 ページ目 URL に perPage=2 が引き継がれている
        assert_eq!(
            p.next_href.unwrap().as_str(),
            "/products?page=2&perPage=2"
        );
    }

    /// per_page=2&page=2 → 中間ページで prev / next ともに Some。
    #[tokio::test]
    async fn pagination_middle_page_has_prev_and_next() {
        let resp = list_product_cards(Query(ListQuery {
            per_page: Some(2),
            page: Some(2),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let p = resp.pagination.expect("pagination");
        assert_eq!(resp.cards.len(), 2);
        assert_eq!(p.page, 2);
        assert!(p.prev_href.is_some());
        assert!(p.next_href.is_some());
        // 1 ページ目 URL は page=1 を抜く (canonical)
        assert_eq!(p.prev_href.unwrap().as_str(), "/products?perPage=2");
        assert_eq!(p.next_href.unwrap().as_str(), "/products?page=3&perPage=2");
    }

    /// 最終ページは next が None (= disabled)。
    #[tokio::test]
    async fn pagination_last_page_has_no_next() {
        let resp = list_product_cards(Query(ListQuery {
            per_page: Some(2),
            page: Some(3),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let p = resp.pagination.expect("pagination");
        assert_eq!(p.page, 3);
        assert_eq!(p.total_pages, 3);
        assert!(p.next_href.is_none(), "last page has no next");
        assert!(p.prev_href.is_some());
    }

    /// page out-of-range (= 既存件数を超えるページ番号) → 空配列だが pagination 自体は維持。
    /// ユーザの古い URL が腐っても 200 を返す壊れ耐性。
    #[tokio::test]
    async fn pagination_out_of_range_page_returns_empty_cards() {
        let resp = list_product_cards(Query(ListQuery {
            per_page: Some(2),
            page: Some(99),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let p = resp.pagination.expect("pagination");
        assert_eq!(resp.cards.len(), 0);
        // page 値は user input そのまま (clamp しない)
        assert_eq!(p.page, 99);
        assert_eq!(p.total_pages, 3);
        // pages リストは collapse 内部で current=3 にクランプされて 1/2/3 が出る。
        // selected の判定は元の page=99 と比較するので誰も selected=true にはならない
        // (= out-of-range は強調表示なし、ただし戻り導線として番号リンクは描画する)。
        assert_eq!(p.pages.len(), 3, "1/2/3 のリンクが描画される");
        assert!(
            p.pages
                .iter()
                .all(|pl| matches!(pl, PageLink::Page { selected: false, .. })),
            "out-of-range page では selected=true な link は出ない"
        );
    }

    /// pagination link は filter / sort / q を維持する (= ページ移動でクエリは変わらない)。
    #[tokio::test]
    async fn pagination_links_preserve_filter_sort_q() {
        let resp = list_product_cards(Query(ListQuery {
            category: Some("live".to_string()),
            sort: Some("price_asc".to_string()),
            q: Some("ヘラ".to_string()),
            per_page: Some(1),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let p = resp.pagination.expect("pagination");
        // 1 件しかヒットしないが per_page=1 なので 1 ページ目で全部。next = None。
        assert_eq!(p.total_count, 1);
        // 仮想的に 2 ページ目リンクを構築するため、any page link がある場合の URL を見る
        // 1 ページしかないので pages=[1] のはず
        assert_eq!(p.pages.len(), 1);
    }

    /// per_page=2, page=2: prev は page 抜き URL、つまり「page=1 を抜く canonical」。
    /// query 文字列が perPage=2 だけになることを担保。
    #[tokio::test]
    async fn pagination_prev_href_omits_default_page() {
        let resp = list_product_cards(Query(ListQuery {
            per_page: Some(2),
            page: Some(2),
            category: Some("live".to_string()),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let p = resp.pagination.expect("pagination");
        let prev = p.prev_href.expect("prev");
        // canonical: page=1 を URL から抜く + filter は維持
        assert_eq!(prev.as_str(), "/products?category=live&perPage=2");
    }

    /// filter chip click 後の URL は page をリセット (= page=1) する → URL に page= が出ない。
    /// page=2 で踏まれたら、フィルタ chip click 先 URL は page を抜いた canonical 形になる。
    #[tokio::test]
    async fn filter_chip_href_resets_page_to_first() {
        let resp = list_product_cards(Query(ListQuery {
            page: Some(2),
            per_page: Some(2),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let bar = resp.filter_bar.expect("filter_bar");
        let cat = bar.groups.iter().find(|g| g.key == "category").unwrap();
        let live = cat.chips.iter().find(|c| c.key == "live").unwrap();
        // chip click → category=live & page=1(omitted) & perPage=2 維持
        assert_eq!(live.href.as_str(), "/products?category=live&perPage=2");
    }

    /// sort option click も同様に page をリセット。
    #[tokio::test]
    async fn sort_option_href_resets_page_to_first() {
        let resp = list_product_cards(Query(ListQuery {
            page: Some(2),
            per_page: Some(2),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let sb = resp.sort_bar.expect("sort_bar");
        let new_opt = sb.options.iter().find(|o| o.key == "new").unwrap();
        // sort 切替 → page リセット, perPage 維持
        assert_eq!(new_opt.href.as_str(), "/products?sort=new&perPage=2");
    }

    /// per_page を超大 (> MAX_PER_PAGE) で踏まれても返却値は MAX に丸まる。
    #[tokio::test]
    async fn pagination_per_page_capped_at_max() {
        let resp = list_product_cards(Query(ListQuery {
            per_page: Some(MAX_PER_PAGE + 1000),
            ..Default::default()
        }))
        .await
        .expect("ok")
        .0;
        let p = resp.pagination.expect("pagination");
        assert_eq!(p.per_page, MAX_PER_PAGE, "per_page must be capped at MAX_PER_PAGE");
        // 6 件 < MAX_PER_PAGE なので全件 1 ページ
        assert_eq!(resp.cards.len(), 6);
    }

    /// Pagination.analytics_id は規約 `pagination.page` 形式。
    #[tokio::test]
    async fn pagination_analytics_id_follows_convention() {
        let resp = list_product_cards(Query(ListQuery::default()))
            .await
            .expect("ok")
            .0;
        let p = resp.pagination.expect("pagination");
        assert_eq!(p.analytics_id.as_deref(), Some("pagination.page"));
    }

    /// q を含む URL は percent-encode される (multi-byte 安全)。
    #[test]
    fn build_list_href_percent_encodes_multibyte_q() {
        let h = build_list_href(&ListQuery {
            q: Some("ヘラ".to_string()),
            ..Default::default()
        });
        assert_eq!(h, "/products?q=%E3%83%98%E3%83%A9");
    }

    /// `&` や `=` を含む q も安全に encode される。
    #[test]
    fn build_list_href_encodes_special_chars_in_q() {
        let h = build_list_href(&ListQuery {
            q: Some("a&b=c".to_string()),
            ..Default::default()
        });
        // a (alnum), & = %26, b (alnum), = = %3D, c (alnum)
        assert_eq!(h, "/products?q=a%26b%3Dc");
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 7 — Cart card
    //
    // build_cart_card は純粋関数 (snapshot を引数で受ける) なので、
    // ハンドラ越しにグローバル store を触らずに表組みできるユニットテスト。
    // ────────────────────────────────────────────────────────────────

    use crate::handlers::cart::CartEntry;
    use crate::handlers::checkout::CheckoutState;

    fn entry(product_id: &str, qty: u32) -> CartEntry {
        CartEntry {
            product_id: product_id.to_string(),
            qty,
        }
    }

    /// 配送先「全 5 フィールド埋まり」+ 配送方法 cold (1800) の checkout state。
    /// is_shipping_complete = true / shipping_amount = 1800 になる。
    fn complete_checkout() -> CheckoutState {
        CheckoutState {
            address_name: "山田 徹".to_string(),
            address_tel: "080-0000-0000".to_string(),
            address_zip: "150-0001".to_string(),
            address_pref: "東京都".to_string(),
            address_addr: "渋谷区神宮前 1-2-3".to_string(),
            shipping_method_id: "cold".to_string(),
        }
    }

    /// 既存テスト互換のための薄いラッパ。default 配送先 (空) + cold (1800) の状態で組む。
    /// shipping は埋まっていないので cta は warning + continue の 2 件。
    fn build_cart_card_test_default(snap: Vec<(String, CartEntry)>) -> CardBlock {
        build_cart_card_with_checkout(snap, CheckoutState::default())
    }

    /// 空カートでも cart card は組めて、items / summary が空配列で出ること。
    #[test]
    fn cart_card_empty_has_no_items_and_no_summary() {
        let card = build_cart_card_test_default(vec![]);
        match &card {
            CardBlock::Cart { id, regions, .. } => {
                assert_eq!(id, "cart");
                assert_eq!(regions.items.len(), 0, "empty cart → items is []");
                assert_eq!(regions.summary.len(), 0, "empty cart → summary is []");
                assert_eq!(
                    regions.shipping.len(),
                    0,
                    "empty cart → shipping is [] (Phase 8)"
                );
                assert_eq!(
                    regions.shipping_method.len(),
                    0,
                    "empty cart → shipping_method is [] (Phase 8)"
                );
                // header は "0 件" を表示する Text 1 件
                assert_eq!(regions.header.len(), 1);
                // cta は「買い物を続ける」だけ
                assert_eq!(regions.cta.len(), 1, "empty cart → only continue shopping CTA");
            }
            other => panic!("expected Cart variant, got {:?}", other.id()),
        }
        // 空カートでも key 一意性は壊れない
        card.validate_keys().expect("empty cart key validation");
    }

    /// 1 件入りカート + 配送先 OK: LineItem の subtotal / OrderSummary の合計 (送料込) が正しい。
    #[test]
    fn cart_card_single_item_calculates_subtotal_and_total() {
        // p-jelly: 1480 円 × 2 = 2960 円, + cold 配送料 1800 = total 4760
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 2))];
        let card = build_cart_card_with_checkout(snap, complete_checkout());

        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart variant");
        };

        assert_eq!(regions.items.len(), 1, "1 line");
        match &regions.items[0] {
            Block::LineItem {
                key,
                product_id,
                unit_price_amount,
                qty,
                subtotal_amount,
                decrement_action,
                increment_action,
                remove_action,
                ..
            } => {
                assert_eq!(key, "li-undo_1");
                assert_eq!(product_id, "p-jelly");
                assert_eq!(*unit_price_amount, 1480);
                assert_eq!(*qty, 2);
                assert_eq!(*subtotal_amount, 2960, "1480 * 2 = 2960");

                // qty == 2 なので decrement = SetQty(qty=1)
                let dec = decrement_action.as_ref().expect("decrement should be Some");
                assert!(matches!(
                    dec,
                    LineItemAction::SetQty { qty: 1, .. }
                ));
                assert!(matches!(
                    increment_action,
                    LineItemAction::SetQty { qty: 3, .. }
                ));
                assert!(matches!(
                    remove_action,
                    LineItemAction::Remove { .. }
                ));
            }
            other => panic!("expected LineItem, got {:?}", other.key()),
        }

        // summary 1 件: subtotal 2960, shipping 1800, total 4760
        assert_eq!(regions.summary.len(), 1);
        match &regions.summary[0] {
            Block::OrderSummary {
                line_count,
                total_qty,
                subtotal_amount,
                shipping_amount,
                total_amount,
                ..
            } => {
                assert_eq!(*line_count, 1);
                assert_eq!(*total_qty, 2);
                assert_eq!(*subtotal_amount, 2960);
                assert_eq!(*shipping_amount, Some(1800), "cold method (Phase 8)");
                assert_eq!(*total_amount, 4760, "subtotal + shipping = 2960 + 1800");
            }
            other => panic!("expected OrderSummary, got {:?}", other.key()),
        }

        // 非空カート + 配送先完了: cta は「Stripe で決済」+「買い物を続ける」の 2 件
        assert_eq!(regions.cta.len(), 2);
    }

    /// qty == 1 の LineItem は decrement_action が None (= UI で disabled)。
    #[test]
    fn cart_card_qty_one_disables_decrement() {
        let snap = vec![("undo_1".to_string(), entry("p-mat", 1))];
        let card = build_cart_card_test_default(snap);
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        match &regions.items[0] {
            Block::LineItem { decrement_action, .. } => {
                assert!(decrement_action.is_none(), "qty=1 → decrement disabled (None)");
            }
            _ => panic!("expected LineItem"),
        }
    }

    /// 商品マスタに存在しない product_id はゴミとして表示せず、500 にもしない。
    #[test]
    fn cart_card_skips_unknown_product_id() {
        let snap = vec![
            ("undo_1".to_string(), entry("p-jelly", 1)),
            ("undo_2".to_string(), entry("p-ghost-removed", 99)),
            ("undo_3".to_string(), entry("p-mat", 2)),
        ];
        let card = build_cart_card_with_checkout(snap, complete_checkout());
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };

        // 2 件しか残らない (p-ghost-removed は捨てる)
        assert_eq!(regions.items.len(), 2);

        // subtotal は p-jelly (1480 * 1) + p-mat (1280 * 2) = 1480 + 2560 = 4040
        // total = subtotal + shipping (1800) = 5840
        match &regions.summary[0] {
            Block::OrderSummary {
                line_count,
                total_qty,
                subtotal_amount,
                total_amount,
                ..
            } => {
                assert_eq!(*line_count, 2);
                assert_eq!(*total_qty, 3, "1 + 2 = 3 (ghost の qty=99 は無視)");
                assert_eq!(*subtotal_amount, 4040);
                assert_eq!(*total_amount, 5840, "subtotal 4040 + shipping 1800");
            }
            _ => panic!("expected OrderSummary"),
        }
    }

    /// 複数 LineItem の subtotal が個別に計算され、key は token ベースで一意。
    #[test]
    fn cart_card_multiple_items_have_unique_keys() {
        let snap = vec![
            ("undo_1".to_string(), entry("p-hh-m-142", 1)), // 48000
            ("undo_2".to_string(), entry("p-cat-l", 3)),    // 12000 * 3 = 36000
            ("undo_3".to_string(), entry("p-jelly", 5)),    // 1480 * 5 = 7400
        ];
        let card = build_cart_card_with_checkout(snap, complete_checkout());

        // ValidateKeys が通る = key (LineItem / FormField / picker 含む) が一意
        card.validate_keys().expect("multi-item cart keys must be unique");

        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        assert_eq!(regions.items.len(), 3);
        // subtotal = 48000 + 36000 + 7400 = 91400, total = + 1800 = 93200
        match &regions.summary[0] {
            Block::OrderSummary { total_amount, total_qty, subtotal_amount, .. } => {
                assert_eq!(*subtotal_amount, 91400);
                assert_eq!(*total_amount, 93200, "subtotal 91400 + shipping 1800");
                assert_eq!(*total_qty, 9, "1 + 3 + 5 = 9");
            }
            _ => panic!("expected OrderSummary"),
        }
    }

    /// JSON にシリアライズして camelCase で出ること + cart テンプレート tag が付くこと。
    #[test]
    fn cart_card_serializes_to_camel_case_json() {
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 2))];
        let card = build_cart_card_with_checkout(snap, complete_checkout());
        let json = serde_json::to_string(&card).expect("serialize");
        assert!(json.contains(r#""template":"cart""#), "{json}");
        assert!(json.contains(r#""variant":"default""#), "{json}");
        assert!(json.contains(r#""type":"line_item""#), "{json}");
        assert!(json.contains(r#""type":"order_summary""#), "{json}");
        assert!(json.contains(r#""unitPriceAmount":1480"#), "{json}");
        assert!(json.contains(r#""subtotalAmount":2960"#), "{json}");
        // shipping 込み合計 (Phase 8: 2960 + 1800 = 4760)
        assert!(json.contains(r#""totalAmount":4760"#), "{json}");
        assert!(json.contains(r#""shippingAmount":1800"#), "{json}");
        assert!(json.contains(r#""totalQty":2"#), "{json}");
        // LineItemAction も snake_case tag
        assert!(json.contains(r#""type":"set_qty""#), "{json}");
        assert!(json.contains(r#""type":"remove""#), "{json}");
        // Phase 8: form_field / shipping_method_picker
        assert!(json.contains(r#""type":"form_field""#), "{json}");
        assert!(json.contains(r#""type":"shipping_method_picker""#), "{json}");
        // Action も snake_case tag
        assert!(json.contains(r#""type":"patch_field""#), "{json}");
        assert!(json.contains(r#""type":"patch_method""#), "{json}");
    }

    /// JSON 経由で round-trip できること (Block::LineItem / OrderSummary / FormField /
    /// ShippingMethodPicker の deserialize 確認)。
    #[test]
    fn cart_card_round_trips_via_json() {
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 2))];
        let card = build_cart_card_with_checkout(snap, complete_checkout());
        let json = serde_json::to_string(&card).expect("serialize");
        let parsed: CardBlock = serde_json::from_str(&json).expect("round-trip");
        assert_eq!(parsed.id(), "cart");
        // 再度 JSON 化して同一になること (= 再帰的に欠損が無い)
        let json2 = serde_json::to_string(&parsed).unwrap();
        assert_eq!(json, json2, "round-trip JSON must be byte-identical");
    }

    /// detail_href は `/products/{id}` 形式。
    #[test]
    fn cart_card_line_item_detail_href_points_to_product_page() {
        let snap = vec![("undo_1".to_string(), entry("p-hh-m-142", 1))];
        let card = build_cart_card_test_default(snap);
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        match &regions.items[0] {
            Block::LineItem { detail_href, .. } => {
                assert_eq!(detail_href.as_str(), "/products/p-hh-m-142");
            }
            _ => panic!("expected LineItem"),
        }
    }

    /// ハンドラ直叩き: グローバル store が空のとき空カードが返ること。
    /// (cart store のテストは serial 化されているのでここも guard を取る)
    #[tokio::test]
    async fn get_cart_card_handler_returns_empty_card_when_store_empty() {
        // cart::tests と共有する GUARD は private なのでこちらは独立に取る。
        // 同時実行で落ちる可能性があるが MVP では `cargo test -- --test-threads=1` で逃げる前提。
        crate::handlers::cart::reset_cart_for_test();
        let res = get_cart_card().await.expect("handler ok");
        let card = res.0;
        assert_eq!(card.id(), "cart");
        match &card {
            CardBlock::Cart { regions, .. } => {
                assert_eq!(regions.items.len(), 0);
                assert_eq!(regions.summary.len(), 0);
                // Phase 8: 空カート時は shipping / shipping_method も空
                assert_eq!(regions.shipping.len(), 0);
                assert_eq!(regions.shipping_method.len(), 0);
            }
            _ => panic!("expected Cart"),
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 8 — Shipping form / Shipping method picker
    // ────────────────────────────────────────────────────────────────

    /// 非空カートでは shipping region に FormField 5 件が並び、各 patch_action の
    /// field_name が name と一致する (= URL を組む時のずれゼロ)。
    #[test]
    fn cart_card_shipping_has_five_form_fields_with_matching_actions() {
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 1))];
        let card = build_cart_card_test_default(snap);
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        assert_eq!(regions.shipping.len(), 5, "氏名/電話/郵便/都道府県/住所");

        let expected_names = [
            "addressName",
            "addressTel",
            "addressZip",
            "addressPref",
            "addressAddr",
        ];
        for (i, b) in regions.shipping.iter().enumerate() {
            match b {
                Block::FormField { name, patch_action, .. } => {
                    assert_eq!(name, expected_names[i]);
                    let CheckoutFieldAction::PatchField { field_name } = patch_action;
                    assert_eq!(field_name, name, "patch_action.field_name == name");
                }
                _ => panic!("expected FormField at index {i}"),
            }
        }
    }

    /// 必須かつ空の FormField は validation_error が Some になる (= UI で赤字)。
    #[test]
    fn cart_card_form_field_empty_value_has_validation_error() {
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 1))];
        let card = build_cart_card_with_checkout(snap, CheckoutState::default());
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        for b in regions.shipping.iter() {
            match b {
                Block::FormField {
                    required,
                    value,
                    validation_error,
                    ..
                } => {
                    assert!(*required);
                    assert!(value.is_none(), "default state → value is None");
                    assert!(
                        validation_error.is_some(),
                        "required + empty → validation_error must be Some"
                    );
                }
                _ => panic!("expected FormField"),
            }
        }
    }

    /// 配送先が完全に揃っていれば validation_error は全て None。
    #[test]
    fn cart_card_form_field_filled_value_has_no_validation_error() {
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 1))];
        let card = build_cart_card_with_checkout(snap, complete_checkout());
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        for b in regions.shipping.iter() {
            match b {
                Block::FormField {
                    value,
                    validation_error,
                    ..
                } => {
                    assert!(value.is_some());
                    assert!(
                        validation_error.is_none(),
                        "filled value → no validation_error"
                    );
                }
                _ => panic!("expected FormField"),
            }
        }
    }

    /// 都道府県は Select kind で 47 候補を持つ。
    #[test]
    fn cart_card_pref_field_is_select_with_47_options() {
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 1))];
        let card = build_cart_card_test_default(snap);
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        // 4 番目 (index 3) が pref
        match &regions.shipping[3] {
            Block::FormField { name, kind, .. } => {
                assert_eq!(name, "addressPref");
                match kind {
                    FormFieldKind::Select { options } => {
                        assert_eq!(options.len(), 47, "都道府県は 47 件");
                        // 先頭は北海道、末尾は沖縄県
                        assert_eq!(options[0].id, "北海道");
                        assert_eq!(options[46].id, "沖縄県");
                    }
                    other => panic!("expected Select kind, got {other:?}"),
                }
            }
            _ => panic!("expected FormField"),
        }
    }

    /// 配送方法ピッカーは ShippingMethodPicker 1 件で 2 オプションを持ち、
    /// selected_id が checkout state の値と一致する。
    #[test]
    fn cart_card_shipping_method_picker_reflects_state() {
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 1))];
        let mut state = complete_checkout();
        state.shipping_method_id = "normal".to_string();
        let card = build_cart_card_with_checkout(snap, state);
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        assert_eq!(regions.shipping_method.len(), 1);
        match &regions.shipping_method[0] {
            Block::ShippingMethodPicker {
                options,
                selected_id,
                patch_action,
                ..
            } => {
                assert_eq!(options.len(), 2, "cold + normal");
                assert_eq!(selected_id, "normal");
                assert!(matches!(patch_action, CheckoutMethodAction::PatchMethod));
                // amounts: cold 1800, normal 800
                let cold = options.iter().find(|o| o.id == "cold").expect("cold");
                let normal = options.iter().find(|o| o.id == "normal").expect("normal");
                assert_eq!(cold.amount, 1800);
                assert_eq!(normal.amount, 800);
            }
            _ => panic!("expected ShippingMethodPicker"),
        }
    }

    /// 商品有 + 配送先未入力: cta に「決済」ボタンを出さず、warning Text + continue Cta を出す。
    #[test]
    fn cart_card_cta_warns_when_shipping_incomplete() {
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 1))];
        let card = build_cart_card_with_checkout(snap, CheckoutState::default());
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        // [warning Text, continue Cta] の 2 件、決済 Cta は無い
        assert_eq!(regions.cta.len(), 2);
        assert!(matches!(regions.cta[0], Block::Text { .. }));
        assert!(matches!(regions.cta[1], Block::Cta { .. }));
        // checkout キーが含まれていないこと
        for b in regions.cta.iter() {
            assert_ne!(b.key(), "cta-checkout");
        }
    }

    /// 商品有 + 配送先完了: cta に「Stripe で決済」(primary) + 「買い物を続ける」が並ぶ。
    #[test]
    fn cart_card_cta_includes_stripe_when_shipping_complete() {
        let snap = vec![("undo_1".to_string(), entry("p-jelly", 1))];
        let card = build_cart_card_with_checkout(snap, complete_checkout());
        let CardBlock::Cart { regions, .. } = &card else {
            panic!("expected Cart");
        };
        assert_eq!(regions.cta.len(), 2);
        match &regions.cta[0] {
            Block::Cta { key, intent, .. } => {
                assert_eq!(key, "cta-checkout");
                assert!(matches!(intent, CtaIntent::Primary));
            }
            _ => panic!("expected primary Cta"),
        }
    }

    /// FormField / ShippingMethodPicker を含めて全 block の key が一意であること。
    #[test]
    fn cart_card_phase8_keys_are_unique() {
        let snap = vec![
            ("undo_1".to_string(), entry("p-hh-m-142", 1)),
            ("undo_2".to_string(), entry("p-cat-l", 2)),
        ];
        let card = build_cart_card_with_checkout(snap, complete_checkout());
        card.validate_keys()
            .expect("Phase 8 cart card keys must be unique across all regions");
    }
}
