//! `/api/v1/listings/*` (C2C marketplace HTTP API)
//!
//! - `GET    /api/v1/listings`                  → active な出品一覧 (= 公開閲覧)
//! - `GET    /api/v1/listings/me`               → 自分の出品 (= login 必須 / status filter 可)
//! - `POST   /api/v1/listings`                  → 新規出品 (= login 必須 / seller = current user)
//! - `GET    /api/v1/listings/{public_id}`      → 公開閲覧
//! - `POST   /api/v1/listings/{id}/cancel`      → 出品取消 (= 所有者のみ)
//! - `POST   /api/v1/listings/{id}/bids`        → 入札 (= login 必須)
//! - `POST   /api/v1/listings/{id}/watch`       → ウォッチトグル (= login 必須)
//!
//! **Auth**:
//!   - 公開系 (GET /, GET /{public_id}) は anonymous で OK。
//!   - 自分系 (GET /me) と 状態変更系 (POST) は login 必須 (= 401 を返す)。

use axum::{Extension, Json, extract::{Path, Query, State}, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::handlers::require_user_id;
use crate::repos::{bids, listing_watches, listings};
use crate::session::SessionId;
use crate::state::AppState;

// ──────────────────────────────────────────────────────────────────────
// DTO
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
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

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateListingRequest {
    pub public_id: String,
    pub specimen_id: Option<String>,                    // UUID 文字列 / NULL 許容
    pub title: String,
    pub description: Option<String>,
    pub is_auction: bool,
    pub starting_price_jpy: i64,
    /// 即決価格 (= auction の "Buy It Now")。
    /// 任意 / NULL 許容。設定する場合は `is_auction=true` かつ `> starting_price_jpy`。
    /// migration 0024 の CHECK 制約と repo validate で同条件を強制。
    #[serde(default)]
    pub buyout_price_jpy: Option<i64>,
    pub ends_at: Option<DateTime<Utc>>,
    /// アップロード済 asset (= /uploads/complete を通過した) の UUID リスト。
    /// listing 作成成功後に `assets.attach_target` で `(target_kind='listing', target_id=<listing_id>)`
    /// を書き込む。空配列 / 省略は写真なしの出品として OK。
    /// asset の所有者検証 (= asset.owner_user_id == seller) は attach 時に呼び出し側で行う。
    #[serde(default)]
    pub asset_ids: Vec<String>,
    /// 出品者が対応可能な配送方法 ID リスト (= shipping_methods.id)。
    /// 空配列 / 省略は「全方法 OK」と解釈する (= 出品者が絞り込みを設定しない)。
    /// 行があれば `listing_shipping_methods` に書き込み、checkout は client 側で
    /// その集合のみから選択する規律。
    #[serde(default)]
    pub shipping_method_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateListingResponse {
    pub id: String,
    pub public_id: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaceBidRequest {
    pub amount_jpy: i64,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaceBidResponse {
    pub bid_id: String,
    pub current_price_jpy: i64,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToggleWatchResponse {
    pub watching: bool,
}

// ──────────────────────────────────────────────────────────────────────
// handlers
// ──────────────────────────────────────────────────────────────────────

/// `GET /api/v1/listings` — active な出品の公開一覧。
///
/// PR-7 (フロント listings adapter DB 化) で `seller_name` / `bid_count` /
/// `watcher_count` を含む `ListingViewWithCounts` 形式に拡張。Market.tsx の
/// 表示要件 (出品者 / 入札数 / ウォッチ数) を 1 fetch で満たす。
#[utoipa::path(
    get,
    path = "/listings",
    tag = "listings",
    responses(
        (status = 200, description = "active な listing を一覧で返す (= seller / bid_count / watcher_count 同梱)", body = Vec<ListingViewWithCounts>),
    ),
)]
pub async fn list_active(
    State(state): State<AppState>,
) -> Result<Json<Vec<ListingViewWithCounts>>, AppError> {
    let rows = listings::find_active_with_counts(state.db())
        .await
        .map_err(|e| AppError::BadRequest(format!("listings fetch: {e}")))?;
    let mut views: Vec<ListingViewWithCounts> =
        rows.into_iter().map(ListingViewWithCounts::from).collect();
    hydrate_shipping_methods(&state, &mut views).await;
    Ok(Json(views))
}

/// `GET /api/v1/listings/me` の query parameters。
#[derive(Debug, Clone, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ListMyListingsParams {
    /// `active` / `sold` / `canceled` / `expired` / `all`。省略時は `all`。
    pub status: Option<String>,
}

/// `GET /api/v1/listings/me?status=active|sold|canceled|expired|all` —
/// 自分の出品一覧。
///
/// **マイ出品**:
/// - login 必須 (= 401)。session の user_id を `seller_user_id` として固定。
/// - `?status=` 省略 or `all` で全 status、それ以外は schema CHECK と同じ集合のみ受け付ける。
/// - 戻り値は `list_active` と同じ `ListingViewWithCounts` shape (= bid_count / watcher_count
///   込み)。FE のタブ (= `入札中` = active && bid_count > 0) は派生計算する。
#[utoipa::path(
    get,
    path = "/listings/me",
    tag = "listings",
    params(ListMyListingsParams),
    responses(
        (status = 200, description = "自分の出品 (= bid_count / watcher_count 込み)", body = Vec<ListingViewWithCounts>),
        (status = 400, description = "invalid status", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn list_my_listings(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Query(params): Query<ListMyListingsParams>,
) -> Result<Json<Vec<ListingViewWithCounts>>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;

    // "all" / 空文字 / None はフィルタ無し扱い。それ以外は repo 側の validation に委ねる。
    let raw = params.status.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let status_filter = match raw {
        None | Some("all") => None,
        Some(s) => Some(s),
    };

    let rows = listings::find_by_seller(state.db(), user_id, status_filter)
        .await
        .map_err(|e| match e {
            listings::ListingRepoError::Invalid(msg) => AppError::BadRequest(msg),
            listings::ListingRepoError::Db(e) => {
                AppError::BadRequest(format!("listings fetch: {e}"))
            }
            listings::ListingRepoError::NotFound(_) => AppError::NotFound,
        })?;
    let mut views: Vec<ListingViewWithCounts> =
        rows.into_iter().map(ListingViewWithCounts::from).collect();
    hydrate_shipping_methods(&state, &mut views).await;
    Ok(Json(views))
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListingViewWithCounts {
    pub id: String,
    pub public_id: String,
    pub seller_user_id: String,
    /// JOIN users.name で取得。
    pub seller_name: String,
    pub specimen_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub is_auction: bool,
    pub starting_price_jpy: i64,
    pub current_price_jpy: Option<i64>,
    /// 即決価格 (= auction の Buy It Now)。
    pub buyout_price_jpy: Option<i64>,
    pub ends_at: Option<DateTime<Utc>>,
    pub status: String,
    pub is_verified: bool,
    /// `v_listings_with_counts.bid_count`。
    pub bid_count: i64,
    /// `v_listings_with_counts.watcher_count`。
    pub watcher_count: i64,
    /// 対応可能な配送方法 ID 集合。
    /// **空配列 = 「全方法 OK」** と解釈 (= 出品者が絞り込みを設定していない)。
    /// 値が入っていれば、checkout はその集合のみから選ぶ規律。
    #[serde(default)]
    pub shipping_method_ids: Vec<String>,
}

impl From<listings::ListingWithCounts> for ListingViewWithCounts {
    fn from(r: listings::ListingWithCounts) -> Self {
        Self {
            id: r.id.to_string(),
            public_id: r.public_id,
            seller_user_id: r.seller_user_id.to_string(),
            seller_name: r.seller_name,
            specimen_id: r.specimen_id.map(|u| u.to_string()),
            title: r.title,
            description: r.description,
            is_auction: r.is_auction,
            starting_price_jpy: r.starting_price_jpy,
            current_price_jpy: r.current_price_jpy,
            buyout_price_jpy: r.buyout_price_jpy,
            ends_at: r.ends_at,
            status: r.status,
            is_verified: r.is_verified,
            bid_count: r.bid_count,
            watcher_count: r.watcher_count,
            // shipping_method_ids は別 query で埋める (= From の段階では空)。
            // hydrate_shipping_methods() でまとめて 1 query に集約する。
            shipping_method_ids: Vec::new(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// ListingViewWithCounts.shipping_method_ids の一括 hydrate
// ──────────────────────────────────────────────────────────────────────
//
// listing 一覧 / 詳細を返す箇所で、配送方法の絞り込み集合を 1 listing ずつ別 query で
// 取って詰める。1 listing あたり 1 round trip だが、MVP の規模なら N+1 でも実用範囲。
// TODO: 件数が増えたら IN (...) で一括取得する形に最適化する。

async fn hydrate_shipping_methods(
    state: &AppState,
    views: &mut [ListingViewWithCounts],
) {
    for v in views.iter_mut() {
        let lid = match Uuid::parse_str(&v.id) {
            Ok(u) => u,
            Err(_) => continue,
        };
        match crate::repos::listing_shipping_methods::find_by_listing(state.db(), lid).await {
            Ok(ids) => v.shipping_method_ids = ids,
            Err(e) => {
                tracing::warn!(
                    "hydrate_shipping_methods: find_by_listing({}) failed: {}",
                    lid,
                    e
                );
            }
        }
    }
}

async fn hydrate_one(state: &AppState, view: &mut ListingViewWithCounts) {
    hydrate_shipping_methods(state, std::slice::from_mut(view)).await;
}

/// `POST /api/v1/listings` — 新規出品。seller_user_id は session の user_id に固定。
#[utoipa::path(
    post,
    path = "/listings",
    tag = "listings",
    request_body = CreateListingRequest,
    responses(
        (status = 200, description = "出品作成成功", body = CreateListingResponse),
        (status = 400, description = "入力 invalid / public_id 重複 / specimenId UUID 不正", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
    ),
)]
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
            buyout_price_jpy: req.buyout_price_jpy,
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

    // shipping_method_ids を listing_shipping_methods に書き込む。
    //
    // **値域検証**:
    //   shipping_methods マスタ (= warm キャッシュ) に存在する id のみ受理。未知は 400。
    //   空配列なら set_for_listing は呼ばず、「全方法 OK」状態 (= 行ゼロ) を維持。
    //
    // **失敗ポリシー**:
    //   - 値域エラー (= 不正な shipping_method_id) は 400 で listing 作成自体を拒否すべきだが、
    //     既に listing 行は INSERT 済なので**作成成功扱い**で warn 止め (= 規律としては
    //     pre-validate して INSERT 前に弾くのが筋)。MVP の落としどころ。
    //   - DB 書き込み失敗は warn 止め (= 「全方法 OK」状態にフォールバック)。
    if !req.shipping_method_ids.is_empty() {
        let known: std::collections::HashSet<String> =
            crate::repos::shipping_methods::cached_methods()
                .into_keys()
                .collect();
        let validated: Vec<&str> = req
            .shipping_method_ids
            .iter()
            .filter(|m| known.contains(m.as_str()))
            .map(String::as_str)
            .collect();
        if validated.len() != req.shipping_method_ids.len() {
            tracing::warn!(
                "create_listing: some shipping_method_ids are unknown (input={:?}, known={:?})",
                req.shipping_method_ids,
                known
            );
        }
        if !validated.is_empty()
            && let Err(e) = crate::repos::listing_shipping_methods::set_for_listing(
                state.db(),
                id,
                &validated,
            )
            .await
        {
            tracing::warn!(
                "create_listing: set_for_listing failed for listing {}: {}",
                id,
                e
            );
        }
    }

    // asset_ids を listing に attach する。
    //
    // **失敗ポリシー**:
    //   - UUID parse 失敗は BadRequest (= client 側のバグなので即時返す)。
    //   - 所有者違い / 既 attach は warn 止め (= リスト全体は成功扱いで listing を返す)。
    //     これにより「写真 1 枚が他人のものでも listing 自体は作られる」緩い扱い。
    //     ただし他人 asset を当てるのは security risk なので require_user_id チェックで
    //     owner_user_id が seller とずれる場合は attach せず警告ログで済ませる。
    //
    //   pool が None (= DB 不在の dev テスト) の場合は attach をスキップ (= asset repo が
    //   PoolMissing を返すため。listing は in-memory に作られているので OK)。
    if !req.asset_ids.is_empty() && state.db().is_some() {
        for raw_id in &req.asset_ids {
            let asset_id = match Uuid::parse_str(raw_id) {
                Ok(u) => u,
                Err(_) => {
                    return Err(AppError::BadRequest(format!(
                        "invalid asset_id UUID: {raw_id}"
                    )));
                }
            };

            // 所有者検証: asset.owner_user_id == seller (= 自分の asset しか attach できない)
            match crate::repos::assets::find_by_id(state.db(), asset_id).await {
                Ok(Some(a)) => {
                    if a.owner_user_id != user_id {
                        tracing::warn!(
                            "create_listing: asset {} owner mismatch (asset.owner={} session.user={}) — skipping attach",
                            asset_id,
                            a.owner_user_id,
                            user_id
                        );
                        continue;
                    }
                    if a.status != "uploaded" {
                        tracing::warn!(
                            "create_listing: asset {} not uploaded yet (status={}) — skipping attach",
                            asset_id,
                            a.status
                        );
                        continue;
                    }
                }
                Ok(None) => {
                    tracing::warn!(
                        "create_listing: asset {} not found — skipping attach",
                        asset_id
                    );
                    continue;
                }
                Err(e) => {
                    tracing::error!("create_listing: asset lookup failed: {e}");
                    continue;
                }
            }

            // attach (= UPDATE assets SET target_kind='listing', target_id=$listing)。
            // 既に紐付け済の場合は Ok(false) で warn 止め。
            match crate::repos::assets::attach_target(state.db(), asset_id, "listing", id)
                .await
            {
                Ok(true) => {}
                Ok(false) => {
                    tracing::warn!(
                        "create_listing: asset {} was already attached to another target",
                        asset_id
                    );
                }
                Err(e) => {
                    tracing::error!(
                        "create_listing: attach_target failed for asset {}: {}",
                        asset_id,
                        e
                    );
                }
            }
        }
    }

    Ok(Json(CreateListingResponse {
        id: id.to_string(),
        public_id: req.public_id,
    }))
}

/// `GET /api/v1/listings/{public_id}` — public_id で 1 件取得 (= 公開閲覧 OK)。
///
/// 戻り値は seller_name / bid_count / watcher_count を JOIN で含めた `ListingViewWithCounts`
/// (= 一覧 endpoint と同 shape)。FE の listings 詳細ページが seller 名を fallback 無しで
/// 表示できるようにするのが目的。
#[utoipa::path(
    get,
    path = "/listings/{public_id}",
    tag = "listings",
    params(
        ("public_id" = String, Path, description = "listing の public_id (= URL slug)"),
    ),
    responses(
        (status = 200, description = "1 listing 詳細 (= seller_name / bid_count / watcher_count 同梱)", body = ListingViewWithCounts),
        (status = 404, description = "listing 不存在", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn get_listing(
    State(state): State<AppState>,
    Path(public_id): Path<String>,
) -> Result<Json<ListingViewWithCounts>, AppError> {
    let row = listings::find_by_public_id_with_counts(state.db(), &public_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("listing lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    let mut view = ListingViewWithCounts::from(row);
    hydrate_one(&state, &mut view).await;
    Ok(Json(view))
}

/// `POST /api/v1/listings/{id}/cancel` — 自分の出品を canceled に倒す。
#[utoipa::path(
    post,
    path = "/listings/{id}/cancel",
    tag = "listings",
    params(
        ("id" = String, Path, description = "listing の internal UUID (= listings.id)"),
    ),
    responses(
        (status = 204, description = "cancel 成功"),
        (status = 400, description = "active 以外は cancel 不可", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
        (status = 404, description = "listing 不存在 / 所有者でない (= 情報漏れ防止で 404)", body = crate::openapi::ErrorResponse),
    ),
)]
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
#[utoipa::path(
    post,
    path = "/listings/{id}/bids",
    tag = "listings",
    params(
        ("id" = String, Path, description = "listing の internal UUID (= listings.id)"),
    ),
    request_body = PlaceBidRequest,
    responses(
        (status = 200, description = "入札成功 (= current_price 更新含む)", body = PlaceBidResponse),
        (status = 400, description = "auction でない / non-active / seller 自身 / amount 不足", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
        (status = 404, description = "listing 不存在", body = crate::openapi::ErrorResponse),
    ),
)]
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
#[utoipa::path(
    post,
    path = "/listings/{id}/watch",
    tag = "listings",
    params(
        ("id" = String, Path, description = "listing の internal UUID (= listings.id)"),
    ),
    responses(
        (status = 200, description = "トグル後の watching 状態を返す", body = ToggleWatchResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
    ),
)]
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
    #[allow(clippy::type_complexity)]
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
            // 即決価格は既定で None (= 個別テストで Some を渡して検証)。
            buyout_price_jpy: None,
            ends_at: if is_auction {
                Some(Utc::now() + chrono::Duration::days(7))
            } else {
                None
            },
            // asset_ids は既定で空 (= 写真なし出品)。テストでも空配列で OK。
            asset_ids: Vec::new(),
            // shipping_method_ids 既定空 (= 「全方法 OK」状態)。
            shipping_method_ids: Vec::new(),
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

    // ──────────────────────────────────────────────────────────────────
    // GET /listings/me
    // ──────────────────────────────────────────────────────────────────

    fn my_params(status: Option<&str>) -> Query<ListMyListingsParams> {
        Query(ListMyListingsParams {
            status: status.map(str::to_string),
        })
    }

    /// 自分の active 出品だけ返り、別ユーザーのは混ざらない (cross-user リーク防止)。
    #[tokio::test]
    async fn list_my_listings_returns_only_own() {
        let _g = lock_all();
        reset_all();

        let (s_a, _) = login_session().await;
        create_listing(st(), ext(s_a), Json(create_req("L-A1", false, 1000)))
            .await
            .unwrap();
        create_listing(st(), ext(s_a), Json(create_req("L-A2", false, 2000)))
            .await
            .unwrap();

        let (s_b, _) = login_session().await;
        create_listing(st(), ext(s_b), Json(create_req("L-B1", false, 3000)))
            .await
            .unwrap();

        let mine = list_my_listings(st(), ext(s_a), my_params(None))
            .await
            .unwrap();
        assert_eq!(mine.0.len(), 2);
        assert!(mine.0.iter().all(|r| r.public_id.starts_with("L-A")));
    }

    /// `?status=active` / `?status=canceled` でフィルタが効くこと。
    #[tokio::test]
    async fn list_my_listings_filters_by_status() {
        let _g = lock_all();
        reset_all();

        let (session, _) = login_session().await;
        let r1 = create_listing(st(), ext(session), Json(create_req("L-S1", false, 1000)))
            .await
            .unwrap();
        let _r2 = create_listing(st(), ext(session), Json(create_req("L-S2", false, 2000)))
            .await
            .unwrap();
        // L-S1 を取消
        cancel_listing(st(), ext(session), Path(r1.0.id.clone()))
            .await
            .unwrap();

        let active = list_my_listings(st(), ext(session), my_params(Some("active")))
            .await
            .unwrap();
        assert_eq!(active.0.len(), 1);
        assert_eq!(active.0[0].public_id, "L-S2");

        let canceled = list_my_listings(st(), ext(session), my_params(Some("canceled")))
            .await
            .unwrap();
        assert_eq!(canceled.0.len(), 1);
        assert_eq!(canceled.0[0].public_id, "L-S1");

        // ?status=all (= None と同じ扱い) は両方返す
        let all = list_my_listings(st(), ext(session), my_params(Some("all")))
            .await
            .unwrap();
        assert_eq!(all.0.len(), 2);
    }

    /// anonymous (= attach_user していない session) は 401。
    #[tokio::test]
    async fn list_my_listings_requires_login() {
        let _g = lock_all();
        reset_all();

        let session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        match list_my_listings(st(), ext(session), my_params(None)).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    /// invalid な status 値は 400。
    #[tokio::test]
    async fn list_my_listings_rejects_invalid_status() {
        let _g = lock_all();
        reset_all();

        let (session, _) = login_session().await;
        match list_my_listings(st(), ext(session), my_params(Some("weird"))).await {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("invalid status")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }
}
