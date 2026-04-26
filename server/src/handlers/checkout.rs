//! `/api/v1/checkout` 系の SDUI Action エンドポイント (Phase 8)。
//!
//! - `PATCH /api/v1/checkout/shipping_field/{name}`  → 配送先 1 フィールドを更新
//! - `PATCH /api/v1/checkout/shipping_method`        → 配送方法を切り替え
//!
//! **設計方針 (MVP)**:
//!   - 永続化なし。プロセス内 `Mutex<CheckoutState>` だけ (single-user 前提)。
//!   - state は `name / tel / zip / pref / addr / shipping_method_id` のフラット構造。
//!     legacy /cart の `store/checkout.ts` の field 名と意図的に揃える (= 移行容易性)。
//!   - field 名 (PATCH path の `{name}`) は ALLOWED_FIELDS に列挙。未知の name は 400。
//!     許可制にする理由: 任意キーを書き込めると XSS / DoS の温床になる。
//!   - shipping_method_id は SHIPPING_METHODS の id のいずれかしか受け付けない。未知は 400。
//!
//! **将来 (Phase 8+)**:
//!   - Cookie ベース session で multi-user 化
//!   - SQLite or Postgres 永続化 (= ページリロードでも値が残る)
//!   - field ごとの validation rule を server から下ろす (length / regex)

use std::sync::{Mutex, OnceLock};

use axum::{Json, extract::Path};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

// ──────────────────────────────────────────────────────────────────────
// Checkout state (in-process, single-user)
// ──────────────────────────────────────────────────────────────────────

/// 配送先 + 配送方法の現状。`build_cart_card` から `pub(crate)` で参照される。
///
/// Default 値はあえて空文字 + 既定 shipping_method_id ("cold") にする。
/// "山田 徹" のような hardcoded fixture は server 側に持ち込まない (= テストノイズ削減)。
#[derive(Debug, Clone)]
pub(crate) struct CheckoutState {
    pub address_name: String,
    pub address_tel: String,
    pub address_zip: String,
    pub address_pref: String,
    pub address_addr: String,
    pub shipping_method_id: String,
}

impl Default for CheckoutState {
    fn default() -> Self {
        Self {
            address_name: String::new(),
            address_tel: String::new(),
            address_zip: String::new(),
            address_pref: String::new(),
            address_addr: String::new(),
            shipping_method_id: DEFAULT_SHIPPING_METHOD_ID.to_string(),
        }
    }
}

pub(crate) fn checkout_store() -> &'static Mutex<CheckoutState> {
    static STORE: OnceLock<Mutex<CheckoutState>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(CheckoutState::default()))
}

/// 現在の checkout state のスナップショットを返す。
/// 戻り値は値コピーなので呼び出し側は Mutex を持ち続けない。
pub(crate) fn snapshot_checkout() -> CheckoutState {
    checkout_store()
        .lock()
        .expect("checkout store mutex poisoned")
        .clone()
}

// ──────────────────────────────────────────────────────────────────────
// 許容フィールド一覧 + 配送方法定義
// ──────────────────────────────────────────────────────────────────────

/// PATCH `/checkout/shipping_field/{name}` で受け付ける `name` の allowlist。
/// 未知の name は 400 で弾く (= XSS / 任意キー書き込み防止)。
pub(crate) const ALLOWED_FIELDS: &[&str] = &[
    "addressName",
    "addressTel",
    "addressZip",
    "addressPref",
    "addressAddr",
];

/// 既定の shipping_method_id (= 新規 CheckoutState 生成時の値)。
///
/// **Phase 9.B 段階 6** (= DB 移行 / 2026-04):
///   配送方法の本体は `crate::repos::shipping_methods` に移動。本ファイルからは
///   `shipping_amount_for` / `is_known_shipping_method_id` を repo 経由で公開する。
///   "cold" は 0002_master_data.sql で sort_order=0 (= 推奨枠) を指す前提で固定値。
pub(crate) const DEFAULT_SHIPPING_METHOD_ID: &str = "cold";

/// 現在 selected な配送方法の amount を返す。未知 id ならデフォルトにフォールバック。
/// `build_cart_card` から OrderSummary.shipping_amount に詰めるため使う。
///
/// Phase 9.B 段階 6: 実体は `repos::shipping_methods::amount_for` に委譲。
/// pool 不在時 (= warm 前) も in-memory fallback で同値を返す。
pub(crate) fn shipping_amount_for(id: &str) -> i64 {
    crate::repos::shipping_methods::amount_for(id)
}

/// id が既知の配送方法か判定 (= patch validation 用)。
fn is_known_shipping_method_id(id: &str) -> bool {
    crate::repos::shipping_methods::has_method(id)
}

// ──────────────────────────────────────────────────────────────────────
// リクエスト / レスポンス DTO
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatchShippingFieldRequest {
    /// この field の新しい値。空文字 ("") も許容 (= 「クリア」操作)。
    /// 過剰に長い値は 400 (DoS 対策)。
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchShippingFieldResponse {
    /// 設定後の value (= echo back)。サーバ側 trim 等を将来掛ける時の正規化結果が見えるよう。
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatchShippingMethodRequest {
    /// SHIPPING_METHODS の id のいずれか (= "cold" / "normal")。未知 id は 400。
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchShippingMethodResponse {
    pub id: String,
}

// ──────────────────────────────────────────────────────────────────────
// ハンドラ
// ──────────────────────────────────────────────────────────────────────

/// 1 フィールドあたりの最大長 (DoS 対策 + UI 上も 200 文字超は無意味)。
const MAX_FIELD_LEN: usize = 200;

/// `PATCH /api/v1/checkout/shipping_field/{name}` — 配送先 1 フィールドを更新。
pub async fn patch_shipping_field(
    Path(name): Path<String>,
    Json(req): Json<PatchShippingFieldRequest>,
) -> Result<Json<PatchShippingFieldResponse>, AppError> {
    if !ALLOWED_FIELDS.contains(&name.as_str()) {
        return Err(AppError::BadRequest(format!("unknown field: {name}")));
    }
    if req.value.chars().count() > MAX_FIELD_LEN {
        return Err(AppError::BadRequest(format!(
            "value exceeds {MAX_FIELD_LEN} chars"
        )));
    }

    let mut store = checkout_store()
        .lock()
        .expect("checkout store mutex poisoned");
    match name.as_str() {
        "addressName" => store.address_name = req.value.clone(),
        "addressTel" => store.address_tel = req.value.clone(),
        "addressZip" => store.address_zip = req.value.clone(),
        "addressPref" => store.address_pref = req.value.clone(),
        "addressAddr" => store.address_addr = req.value.clone(),
        // ALLOWED_FIELDS で先に弾いているのでここには来ない (= unreachable! でも良いが
        // 防御的に 400 を返しておく)。
        _ => return Err(AppError::BadRequest(format!("unknown field: {name}"))),
    }

    Ok(Json(PatchShippingFieldResponse { value: req.value }))
}

/// `PATCH /api/v1/checkout/shipping_method` — 配送方法を切り替え。
pub async fn patch_shipping_method(
    Json(req): Json<PatchShippingMethodRequest>,
) -> Result<Json<PatchShippingMethodResponse>, AppError> {
    if !is_known_shipping_method_id(&req.id) {
        return Err(AppError::BadRequest(format!(
            "unknown shipping method id: {}",
            req.id
        )));
    }

    let mut store = checkout_store()
        .lock()
        .expect("checkout store mutex poisoned");
    store.shipping_method_id = req.id.clone();

    Ok(Json(PatchShippingMethodResponse { id: req.id }))
}

/// 任意で全 state を確認したい時の GET (Phase 8: テスト + デバッグ用)。
/// SDUI 契約上は cart card の中で配送先も返るのでクライアントは普通使わない。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSnapshotResponse {
    pub address_name: String,
    pub address_tel: String,
    pub address_zip: String,
    pub address_pref: String,
    pub address_addr: String,
    pub shipping_method_id: String,
}

pub async fn get_checkout_snapshot() -> Result<Json<CheckoutSnapshotResponse>, AppError> {
    let snap = snapshot_checkout();
    Ok(Json(CheckoutSnapshotResponse {
        address_name: snap.address_name,
        address_tel: snap.address_tel,
        address_zip: snap.address_zip,
        address_pref: snap.address_pref,
        address_addr: snap.address_addr,
        shipping_method_id: snap.shipping_method_id,
    }))
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/v1/checkout/submit (Phase 9.1 / Stripe3)
//
// cart snapshot + checkout state を読み、
//   1. Validate (cart 非空 / shipping 必須項目埋まり / qty 範囲 / 値段 >=0)
//   2. orders / order_items / shipping_addresses に INSERT (= repos::orders)
//   3. Stripe Checkout Session を作成 (= stripe::CheckoutProvider, MVP は mock)
//   4. orders.stripe_session_id を更新 (mock の場合は INSERT 時に直接書く)
//   5. JSON `{ orderId, sessionUrl }` を返す
//
// レスポンス JSON は client (CtaBlockView の stripe_checkout 分岐) が
// `window.location.href = sessionUrl` で遷移する前提。
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSubmitResponse {
    pub order_id: String,
    pub session_url: String,
}

/// `POST /api/v1/checkout/submit` — 注文を確定し Stripe Checkout Session URL を返す。
///
/// **Phase 9.x AppState 配線**:
///   `axum::extract::State<AppState>` 経由で `Option<PgPool>` を受け取り、
///   - `repos::products::find_by_public_id(pool, ...)` で product_uuid 解決
///   - `repos::orders::insert_order(pool, ...)` で DB に永続化
///   どちらも pool 不在時は in-memory fallback。
///
/// **Session 配線** (= Cookie middleware 導入後):
///   `axum::Extension<SessionId>` 経由で cookie 由来の UUID を受け取り、
///   `orders.session_id` (= TEXT) と Stripe Session の reference に詰める。
///   未ログイン (= anonymous) でも cookie で安定した UUID を持つので、同一ユーザの
///   複数 cart → 注文の追跡が可能になる。
pub async fn post_checkout_submit(
    axum::extract::State(state): axum::extract::State<crate::state::AppState>,
    axum::Extension(session_id): axum::Extension<crate::session::SessionId>,
) -> Result<Json<CheckoutSubmitResponse>, AppError> {
    use crate::handlers::cards::{is_shipping_complete, product_filter_meta};
    use crate::handlers::cart::snapshot_cart;
    use crate::repos::orders::{
        OrderInsertRequest, OrderLineInsert, ShippingAddressInsert, insert_order,
    };
    use crate::repos::products;
    use crate::stripe::{CheckoutLineItem, CheckoutProvider, CheckoutSessionRequest};

    // ── 1. Validate cart ──────────────────────────────────────────
    let cart = snapshot_cart();
    if cart.is_empty() {
        return Err(AppError::BadRequest("cart is empty".to_string()));
    }

    // ── 2. Validate shipping ───────────────────────────────────────
    let checkout = snapshot_checkout();
    if !is_shipping_complete(&checkout) {
        return Err(AppError::BadRequest(
            "shipping address is incomplete".to_string(),
        ));
    }

    // ── 3. cart entries → order line items + Stripe LineItem 並列構築 ──
    let meta = product_filter_meta();
    let mut order_lines: Vec<OrderLineInsert> = Vec::with_capacity(cart.len());
    let mut stripe_lines: Vec<CheckoutLineItem> = Vec::with_capacity(cart.len());
    let mut subtotal_jpy: i64 = 0;

    for (_token, entry) in &cart {
        let m = meta.get(entry.product_id.as_str()).ok_or_else(|| {
            AppError::BadRequest(format!("unknown product in cart: {}", entry.product_id))
        })?;
        let unit_price_jpy: i64 = m.price_yen as i64;
        let qty = entry.qty;
        if qty == 0 {
            return Err(AppError::BadRequest(format!(
                "cart entry has qty=0 for {}",
                entry.product_id
            )));
        }
        let line_subtotal: i64 = unit_price_jpy * qty as i64;
        subtotal_jpy += line_subtotal;

        // Phase 9.F: pool が AppState 経由で来ているので products テーブルから
        //   public_id → UUID を解決する。pool 不在 (in-memory fallback) の場合は
        //   毎回ランダム UUID が返る性質があるため None に倒し、DB INSERT 時に
        //   product_uuid を NULL にしておく (= product_id TEXT で履歴は保たれる)。
        let product_uuid = if state.db().is_some() {
            match products::find_by_public_id(state.db(), &entry.product_id).await {
                Ok(Some(p)) => Some(p.row.id),
                _ => None,
            }
        } else {
            None
        };

        order_lines.push(OrderLineInsert {
            product_id: entry.product_id.clone(),
            product_uuid,
            title: m.title.to_string(),
            unit_price_jpy,
            qty,
            subtotal_jpy: line_subtotal,
        });
        stripe_lines.push(CheckoutLineItem {
            product_id: entry.product_id.clone(),
            title: m.title.to_string(),
            unit_price_jpy,
            qty,
        });
    }

    // ── 4. Shipping fee ───────────────────────────────────────────
    let shipping_jpy = shipping_amount_for(&checkout.shipping_method_id);
    let total_amount_jpy: i64 = subtotal_jpy + shipping_jpy;

    // ── 5. Stripe Session 作成 (mock) ──────────────────────────────
    // INSERT 前に order_id を発行する必要があるが、mock provider は session id
    // を `cs_mock_<order_id>` として作る → 先に Uuid を生成してから INSERT で
    // stripe_session_id を埋める。
    let order_id = uuid::Uuid::new_v4();
    // Cookie 由来の安定 UUID を session 識別子として使う (= 旧 hardcoded "anonymous" 撤去)。
    let session_id_str = session_id.0.to_string();
    let provider = CheckoutProvider::from_env();
    let session = provider
        .create_session(CheckoutSessionRequest {
            order_id,
            session_id: session_id_str.clone(),
            line_items: stripe_lines,
            shipping_jpy,
            success_url: "/checkout/success".to_string(),
            cancel_url: "/checkout/cancel".to_string(),
        })
        .await
        .map_err(|e| AppError::BadRequest(format!("stripe session: {e}")))?;

    // ── 6. orders / order_items / shipping_addresses INSERT ────────
    // Phase 9.x AppState 配線: pool が `Some` なら DB トランザクションで永続化、
    // `None` なら in-memory fallback。テストや DB 切れ時もそのまま動く。
    let _record = insert_order(
        state.db(),
        OrderInsertRequest {
            session_id: session_id_str,
            stripe_session_id: Some(session.stripe_session_id.clone()),
            amount_jpy: total_amount_jpy,
            shipping_jpy: Some(shipping_jpy),
            line_items: order_lines,
            shipping_address: ShippingAddressInsert {
                address_name: checkout.address_name.clone(),
                address_tel: checkout.address_tel.clone(),
                address_zip: checkout.address_zip.clone(),
                address_pref: checkout.address_pref.clone(),
                address_addr: checkout.address_addr.clone(),
                shipping_method_id: checkout.shipping_method_id.clone(),
            },
        },
    )
    .await
    .map_err(|e| AppError::BadRequest(format!("order insert: {e}")))?;

    // ── 7. Response ──────────────────────────────────────────────
    Ok(Json(CheckoutSubmitResponse {
        order_id: order_id.to_string(),
        session_url: session.session_url,
    }))
}

/// テスト専用: store をデフォルトにリセット。
#[cfg(test)]
pub(crate) fn reset_checkout_for_test() {
    let mut store = checkout_store()
        .lock()
        .expect("checkout store mutex poisoned");
    *store = CheckoutState::default();
}

// ──────────────────────────────────────────────────────────────────────
// テスト
// ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// **重要**: テストはグローバル checkout_store を触るので、
    /// reset_checkout_for_test() + GUARD で逐次化する。
    use std::sync::Mutex as StdMutex;
    static GUARD: StdMutex<()> = StdMutex::new(());

    #[tokio::test]
    async fn patch_field_updates_store() {
        let _g = GUARD.lock().unwrap();
        reset_checkout_for_test();

        let res = patch_shipping_field(
            Path("addressName".to_string()),
            Json(PatchShippingFieldRequest {
                value: "山田 徹".to_string(),
            }),
        )
        .await
        .expect("patch ok");
        assert_eq!(res.0.value, "山田 徹");

        let snap = snapshot_checkout();
        assert_eq!(snap.address_name, "山田 徹");
    }

    #[tokio::test]
    async fn patch_field_unknown_name_is_400() {
        let _g = GUARD.lock().unwrap();
        reset_checkout_for_test();
        match patch_shipping_field(
            Path("hackKey".to_string()),
            Json(PatchShippingFieldRequest {
                value: "x".to_string(),
            }),
        )
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn patch_field_too_long_value_is_400() {
        let _g = GUARD.lock().unwrap();
        reset_checkout_for_test();
        let long = "a".repeat(MAX_FIELD_LEN + 1);
        match patch_shipping_field(
            Path("addressName".to_string()),
            Json(PatchShippingFieldRequest { value: long }),
        )
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn patch_field_empty_value_clears() {
        let _g = GUARD.lock().unwrap();
        reset_checkout_for_test();
        // まず値を入れて → 空で上書き → 空文字で残ること
        patch_shipping_field(
            Path("addressTel".to_string()),
            Json(PatchShippingFieldRequest {
                value: "080-0000-0000".to_string(),
            }),
        )
        .await
        .unwrap();
        patch_shipping_field(
            Path("addressTel".to_string()),
            Json(PatchShippingFieldRequest {
                value: String::new(),
            }),
        )
        .await
        .unwrap();
        let snap = snapshot_checkout();
        assert_eq!(snap.address_tel, "");
    }

    #[tokio::test]
    async fn patch_method_updates_store() {
        let _g = GUARD.lock().unwrap();
        reset_checkout_for_test();
        let res = patch_shipping_method(Json(PatchShippingMethodRequest {
            id: "normal".to_string(),
        }))
        .await
        .expect("patch ok");
        assert_eq!(res.0.id, "normal");
        assert_eq!(snapshot_checkout().shipping_method_id, "normal");
    }

    #[tokio::test]
    async fn patch_method_unknown_id_is_400() {
        let _g = GUARD.lock().unwrap();
        reset_checkout_for_test();
        match patch_shipping_method(Json(PatchShippingMethodRequest {
            id: "rocket".to_string(),
        }))
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn default_state_has_cold_method_and_empty_fields() {
        let _g = GUARD.lock().unwrap();
        reset_checkout_for_test();
        let snap = snapshot_checkout();
        assert_eq!(snap.shipping_method_id, "cold");
        assert_eq!(snap.address_name, "");
        assert_eq!(snap.address_tel, "");
    }

    #[test]
    fn shipping_amount_for_known_ids() {
        assert_eq!(shipping_amount_for("cold"), 1800);
        assert_eq!(shipping_amount_for("normal"), 800);
    }

    #[test]
    fn shipping_amount_for_unknown_falls_back_to_default() {
        // 未知 id は default ("cold") の amount にフォールバック
        assert_eq!(shipping_amount_for("rocket"), 1800);
    }

    #[test]
    fn allowed_fields_match_state_fields() {
        // ALLOWED_FIELDS を将来増やす時に State に反映し忘れない安全網
        let mut state = CheckoutState::default();
        for f in ALLOWED_FIELDS {
            // 全 allowed field に "x" を書き込んで snapshot で "x" が見えることを確認
            match *f {
                "addressName" => state.address_name = "x".to_string(),
                "addressTel" => state.address_tel = "x".to_string(),
                "addressZip" => state.address_zip = "x".to_string(),
                "addressPref" => state.address_pref = "x".to_string(),
                "addressAddr" => state.address_addr = "x".to_string(),
                other => panic!("ALLOWED_FIELDS contains unknown name: {other}"),
            }
        }
        // 全部書き込めたら全 field が "x"
        assert_eq!(state.address_name, "x");
        assert_eq!(state.address_tel, "x");
        assert_eq!(state.address_zip, "x");
        assert_eq!(state.address_pref, "x");
        assert_eq!(state.address_addr, "x");
    }

    #[test]
    fn patch_field_request_deserializes_camel_case() {
        let json = r#"{"value":"hello"}"#;
        let req: PatchShippingFieldRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.value, "hello");
    }

    #[test]
    fn patch_method_request_deserializes_camel_case() {
        let json = r#"{"id":"normal"}"#;
        let req: PatchShippingMethodRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.id, "normal");
    }

    #[tokio::test]
    async fn snapshot_endpoint_serializes_camel_case() {
        let _g = GUARD.lock().unwrap();
        reset_checkout_for_test();
        // 1 件 patch しておいて GET で読み戻し
        patch_shipping_field(
            Path("addressName".to_string()),
            Json(PatchShippingFieldRequest {
                value: "テスト 太郎".to_string(),
            }),
        )
        .await
        .unwrap();
        let res = get_checkout_snapshot().await.unwrap();
        let json = serde_json::to_string(&res.0).unwrap();
        assert!(json.contains(r#""addressName":"テスト 太郎""#), "{json}");
        assert!(json.contains(r#""shippingMethodId":"cold""#), "{json}");
    }
}
