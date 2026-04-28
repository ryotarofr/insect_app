//! `POST /api/v1/stripe/webhook` (Phase 9.1 / Stripe7)
//!
//! Stripe からの webhook を受け取って orders.status を更新する。
//!
//! **Phase 9.1 (現状)**:
//!   - mock provider 用に「テストから直接 trigger できる JSON body」だけ受け付ける
//!     (= async-stripe の `stripe::Event` を deserialize しない)。
//!   - HMAC 検証 (`Stripe-Signature` header) は **scaffolding のみ**。env の
//!     `STRIPE_WEBHOOK_SECRET` が空なら検証スキップ、Some なら HMAC-SHA256 を計算。
//!     mock では空のままで OK。
//!   - 受信 event_type を見て orders.status を遷移:
//!       checkout.session.completed → paid
//!       payment_intent.payment_failed → failed
//!       checkout.session.expired → canceled
//!     未知 event_type は 200 で no-op (= Stripe は 2xx を期待)。
//!
//! **Phase 9.2 (将来)**:
//!   - `async_stripe::Webhook::construct_event` で正規の検証 + parse に切り替え
//!   - Idempotency: 同じ event_id を 2 回受信した時に 1 回だけ処理する store を追加
//!   - Dead-letter queue: 処理失敗時に SQS / DLQ に詰む
//!
//! **冪等性 (idempotency)**:
//!   現状の `update_status_db` は `WHERE id = $1` で 1 行だけ更新する。
//!   同じ event を 2 回受け取っても結果は同じ (= status が paid → paid に上書き)。
//!   ただし「pending → paid → failed」のような誤遷移は防げないので、Phase 9.2 で
//!   `WHERE id = $1 AND status NOT IN ('paid', 'canceled')` を追加する想定。

use axum::{
    body::Bytes,
    http::{HeaderMap, StatusCode},
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::orders;

type HmacSha256 = Hmac<Sha256>;

/// 環境変数 `STRIPE_WEBHOOK_SECRET` が設定されていれば、その値で HMAC 検証を有効化する。
/// 未設定なら検証スキップ (= dev / test モード)。
fn webhook_secret() -> Option<String> {
    std::env::var("STRIPE_WEBHOOK_SECRET").ok().filter(|s| !s.is_empty())
}

/// Stripe-Signature ヘッダから v1=<hex> 部分を抽出する。
/// 形式: `t=<timestamp>,v1=<hex>,v0=<old>` (= comma 区切り key=value)。
fn extract_v1(sig_header: &str) -> Option<&str> {
    sig_header.split(',').find_map(|piece| {
        piece.trim().strip_prefix("v1=")
    })
}

/// Stripe-Signature ヘッダから `t=<unix>` を抽出して i64 に parse。
/// replay protection で `|now() - t|` を計算するために使う。
fn extract_timestamp(sig_header: &str) -> Option<i64> {
    sig_header
        .split(',')
        .find_map(|piece| piece.trim().strip_prefix("t="))
        .and_then(|s| s.parse::<i64>().ok())
}

/// 許容時間幅 (= 5 分 / 300 秒) を default にし、`KOCHU_STRIPE_TOLERANCE_SEC` env で上書き可。
/// dev で長く (= 数時間) / prod で 5 分 / 厳格運用なら 30 秒、と環境ごとに調整する余地を残す。
fn tolerance_seconds() -> i64 {
    std::env::var("KOCHU_STRIPE_TOLERANCE_SEC")
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(300)
}

/// raw body と secret から HMAC-SHA256 hex を計算する。
fn compute_hmac_hex(secret: &str, body: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts arbitrary key length");
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

/// HMAC-SHA256 を hex で計算し、一定時間比較で照合する。secret が未設定なら Ok (= 検証スキップ)。
///
/// **timing attack 対策**: `subtle::ConstantTimeEq` で hex 文字列の byte 単位定数時間比較。
/// **replay 対策**: `t=<unix>` が現在時刻 ± `tolerance_seconds()` 以内であることを要求。
///   昔受信した正当なペイロードを後から re-POST されても、t が古ければ通らない。
fn verify_signature(headers: &HeaderMap, body: &[u8]) -> Result<(), AppError> {
    let secret = match webhook_secret() {
        Some(s) => s,
        // env 未設定 → scaffolding mode (= dev / test) で検証スキップ
        None => return Ok(()),
    };
    use subtle::ConstantTimeEq;

    let sig_header = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized)?;
    let provided_hex = extract_v1(sig_header).ok_or(AppError::Unauthorized)?;

    // ── timestamp tolerance window ────────────────────────────────
    // `t` が無い / 未来過去どちらでも tolerance を超えると 401。
    // env `KOCHU_STRIPE_TOLERANCE_SEC` で窓幅を上書き可能。
    let t = extract_timestamp(sig_header).ok_or(AppError::Unauthorized)?;
    let now = chrono::Utc::now().timestamp();
    let drift = (now - t).abs();
    if drift > tolerance_seconds() {
        tracing::warn!(
            "stripe webhook: timestamp drift {drift}s exceeds tolerance (t={t}, now={now})"
        );
        return Err(AppError::Unauthorized);
    }

    let expected_hex = compute_hmac_hex(&secret, body);
    if expected_hex.as_bytes().ct_eq(provided_hex.as_bytes()).into() {
        Ok(())
    } else {
        Err(AppError::Unauthorized)
    }
}

/// Mock 用の webhook body。`type` に応じて orders.status を遷移する。
/// 本番では Stripe SDK が解釈する raw body をそのまま受けて検証する。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MockStripeEvent {
    /// Stripe の event id (= "evt_xxx" / mock の "evt_test_xxx")。冪等性キーとして使う。
    pub id: String,
    /// 例: "checkout.session.completed" / "payment_intent.payment_failed"。
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: MockStripeEventData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MockStripeEventData {
    pub object: MockStripeObject,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockStripeObject {
    /// Stripe Checkout Session の id (= cs_mock_<order_id>) または cs_test_xxx。
    pub id: Option<String>,
    /// 注文 UUID。mock event を作る時に直接入れる前提。本番では client_reference_id。
    pub client_reference_id: Option<String>,
    /// Stripe PaymentIntent の id (= pi_xxx)。payment_intent.payment_failed 等で乗る。
    pub payment_intent: Option<String>,
}

pub async fn post_stripe_webhook(
    axum::extract::State(state): axum::extract::State<crate::state::AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    // ── 0. HMAC-SHA256 検証 (= STRIPE_WEBHOOK_SECRET 設定時のみ) ──
    // production: env var を必ず設定し、Stripe Dashboard で発行される webhook secret を使う。
    // dev / mock: env var 未設定なら verify_signature は Ok を返す (= scaffolding mode)。
    verify_signature(&headers, &body)?;

    // ── 1. body を MockStripeEvent として deserialize ─────────────
    let event: MockStripeEvent = serde_json::from_slice(&body).map_err(|e| {
        AppError::BadRequest(format!("invalid stripe event body: {e}"))
    })?;

    // ── 1.5. event_id 冪等性: 既に受信済なら 200 で no-op ──────────
    // Stripe の retry (= 5xx / timeout) で同じ event が複数届く可能性があるため、
    // event_id を一度限りに固定する。ここで通った後の処理は side effect 込みで一度だけ実行。
    let payload_value: serde_json::Value =
        serde_json::from_slice(&body).unwrap_or_else(|_| serde_json::json!({}));
    let outcome = crate::repos::stripe_webhook_events::record_if_new(
        state.db(),
        &event.id,
        &event.event_type,
        &payload_value,
    )
    .await
    .map_err(|e| AppError::BadRequest(format!("idempotency record: {e}")))?;
    if matches!(
        outcome,
        crate::repos::stripe_webhook_events::RecordOutcome::AlreadySeen
    ) {
        tracing::info!(
            "stripe webhook: duplicate event {} (type={}), skipping",
            event.id,
            event.event_type
        );
        return Ok(StatusCode::OK);
    }

    // ── event_type に応じて status 遷移 ──────────────────────────
    let new_status: &str = match event.event_type.as_str() {
        "checkout.session.completed" => "paid",
        "payment_intent.payment_failed" => "failed",
        "checkout.session.expired" => "canceled",
        // 未知 event_type は 200 で no-op (= Stripe 仕様: 2xx で ack 要)
        _ => {
            tracing::debug!("ignoring stripe event_type: {}", event.event_type);
            return Ok(StatusCode::OK);
        }
    };

    // ── 対象 order を特定 ─────────────────────────────────────────
    // 優先順位: client_reference_id (= UUID 直指定) > id (= cs_xxx) で stripe_session_id 検索
    let order_id_opt: Option<Uuid> = event
        .data
        .object
        .client_reference_id
        .as_deref()
        .and_then(|s| Uuid::parse_str(s).ok());

    let order = if let Some(oid) = order_id_opt {
        // 直接 id 指定 → status 更新するだけ
        Some(oid)
    } else if let Some(sid) = event.data.object.id.as_deref() {
        // cs_xxx 経由で order を引く (Phase 9.x: AppState 経由で pool 利用 / 不在時 in-memory)
        match orders::find_by_stripe_session_id(state.db(), sid).await {
            Ok(Some(rec)) => Some(rec.id),
            Ok(None) => {
                tracing::warn!("stripe webhook: no order found for session_id={}", sid);
                None
            }
            Err(e) => {
                tracing::error!("stripe webhook lookup error: {}", e);
                // review fix (major): idempotency マーカーを取り消して retry を許す
                // (この event は side effect を 1 つも起こしていないため安全)。
                if let Err(rollback_err) =
                    crate::repos::stripe_webhook_events::delete_by_id(state.db(), &event.id).await
                {
                    tracing::warn!(
                        "stripe webhook: idempotency rollback failed for event {}: {}",
                        event.id,
                        rollback_err
                    );
                }
                return Err(AppError::Internal(anyhow::anyhow!(
                    "lookup error: {e}"
                )));
            }
        }
    } else {
        None
    };

    let Some(order_id) = order else {
        // 対象注文が見つからない → 200 で no-op (= Stripe に retry させない)
        // 既に削除された注文 / 別 environment への漏れ込みケースを想定。
        tracing::warn!(
            "stripe webhook: order not identifiable (event_type={})",
            event.event_type
        );
        return Ok(StatusCode::OK);
    };

    // ── status 更新 ──────────────────────────────────────────────
    //
    // review fix (major): record_if_new と update_status は別経路で実行されるため、
    // ここで失敗したまま 5xx を返すと、idempotency マーカーは残っているのに
    // status は古いまま、という stuck 状態になる。Stripe の retry はマーカーで
    // 弾かれて永久に paid に遷移しなくなる。
    //
    // 真のトランザクション境界は repo の TX 化が必要 (= 別 PR)。
    // ここでは best-effort で idempotency レコードを取り消し、Stripe retry が
    // 再処理できるようにする。delete_by_id 失敗は warn だけで握りつぶす
    // (= 元の update_status エラーを優先して 5xx で返す)。
    let pi = event.data.object.payment_intent.as_deref();
    if let Err(e) = orders::update_status(state.db(), order_id, new_status, pi).await {
        tracing::error!(
            "stripe webhook: update_status failed for order {} (event {}): {}",
            order_id,
            event.id,
            e
        );
        if let Err(rollback_err) =
            crate::repos::stripe_webhook_events::delete_by_id(state.db(), &event.id).await
        {
            tracing::warn!(
                "stripe webhook: idempotency rollback failed for event {}: {} (order {} may be stuck)",
                event.id,
                rollback_err,
                order_id
            );
        }
        return Err(AppError::Internal(anyhow::anyhow!(
            "update_status failed: {e}"
        )));
    }

    // ── K1: paid 遷移時のみ live 商品の specimens を自動生成 (Week 1) ──
    // 行レベル冪等性 (= order_items.fulfilled_specimen_id IS NULL ガード) で重複生成を防止。
    // 失敗時は idempotency キャッシュを rollback して Stripe retry に任せる。
    if new_status == "paid"
        && let Err(e) =
            crate::handlers::specimen_fulfillment::fulfill_paid_order(&state, order_id).await
    {
        tracing::error!(
            "stripe webhook: fulfill_paid_order failed for order {} (event {}): {}",
            order_id,
            event.id,
            e
        );
        if let Err(rollback_err) =
            crate::repos::stripe_webhook_events::delete_by_id(state.db(), &event.id).await
        {
            tracing::warn!(
                "stripe webhook: idempotency rollback failed for event {}: {}",
                event.id,
                rollback_err
            );
        }
        return Err(AppError::Internal(anyhow::anyhow!(
            "fulfillment failed: {e}"
        )));
    }

    tracing::info!(
        "stripe webhook: order {} → {} (event_type={})",
        order_id,
        new_status,
        event.event_type
    );
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;
    use crate::repos::orders::{
        OrderInsertRequest, OrderLineInsert, ShippingAddressInsert, insert_order, memory_guard,
        reset_memory_for_test,
    };
    use crate::state::AppState;

    /// テストでは pool 無しの AppState を使う (= in-memory fallback で動く)
    fn empty_state() -> State<AppState> {
        State(AppState::default())
    }

    /// 検証スキップを保証するため STRIPE_WEBHOOK_SECRET を unset しておく。
    /// 1 度のテスト run で env を弄るので並列で他テストに影響しないよう各 test 冒頭で呼ぶ。
    fn unset_webhook_secret() {
        // SAFETY: env mutation in tests is single-threaded under our memory_guard,
        // and this var isn't read on other threads concurrently.
        unsafe {
            std::env::remove_var("STRIPE_WEBHOOK_SECRET");
        }
    }

    /// MockStripeEvent と同じ形の JSON body を bytes で返す test helper。
    /// event_id は呼び出し側で指定 (= 冪等性テストで同じ id を 2 回送りたいため)。
    fn body_bytes(
        event_id: &str,
        event_type: &str,
        id: Option<&str>,
        client_reference_id: Option<&str>,
        payment_intent: Option<&str>,
    ) -> Bytes {
        let v = serde_json::json!({
            "id": event_id,
            "type": event_type,
            "data": {
                "object": {
                    "id": id,
                    "clientReferenceId": client_reference_id,
                    "paymentIntent": payment_intent,
                }
            }
        });
        Bytes::from(serde_json::to_vec(&v).unwrap())
    }

    /// 各テスト冒頭で stripe_webhook_events の in-memory store もクリアする。
    fn reset_idempotency() {
        crate::repos::stripe_webhook_events::reset_memory_for_test();
    }

    async fn seed_pending_order() -> uuid::Uuid {
        reset_memory_for_test();
        let rec = insert_order(
            None,
            OrderInsertRequest {
                session_id: "anonymous".to_string(),
                user_id: None,
                stripe_session_id: Some("cs_mock_test".to_string()),
                amount_jpy: 96000,
                shipping_jpy: Some(1800),
                line_items: vec![OrderLineInsert {
                    product_id: "p-x".to_string(),
                    product_uuid: None, // test fixture では UUID 解決スキップ
                    title: "Test".to_string(),
                    unit_price_jpy: 48000,
                    qty: 2,
                    subtotal_jpy: 96000,
                }],
                shipping_address: ShippingAddressInsert {
                    address_name: "Yamada".to_string(),
                    address_tel: "090".to_string(),
                    address_zip: "150".to_string(),
                    address_pref: "13".to_string(),
                    address_addr: "Shibuya".to_string(),
                    shipping_method_id: "cold".to_string(),
                },
            },
        )
        .await
        .unwrap();
        rec.id
    }

    #[tokio::test]
    async fn checkout_session_completed_marks_order_paid() {
        let _g = memory_guard();
        unset_webhook_secret();
        reset_idempotency();
        let order_id = seed_pending_order().await;
        let body = body_bytes(
            "evt_test_completed",
            "checkout.session.completed",
            Some("cs_mock_test"),
            Some(&order_id.to_string()),
            Some("pi_test_42"),
        );
        let res = post_stripe_webhook(empty_state(), HeaderMap::new(), body)
            .await
            .unwrap();
        assert_eq!(res, StatusCode::OK);

        let updated = orders::find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap()
            .expect("order should exist after seeding");
        assert_eq!(updated.status, "paid");
        assert_eq!(updated.stripe_payment_intent_id, Some("pi_test_42".to_string()));
    }

    #[tokio::test]
    async fn payment_failed_marks_order_failed() {
        let _g = memory_guard();
        unset_webhook_secret();
        reset_idempotency();
        let order_id = seed_pending_order().await;
        let body = body_bytes(
            "evt_test_failed",
            "payment_intent.payment_failed",
            Some("cs_mock_test"),
            Some(&order_id.to_string()),
            Some("pi_test_failed"),
        );
        post_stripe_webhook(empty_state(), HeaderMap::new(), body)
            .await
            .unwrap();

        let updated = orders::find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.status, "failed");
    }

    #[tokio::test]
    async fn unknown_event_type_is_no_op() {
        let _g = memory_guard();
        unset_webhook_secret();
        reset_idempotency();
        let _id = seed_pending_order().await;
        let body = body_bytes("evt_test_unknown", "customer.created", None, None, None);
        let res = post_stripe_webhook(empty_state(), HeaderMap::new(), body)
            .await
            .unwrap();
        assert_eq!(res, StatusCode::OK);

        // status は pending のまま
        let snap = orders::find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(snap.status, "pending");
    }

    #[tokio::test]
    async fn missing_order_returns_ok_no_op() {
        let _g = memory_guard();
        unset_webhook_secret();
        reset_idempotency();
        reset_memory_for_test();
        let body = body_bytes(
            "evt_test_missing",
            "checkout.session.completed",
            Some("cs_unknown"),
            None,
            None,
        );
        let res = post_stripe_webhook(empty_state(), HeaderMap::new(), body)
            .await
            .unwrap();
        // 注文不在でも 200 で no-op (= Stripe に retry させない)
        assert_eq!(res, StatusCode::OK);
    }

    /// 同じ event_id を 2 度送ると 2 回目は no-op (= 冪等性)。
    /// status が誤って巻き戻ったり PaymentIntent が二重書きされない。
    #[tokio::test]
    async fn duplicate_event_is_idempotent_no_op_on_second() {
        let _g = memory_guard();
        unset_webhook_secret();
        reset_idempotency();
        let order_id = seed_pending_order().await;

        let body1 = body_bytes(
            "evt_test_dup",
            "checkout.session.completed",
            Some("cs_mock_test"),
            Some(&order_id.to_string()),
            Some("pi_first"),
        );
        let res1 = post_stripe_webhook(empty_state(), HeaderMap::new(), body1)
            .await
            .unwrap();
        assert_eq!(res1, StatusCode::OK);

        // 1 回目で paid に遷移
        let after_1 = orders::find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after_1.status, "paid");
        assert_eq!(
            after_1.stripe_payment_intent_id,
            Some("pi_first".to_string())
        );

        // 同じ event_id で再送 (= payment_intent だけ違う body)
        let body2 = body_bytes(
            "evt_test_dup",
            "payment_intent.payment_failed",
            Some("cs_mock_test"),
            Some(&order_id.to_string()),
            Some("pi_should_be_ignored"),
        );
        let res2 = post_stripe_webhook(empty_state(), HeaderMap::new(), body2)
            .await
            .unwrap();
        assert_eq!(res2, StatusCode::OK);

        // 2 回目は no-op: status / payment_intent ともに 1 回目のまま
        let after_2 = orders::find_by_stripe_session_id(None, "cs_mock_test")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after_2.status, "paid", "重複 event は status を変えない");
        assert_eq!(
            after_2.stripe_payment_intent_id,
            Some("pi_first".to_string()),
            "重複 event の payment_intent は無視される"
        );
    }

    // ── HMAC 検証のテスト ─────────────────────────────────────────

    #[test]
    fn extract_v1_picks_v1_segment() {
        let h = "t=1700000000,v1=abc123,v0=old";
        assert_eq!(extract_v1(h), Some("abc123"));
    }

    #[test]
    fn extract_v1_returns_none_when_missing() {
        let h = "t=1700000000,v0=old";
        assert!(extract_v1(h).is_none());
    }

    #[test]
    fn compute_hmac_hex_matches_known_vector() {
        // 既知 vector で再計算が一意であることだけ確認 (= regression detection)。
        let a = compute_hmac_hex("secret", b"hello");
        let b = compute_hmac_hex("secret", b"hello");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64, "SHA-256 hex は 64 文字");
        let c = compute_hmac_hex("secret", b"hello!");
        assert_ne!(a, c, "1 文字違いで hash が変わる");
    }

    #[tokio::test]
    async fn verify_signature_skips_when_secret_unset() {
        let _g = memory_guard();
        unset_webhook_secret();
        // header 無し / 空 body でも env 未設定なら Ok
        let h = HeaderMap::new();
        verify_signature(&h, b"").expect("scaffolding mode skips verification");
    }

    /// 現在の unix timestamp を返す test helper。tolerance window 内に収まる。
    fn now_ts() -> i64 {
        chrono::Utc::now().timestamp()
    }

    #[tokio::test]
    async fn verify_signature_accepts_correct_signature() {
        let _g = memory_guard();
        unsafe {
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_test");
        }
        let body = b"payload";
        let hex = compute_hmac_hex("whsec_test", body);
        let mut h = HeaderMap::new();
        h.insert(
            "stripe-signature",
            format!("t={ts},v1={hex}", ts = now_ts()).parse().unwrap(),
        );
        verify_signature(&h, body).expect("正しい署名は通る");
        unset_webhook_secret();
    }

    #[tokio::test]
    async fn verify_signature_rejects_wrong_signature() {
        let _g = memory_guard();
        unsafe {
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_test");
        }
        let mut h = HeaderMap::new();
        h.insert(
            "stripe-signature",
            format!("t={ts},v1=deadbeef", ts = now_ts()).parse().unwrap(),
        );
        match verify_signature(&h, b"payload") {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
        unset_webhook_secret();
    }

    #[tokio::test]
    async fn verify_signature_rejects_missing_header() {
        let _g = memory_guard();
        unsafe {
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_test");
        }
        let h = HeaderMap::new();
        match verify_signature(&h, b"payload") {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized for missing header, got {other:?}"),
        }
        unset_webhook_secret();
    }

    // ── replay protection: timestamp tolerance window ────────────────

    #[test]
    fn extract_timestamp_parses_t_segment() {
        assert_eq!(
            extract_timestamp("t=1700000000,v1=abc"),
            Some(1700000000)
        );
        assert_eq!(extract_timestamp("v1=abc"), None);
        assert_eq!(extract_timestamp("t=notnum,v1=abc"), None);
    }

    #[test]
    fn tolerance_seconds_default_is_300() {
        unsafe {
            std::env::remove_var("KOCHU_STRIPE_TOLERANCE_SEC");
        }
        assert_eq!(tolerance_seconds(), 300);
    }

    #[test]
    fn tolerance_seconds_can_be_overridden_by_env() {
        unsafe {
            std::env::set_var("KOCHU_STRIPE_TOLERANCE_SEC", "30");
        }
        assert_eq!(tolerance_seconds(), 30);
        unsafe {
            std::env::remove_var("KOCHU_STRIPE_TOLERANCE_SEC");
        }
    }

    #[tokio::test]
    async fn verify_signature_rejects_too_old_timestamp() {
        let _g = memory_guard();
        unsafe {
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_test");
            std::env::remove_var("KOCHU_STRIPE_TOLERANCE_SEC");
        }
        let body = b"payload";
        let hex = compute_hmac_hex("whsec_test", body);
        // 10 分前 (= 600 秒前) は default の 300 秒を超える → reject
        let old_ts = now_ts() - 600;
        let mut h = HeaderMap::new();
        h.insert(
            "stripe-signature",
            format!("t={old_ts},v1={hex}").parse().unwrap(),
        );
        match verify_signature(&h, body) {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized for old timestamp, got {other:?}"),
        }
        unset_webhook_secret();
    }

    #[tokio::test]
    async fn verify_signature_rejects_far_future_timestamp() {
        let _g = memory_guard();
        unsafe {
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_test");
            std::env::remove_var("KOCHU_STRIPE_TOLERANCE_SEC");
        }
        let body = b"payload";
        let hex = compute_hmac_hex("whsec_test", body);
        // 10 分先 → reject
        let future_ts = now_ts() + 600;
        let mut h = HeaderMap::new();
        h.insert(
            "stripe-signature",
            format!("t={future_ts},v1={hex}").parse().unwrap(),
        );
        match verify_signature(&h, body) {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized for future timestamp, got {other:?}"),
        }
        unset_webhook_secret();
    }

    #[tokio::test]
    async fn verify_signature_rejects_missing_timestamp() {
        let _g = memory_guard();
        unsafe {
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_test");
        }
        let body = b"payload";
        let hex = compute_hmac_hex("whsec_test", body);
        // t= が無い header (= 古い stripe / 攻撃者の偽装) → reject
        let mut h = HeaderMap::new();
        h.insert("stripe-signature", format!("v1={hex}").parse().unwrap());
        match verify_signature(&h, body) {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized for missing t, got {other:?}"),
        }
        unset_webhook_secret();
    }

    #[tokio::test]
    async fn verify_signature_accepts_within_custom_tolerance() {
        let _g = memory_guard();
        unsafe {
            std::env::set_var("STRIPE_WEBHOOK_SECRET", "whsec_test");
            // 1 時間まで許容 (= dev 用に長めに広げる例)
            std::env::set_var("KOCHU_STRIPE_TOLERANCE_SEC", "3600");
        }
        let body = b"payload";
        let hex = compute_hmac_hex("whsec_test", body);
        // default 300 秒の境を越える 10 分前でも、env で 3600 まで広げれば通る
        let old_ts = now_ts() - 600;
        let mut h = HeaderMap::new();
        h.insert(
            "stripe-signature",
            format!("t={old_ts},v1={hex}").parse().unwrap(),
        );
        verify_signature(&h, body).expect("env で tolerance を広げれば通る");
        unsafe {
            std::env::remove_var("KOCHU_STRIPE_TOLERANCE_SEC");
        }
        unset_webhook_secret();
    }
}
