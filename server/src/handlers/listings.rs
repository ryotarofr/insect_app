//! `/api/v1/listings/*` (Phase 9.E / C2C marketplace HTTP API)
//!
//! - `GET    /api/v1/listings`                  → active な出品一覧 (= 公開閲覧)
//! - `POST   /api/v1/listings`                  → 新規出品 (= login 必須 / seller = current user)
//! - `GET    /api/v1/listings/{public_id}`      → 公開閲覧
//! - `POST   /api/v1/listings/{id}/cancel`      → 出品取消 (= 所有者のみ)
//! - `POST   /api/v1/listings/{id}/bids`        → 入札 (= login 必須)
//! - `POST   /api/v1/listings/{id}/watch`       → ウォッチトグル (= login 必須)
//!
//! **Auth**:
//!   - 公開系 (GET) は anonymous で OK。
//!   - 状態変更系 (POST) は login 必須 (= 401 を返す)。

use axum::{Extension, Json, extract::{Path, State}, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::{bids, listing_watches, listings, user_sessions};
use crate::session::SessionId;
use crate::state::AppState;

// ──────────────────────────────────────────────────────────────────────
// auth guard
// ──────────────────────────────────────────────────────────────────────

async fn require_user_id(state: &AppState, session_id: Uuid) -> Result<Uuid, AppError> {
    let session = user_sessions::find_by_id(state.db(), session_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("session lookup: {e}")))?
        .ok_or(AppError::Unauthorized)?;
    session.user_id.ok_or(AppError::Unauthorized)
}

// ──────────────────────────────────────────────────────────────────────
// DTO
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListingView {
    pub id: String,
    pub public_id: String,
    pub seller_user_id: String,
    pub specimen_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub is_auction: bool,
    pub starting_price_jpy: i64,
    pub current_price_jpy: Option<i64>,
    pub ends_at: Option<DateTime<Utc>>,
    pub status: String,
    pub is_verified: bool,
}

impl From<listings::ListingRow> for ListingView {
    fn from(r: listings::ListingRow) -> Self {
        Self {
            id: r.id.to_string(),
            public_id: r.public_id,
            seller_user_id: r.seller_user_id.to_string(),
            specimen_id: r.specimen_id.map(|u| u.to_string()),
            title: r.title,
            description: r.description,
            is_auction: r.is_auction,
            starting_price_jpy: r.starting_price_jpy,
            current_price_jpy: r.current_price_jpy,
            ends_at: r.ends_at,
            status: r.status,
            is_verified: r.is_verified,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateListingRequest {
    pub public_id: String,
    pub specimen_id: Option<String>,                    // UUID 文字列 / NULL 許容
    pub title: String,
    pub description: Option<String>,
    pub is_auction: bool,
    pub starting_price_jpy: i64,
    pub ends_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateListingResponse {
    pub id: String,
    pub public_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaceBidRequest {
    pub amount_jpy: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceBidResponse {
    pub bid_id: String,
    pub current_price_jpy: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleWatchResponse {
    pub watching: bool,
}

// ──────────────────────────────────────────────────────────────────────
// handlers
// ──────────────────────────────────────────────────────────────────────

/// `GET /api/v1/listings` — active な出品の公開一覧。
pub async fn list_active(
    State(state): State<AppState>,
) -> Result<Json<Vec<ListingView>>, AppError> {
    let rows = listings::find_active(state.db())
        .await
        .map_err(|e| AppError::BadRequest(format!("listings fetch: {e}")))?;
    Ok(Json(rows.into_iter().map(ListingView::from).collect()))
}

/// `POST /api/v1/listings` — 新規出品。seller_user_id は session の user_id に固定。
pub async fn create_listing(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(req): Json<CreateListingRequest>,
) -> Result<Json<CreateListingResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;

    let specimen_uuid = match req.specimen_id.as_deref() {
        Some(s) => Some(Uuid::parse_str(s).map_err(|_| {
            AppError::BadRequest(format!("invalid specimenId UUID: {s}"))
        })?),
        None => None,
    };

    let id = listings::insert(
        state.db(),
        listings::ListingInsert {
            public_id: req.public_id.clone(),
            seller_user_id: user_id,
            specimen_id: specimen_uuid,
            title: req.title,
            description: req.description,
            is_auction: req.is_auction,
            starting_price_jpy: req.starting_price_jpy,
            ends_at: req.ends_at,
        },
    )
    .await
    .map_err(|e| match e {
        listings::ListingRepoError::Invalid(msg) => AppError::BadRequest(msg),
        listings::ListingRepoError::Db(e) => {
            AppError::BadRequest(format!("could not register listing: {e}"))
        }
        listings::ListingRepoError::NotFound(_) => AppError::NotFound,
    })?;

    Ok(Json(CreateListingResponse {
        id: id.to_string(),
        public_id: req.public_id,
    }))
}

/// `GET /api/v1/listings/{public_id}` — public_id で 1 件取得 (= 公開閲覧 OK)。
pub async fn get_listing(
    State(state): State<AppState>,
    Path(public_id): Path<String>,
) -> Result<Json<ListingView>, AppError> {
    let row = listings::find_by_public_id(state.db(), &public_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("listing lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    Ok(Json(ListingView::from(row)))
}

/// `POST /api/v1/listings/{id}/cancel` — 自分の出品を canceled に倒す。
pub async fn cancel_listing(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let target_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;

    let row = listings::find_by_id(state.db(), target_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("listing lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    if row.seller_user_id != user_id {
        // 他人の出品 → 404 で吸収 (= 情報漏れ防止)
        return Err(AppError::NotFound);
    }
    if row.status != "active" {
        return Err(AppError::BadRequest(format!(
            "listing is already {} (only active can be canceled)",
            row.status
        )));
    }

    listings::update_status(state.db(), target_id, "canceled")
        .await
        .map_err(|e| match e {
            listings::ListingRepoError::NotFound(_) => AppError::NotFound,
            other => AppError::BadRequest(format!("cancel failed: {other}")),
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/v1/listings/{id}/bids` — auction 入札。
pub async fn place_bid(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(id): Path<String>,
    Json(req): Json<PlaceBidRequest>,
) -> Result<Json<PlaceBidResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let listing_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;

    // ── listing バリデーション ─────────────────────────────────
    let listing = listings::find_by_id(state.db(), listing_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("listing lookup: {e}")))?
        .ok_or(AppError::NotFound)?;

    if !listing.is_auction {
        return Err(AppError::BadRequest(
            "this listing is not an auction".to_string(),
        ));
    }
    if listing.status != "active" {
        return Err(AppError::BadRequest(format!(
            "listing is {} (only active accepts bids)",
            listing.status
        )));
    }
    if listing.seller_user_id == user_id {
        return Err(AppError::BadRequest(
            "seller cannot bid on own listing".to_string(),
        ));
    }

    // ── amount バリデーション ──────────────────────────────────
    // 既存 current_price (or starting_price) より大きいことを要求 (= bid laddering)。
    let floor = listing
        .current_price_jpy
        .unwrap_or(listing.starting_price_jpy);
    if req.amount_jpy <= floor {
        return Err(AppError::BadRequest(format!(
            "bid must exceed current price {} (got {})",
            floor, req.amount_jpy
        )));
    }

    // ── INSERT bid ────────────────────────────────────────────
    let bid_id = bids::insert(
        state.db(),
        bids::BidInsert {
            listing_id,
            bidder_user_id: user_id,
            amount_jpy: req.amount_jpy,
        },
    )
    .await
    .map_err(|e| match e {
        bids::BidRepoError::Invalid(msg) => AppError::BadRequest(msg),
        bids::BidRepoError::Db(e) => AppError::BadRequest(format!("bid insert: {e}")),
    })?;

    // ── listing.current_price_jpy 更新 ────────────────────────
    // best-effort: 失敗しても bid は記録済みなので 200 を返す (= eventual consistency)。
    if let Err(e) =
        listings::update_current_price(state.db(), listing_id, req.amount_jpy).await
    {
        tracing::warn!(
            "place_bid: update_current_price failed for listing={}: {} (bid is still recorded)",
            listing_id,
            e
        );
    }

    Ok(Json(PlaceBidResponse {
        bid_id: bid_id.to_string(),
        current_price_jpy: req.amount_jpy,
    }))
}

/// `POST /api/v1/listings/{id}/watch` — listing watch のトグル。
pub async fn toggle_watch_listing(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(id): Path<String>,
) -> Result<Json<ToggleWatchResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let listing_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;

    let outcome = listing_watches::toggle(state.db(), user_id, listing_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("watch toggle: {e}")))?;

    let watching = matches!(outcome, listing_watches::ToggleOutcome::Added);
    Ok(Json(ToggleWatchResponse { watching }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::{bids, listing_watches, listings, user_sessions, users};

    fn st() -> State<AppState> {
        State(AppState::default())
    }
    fn ext(session_id: Uuid) -> Extension<SessionId> {
        Extension(SessionId(session_id))
    }

    /// users + user_sessions + listings + bids + listing_watches を触るので順序固定で取得。
    fn lock_all() -> (
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
    ) {
        let u = users::memory_guard();
        let s = user_sessions::memory_guard();
        let l = listings::memory_guard();
        let b = bids::memory_guard();
        let w = listing_watches::memory_guard();
        (u, s, l, b, w)
    }

    fn reset_all() {
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        listings::reset_memory_for_test();
        bids::reset_memory_for_test();
        listing_watches::reset_memory_for_test();
    }

    async fn login_session() -> (Uuid, Uuid) {
        let session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        let id = users::create_with_password(
            None,
            users::UserRegisterInput {
                public_id: format!("u_{}", &session.to_string()[..8]),
                name: "test".to_string(),
                email: format!("{}@example.com", &session.to_string()[..8]),
                password_plain: "long-enough-password".to_string(),
                avatar_initial: "T".to_string(),
                role: "breeder".to_string(),
            },
        )
        .await
        .unwrap();
        user_sessions::attach_user(None, session, id).await.unwrap();
        (session, id)
    }

    fn create_req(public_id: &str, is_auction: bool, starting: i64) -> CreateListingRequest {
        CreateListingRequest {
            public_id: public_id.to_string(),
            specimen_id: None,
            title: "ヘラクレス test".to_string(),
            description: None,
            is_auction,
            starting_price_jpy: starting,
            ends_at: if is_auction {
                Some(Utc::now() + chrono::Duration::days(7))
            } else {
                None
            },
        }
    }

    #[tokio::test]
    async fn list_create_get_cycle() {
        let _g = lock_all();
        reset_all();

        let (session, _) = login_session().await;
        let r = create_listing(st(), ext(session), Json(create_req("L-1", false, 50000)))
            .await
            .unwrap();
        assert_eq!(r.0.public_id, "L-1");

        let list = list_active(st()).await.unwrap();
        assert_eq!(list.0.len(), 1);

        let one = get_listing(st(), Path("L-1".to_string())).await.unwrap();
        assert_eq!(one.0.starting_price_jpy, 50000);
        assert_eq!(one.0.status, "active");
    }

    #[tokio::test]
    async fn create_listing_requires_login() {
        let _g = lock_all();
        reset_all();

        let session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        // attach_user していない → 401
        match create_listing(st(), ext(session), Json(create_req("L-2", false, 1000))).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn cancel_only_by_owner() {
        let _g = lock_all();
        reset_all();

        let (s_a, _) = login_session().await;
        let r = create_listing(st(), ext(s_a), Json(create_req("L-3", false, 1000)))
            .await
            .unwrap();

        let (s_b, _) = login_session().await;
        match cancel_listing(st(), ext(s_b), Path(r.0.id.clone())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound for cross-user cancel, got {other:?}"),
        }

        // owner なら通る
        let status = cancel_listing(st(), ext(s_a), Path(r.0.id)).await.unwrap();
        assert_eq!(status, StatusCode::NO_CONTENT);
        let one = get_listing(st(), Path("L-3".to_string())).await.unwrap();
        assert_eq!(one.0.status, "canceled");
    }

    #[tokio::test]
    async fn place_bid_validates_listing() {
        let _g = lock_all();
        reset_all();

        let (seller, _) = login_session().await;
        let r = create_listing(st(), ext(seller), Json(create_req("L-4", true, 10000)))
            .await
            .unwrap();
        let listing_id = r.0.id;

        let (bidder, _) = login_session().await;

        // 1 円高い → OK
        let res = place_bid(
            st(),
            ext(bidder),
            Path(listing_id.clone()),
            Json(PlaceBidRequest { amount_jpy: 11000 }),
        )
        .await
        .unwrap();
        assert_eq!(res.0.current_price_jpy, 11000);

        // 同額以下 → 400
        match place_bid(
            st(),
            ext(bidder),
            Path(listing_id.clone()),
            Json(PlaceBidRequest { amount_jpy: 11000 }),
        )
        .await
        {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("exceed")),
            other => panic!("expected BadRequest, got {other:?}"),
        }

        // listing.current_price_jpy が更新されている
        let one = get_listing(st(), Path("L-4".to_string())).await.unwrap();
        assert_eq!(one.0.current_price_jpy, Some(11000));
    }

    #[tokio::test]
    async fn place_bid_rejects_seller_self_bid() {
        let _g = lock_all();
        reset_all();

        let (seller, _) = login_session().await;
        let r = create_listing(st(), ext(seller), Json(create_req("L-5", true, 5000)))
            .await
            .unwrap();
        match place_bid(
            st(),
            ext(seller),
            Path(r.0.id),
            Json(PlaceBidRequest { amount_jpy: 6000 }),
        )
        .await
        {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("seller cannot bid")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn place_bid_rejects_non_auction() {
        let _g = lock_all();
        reset_all();

        let (seller, _) = login_session().await;
        // is_auction=false で作成
        let r = create_listing(st(), ext(seller), Json(create_req("L-6", false, 5000)))
            .await
            .unwrap();
        let (bidder, _) = login_session().await;
        match place_bid(
            st(),
            ext(bidder),
            Path(r.0.id),
            Json(PlaceBidRequest { amount_jpy: 6000 }),
        )
        .await
        {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("not an auction")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn toggle_watch_alternates_state() {
        let _g = lock_all();
        reset_all();

        let (seller, _) = login_session().await;
        let r = create_listing(st(), ext(seller), Json(create_req("L-7", false, 5000)))
            .await
            .unwrap();
        let (watcher, _) = login_session().await;

        let r1 = toggle_watch_listing(st(), ext(watcher), Path(r.0.id.clone()))
            .await
            .unwrap();
        assert!(r1.0.watching);
        let r2 = toggle_watch_listing(st(), ext(watcher), Path(r.0.id))
            .await
            .unwrap();
        assert!(!r2.0.watching);
    }

    #[tokio::test]
    async fn toggle_watch_requires_login() {
        let _g = lock_all();
        reset_all();

        let session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        match toggle_watch_listing(st(), ext(session), Path(Uuid::new_v4().to_string())).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }
}
