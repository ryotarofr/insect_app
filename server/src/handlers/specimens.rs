//! `/api/v1/specimens/*` (Phase 9.D / 個体カルテ HTTP API)
//!
//! - `GET    /api/v1/specimens/me`              → current user の specimens 一覧
//! - `POST   /api/v1/specimens`                  → 新規 specimen を登録
//! - `GET    /api/v1/specimens/{public_id}`     → public_id で 1 件取得 (= 公開閲覧)
//! - `POST   /api/v1/specimens/{id}/archive`    → 自分の specimen を archive (= 論理削除)
//!
//! **Auth**:
//!   - `me` / `POST` / `archive` は **login user 必須** (= session.user_id が None なら 401)。
//!     `require_user_id(state, session_id)` ヘルパで握る。
//!   - `GET /{public_id}` は public 閲覧 OK (= ブラウザで個体カルテを見られる)。
//!
//! **未実装 (= 後続)**:
//!   - status 遷移時の `specimen_status_history` への INSERT 規律
//!   - `specimen_logs` / `mating_records` 用の専用 endpoint
//!   - 編集 (PATCH) endpoint

use axum::{Extension, Json, extract::{Path, State}, http::StatusCode};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::{specimens, user_sessions};
use crate::session::SessionId;
use crate::state::AppState;

// ──────────────────────────────────────────────────────────────────────
// auth guard helper
// ──────────────────────────────────────────────────────────────────────

/// session_id から user_id を引く。anonymous (= session.user_id が None) や session 行未登録は 401。
async fn require_user_id(
    state: &AppState,
    session_id: Uuid,
) -> Result<Uuid, AppError> {
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
pub struct SpecimenView {
    pub id: String,
    pub public_id: String,
    pub owner_user_id: String,
    pub species_id: String,
    pub name: String,
    pub sex: String,
    pub stage: String,
    pub stage_progress: f64,
    pub size_mm: Option<f64>,
    pub weight_g: Option<f64>,
    pub birth_date: Option<NaiveDate>,
    pub purchased_at: Option<NaiveDate>,
    pub generation: Option<String>,
    pub eclosion_eta: Option<NaiveDate>,
    pub life_status: String,
    pub is_archived: bool,
}

impl From<specimens::SpecimenRow> for SpecimenView {
    fn from(r: specimens::SpecimenRow) -> Self {
        Self {
            id: r.id.to_string(),
            public_id: r.public_id,
            owner_user_id: r.owner_user_id.to_string(),
            species_id: r.species_id,
            name: r.name,
            sex: r.sex,
            stage: r.stage,
            stage_progress: r.stage_progress,
            size_mm: r.size_mm,
            weight_g: r.weight_g,
            birth_date: r.birth_date,
            purchased_at: r.purchased_at,
            generation: r.generation,
            eclosion_eta: r.eclosion_eta,
            life_status: r.life_status,
            is_archived: r.is_archived,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateSpecimenRequest {
    pub public_id: String,                              // "#DHH-0271"
    pub species_id: String,                             // "dhh"
    pub name: String,                                   // "ヘラクレス 黒曜"
    pub sex: String,                                    // "male" / "female" / "unknown"
    pub stage: String,                                  // "幼虫 3齢" / "蛹" / "成虫" 等
    pub stage_progress: f64,                            // 0.0..=1.0
    pub size_mm: Option<f64>,
    pub weight_g: Option<f64>,
    pub birth_date: Option<NaiveDate>,
    pub purchased_at: Option<NaiveDate>,
    pub generation: Option<String>,
    pub eclosion_eta: Option<NaiveDate>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpecimenResponse {
    pub id: String,
    pub public_id: String,
}

// ──────────────────────────────────────────────────────────────────────
// handlers
// ──────────────────────────────────────────────────────────────────────

/// `GET /api/v1/specimens/me` — 現在 login 中の user の specimens を返す。archived は除外。
pub async fn list_my_specimens(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
) -> Result<Json<Vec<SpecimenView>>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let rows = specimens::find_by_owner(state.db(), user_id, false)
        .await
        .map_err(|e| AppError::BadRequest(format!("specimens fetch: {e}")))?;
    Ok(Json(rows.into_iter().map(SpecimenView::from).collect()))
}

/// `POST /api/v1/specimens` — 自分の所有 specimen を新規登録。
pub async fn create_specimen(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(req): Json<CreateSpecimenRequest>,
) -> Result<Json<CreateSpecimenResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;

    let id = specimens::insert(
        state.db(),
        specimens::SpecimenInsert {
            public_id: req.public_id.clone(),
            owner_user_id: user_id,
            species_id: req.species_id,
            name: req.name,
            sex: req.sex,
            stage: req.stage,
            stage_progress: req.stage_progress,
            size_mm: req.size_mm,
            weight_g: req.weight_g,
            birth_date: req.birth_date,
            purchased_at: req.purchased_at,
            purchased_from_shop_id: None,
            generation: req.generation,
            purchase_price_jpy: None,
            eclosion_eta: req.eclosion_eta,
            father_id: None,
            mother_id: None,
            father_label: None,
            mother_label: None,
            notes: req.notes,
        },
    )
    .await
    .map_err(|e| match e {
        specimens::SpecimenRepoError::Invalid(msg) => AppError::BadRequest(msg),
        specimens::SpecimenRepoError::Db(e) => {
            AppError::BadRequest(format!("could not register specimen: {e}"))
        }
        specimens::SpecimenRepoError::NotFound(_) => AppError::NotFound,
    })?;

    Ok(Json(CreateSpecimenResponse {
        id: id.to_string(),
        public_id: req.public_id,
    }))
}

/// `GET /api/v1/specimens/{public_id}` — public_id で 1 件取得 (= 公開閲覧 OK)。
pub async fn get_specimen(
    State(state): State<AppState>,
    Path(public_id): Path<String>,
) -> Result<Json<SpecimenView>, AppError> {
    let row = specimens::find_by_public_id(state.db(), &public_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("specimen lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    if row.is_archived {
        // archived は削除済みと等価扱いで 404
        return Err(AppError::NotFound);
    }
    Ok(Json(SpecimenView::from(row)))
}

// ──────────────────────────────────────────────────────────────────────
// life_status 遷移 + 履歴 (Phase 9.D / Medium #3)
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeLifeStatusRequest {
    /// "active" / "deceased" / "transferred" / "escaped"
    pub status: String,
    /// 死着日 / 譲渡日 / 脱走日。`changed_at` カラムに記録。
    pub changed_at: NaiveDate,
    /// 自由メモ。specimens.life_status_note と specimen_status_history.note の両方に書く。
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusHistoryView {
    pub id: String,
    pub specimen_id: String,
    pub status: String,
    pub changed_at: NaiveDate,
    pub note: Option<String>,
    pub author_user_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<crate::repos::specimen_status_history::StatusHistoryRow> for StatusHistoryView {
    fn from(r: crate::repos::specimen_status_history::StatusHistoryRow) -> Self {
        Self {
            id: r.id.to_string(),
            specimen_id: r.specimen_id.to_string(),
            status: r.status,
            changed_at: r.changed_at,
            note: r.note,
            author_user_id: r.author_user_id.to_string(),
            created_at: r.created_at,
        }
    }
}

/// `POST /api/v1/specimens/{id}/life_status` — life_status 遷移。所有者のみ操作可。
///
/// **Medium #3**: specimens.life_status の更新時は必ず本 endpoint 経由で
/// `repos::specimens::update_life_status` を呼び、specimen_status_history への履歴
/// INSERT が原子的に走る規律にしている。直接 UPDATE する経路は作らない。
pub async fn change_life_status(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(id): Path<String>,
    Json(req): Json<ChangeLifeStatusRequest>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let target_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;

    // 所有者チェック (= 他人の specimen の life_status を変えられない / 404 で吸収)
    let row = specimens::find_by_id(state.db(), target_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("specimen lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    if row.owner_user_id != user_id {
        return Err(AppError::NotFound);
    }

    specimens::update_life_status(
        state.db(),
        target_id,
        &req.status,
        req.changed_at,
        req.note.as_deref(),
        user_id,
    )
    .await
    .map_err(|e| match e {
        specimens::SpecimenRepoError::Invalid(msg) => AppError::BadRequest(msg),
        specimens::SpecimenRepoError::NotFound(_) => AppError::NotFound,
        other => AppError::BadRequest(format!("update_life_status: {other}")),
    })?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/v1/specimens/{id}/status_history` — life_status の遷移履歴を返す (= public 閲覧 OK)。
pub async fn list_status_history(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<StatusHistoryView>>, AppError> {
    let target_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;

    // specimen 不存在 / archived は 404 で吸収 (= 公開閲覧でも履歴は隠す)
    let specimen = specimens::find_by_id(state.db(), target_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("specimen lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    if specimen.is_archived {
        return Err(AppError::NotFound);
    }

    let rows = crate::repos::specimen_status_history::list_by_specimen(state.db(), target_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("status_history fetch: {e}")))?;
    Ok(Json(rows.into_iter().map(StatusHistoryView::from).collect()))
}

/// `POST /api/v1/specimens/{id}/archive` — 自分の specimen を archive する。
/// 他人の specimen を archive しようとすると 403 (= ここでは 404 で吸収)。
pub async fn archive_specimen(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let target_id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;

    // 所有者チェック (= 他人の archive を禁ずる)
    let row = specimens::find_by_id(state.db(), target_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("specimen lookup: {e}")))?
        .ok_or(AppError::NotFound)?;
    if row.owner_user_id != user_id {
        return Err(AppError::NotFound);
    }

    specimens::archive(state.db(), target_id).await.map_err(|e| match e {
        specimens::SpecimenRepoError::NotFound(_) => AppError::NotFound,
        other => AppError::BadRequest(format!("archive failed: {other}")),
    })?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::{user_sessions, users};

    fn st() -> State<AppState> {
        State(AppState::default())
    }
    fn ext(session_id: Uuid) -> Extension<SessionId> {
        Extension(SessionId(session_id))
    }

    /// users + user_sessions + specimens の 3 つの memory store を触るので、
    /// users::memory_guard を共通鍵にして逐次化する。
    fn lock_all() -> (
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
    ) {
        let u = users::memory_guard();
        let s = user_sessions::memory_guard();
        let sp = specimens::memory_guard();
        (u, s, sp)
    }

    fn create_req(public_id: &str) -> CreateSpecimenRequest {
        CreateSpecimenRequest {
            public_id: public_id.to_string(),
            species_id: "dhh".to_string(),
            name: "ヘラクレス test".to_string(),
            sex: "male".to_string(),
            stage: "幼虫 3齢".to_string(),
            stage_progress: 0.5,
            size_mm: Some(120.0),
            weight_g: Some(30.5),
            birth_date: None,
            purchased_at: None,
            generation: Some("CBF2".to_string()),
            eclosion_eta: None,
            notes: None,
        }
    }

    /// session を作成 + register でログイン状態にして user_id を返す。
    async fn login_session() -> (Uuid, Uuid) {
        let session = Uuid::new_v4();
        user_sessions::create_anonymous(None, session).await.unwrap();
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

    #[tokio::test]
    async fn list_my_specimens_returns_only_owned_active() {
        let _g = lock_all();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();

        let (session, _user_id) = login_session().await;

        // 自分の specimen を 2 つ作る
        let r1 = create_specimen(st(), ext(session), Json(create_req("#A-1")))
            .await
            .unwrap();
        let _ = create_specimen(st(), ext(session), Json(create_req("#A-2")))
            .await
            .unwrap();

        // 別 user の specimen も作る (= 漏れて見えないことを確認)
        let (session_b, _user_b) = login_session().await;
        let _ = create_specimen(st(), ext(session_b), Json(create_req("#B-1")))
            .await
            .unwrap();

        let res = list_my_specimens(st(), ext(session)).await.unwrap();
        assert_eq!(res.0.len(), 2, "自分の specimen 2 件");

        // archive すると一覧から消える
        archive_specimen(st(), ext(session), Path(r1.0.id.clone()))
            .await
            .unwrap();
        let res = list_my_specimens(st(), ext(session)).await.unwrap();
        assert_eq!(res.0.len(), 1, "archive 後は 1 件");
    }

    #[tokio::test]
    async fn list_my_specimens_returns_401_for_anonymous() {
        let _g = lock_all();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();

        let session = Uuid::new_v4();
        user_sessions::create_anonymous(None, session).await.unwrap();
        // attach_user していない → user_id None

        match list_my_specimens(st(), ext(session)).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn create_specimen_validates_fields() {
        let _g = lock_all();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();

        let (session, _) = login_session().await;

        // sex 無効 → 400
        let mut bad = create_req("#X-1");
        bad.sex = "alien".to_string();
        match create_specimen(st(), ext(session), Json(bad)).await {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("sex")),
            other => panic!("expected BadRequest, got {other:?}"),
        }

        // stage_progress 範囲外 → 400
        let mut bad = create_req("#X-2");
        bad.stage_progress = 1.5;
        match create_specimen(st(), ext(session), Json(bad)).await {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("stage_progress")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn get_specimen_by_public_id_works_for_anonymous() {
        let _g = lock_all();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();

        // owner で作成
        let (session, _user_id) = login_session().await;
        let _ = create_specimen(st(), ext(session), Json(create_req("#PUBLIC-1")))
            .await
            .unwrap();

        // 公開閲覧は anonymous でも OK (= /api/v1/specimens/{public_id})
        let res = get_specimen(st(), Path("#PUBLIC-1".to_string()))
            .await
            .expect("public read OK");
        assert_eq!(res.0.public_id, "#PUBLIC-1");
        assert_eq!(res.0.species_id, "dhh");
    }

    #[tokio::test]
    async fn get_specimen_returns_404_for_archived() {
        let _g = lock_all();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();

        let (session, _) = login_session().await;
        let r = create_specimen(st(), ext(session), Json(create_req("#GHOST-1")))
            .await
            .unwrap();
        archive_specimen(st(), ext(session), Path(r.0.id.clone()))
            .await
            .unwrap();

        match get_specimen(st(), Path("#GHOST-1".to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound for archived, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn archive_other_users_specimen_returns_404() {
        let _g = lock_all();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();

        let (session_a, _user_a) = login_session().await;
        let r = create_specimen(st(), ext(session_a), Json(create_req("#OWNED-A")))
            .await
            .unwrap();

        // 別 user (session_b) が archive を試みる
        let (session_b, _user_b) = login_session().await;
        match archive_specimen(st(), ext(session_b), Path(r.0.id.clone())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound for cross-user archive, got {other:?}"),
        }

        // owner_a の specimen は引き続き active
        let res = list_my_specimens(st(), ext(session_a)).await.unwrap();
        assert_eq!(res.0.len(), 1);
        assert!(!res.0[0].is_archived);
    }

    #[tokio::test]
    async fn archive_unknown_uuid_is_404() {
        let _g = lock_all();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();

        let (session, _) = login_session().await;
        // 不正な UUID (parse 失敗) → 404
        match archive_specimen(st(), ext(session), Path("not-a-uuid".to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    // ── life_status / status_history ─────────────────────────────

    fn lock_all_with_history() -> (
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
    ) {
        let u = users::memory_guard();
        let s = user_sessions::memory_guard();
        let sp = specimens::memory_guard();
        let h = crate::repos::specimen_status_history::memory_guard();
        (u, s, sp, h)
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[tokio::test]
    async fn change_life_status_records_history_and_updates_specimen() {
        let _g = lock_all_with_history();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();
        crate::repos::specimen_status_history::reset_memory_for_test();

        let (session, _user_id) = login_session().await;
        let r = create_specimen(st(), ext(session), Json(create_req("#LIFE-1")))
            .await
            .unwrap();

        let status = change_life_status(
            st(),
            ext(session),
            Path(r.0.id.clone()),
            Json(ChangeLifeStatusRequest {
                status: "deceased".to_string(),
                changed_at: d("2026-04-01"),
                note: Some("羽化失敗".to_string()),
            }),
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::NO_CONTENT);

        // specimens.life_status が更新されている
        let one = get_specimen(st(), Path("#LIFE-1".to_string())).await.unwrap();
        assert_eq!(one.0.life_status, "deceased");

        // history に 1 件積まれている
        let history = list_status_history(st(), Path(r.0.id.clone())).await.unwrap();
        assert_eq!(history.0.len(), 1);
        assert_eq!(history.0[0].status, "deceased");
        assert_eq!(history.0[0].note.as_deref(), Some("羽化失敗"));
        assert_eq!(history.0[0].changed_at, d("2026-04-01"));
    }

    #[tokio::test]
    async fn change_life_status_rejects_invalid_status() {
        let _g = lock_all_with_history();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();
        crate::repos::specimen_status_history::reset_memory_for_test();

        let (session, _) = login_session().await;
        let r = create_specimen(st(), ext(session), Json(create_req("#LIFE-2")))
            .await
            .unwrap();
        match change_life_status(
            st(),
            ext(session),
            Path(r.0.id.clone()),
            Json(ChangeLifeStatusRequest {
                status: "alive".to_string(), // CHECK 値域外
                changed_at: d("2026-04-01"),
                note: None,
            }),
        )
        .await
        {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("status")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn change_life_status_rejects_other_users_specimen() {
        let _g = lock_all_with_history();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();
        crate::repos::specimen_status_history::reset_memory_for_test();

        let (session_a, _) = login_session().await;
        let r = create_specimen(st(), ext(session_a), Json(create_req("#LIFE-3")))
            .await
            .unwrap();

        let (session_b, _) = login_session().await;
        match change_life_status(
            st(),
            ext(session_b),
            Path(r.0.id.clone()),
            Json(ChangeLifeStatusRequest {
                status: "deceased".to_string(),
                changed_at: d("2026-04-01"),
                note: None,
            }),
        )
        .await
        {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound for cross-user change, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_status_history_returns_descending_changes() {
        let _g = lock_all_with_history();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();
        crate::repos::specimen_status_history::reset_memory_for_test();

        let (session, _) = login_session().await;
        let r = create_specimen(st(), ext(session), Json(create_req("#LIFE-4")))
            .await
            .unwrap();

        // 3 回 status を遷移
        for (st_v, day) in [
            ("active", "2024-01-01"),
            ("deceased", "2026-04-10"),
            ("transferred", "2025-08-01"),
        ] {
            let _ = change_life_status(
                st(),
                ext(session),
                Path(r.0.id.clone()),
                Json(ChangeLifeStatusRequest {
                    status: st_v.to_string(),
                    changed_at: d(day),
                    note: None,
                }),
            )
            .await
            .unwrap();
        }

        let history = list_status_history(st(), Path(r.0.id.clone())).await.unwrap();
        assert_eq!(history.0.len(), 3);
        // changed_at 降順
        assert_eq!(history.0[0].changed_at, d("2026-04-10"));
        assert_eq!(history.0[1].changed_at, d("2025-08-01"));
        assert_eq!(history.0[2].changed_at, d("2024-01-01"));
    }

    #[tokio::test]
    async fn list_status_history_404_for_archived_specimen() {
        let _g = lock_all_with_history();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        specimens::reset_memory_for_test();
        crate::repos::specimen_status_history::reset_memory_for_test();

        let (session, _) = login_session().await;
        let r = create_specimen(st(), ext(session), Json(create_req("#LIFE-5")))
            .await
            .unwrap();
        archive_specimen(st(), ext(session), Path(r.0.id.clone()))
            .await
            .unwrap();
        match list_status_history(st(), Path(r.0.id.clone())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound for archived, got {other:?}"),
        }
    }
}
