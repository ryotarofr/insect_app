//! `/api/v1/cohorts/*` (群飼育 HTTP API)
//!
//! - `GET    /api/v1/cohorts/me`                    → 一覧 (default active のみ、?archived=true で archived)
//! - `POST   /api/v1/cohorts`                       → 群を作成
//! - `GET    /api/v1/cohorts/{public_id}`           → 群詳細 + 直近ログ + 個体化済み件数
//! - `POST   /api/v1/cohorts/{public_id}/promote`   → 個体化 1 件 (transactional)
//! - `POST   /api/v1/cohorts/{public_id}/archive`   → 中断アーカイブ
//! - `POST   /api/v1/cohorts/{public_id}/cohort_logs` → 群ログ追加 (一括ログ)
//!
//! **Auth**: 全 endpoint で login user 必須 (= 401 if anonymous)。

use axum::{
    Extension, Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::error::AppError;
use crate::handlers::require_user_id;
use crate::repos::{cohort_logs, cohorts, specimens};
use crate::session::SessionId;
use crate::state::AppState;

// ──────────────────────────────────────────────────────────────────────
// auth
// ──────────────────────────────────────────────────────────────────────

/// 自分の cohort かどうかを確認 (= 他人の cohort へのアクセスを 404 で隠す)
async fn require_owned(
    state: &AppState,
    public_id: &str,
    user_id: Uuid,
) -> Result<cohorts::CohortRow, AppError> {
    let row = cohorts::find_by_public_id(state.db(), public_id)
        .await
        .map_err(map_cohort_err)?
        .ok_or(AppError::NotFound)?;
    if row.owner_user_id != user_id {
        return Err(AppError::NotFound);
    }
    Ok(row)
}

fn map_cohort_err(e: cohorts::CohortRepoError) -> AppError {
    use cohorts::CohortRepoError::*;
    match e {
        Invalid(msg) => AppError::BadRequest(msg),
        Db(err) => AppError::BadRequest(format!("db: {err}")),
        NotFound(_) => AppError::NotFound,
        AlreadyArchived(_) => AppError::BadRequest("cohort already archived".to_string()),
        Empty(_) => AppError::BadRequest("cohort is empty (current_count = 0)".to_string()),
    }
}

// ──────────────────────────────────────────────────────────────────────
// DTO
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CohortView {
    pub id: String,
    pub public_id: String,
    pub owner_user_id: String,
    pub species_id: String,
    pub name: Option<String>,
    pub bloodline_name: Option<String>,
    pub origin_kind: String,
    pub parent_mating_id: Option<String>,
    pub initial_count: i32,
    pub current_count: i32,
    pub stage: String,
    pub start_date: NaiveDate,
    pub notes: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<cohorts::CohortRow> for CohortView {
    fn from(r: cohorts::CohortRow) -> Self {
        Self {
            id: r.id.to_string(),
            public_id: r.public_id,
            owner_user_id: r.owner_user_id.to_string(),
            species_id: r.species_id,
            name: r.name,
            bloodline_name: r.bloodline_name,
            origin_kind: r.origin_kind,
            parent_mating_id: r.parent_mating_id.map(|u| u.to_string()),
            initial_count: r.initial_count,
            current_count: r.current_count,
            stage: r.stage,
            start_date: r.start_date,
            notes: r.notes,
            archived_at: r.archived_at,
            version: r.version,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CohortLogView {
    pub id: String,
    pub cohort_id: String,
    pub log_type: String,
    pub count_delta: Option<i32>,
    /// 任意 JSON object として表現するため `HashMap<String, serde_json::Value>` を value_type に指定
    /// (utoipa 5 は `serde_json::Value` を直接スキーマ化できないため / specimen_logs と同じ規律)。
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    pub metrics: Option<JsonValue>,
    pub body: Option<String>,
    pub logged_at: DateTime<Utc>,
    pub author_user_id: String,
}

impl From<cohort_logs::CohortLogRow> for CohortLogView {
    fn from(r: cohort_logs::CohortLogRow) -> Self {
        Self {
            id: r.id.to_string(),
            cohort_id: r.cohort_id.to_string(),
            log_type: r.log_type,
            count_delta: r.count_delta,
            metrics: r.metrics,
            body: r.body,
            logged_at: r.logged_at,
            author_user_id: r.author_user_id.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CohortDetailView {
    #[serde(flatten)]
    pub cohort: CohortView,
    pub recent_logs: Vec<CohortLogView>,
    pub promoted_specimens_count: i64,
}

// ── request payloads

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateCohortRequest {
    /// 省略時は handler 側で LOT-{YYYY}-NNNN を採番
    pub public_id: Option<String>,
    pub species_id: String,
    pub name: Option<String>,
    pub bloodline_name: Option<String>,
    pub origin_kind: String,
    pub parent_mating_id: Option<Uuid>,
    pub initial_count: i32,
    pub stage: String,
    pub start_date: NaiveDate,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCohortResponse {
    pub id: String,
    pub public_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListCohortsQuery {
    #[serde(default)]
    pub archived: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteSpecimenPayload {
    /// 省略時は handler 側で 種prefix-{YYYY}-NNNN を採番
    pub public_id: Option<String>,
    pub name: Option<String>,
    pub sex: Option<String>,
    pub stage: Option<String>,
    pub weight_g: Option<f64>,
    pub size_mm: Option<f64>,
    pub father_id: Option<Uuid>,
    pub mother_id: Option<Uuid>,
    pub father_label: Option<String>,
    pub mother_label: Option<String>,
    pub generation: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteLogPayload {
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    pub metrics: Option<JsonValue>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteCohortRequest {
    pub specimen: PromoteSpecimenPayload,
    pub log: Option<PromoteLogPayload>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromoteCohortResponse {
    pub specimen: PromotedSpecimenView,
    pub cohort: CohortView,
    pub session: PromoteSessionState,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromotedSpecimenView {
    pub id: String,
    pub public_id: String,
    pub name: Option<String>,
    pub sex: Option<String>,
    pub stage: String,
    pub weight_g: Option<f64>,
    pub size_mm: Option<f64>,
    pub cohort_id: String,
    pub promoted_from_cohort_at: DateTime<Utc>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromoteSessionState {
    pub remaining_in_cohort: i32,
    pub completed: bool,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateCohortLogRequest {
    pub log_type: String,
    pub count_delta: Option<i32>,
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    pub metrics: Option<JsonValue>,
    pub body: Option<String>,
}

// ──────────────────────────────────────────────────────────────────────
// handlers
// ──────────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/cohorts/me",
    tag = "cohorts",
    params(
        ("archived" = Option<bool>, Query, description = "true で archived 込み (default false = active のみ)"),
    ),
    responses(
        (status = 200, description = "自分の cohort 一覧", body = Vec<CohortView>),
        (status = 401, description = "anonymous", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn list_my_cohorts(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Query(q): Query<ListCohortsQuery>,
) -> Result<Json<Vec<CohortView>>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let include_archived = q.archived.unwrap_or(false);
    let rows = cohorts::list_by_owner(state.db(), user_id, include_archived)
        .await
        .map_err(map_cohort_err)?;
    Ok(Json(rows.into_iter().map(CohortView::from).collect()))
}

#[utoipa::path(
    post,
    path = "/cohorts",
    tag = "cohorts",
    request_body = CreateCohortRequest,
    responses(
        (status = 200, description = "作成成功", body = CreateCohortResponse),
        (status = 400, description = "入力 invalid (= species / origin_kind / count 等)", body = crate::openapi::ErrorResponse),
        (status = 401, description = "anonymous", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn create_cohort(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(req): Json<CreateCohortRequest>,
) -> Result<Json<CreateCohortResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;

    let public_id = match req.public_id {
        Some(p) if !p.trim().is_empty() => p,
        _ => generate_lot_id(&state, user_id).await?,
    };

    let id = cohorts::insert(
        state.db(),
        cohorts::CohortInsert {
            public_id: public_id.clone(),
            owner_user_id: user_id,
            species_id: req.species_id,
            name: req.name,
            bloodline_name: req.bloodline_name,
            origin_kind: req.origin_kind,
            parent_mating_id: req.parent_mating_id,
            initial_count: req.initial_count,
            stage: req.stage,
            start_date: req.start_date,
            notes: req.notes,
        },
    )
    .await
    .map_err(map_cohort_err)?;

    Ok(Json(CreateCohortResponse {
        id: id.to_string(),
        public_id,
    }))
}

#[utoipa::path(
    get,
    path = "/cohorts/{public_id}",
    tag = "cohorts",
    params(
        ("public_id" = String, Path, description = "cohort.public_id (= LOT-YYYY-NNNN)"),
    ),
    responses(
        (status = 200, description = "詳細 + 直近ログ + 個体化済み件数", body = CohortDetailView),
        (status = 401, description = "anonymous", body = crate::openapi::ErrorResponse),
        (status = 404, description = "他人の cohort または不存在", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn get_cohort(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(public_id): Path<String>,
) -> Result<Json<CohortDetailView>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let row = require_owned(&state, &public_id, user_id).await?;
    let cohort_id = row.id;

    // 直近ログ
    let logs = cohort_logs::list_by_cohort(state.db(), cohort_id, 10)
        .await
        .map_err(|e| AppError::BadRequest(format!("cohort_logs fetch: {e}")))?;

    // 個体化済み件数 (= specimens.cohort_id でカウント)。pool が None なら 0 を返す。
    let promoted_count: i64 = match state.db() {
        Some(p) => sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM specimens WHERE cohort_id = $1",
        )
        .bind(cohort_id)
        .fetch_one(p)
        .await
        .map_err(|e| AppError::BadRequest(format!("count: {e}")))?,
        None => 0,
    };

    Ok(Json(CohortDetailView {
        cohort: row.into(),
        recent_logs: logs.into_iter().map(CohortLogView::from).collect(),
        promoted_specimens_count: promoted_count,
    }))
}

#[utoipa::path(
    post,
    path = "/cohorts/{public_id}/promote",
    tag = "cohorts",
    params(
        ("public_id" = String, Path, description = "cohort.public_id"),
    ),
    request_body = PromoteCohortRequest,
    responses(
        (status = 200, description = "個体化成功 (= 1 specimen 生成 + cohort.current_count -1)", body = PromoteCohortResponse),
        (status = 400, description = "入力 invalid / cohort empty / archived 等", body = crate::openapi::ErrorResponse),
        (status = 401, description = "anonymous", body = crate::openapi::ErrorResponse),
        (status = 404, description = "他人の cohort または不存在", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn promote_cohort(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(public_id): Path<String>,
    Json(req): Json<PromoteCohortRequest>,
) -> Result<Json<PromoteCohortResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let cohort = require_owned(&state, &public_id, user_id).await?;

    let pool = state
        .db()
        .ok_or_else(|| AppError::BadRequest("DB pool required for promote".to_string()))?;

    // 自動採番は species_id を見て {prefix}-{YYYY}-{NNNN} 形式で出す。
    let specimen_public_id = match req.specimen.public_id.clone() {
        Some(p) if !p.trim().is_empty() => p,
        _ => generate_specimen_id(pool, &cohort.species_id).await?,
    };

    // 親情報の継承: parent_mating_id があり、payload で father/mother 未指定なら継承する。
    let (father_id, mother_id, father_label, mother_label, gen_inherited) =
        resolve_parents(pool, &cohort, &req.specimen).await?;

    // 累代: payload 指定 > 継承値 > None
    let generation_str = req
        .specimen
        .generation
        .or(gen_inherited)
        .map(|n| format!("F{n}"));

    let specimen_insert = specimens::SpecimenInsert {
        public_id: specimen_public_id.clone(),
        owner_user_id: user_id,
        species_id: cohort.species_id.clone(),
        name: req.specimen.name.clone().unwrap_or_default(),
        sex: req.specimen.sex.clone().unwrap_or_else(|| "unknown".to_string()),
        stage: req.specimen.stage.clone().unwrap_or_else(|| "larva_l3".to_string()),
        stage_progress: 0.0,
        size_mm: req.specimen.size_mm,
        weight_g: req.specimen.weight_g,
        birth_date: None,
        purchased_at: None,
        purchased_from_shop_id: None,
        generation: generation_str,
        purchase_price_jpy: None,
        eclosion_eta: None,
        father_id,
        mother_id,
        father_label,
        mother_label,
        notes: req.specimen.notes.clone(),
    };

    let result = cohorts::promote_one(pool, cohort.id, &specimen_insert)
        .await
        .map_err(map_cohort_err)?;

    // ログ自動追加 (= 個体化イベント)
    let log_payload = req.log.unwrap_or(PromoteLogPayload {
        metrics: None,
        body: None,
    });
    let _ = cohort_logs::insert(
        state.db(),
        cohort_logs::CohortLogInsert {
            cohort_id: cohort.id,
            log_type: "observation".to_string(),
            count_delta: None,
            metrics: log_payload.metrics,
            body: log_payload.body,
            author_user_id: user_id,
        },
    )
    .await
    .map_err(|e| AppError::BadRequest(format!("cohort_log insert: {e}")))?;

    let cohort_after = result.cohort_after.clone();
    Ok(Json(PromoteCohortResponse {
        specimen: PromotedSpecimenView {
            id: result.specimen_id.to_string(),
            public_id: specimen_public_id,
            name: req.specimen.name,
            sex: req.specimen.sex,
            stage: req
                .specimen
                .stage
                .unwrap_or_else(|| "larva_l3".to_string()),
            weight_g: req.specimen.weight_g,
            size_mm: req.specimen.size_mm,
            cohort_id: cohort.id.to_string(),
            promoted_from_cohort_at: Utc::now(),
            notes: req.specimen.notes,
        },
        session: PromoteSessionState {
            remaining_in_cohort: cohort_after.current_count,
            completed: cohort_after.archived_at.is_some(),
        },
        cohort: cohort_after.into(),
    }))
}

#[utoipa::path(
    post,
    path = "/cohorts/{public_id}/archive",
    tag = "cohorts",
    params(
        ("public_id" = String, Path, description = "cohort.public_id"),
    ),
    responses(
        (status = 200, description = "archive 成功 (= archived_at 確定)", body = CohortView),
        (status = 401, description = "anonymous", body = crate::openapi::ErrorResponse),
        (status = 404, description = "他人の cohort または不存在", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn archive_cohort(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(public_id): Path<String>,
) -> Result<Json<CohortView>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let row = require_owned(&state, &public_id, user_id).await?;
    cohorts::archive(state.db(), row.id)
        .await
        .map_err(map_cohort_err)?;
    let updated = cohorts::find_by_id(state.db(), row.id)
        .await
        .map_err(map_cohort_err)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(updated.into()))
}

#[utoipa::path(
    post,
    path = "/cohorts/{public_id}/cohort_logs",
    tag = "cohorts",
    params(
        ("public_id" = String, Path, description = "cohort.public_id"),
    ),
    request_body = CreateCohortLogRequest,
    responses(
        (status = 200, description = "log 追加成功", body = CohortLogView),
        (status = 400, description = "log_type / metrics 形式 invalid", body = crate::openapi::ErrorResponse),
        (status = 401, description = "anonymous", body = crate::openapi::ErrorResponse),
        (status = 404, description = "他人の cohort または不存在", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn add_cohort_log(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(public_id): Path<String>,
    Json(req): Json<CreateCohortLogRequest>,
) -> Result<Json<CohortLogView>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let cohort = require_owned(&state, &public_id, user_id).await?;
    let id = cohort_logs::insert(
        state.db(),
        cohort_logs::CohortLogInsert {
            cohort_id: cohort.id,
            log_type: req.log_type.clone(),
            count_delta: req.count_delta,
            metrics: req.metrics.clone(),
            body: req.body.clone(),
            author_user_id: user_id,
        },
    )
    .await
    .map_err(|e| AppError::BadRequest(format!("cohort_log insert: {e}")))?;
    // 直近の 1 件として返す
    let logs = cohort_logs::list_by_cohort(state.db(), cohort.id, 1)
        .await
        .map_err(|e| AppError::BadRequest(format!("cohort_log fetch: {e}")))?;
    let row = logs
        .into_iter()
        .find(|r| r.id == id)
        .ok_or(AppError::NotFound)?;
    Ok(Json(row.into()))
}

// ──────────────────────────────────────────────────────────────────────
// helpers: 採番 / 親情報継承
// ──────────────────────────────────────────────────────────────────────

async fn generate_lot_id(
    state: &AppState,
    user_id: Uuid,
) -> Result<String, AppError> {
    let year = Utc::now().format("%Y").to_string();
    let prefix = format!("LOT-{year}-");
    let existing = cohorts::list_by_owner(state.db(), user_id, true)
        .await
        .map_err(map_cohort_err)?;
    let mut max = 0;
    for r in existing {
        if let Some(rest) = r.public_id.strip_prefix(&prefix) {
            if let Ok(n) = rest.parse::<u32>() {
                if n > max {
                    max = n;
                }
            }
        }
    }
    Ok(format!("{prefix}{:04}", max + 1))
}

async fn generate_specimen_id(
    pool: &sqlx::PgPool,
    species_id: &str,
) -> Result<String, AppError> {
    // species prefix を 2 文字に: dhh → DH, cat → CA, neo → NE 等。
    let prefix2: String = species_id.chars().take(2).collect::<String>().to_uppercase();
    let year = Utc::now().format("%Y").to_string();
    let prefix = format!("{prefix2}-{year}-");

    let max: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT COALESCE(MAX(CAST(SUBSTRING(public_id FROM LENGTH($1) + 1) AS BIGINT)), 0)
        FROM specimens
        WHERE public_id LIKE $1 || '%'
          AND SUBSTRING(public_id FROM LENGTH($1) + 1) ~ '^[0-9]+$'
        "#,
    )
    .bind(&prefix)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::BadRequest(format!("specimen seq: {e}")))?;

    let next = max.unwrap_or(0) + 1;
    Ok(format!("{prefix}{:04}", next))
}

/// parent_mating_id 経由で father/mother を継承。payload で明示指定があれば優先。
async fn resolve_parents(
    pool: &sqlx::PgPool,
    cohort: &cohorts::CohortRow,
    payload: &PromoteSpecimenPayload,
) -> Result<
    (
        Option<Uuid>,
        Option<Uuid>,
        Option<String>,
        Option<String>,
        Option<i32>,
    ),
    AppError,
> {
    if payload.father_id.is_some()
        || payload.mother_id.is_some()
        || payload.father_label.is_some()
        || payload.mother_label.is_some()
    {
        return Ok((
            payload.father_id,
            payload.mother_id,
            payload.father_label.clone(),
            payload.mother_label.clone(),
            None,
        ));
    }
    let Some(mating_id) = cohort.parent_mating_id else {
        return Ok((None, None, None, None, None));
    };
    // mating_records から father/mother を引く。形式は repos::mating_records 依存。
    let row: Option<(Option<Uuid>, Option<Uuid>, Option<String>, Option<String>)> =
        sqlx::query_as(
            r#"
            SELECT father_id, mother_id, father_label, mother_label
            FROM mating_records
            WHERE id = $1
            "#,
        )
        .bind(mating_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::BadRequest(format!("mating fetch: {e}")))?;
    let Some((fid, mid, flab, mlab)) = row else {
        return Ok((None, None, None, None, None));
    };

    // 累代継承: father.generation と mother.generation の MAX + 1。失敗しても None で続行。
    let inherited_gen = compute_inherited_generation(pool, fid, mid).await.ok();

    Ok((fid, mid, flab, mlab, inherited_gen))
}

async fn compute_inherited_generation(
    pool: &sqlx::PgPool,
    father_id: Option<Uuid>,
    mother_id: Option<Uuid>,
) -> Result<i32, sqlx::Error> {
    let father_gen = parent_gen(pool, father_id).await?;
    let mother_gen = parent_gen(pool, mother_id).await?;
    Ok(std::cmp::max(father_gen, mother_gen).saturating_add(1))
}

async fn parent_gen(pool: &sqlx::PgPool, id: Option<Uuid>) -> Result<i32, sqlx::Error> {
    let Some(id) = id else { return Ok(0) };
    let g: Option<String> =
        sqlx::query_scalar("SELECT generation FROM specimens WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .flatten();
    Ok(g.and_then(|s| s.trim_start_matches('F').parse::<i32>().ok())
        .unwrap_or(0))
}
