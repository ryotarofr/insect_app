//! `/api/v1/specimens/{id}/logs` (Phase 9.D / 飼育ログ HTTP API)
//!
//! - `GET  /api/v1/specimens/{id}/logs`  → 公開閲覧。logged_at 降順で返す。
//! - `POST /api/v1/specimens/{id}/logs`  → 自分の specimen にログ追加 (= login 必須)。
//!
//! `{id}` は **specimen の internal UUID** (= specimens.id) を渡す。
//! 公開 specimens の閲覧は public_id 経由 (= /specimens/{public_id}) なので、
//! ログ追加 / 取得は内部 UUID を使う。
//!
//! **author_user_id** は session.user_id に固定 (= 他人になりすませない)。

use axum::{
    Extension, Json,
    extract::{Path, State},
};
use chrono::{NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::{specimen_logs, specimens, user_sessions};
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
pub struct SpecimenLogView {
    pub id: String,
    pub specimen_id: String,
    pub author_user_id: String,
    pub log_type: String,
    pub logged_at: NaiveDate,
    pub logged_at_time: Option<NaiveTime>,
    pub title: String,
    pub body: String,
    pub has_photo: bool,
    /// 構造化 metrics (= log_type ごとに JSONB で柔軟に持つ)。例: weight log なら `{ "weight_g": 28.4 }`。
    /// 任意 JSON object として表現するため `HashMap<String, serde_json::Value>` を value_type に指定
    /// (= OpenAPI で `type: object, additionalProperties: ...` を emit / TS 側 `Record<string, unknown>`)。
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    pub metrics: Value,
}

impl From<specimen_logs::SpecimenLogRow> for SpecimenLogView {
    fn from(r: specimen_logs::SpecimenLogRow) -> Self {
        Self {
            id: r.id.to_string(),
            specimen_id: r.specimen_id.to_string(),
            author_user_id: r.author_user_id.to_string(),
            log_type: r.log_type,
            logged_at: r.logged_at,
            logged_at_time: r.logged_at_time,
            title: r.title,
            body: r.body,
            has_photo: r.has_photo,
            metrics: r.metrics,
        }
    }
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateSpecimenLogRequest {
    pub log_type: String,                               // "weight" / "feed" / "mat" / "molt" / "observation"
    pub logged_at: NaiveDate,
    pub logged_at_time: Option<NaiveTime>,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub has_photo: bool,
    /// 構造化 metrics (= log_type ごとに JSONB で柔軟に持つ)。例: weight log なら `{ "weight_g": 28.4 }`。
    /// 任意 JSON object として表現するため `HashMap<String, serde_json::Value>` を value_type に指定
    /// (= OpenAPI で `type: object, additionalProperties: ...` を emit / TS 側 `Record<string, unknown>`)。
    #[serde(default = "default_metrics")]
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    pub metrics: Value,
}

fn default_metrics() -> Value {
    Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpecimenLogResponse {
    pub id: String,
}

/// `GET /api/v1/me/logs` — login user の所有 specimens 全体のログを横断で返す。
/// マイページの「今月のログ」KPI / `listLogs()` 互換 (= フロント data.ts 移行)。
#[utoipa::path(
    get,
    path = "/me/logs",
    tag = "specimens",
    responses(
        (status = 200, description = "login user の全 specimen ログを横断で返す", body = Vec<SpecimenLogView>),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn list_my_logs(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
) -> Result<Json<Vec<SpecimenLogView>>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let rows = specimen_logs::list_by_user_id(state.db(), user_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("logs fetch: {e}")))?;
    Ok(Json(rows.into_iter().map(SpecimenLogView::from).collect()))
}

/// `GET /api/v1/specimens/{id}/logs` — 1 specimen の log を時系列降順で返す。public 閲覧 OK。
#[utoipa::path(
    get,
    path = "/specimens/{id}/logs",
    tag = "specimens",
    params(
        ("id" = String, Path, description = "specimen の internal UUID (= specimens.id)"),
    ),
    responses(
        (status = 200, description = "log を logged_at 降順で返す", body = Vec<SpecimenLogView>),
        (status = 404, description = "specimen 不存在 / archived", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn list_logs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<SpecimenLogView>>, AppError> {
    let specimen_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;
    // specimen の存在確認 (= 不存在 / archived は 404)。
    let specimen = specimens::find_by_id(state.db(), specimen_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("specimen lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    if specimen.is_archived {
        return Err(AppError::NotFound);
    }
    let rows = specimen_logs::list_by_specimen(state.db(), specimen_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("logs fetch: {e}")))?;
    Ok(Json(rows.into_iter().map(SpecimenLogView::from).collect()))
}

/// `POST /api/v1/specimens/{id}/logs` — 自分の specimen にログ追加。login + 所有者必須。
#[utoipa::path(
    post,
    path = "/specimens/{id}/logs",
    tag = "specimens",
    params(
        ("id" = String, Path, description = "specimen の internal UUID (= specimens.id)"),
    ),
    request_body = CreateSpecimenLogRequest,
    responses(
        (status = 200, description = "ログ作成成功", body = CreateSpecimenLogResponse),
        (status = 400, description = "log_type 不正 / archived specimen", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
        (status = 404, description = "specimen 不存在 / 所有者でない (= account enumeration 防御で 404)", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn create_log(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(id): Path<String>,
    Json(req): Json<CreateSpecimenLogRequest>,
) -> Result<Json<CreateSpecimenLogResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let specimen_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;

    // 所有者チェック (= 他人の specimen にログを書けない)
    let specimen = specimens::find_by_id(state.db(), specimen_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("specimen lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    if specimen.owner_user_id != user_id {
        return Err(AppError::NotFound);
    }
    if specimen.is_archived {
        return Err(AppError::BadRequest(
            "cannot add logs to archived specimen".to_string(),
        ));
    }

    let new_id = specimen_logs::insert(
        state.db(),
        specimen_logs::SpecimenLogInsert {
            specimen_id,
            author_user_id: user_id,
            log_type: req.log_type,
            logged_at: req.logged_at,
            logged_at_time: req.logged_at_time,
            title: req.title,
            body: req.body,
            has_photo: req.has_photo,
            metrics: req.metrics,
        },
    )
    .await
    .map_err(|e| match e {
        specimen_logs::SpecimenLogRepoError::Invalid(msg) => AppError::BadRequest(msg),
        specimen_logs::SpecimenLogRepoError::Db(e) => {
            AppError::BadRequest(format!("log insert: {e}"))
        }
    })?;

    Ok(Json(CreateSpecimenLogResponse {
        id: new_id.to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::{specimen_logs, specimens, user_sessions, users};

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
        std::sync::MutexGuard<'static, ()>,
    ) {
        let u = users::memory_guard();
        let s = user_sessions::memory_guard();
        let sp = specimens::memory_guard();
        let lg = specimen_logs::memory_guard();
        (u, s, sp, lg)
    }

    fn reset_all() {
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();
        specimen_logs::reset_memory_for_test();
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

    /// 1 specimen を作って (specimen_id, owner_session) を返す。
    async fn seed_specimen(owner_session: Uuid) -> Uuid {
        let owner = user_sessions::find_by_id(None, owner_session)
            .await
            .unwrap()
            .unwrap()
            .user_id
            .unwrap();
        specimens::insert(
            None,
            specimens::SpecimenInsert {
                public_id: format!("#TEST-{}", &owner_session.to_string()[..6]),
                owner_user_id: owner,
                species_id: "dhh".to_string(),
                name: "テスト個体".to_string(),
                sex: "male".to_string(),
                stage: "幼虫 3齢".to_string(),
                stage_progress: 0.5,
                size_mm: None,
                weight_g: None,
                birth_date: None,
                purchased_at: None,
                purchased_from_shop_id: None,
                generation: None,
                purchase_price_jpy: None,
                eclosion_eta: None,
                father_id: None,
                mother_id: None,
                father_label: None,
                mother_label: None,
                notes: None,
            },
        )
        .await
        .unwrap()
    }

    fn req(log_type: &str) -> CreateSpecimenLogRequest {
        CreateSpecimenLogRequest {
            log_type: log_type.to_string(),
            logged_at: NaiveDate::from_ymd_opt(2026, 4, 1).unwrap(),
            logged_at_time: None,
            title: "計測".to_string(),
            body: "test body".to_string(),
            has_photo: false,
            metrics: serde_json::json!({"weight_g": 28.4}),
        }
    }

    #[tokio::test]
    async fn create_log_then_list() {
        let _g = lock_all();
        reset_all();

        let (session, _) = login_session().await;
        let specimen_id = seed_specimen(session).await;

        let r = create_log(st(), ext(session), Path(specimen_id.to_string()), Json(req("weight")))
            .await
            .unwrap();
        assert!(!r.0.id.is_empty());

        let list = list_logs(st(), Path(specimen_id.to_string())).await.unwrap();
        assert_eq!(list.0.len(), 1);
        assert_eq!(list.0[0].log_type, "weight");
        assert_eq!(list.0[0].metrics["weight_g"], 28.4);
    }

    #[tokio::test]
    async fn create_log_requires_login() {
        let _g = lock_all();
        reset_all();

        let session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        // attach_user していない
        match create_log(st(), ext(session), Path(Uuid::new_v4().to_string()), Json(req("weight")))
            .await
        {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn create_log_rejects_other_users_specimen() {
        let _g = lock_all();
        reset_all();

        let (session_a, _) = login_session().await;
        let specimen_id = seed_specimen(session_a).await;

        let (session_b, _) = login_session().await;
        // 他人の specimen にログ追加 → 404 で吸収
        match create_log(
            st(),
            ext(session_b),
            Path(specimen_id.to_string()),
            Json(req("feed")),
        )
        .await
        {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn create_log_rejects_invalid_log_type() {
        let _g = lock_all();
        reset_all();

        let (session, _) = login_session().await;
        let specimen_id = seed_specimen(session).await;
        match create_log(
            st(),
            ext(session),
            Path(specimen_id.to_string()),
            Json(req("dance")),
        )
        .await
        {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("log_type")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_logs_404_for_unknown_specimen() {
        let _g = lock_all();
        reset_all();
        match list_logs(st(), Path(Uuid::new_v4().to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_logs_404_for_archived_specimen() {
        let _g = lock_all();
        reset_all();

        let (session, _) = login_session().await;
        let specimen_id = seed_specimen(session).await;
        specimens::archive(None, specimen_id).await.unwrap();
        match list_logs(st(), Path(specimen_id.to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound for archived, got {other:?}"),
        }
    }
}
