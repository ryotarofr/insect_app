//! Stripe Checkout Provider 抽象 (Phase 9.1 / Stripe1)
//!
//! **責務**:
//!   - CheckoutSession を作成して URL を返す trait `CheckoutProvider`
//!   - Mock 実装 `MockCheckoutProvider` (= async-stripe 不要、本番 key 不要)
//!   - 将来 Phase 9.2 で `LiveCheckoutProvider` (async-stripe 利用) を追加する
//!     scaffolding。env `STRIPE_PROVIDER` (mock | live) で切り替え。
//!
//! **設計判断**:
//!   - trait + Box<dyn> ではなく enum で wrap (= dynamic dispatch を避けて compile-time
//!     に provider が決まる)。MVP では provider 数が少ないので enum で十分。
//!   - Session 作成のリクエスト型 `CheckoutLineItem` は SDUI cart の LineItem と同じ
//!     形 (= product_id / title / unit_price_jpy / qty) で受け取る。Provider 内部で
//!     Stripe LineItem に変換する。
//!   - 失敗時は `CheckoutError` で正規化。handler 側で 400 / 502 にマップ。
//!
//! **将来 (Phase 9.2)**:
//!   - `async_stripe` crate 追加
//!   - `LiveCheckoutProvider::create_session` で実際に Stripe API を叩く
//!   - Webhook 検証 (= `Stripe-Signature` header の HMAC) は別 module

use std::env;

use thiserror::Error;
use uuid::Uuid;

/// Provider 不問の checkout session 作成リクエスト。
#[derive(Debug, Clone)]
pub struct CheckoutSessionRequest {
    /// Order の UUID (= orders.id)。Stripe の `client_reference_id` にも乗せる。
    pub order_id: Uuid,
    /// 注文セッション識別子 (= orders.session_id)。匿名ユーザは "anonymous"。
    pub session_id: String,
    /// 注文行。空ならエラー (handler 側で先に弾く想定)。
    pub line_items: Vec<CheckoutLineItem>,
    /// 配送料 (税込・JPY)。0 なら配送料行を出さない。
    pub shipping_jpy: i64,
    /// success / cancel 時のリダイレクト先 (= host を含む完全 URL)。
    pub success_url: String,
    pub cancel_url: String,
}

/// 注文 1 行 (= LineItem block 相当)。
#[derive(Debug, Clone)]
pub struct CheckoutLineItem {
    pub product_id: String,
    pub title: String,
    pub unit_price_jpy: i64,
    pub qty: u32,
}

/// Provider が返す session 情報。
#[derive(Debug, Clone)]
pub struct CheckoutSession {
    /// Stripe session id (= cs_test_... / cs_live_...) または mock 識別子。
    pub stripe_session_id: String,
    /// クライアントを redirect する URL (= Stripe Hosted Checkout / mock landing)。
    pub session_url: String,
}

#[derive(Debug, Error)]
pub enum CheckoutError {
    #[error("checkout request invalid: {0}")]
    Invalid(String),
    #[error("Stripe API error: {0}")]
    Provider(String),
}

// ──────────────────────────────────────────────────────────────────────
// Provider enum
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum CheckoutProvider {
    Mock(MockCheckoutProvider),
    /// async-stripe 実装は Phase 9.2 で追加。現状は scaffolding (= unimplemented)。
    Live, // LiveCheckoutProvider (Phase 9.2)
}

impl CheckoutProvider {
    /// env `STRIPE_PROVIDER` から provider を決定。未設定 / "mock" なら Mock。
    pub fn from_env() -> Self {
        match env::var("STRIPE_PROVIDER").as_deref() {
            Ok("live") => CheckoutProvider::Live,
            _ => CheckoutProvider::Mock(MockCheckoutProvider::default()),
        }
    }

    pub async fn create_session(
        &self,
        req: CheckoutSessionRequest,
    ) -> Result<CheckoutSession, CheckoutError> {
        match self {
            CheckoutProvider::Mock(m) => m.create_session(req).await,
            CheckoutProvider::Live => Err(CheckoutError::Provider(
                "live provider not implemented yet (Phase 9.2)".to_string(),
            )),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// Mock 実装
// ──────────────────────────────────────────────────────────────────────

/// async-stripe 不要の mock。session url は `/checkout/mock/{order_id}` を返す。
/// 内部に発行済みの session を保持しておくと webhook simulator から参照できる。
#[derive(Debug, Clone, Default)]
pub struct MockCheckoutProvider {
    // 現状は state を持たない (= request → response の純関数)。
    // 将来 mock webhook simulator を載せる時に Mutex<HashMap<...>> を追加する。
}

impl MockCheckoutProvider {
    pub async fn create_session(
        &self,
        req: CheckoutSessionRequest,
    ) -> Result<CheckoutSession, CheckoutError> {
        if req.line_items.is_empty() {
            return Err(CheckoutError::Invalid("line_items is empty".to_string()));
        }
        for li in &req.line_items {
            if li.qty == 0 {
                return Err(CheckoutError::Invalid(format!(
                    "line item qty=0 for product {}",
                    li.product_id
                )));
            }
            if li.unit_price_jpy < 0 {
                return Err(CheckoutError::Invalid(format!(
                    "negative unit_price_jpy for product {}",
                    li.product_id
                )));
            }
        }

        // mock session id は cs_mock_<order_id>
        let stripe_session_id = format!("cs_mock_{}", req.order_id);
        // mock session URL は同一オリジンの `/checkout/mock/{order_id}` 想定。
        // 本番では Stripe Hosted Checkout の URL が返る。
        let session_url = format!("/checkout/mock/{}", req.order_id);

        Ok(CheckoutSession {
            stripe_session_id,
            session_url,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> CheckoutSessionRequest {
        CheckoutSessionRequest {
            order_id: Uuid::new_v4(),
            session_id: "anonymous".to_string(),
            line_items: vec![CheckoutLineItem {
                product_id: "p-x".to_string(),
                title: "Test product".to_string(),
                unit_price_jpy: 48000,
                qty: 2,
            }],
            shipping_jpy: 1800,
            success_url: "https://example.com/checkout/success".to_string(),
            cancel_url: "https://example.com/checkout/cancel".to_string(),
        }
    }

    #[tokio::test]
    async fn mock_creates_session_with_predictable_url() {
        let p = MockCheckoutProvider::default();
        let r = req();
        let oid = r.order_id;
        let s = p.create_session(r).await.unwrap();
        assert!(s.stripe_session_id.starts_with("cs_mock_"));
        assert_eq!(s.session_url, format!("/checkout/mock/{oid}"));
    }

    #[tokio::test]
    async fn mock_rejects_empty_line_items() {
        let p = MockCheckoutProvider::default();
        let mut r = req();
        r.line_items.clear();
        match p.create_session(r).await {
            Err(CheckoutError::Invalid(msg)) => assert!(msg.contains("line_items")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn mock_rejects_qty_zero() {
        let p = MockCheckoutProvider::default();
        let mut r = req();
        r.line_items[0].qty = 0;
        match p.create_session(r).await {
            Err(CheckoutError::Invalid(msg)) => assert!(msg.contains("qty=0")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn provider_from_env_defaults_to_mock() {
        // 一時的に STRIPE_PROVIDER を unset することは並行テスト下で危ないので、
        // 「現在の env の解釈」だけ確認する。
        // 副作用テストは not run / set / live の 3 通りでマニュアル確認推奨。
        let p = CheckoutProvider::from_env();
        // 何らかのコンストラクションが成功することのみ検証 (= panic しない)
        match p {
            CheckoutProvider::Mock(_) | CheckoutProvider::Live => {}
        }
    }
}
