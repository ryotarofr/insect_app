//! `/api/v1/mating_records/*` (Phase 9.D / 交配記録 HTTP API)
//!
//! - `POST /api/v1/mating_records`              → 新規記録 (= login 必須 / breeder = current user)
//! - `GET  /api/v1/mating_records/me`           → 自分の交配記録一覧 (= login 必須)
//! - `POST /api/v1/mating_records/{id}/status`  → status 遷移 (= 所有者のみ)
//! - `POST /api/v1/mating_records/{id}/egg_count` → 採卵数を更新 (= 所有者のみ)

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::{mating_records, user_sessions};
use crate::session::SessionId;
use crate::state::AppState;

async fn require_user_id(state: &AppState, session_id: Uuid) -> Result<Uuid, AppError> {
    let session = user_sessions::find_by_id(state.db(), session_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("session lookup: {e}")))?
        .ok_or(AppError::Unauthorized)?;
    session.user_id.ok_or(AppError::Unauthorized)
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatingRecordView {
    pub id: String,
    pub breeder_user_id: String,
    pub father_id: Option<String>,
    pub mother_id: Option<String>,
    pub father_label: Option<String>,
    pub mother_label: Option<String>,
    pub mated_at: NaiveDate,
    pub egg_count: Option<i32>,
    pub status: String,
    pub notes: Option<String>,
}

impl From<mating_records::MatingRecordRow> for MatingRecordView {
    fn from(r: mating_records::MatingRecordRow) -> Self {
        Self {
            id: r.id.to_string(),
            breeder_user_id: r.breeder_user_id.to_string(),
            father_id: r.father_id.map(|u| u.to_string()),
            mother_id: r.mother_id.map(|u| u.to_string()),
            father_label: r.father_label,
            mother_label: r.mother_label,
            mated_at: r.mated_at,
            egg_count: r.egg_count,
            status: r.status,
            notes: r.notes,
        }
    }
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateMatingRequest {
    pub father_id: Option<String>,                      // UUID 文字列 / NULL
    pub mother_id: Option<String>,
    pub father_label: Option<String>,
    pub mother_label: Option<String>,
    pub mated_at: NaiveDate,
    pub egg_count: Option<i32>,
    /// 省略時は "planned" (= 予定段階)。
    #[serde(default = "default_status")]
    pub status: String,
    pub notes: Option<String>,
}

fn default_status() -> String {
    "planned".to_string()
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateMatingResponse {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateStatusRequest {
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateEggCountRequest {
    pub egg_count: i32,
}

fn parse_optional_uuid(s: &Option<String>, field: &str) -> Result<Option<Uuid>, AppError> {
    match s.as_deref() {
        Some(v) => Uuid::parse_str(v)
            .map(Some)
            .map_err(|_| AppError::BadRequest(format!("invalid UUID for {field}: {v}"))),
        None => Ok(None),
    }
}

// ──────────────────────────────────────────────────────────────────────
// handlers
// ──────────────────────────────────────────────────────────────────────

/// `POST /api/v1/mating_records` — 新規交配記録。breeder_user_id は session の user_id に固定。
#[utoipa::path(
    post,
    path = "/mating_records",
    tag = "mating",
    request_body = CreateMatingRequest,
    responses(
        (status = 200, description = "記録作成成功", body = CreateMatingResponse),
        (status = 400, description = "father/mother UUID 不正 / status 値域外", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn create_record(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(req): Json<CreateMatingRequest>,
) -> Result<Json<CreateMatingResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let father_id = parse_optional_uuid(&req.father_id, "fatherId")?;
    let mother_id = parse_optional_uuid(&req.mother_id, "motherId")?;

    let id = mating_records::insert(
        state.db(),
        mating_records::MatingRecordInsert {
            breeder_user_id: user_id,
            father_id,
            mother_id,
            father_label: req.father_label,
            mother_label: req.mother_label,
            mated_at: req.mated_at,
            egg_count: req.egg_count,
            status: req.status,
            notes: req.notes,
        },
    )
    .await
    .map_err(|e| match e {
        mating_records::MatingRepoError::Invalid(msg) => AppError::BadRequest(msg),
        mating_records::MatingRepoError::Db(e) => {
            AppError::BadRequest(format!("could not register mating record: {e}"))
        }
        mating_records::MatingRepoError::NotFound(_) => AppError::NotFound,
    })?;
    Ok(Json(CreateMatingResponse {
        id: id.to_string(),
    }))
}

/// `GET /api/v1/mating_records/me` — current breeder の交配記録一覧。
#[utoipa::path(
    get,
    path = "/mating_records/me",
    tag = "mating",
    responses(
        (status = 200, description = "current user の交配記録", body = Vec<MatingRecordView>),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn list_my_records(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
) -> Result<Json<Vec<MatingRecordView>>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let rows = mating_records::list_by_breeder(state.db(), user_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("mating fetch: {e}")))?;
    Ok(Json(rows.into_iter().map(MatingRecordView::from).collect()))
}

/// `POST /api/v1/mating_records/{id}/status` — status 遷移 (= 所有者のみ)。
#[utoipa::path(
    post,
    path = "/mating_records/{id}/status",
    tag = "mating",
    params(
        ("id" = String, Path, description = "mating_record の internal UUID"),
    ),
    request_body = UpdateStatusRequest,
    responses(
        (status = 204, description = "status 更新成功"),
        (status = 400, description = "status 値域外", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
        (status = 404, description = "record 不存在 / 所有者でない", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn update_status_handler(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(id): Path<String>,
    Json(req): Json<UpdateStatusRequest>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let target_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;

    // 所有者チェック (= 他人の record を変えられない / 404 で吸収)
    let row = mating_records::find_by_id(state.db(), target_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("mating lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    if row.breeder_user_id != user_id {
        return Err(AppError::NotFound);
    }

    mating_records::update_status(state.db(), target_id, &req.status)
        .await
        .map_err(|e| match e {
            mating_records::MatingRepoError::Invalid(msg) => AppError::BadRequest(msg),
            mating_records::MatingRepoError::NotFound(_) => AppError::NotFound,
            mating_records::MatingRepoError::Db(e) => {
                AppError::BadRequest(format!("update_status: {e}"))
            }
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/v1/mating_records/{id}/egg_count` — 採卵数を更新 (= 所有者のみ)。
#[utoipa::path(
    post,
    path = "/mating_records/{id}/egg_count",
    tag = "mating",
    params(
        ("id" = String, Path, description = "mating_record の internal UUID"),
    ),
    request_body = UpdateEggCountRequest,
    responses(
        (status = 204, description = "egg_count 更新成功"),
        (status = 400, description = "egg_count 不正", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
        (status = 404, description = "record 不存在 / 所有者でない", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn update_egg_count_handler(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(id): Path<String>,
    Json(req): Json<UpdateEggCountRequest>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let target_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;

    let row = mating_records::find_by_id(state.db(), target_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("mating lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    if row.breeder_user_id != user_id {
        return Err(AppError::NotFound);
    }

    mating_records::update_egg_count(state.db(), target_id, req.egg_count)
        .await
        .map_err(|e| match e {
            mating_records::MatingRepoError::Invalid(msg) => AppError::BadRequest(msg),
            mating_records::MatingRepoError::NotFound(_) => AppError::NotFound,
            mating_records::MatingRepoError::Db(e) => {
                AppError::BadRequest(format!("update_egg_count: {e}"))
            }
        })?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::{mating_records, user_sessions, users};

    fn st() -> State<AppState> {
        State(AppState::default())
    }
    fn ext(session_id: Uuid) -> Extension<SessionId> {
        Extension(SessionId(session_id))
    }

    fn lock_all() -> (
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
    ) {
        let u = users::memory_guard();
        let s = user_sessions::memory_guard();
        let m = mating_records::memory_guard();
        (u, s, m)
    }

    fn reset_all() {
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        mating_records::reset_memory_for_test();
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

    fn req(day: &str, status: &str) -> CreateMatingRequest {
        CreateMatingRequest {
            father_id: None,
            mother_id: None,
            father_label: Some("野生 ♂".to_string()),
            mother_label: Some("自家累代 ♀".to_string()),
            mated_at: NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap(),
            egg_count: None,
            status: status.to_string(),
            notes: None,
        }
    }

    #[tokio::test]
    async fn create_then_list_my_records() {
        let _g = lock_all();
        reset_all();
        let (session, _) = login_session().await;

        let r = create_record(st(), ext(session), Json(req("2026-04-01", "planned")))
            .await
            .unwrap();
        assert!(!r.0.id.is_empty());

        let list = list_my_records(st(), ext(session)).await.unwrap();
        assert_eq!(list.0.len(), 1);
        assert_eq!(list.0[0].status, "planned");
        assert_eq!(list.0[0].father_label.as_deref(), Some("野生 ♂"));
    }

    #[tokio::test]
    async fn create_record_requires_login() {
        let _g = lock_all();
        reset_all();
        let session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        match create_record(st(), ext(session), Json(req("2026-04-01", "planned"))).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn create_rejects_invalid_status() {
        let _g = lock_all();
        reset_all();
        let (session, _) = login_session().await;
        match create_record(st(), ext(session), Json(req("2026-04-01", "wedding"))).await {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("status")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_my_records_isolates_per_user() {
        let _g = lock_all();
        reset_all();
        let (sa, _) = login_session().await;
        let _ = create_record(st(), ext(sa), Json(req("2026-04-01", "planned")))
            .await
            .unwrap();
        let _ = create_record(st(), ext(sa), Json(req("2026-04-02", "mated")))
            .await
            .unwrap();

        let (sb, _) = login_session().await;
        let _ = create_record(st(), ext(sb), Json(req("2026-04-03", "planned")))
            .await
            .unwrap();

        assert_eq!(list_my_records(st(), ext(sa)).await.unwrap().0.len(), 2);
        assert_eq!(list_my_records(st(), ext(sb)).await.unwrap().0.len(), 1);
    }

    #[tokio::test]
    async fn update_status_owner_only() {
        let _g = lock_all();
        reset_all();
        let (sa, _) = login_session().await;
        let r = create_record(st(), ext(sa), Json(req("2026-04-01", "planned")))
            .await
            .unwrap();

        let (sb, _) = login_session().await;
        // 他人 → 404
        match update_status_handler(
            st(),
            ext(sb),
            Path(r.0.id.clone()),
            Json(UpdateStatusRequest {
                status: "mated".to_string(),
            }),
        )
        .await
        {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound for cross-user update, got {other:?}"),
        }

        // 自分 → 204
        let s = update_status_handler(
            st(),
            ext(sa),
            Path(r.0.id.clone()),
            Json(UpdateStatusRequest {
                status: "mated".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(s, StatusCode::NO_CONTENT);

        let list = list_my_records(st(), ext(sa)).await.unwrap();
        assert_eq!(list.0[0].status, "mated");
    }

    #[tokio::test]
    async fn update_egg_count_rejects_negative() {
        let _g = lock_all();
        reset_all();
        let (sa, _) = login_session().await;
        let r = create_record(st(), ext(sa), Json(req("2026-04-01", "eggs_laid")))
            .await
            .unwrap();
        match update_egg_count_handler(
            st(),
            ext(sa),
            Path(r.0.id.clone()),
            Json(UpdateEggCountRequest { egg_count: -3 }),
        )
        .await
        {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("egg_count")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }
}
