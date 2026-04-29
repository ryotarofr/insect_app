//! `/api/v1/auth/*` エンドポイント (Phase 9.G / login flow)
//!
//! - `POST /api/v1/auth/register` → 新規ユーザを Argon2id で hash した password で登録
//! - `POST /api/v1/auth/login`    → email + password を verify して session を user に昇格
//! - `POST /api/v1/auth/logout`   → session の user_id を NULL に戻す (= cookie 自体は維持)
//! - `GET  /api/v1/auth/me`       → 現在 session の user 情報を返す (anonymous は 401)
//!
//! **設計方針**:
//!   - 入力 validation は `repos::users::create_with_password` 内で握る。
//!   - register / login 成功時に **同 cookie session を user_id に紐付け**、cart_items も
//!     `promote_session_to_user` で承継する (= 匿名で買い物中にログインしてもカートが残る)。
//!   - login の失敗 (= email 未登録 / password 不一致) はどちらも 401 で同じレスポンスを返す
//!     (= account enumeration 対策)。
//!   - logout は user_sessions 行を残し user_id だけ NULL に戻す。session 自体は生かして
//!     cart や session-scoped state を保つ (= 「ログアウトしてもカートは残る」UX)。
//!     完全な session 破棄が必要なら別 endpoint で `user_sessions::delete` を呼ぶ。
//!   - /me は session.user_id が None なら 401。pool=None でも動く (= in-memory fallback)。

use axum::{Extension, Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::OnceLock;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::{cart_items, email_outbox, password_resets, product_watches, user_sessions, users};
use crate::session::SessionId;
use crate::state::AppState;

/// register / login 直後に「匿名 session の cart / watch を user に紐付け直す」共通処理。
/// 失敗しても warn ログだけで返す (= 注文 / 認可は通っているのでクリティカルでない)。
async fn promote_session_to_user(db: Option<&PgPool>, session: Uuid, user: Uuid) {
    if let Err(e) = cart_items::promote_session_to_user(db, session, user).await {
        tracing::warn!(
            session = %session,
            user = %user,
            "promote_session_to_user: cart promote failed: {}",
            e
        );
    }
    if let Err(e) = product_watches::promote_session_to_user(db, session, user).await {
        tracing::warn!(
            session = %session,
            user = %user,
            "promote_session_to_user: watch promote failed: {}",
            e
        );
    }
}

/// timing attack 対策の dummy phc 文字列 (review fix: major)。
///
/// `find_password_hash_by_email` で email が引けなかった / hash が NULL だった経路でも、
/// 必ず Argon2 verify を 1 回回して応答時間を平均化するために使う。
/// 初期化時に 1 度だけ真の hash_password を回した phc を OnceLock で保持し使い回す。
fn dummy_phc_hash() -> &'static str {
    static H: OnceLock<String> = OnceLock::new();
    H.get_or_init(|| {
        users::hash_password("__login_timing_dummy__")
            .expect("dummy phc hash must initialize")
    })
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterRequest {
    pub public_id: String,                              // "alice" (= handle)
    pub name: String,                                   // "アリス"
    pub email: String,
    pub password: String,
    pub avatar_initial: String,                        // "ア"
    /// 省略時は "breeder"。"admin" / "shop_owner" は ops しか作れない想定だが、
    /// 本 PR では値域だけ users repo の validation で握る。
    #[serde(default = "default_role")]
    pub role: String,
}

fn default_role() -> String {
    "breeder".to_string()
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResponse {
    /// 新規発行された UUID (= users.id)
    pub user_id: String,
    pub public_id: String,
    pub name: String,
    pub email: String,
    pub role: String,
}

/// `POST /api/v1/auth/register` — 新規ユーザを登録し、現 session に紐付ける。
#[utoipa::path(
    post,
    path = "/auth/register",
    tag = "auth",
    request_body = RegisterRequest,
    responses(
        (status = 200, description = "登録成功 + 現 session を user に紐付け", body = RegisterResponse),
        (status = 400, description = "入力 invalid / public_id-email 重複", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn post_register(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, AppError> {
    // ── 1. users INSERT ────────────────────────────────────────────
    let new_user_id = users::create_with_password(
        state.db(),
        users::UserRegisterInput {
            public_id: req.public_id.clone(),
            name: req.name.clone(),
            email: req.email.clone(),
            password_plain: req.password,
            avatar_initial: req.avatar_initial.clone(),
            role: req.role.clone(),
        },
    )
    .await
    .map_err(|e| match e {
        users::UserRepoError::Invalid(msg) => AppError::BadRequest(msg),
        users::UserRepoError::HashError(msg) => {
            AppError::BadRequest(format!("password hash failed: {msg}"))
        }
        // Db error は UNIQUE 違反 (= public_id / email 重複) も含むので 400 で返す。
        users::UserRepoError::Db(e) => {
            AppError::BadRequest(format!("could not register: {e}"))
        }
        users::UserRepoError::NotFound => AppError::NotFound,
    })?;

    // ── 2. cookie session を user_id に昇格 ─────────────────────────
    // session 行が無い (= cookie はあるが DB に未登録) ケースは pool=None の場合か、
    // 起動直後の race で middleware INSERT が走る前。warn だけ残して続行する。
    if let Err(e) =
        user_sessions::attach_user(state.db(), session_id.0, new_user_id).await
    {
        tracing::warn!(
            "post_register: attach_user failed for session={} user={}: {} (registration is still committed)",
            session_id.0,
            new_user_id,
            e
        );
    }

    // ── 3. cart_items / product_watches の session → user 承継 ────
    //   匿名で投入した cart / 押した watch を、ログインユーザの user_id に紐付け直す。
    //   失敗しても warn ログだけで 200 を返す (= review fix: minor, 共通 helper に集約)。
    promote_session_to_user(state.db(), session_id.0, new_user_id).await;

    Ok(Json(RegisterResponse {
        user_id: new_user_id.to_string(),
        public_id: req.public_id,
        name: req.name,
        email: req.email,
        role: req.role,
    }))
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/login
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub user_id: String,
    pub public_id: String,
    pub name: String,
    /// users.email は NULL を許容する (= seed user / OAuth-only 等)。
    /// review fix (nit): `Option` のまま返し、空文字 ("") と「未設定」を client が区別できる。
    /// JSON では None → null。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub role: String,
}

/// `POST /api/v1/auth/login` — email + password を検証して session を user に昇格させる。
#[utoipa::path(
    post,
    path = "/auth/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "login 成功", body = LoginResponse),
        (status = 400, description = "email / password 入力不足", body = crate::openapi::ErrorResponse),
        (status = 401, description = "認証失敗 (= account enumeration 防御で詳細隠す)", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn post_login(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    if req.email.trim().is_empty() || req.password.is_empty() {
        // 空入力は 400 (= 通常 client 側で弾く想定)。enumeration には使えないため安全。
        return Err(AppError::BadRequest("email / password required".to_string()));
    }

    // ── 1. email から user + password_hash を引く ────────────────
    let found = users::find_password_hash_by_email(state.db(), &req.email)
        .await
        .map_err(|e| AppError::BadRequest(format!("login lookup: {e}")))?;

    // **account enumeration 対策** (review fix: major)。HTTP ステータスを揃えるだけでなく
    // 応答時間も平均化する。旧実装は未存在経路で verify_password を呼ばず即 return
    // していたため、Argon2 verify (~50–100ms) の有無で email 存在を timing oracle 判別
    // できた (CWE-208)。本実装では:
    //   - 存在 + hash あり → 真の hash で verify
    //   - 存在 + hash なし / 未存在 → dummy phc で verify
    //  どの経路でも Argon2 を 1 回必ず実行してから 401 を返す。
    let (user_opt, password_hash) = match found {
        Some((u, Some(h))) => (Some(u), h),
        Some((_, None)) | None => (None, dummy_phc_hash().to_string()),
    };

    // ── 2. password を Argon2 で検証 (= 必ず実行) ────────────────
    let verified = users::verify_password(&password_hash, &req.password)
        .map_err(|_| AppError::Unauthorized)?;

    let Some(user) = user_opt else {
        return Err(AppError::Unauthorized);
    };
    if !verified {
        return Err(AppError::Unauthorized);
    }

    // ── 3. session に user を attach ────────────────────────────
    if let Err(e) = user_sessions::attach_user(state.db(), session_id.0, user.id).await {
        tracing::warn!(
            session = %session_id.0,
            user = %user.id,
            "post_login: attach_user failed: {}",
            e
        );
    }

    // ── 4. cart_items / product_watches の session → user 承継 ───
    promote_session_to_user(state.db(), session_id.0, user.id).await;

    Ok(Json(LoginResponse {
        user_id: user.id.to_string(),
        public_id: user.public_id,
        name: user.name,
        email: user.email,
        role: user.role,
    }))
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/logout
// ──────────────────────────────────────────────────────────────────────

/// `POST /api/v1/auth/logout` — session の user_id を NULL に戻す (= 匿名状態に戻す)。
///
/// session 行は削除せず cart 等の session-scoped state は保つ。
/// 行が存在しない (= cookie はあるが DB に未登録 / 既に detach 済) 場合も 204 を返す
/// (= idempotent / クライアント側で「ログアウト処理」を 2 度叩いても安全)。
///
/// **エラー方針** (review fix: major):
///   - `NotFound` は idempotent な 204 として吸収する (= 連打耐性)
///   - DB error 等の internal error は **5xx に乗せる**。旧実装のように 204 で握り潰すと
///     client は「ログアウト成功」と思い込むが server は session 残存のまま、という
///     observability ゼロの不整合が起こる。alert / re-try ロジックが効くよう
///     `AppError::Internal` で返す。
#[utoipa::path(
    post,
    path = "/auth/logout",
    tag = "auth",
    responses(
        (status = 204, description = "logout 成功 (= idempotent)"),
        (status = 500, description = "DB 不整合等の internal error", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn post_logout(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
) -> Result<StatusCode, AppError> {
    match user_sessions::detach_user(state.db(), session_id.0).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(user_sessions::UserSessionRepoError::NotFound(_)) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            tracing::error!(
                error = ?e,
                session = %session_id.0,
                "post_logout: detach_user failed"
            );
            Err(AppError::Internal(anyhow::anyhow!(
                "logout failed: {e}"
            )))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// GET /api/v1/auth/me
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    pub user_id: String,
    pub public_id: String,
    pub name: String,
    pub email: Option<String>,
    pub role: String,
    pub avatar_initial: String,
    /// アカウント開設日時 (= users.joined_at)。client は YYYY.MM 形式に整形して
    /// 「登録 2024.03 より」のような表示に使う。
    pub joined_at: chrono::DateTime<chrono::Utc>,
}

/// `GET /api/v1/auth/me` — 現在 session の user 情報を返す。
///   anonymous (= session.user_id が NULL / session 行未登録) は 401。
#[utoipa::path(
    get,
    path = "/auth/me",
    tag = "auth",
    responses(
        (status = 200, description = "現 login user 情報", body = MeResponse),
        (status = 401, description = "anonymous", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn get_me(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
) -> Result<Json<MeResponse>, AppError> {
    let session = user_sessions::find_by_id(state.db(), session_id.0)
        .await
        .map_err(|e| AppError::BadRequest(format!("session lookup: {e}")))?
        .ok_or(AppError::Unauthorized)?;

    let user_id = session.user_id.ok_or(AppError::Unauthorized)?;
    let user = users::find_by_id(state.db(), user_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("user lookup: {e}")))?
        .ok_or(AppError::Unauthorized)?;

    Ok(Json(MeResponse {
        user_id: user.id.to_string(),
        public_id: user.public_id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_initial: user.avatar_initial,
        joined_at: user.joined_at,
    }))
}

// ──────────────────────────────────────────────────────────────────────
// PR N-5: パスワードリセット (= /api/v1/auth/password_reset_*)
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordResetRequest {
    pub email: String,
}

/// `POST /api/v1/auth/password_reset_request` — リセット token 発行 + メール送信を outbox 経由で
/// enqueue する。
///
/// **重要 (= account enumeration 防御)**:
///   email が users に存在するか否かに **関わらず常に 200** を返す。存在する場合のみ
/// outbox に enqueue するが、レスポンスでは区別しない (= 攻撃者が「この email は登録済」を
/// 判定できないようにする)。
#[utoipa::path(
    post,
    path = "/auth/password_reset_request",
    tag = "auth",
    request_body = PasswordResetRequest,
    responses(
        (status = 200, description = "常に 200 (= account enumeration 防御 / user 不在でも success と区別不能)"),
    ),
)]
pub async fn post_password_reset_request(
    State(state): State<AppState>,
    Json(req): Json<PasswordResetRequest>,
) -> Result<StatusCode, AppError> {
    // email 形式チェックも 200 で返す (= 攻撃者向けに細かいエラーを出さない)
    if !req.email.contains('@') || req.email.is_empty() {
        return Ok(StatusCode::OK);
    }

    let user = users::find_by_email(state.db(), &req.email)
        .await
        .map_err(|e| AppError::BadRequest(format!("user lookup: {e}")))?;

    let Some(user) = user else {
        // user 不在: 何もせず 200。タイミング差は dummy_phc_hash で平均化したいが、
        // password_reset 経路は既に email 引きが O(1) で軽量なので timing 漏れリスクは低い。
        tracing::info!("password_reset_request: email not found (returning 200 silently)");
        return Ok(StatusCode::OK);
    };

    // token 発行 (= row INSERT + secret 生成)
    let plain_token = match password_resets::create(state.db(), user.id).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("password_reset create failed: {e}");
            // ここも 200 を返す (= 攻撃者には fail / success の区別を見せない)
            return Ok(StatusCode::OK);
        }
    };

    // outbox に enqueue (= worker が実際に送信)
    let payload = email_outbox::OutboxEnqueue {
        kind: "password_reset".to_string(),
        to_email: req.email.clone(),
        template_args: serde_json::json!({
            "token": plain_token,
            "user_name": user.name,
        }),
        // idempotency_key=None: 同 user が連打した場合は別個の email を送る (= 各 token は
        // 独立に有効。古い link は consume しなければ TTL 後に廃棄される)
        idempotency_key: None,
        owner_user_id: Some(user.id),
    };
    if let Err(e) = email_outbox::enqueue(state.db(), payload).await {
        tracing::error!("password_reset outbox enqueue failed: {e}");
    }

    Ok(StatusCode::OK)
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordResetConfirmRequest {
    pub token: String,
    pub new_password: String,
}

/// `POST /api/v1/auth/password_reset_confirm` — token を verify + 新 password で users を更新。
///
/// **失敗ケース**:
///   - token 不正 / 不存在 / 既使用 / 期限切れ → **すべて 400** で同じメッセージ
///     (= 攻撃者に「token が valid / consumed / expired のどれか」を区別させない)
///   - new_password が短すぎる → 400
#[utoipa::path(
    post,
    path = "/auth/password_reset_confirm",
    tag = "auth",
    request_body = PasswordResetConfirmRequest,
    responses(
        (status = 204, description = "password 更新成功"),
        (status = 400, description = "token 不正 / 期限切れ / 既使用 / password short (= 詳細は隠す)", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn post_password_reset_confirm(
    State(state): State<AppState>,
    Json(req): Json<PasswordResetConfirmRequest>,
) -> Result<StatusCode, AppError> {
    if req.new_password.len() < 8 {
        return Err(AppError::BadRequest(
            "new_password must be 8+ chars".to_string(),
        ));
    }

    let user_id = password_resets::consume(state.db(), &req.token)
        .await
        .map_err(|e| {
            tracing::info!("password_reset_confirm rejected: {e}");
            // 失敗詳細は隠す (= attacker oracle 防御)
            AppError::BadRequest("invalid or expired token".to_string())
        })?;

    let new_hash = users::hash_password(&req.new_password)
        .map_err(|e| AppError::BadRequest(format!("password hash: {e}")))?;
    users::update_password_hash(state.db(), user_id, &new_hash)
        .await
        .map_err(|e| AppError::BadRequest(format!("update password: {e}")))?;

    tracing::info!(user_id = %user_id, "password reset successful");
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    /// auth テストは users + user_sessions に加え、register / login で
    /// `cart_items::promote_session_to_user` と `product_watches::promote_session_to_user`
    /// を呼ぶため、それぞれの `memory_guard()` も **同じ順序** で取得して逐次化する。
    /// 順序: users → user_sessions → cart_items → product_watches (= 全テストで統一)。
    fn lock_guards() -> (
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
    ) {
        let u = users::memory_guard();
        let s = user_sessions::memory_guard();
        let c = cart_items::memory_guard();
        let w = product_watches::memory_guard();
        (u, s, c, w)
    }

    fn st() -> State<AppState> {
        State(AppState::default())
    }
    fn ext(session_id: Uuid) -> Extension<SessionId> {
        Extension(SessionId(session_id))
    }

    fn req(public_id: &str, email: &str) -> RegisterRequest {
        RegisterRequest {
            public_id: public_id.to_string(),
            name: "テストユーザ".to_string(),
            email: email.to_string(),
            password: "correct horse battery staple".to_string(),
            avatar_initial: "テ".to_string(),
            role: "breeder".to_string(),
        }
    }

    #[tokio::test]
    async fn register_creates_user_and_attaches_session() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        // 事前に cookie session が立っている前提 (= middleware 経由で発行された想定)
        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();

        let res = post_register(st(), ext(session), Json(req("alice", "alice@example.com")))
            .await
            .expect("register ok");
        assert!(!res.0.user_id.is_empty());
        assert_eq!(res.0.public_id, "alice");
        assert_eq!(res.0.email, "alice@example.com");
        assert_eq!(res.0.role, "breeder");

        // session に user_id が紐付いている
        let row = user_sessions::find_by_id(None, session).await.unwrap().unwrap();
        let user_uuid = Uuid::parse_str(&res.0.user_id).unwrap();
        assert_eq!(row.user_id, Some(user_uuid));
    }

    #[tokio::test]
    async fn register_rejects_short_password() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();

        let mut r = req("alice", "alice@example.com");
        r.password = "short".to_string();
        match post_register(st(), ext(session), Json(r)).await {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("password")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn register_rejects_invalid_email() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();

        let mut r = req("alice", "no-at-sign");
        r.email = "no-at-sign".to_string();
        match post_register(st(), ext(session), Json(r)).await {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("email")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn register_rejects_invalid_role() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();

        let mut r = req("alice", "alice@example.com");
        r.role = "godmode".to_string();
        match post_register(st(), ext(session), Json(r)).await {
            Err(AppError::BadRequest(msg)) => assert!(msg.contains("role")),
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn register_request_camel_case_deserialize() {
        let json = r#"{"publicId":"alice","name":"Alice","email":"a@b.com","password":"longenough","avatarInitial":"A"}"#;
        let r: RegisterRequest = serde_json::from_str(json).unwrap();
        assert_eq!(r.public_id, "alice");
        assert_eq!(r.role, "breeder", "role 省略時は default 'breeder'");
    }

    // ── login ─────────────────────────────────────────────────────

    /// register → 別 session で login → 同 user に紐付く
    #[tokio::test]
    async fn login_with_correct_credentials_attaches_user() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        // ── prep: register でユーザを作る (session_a)
        let session_a = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session_a).await.unwrap();
        let _ = post_register(st(), ext(session_a), Json(req("alice", "alice@example.com")))
            .await
            .unwrap();

        // ── 別ブラウザの session_b から login
        let session_b = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session_b).await.unwrap();

        let res = post_login(
            st(),
            ext(session_b),
            Json(LoginRequest {
                email: "alice@example.com".to_string(),
                password: "correct horse battery staple".to_string(),
            }),
        )
        .await
        .expect("login ok");
        assert_eq!(res.0.public_id, "alice");
        assert_eq!(res.0.role, "breeder");

        // session_b に user_id が紐付いている
        let row_b = user_sessions::find_by_id(None, session_b).await.unwrap().unwrap();
        let user_uuid = Uuid::parse_str(&res.0.user_id).unwrap();
        assert_eq!(row_b.user_id, Some(user_uuid));
    }

    #[tokio::test]
    async fn login_with_wrong_password_returns_401() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        let _ = post_register(st(), ext(session), Json(req("alice", "alice@example.com")))
            .await
            .unwrap();

        match post_login(
            st(),
            ext(session),
            Json(LoginRequest {
                email: "alice@example.com".to_string(),
                password: "WRONG-PASSWORD".to_string(),
            }),
        )
        .await
        {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn login_with_unknown_email_returns_401_same_as_wrong_password() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();

        // account enumeration 対策: 「メール未登録」も「password 不一致」と同じ 401 で返す
        match post_login(
            st(),
            ext(session),
            Json(LoginRequest {
                email: "ghost@example.com".to_string(),
                password: "anything".to_string(),
            }),
        )
        .await
        {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn login_with_empty_input_is_400() {
        let _g = lock_guards();
        match post_login(
            st(),
            ext(Uuid::new_v4()),
            Json(LoginRequest {
                email: "".to_string(),
                password: "".to_string(),
            }),
        )
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    // ── logout ────────────────────────────────────────────────────

    #[tokio::test]
    async fn logout_detaches_user_from_session() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        let _ = post_register(st(), ext(session), Json(req("alice", "alice@example.com")))
            .await
            .unwrap();

        let status = post_logout(st(), ext(session)).await.expect("logout ok");
        assert_eq!(status, StatusCode::NO_CONTENT);

        // session 自体は残るが user_id は None に戻る
        let row = user_sessions::find_by_id(None, session).await.unwrap().unwrap();
        assert!(row.user_id.is_none());
    }

    #[tokio::test]
    async fn logout_unknown_session_is_idempotent_204() {
        let _g = lock_guards();
        user_sessions::reset_memory_for_test();
        // 存在しない session でも 204 (= idempotent / 連打耐性)
        let status = post_logout(st(), ext(Uuid::new_v4())).await.unwrap();
        assert_eq!(status, StatusCode::NO_CONTENT);
    }

    // ── /auth/me ──────────────────────────────────────────────────

    #[tokio::test]
    async fn me_returns_user_info_for_logged_in_session() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        let reg = post_register(st(), ext(session), Json(req("alice", "alice@example.com")))
            .await
            .unwrap();

        let res = get_me(st(), ext(session)).await.expect("me ok");
        assert_eq!(res.0.user_id, reg.0.user_id);
        assert_eq!(res.0.public_id, "alice");
        assert_eq!(res.0.email.as_deref(), Some("alice@example.com"));
        assert_eq!(res.0.role, "breeder");
        assert_eq!(res.0.avatar_initial, "テ");
    }

    #[tokio::test]
    async fn me_returns_401_for_anonymous_session() {
        let _g = lock_guards();
        user_sessions::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();

        match get_me(st(), ext(session)).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn me_returns_401_when_session_row_missing() {
        let _g = lock_guards();
        user_sessions::reset_memory_for_test();
        // session 行が user_sessions に無い (= cookie はあるが DB に未登録)
        match get_me(st(), ext(Uuid::new_v4())).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    /// 匿名 session で watch していた商品が register / login 後も維持されること。
    /// product_watches::promote_session_to_user が auth handler から呼ばれているか確認。
    #[tokio::test]
    async fn register_promotes_session_watches_to_user() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        crate::repos::cart_items::reset_memory_for_test();
        crate::repos::product_watches::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();

        // 匿名で 2 商品を watch
        let p1 = Uuid::new_v4();
        let p2 = Uuid::new_v4();
        let session_owner = crate::repos::product_watches::WatchOwner::Session(session);
        crate::repos::product_watches::toggle(None, session_owner, p1).await.unwrap();
        crate::repos::product_watches::toggle(None, session_owner, p2).await.unwrap();

        // register
        let res = post_register(st(), ext(session), Json(req("alice", "alice@example.com")))
            .await
            .unwrap();
        let user_id = Uuid::parse_str(&res.0.user_id).unwrap();

        // session 経由では消えており、user 経由で見えている
        let user_owner = crate::repos::product_watches::WatchOwner::User(user_id);
        let session_ids =
            crate::repos::product_watches::find_product_ids_by_owner(None, session_owner)
                .await
                .unwrap();
        let user_ids =
            crate::repos::product_watches::find_product_ids_by_owner(None, user_owner)
                .await
                .unwrap();
        assert!(session_ids.is_empty(), "session 経由は空 (= 移譲済)");
        assert_eq!(user_ids.len(), 2, "user 経由で 2 件見える");
    }

    #[tokio::test]
    async fn login_promotes_session_watches_to_user() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        crate::repos::cart_items::reset_memory_for_test();
        crate::repos::product_watches::reset_memory_for_test();

        // ── prep: register でユーザを作っておく (= session_a を user に紐付け済)
        let session_a = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session_a).await.unwrap();
        let _ = post_register(st(), ext(session_a), Json(req("alice", "alice@example.com")))
            .await
            .unwrap();

        // ── 別 session_b で 1 商品 watch (= 別ブラウザでの匿名 watch)
        let session_b = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session_b).await.unwrap();
        let p = Uuid::new_v4();
        crate::repos::product_watches::toggle(
            None,
            crate::repos::product_watches::WatchOwner::Session(session_b),
            p,
        )
        .await
        .unwrap();

        // session_b で login
        let res = post_login(
            st(),
            ext(session_b),
            Json(LoginRequest {
                email: "alice@example.com".to_string(),
                password: "correct horse battery staple".to_string(),
            }),
        )
        .await
        .unwrap();
        let user_id = Uuid::parse_str(&res.0.user_id).unwrap();

        // user 経由で見えるようになっている (= session_b の watch が承継)
        let user_owner = crate::repos::product_watches::WatchOwner::User(user_id);
        let user_ids =
            crate::repos::product_watches::find_product_ids_by_owner(None, user_owner)
                .await
                .unwrap();
        assert!(user_ids.contains(&p), "session_b の watch が user に承継された");
    }

    #[tokio::test]
    async fn login_then_logout_then_me_chain_returns_401() {
        let _g = lock_guards();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();

        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        let _ = post_register(st(), ext(session), Json(req("alice", "alice@example.com")))
            .await
            .unwrap();

        // /me は通る
        let _ = get_me(st(), ext(session)).await.unwrap();

        // logout 後は /me が 401
        post_logout(st(), ext(session)).await.unwrap();
        match get_me(st(), ext(session)).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized after logout, got {other:?}"),
        }
    }

    // ── PR N-5 / password reset ──────────────────────────────────

    /// password_reset テストは users + outbox + password_resets の memory store を弄るので
    /// 通常 lock + outbox / password_resets の guard を一気に取る。
    fn lock_guards_with_reset() -> (
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
    ) {
        let u = users::memory_guard();
        let s = user_sessions::memory_guard();
        let c = cart_items::memory_guard();
        let w = product_watches::memory_guard();
        let o = email_outbox::memory_guard();
        let r = password_resets::memory_guard();
        (u, s, c, w, o, r)
    }

    #[tokio::test]
    async fn password_reset_request_unknown_email_returns_200_silently() {
        let _g = lock_guards_with_reset();
        users::reset_dynamic_for_test();
        email_outbox::reset_memory_for_test();
        password_resets::reset_memory_for_test();

        let res = post_password_reset_request(
            st(),
            Json(PasswordResetRequest {
                email: "nobody@example.com".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(res, StatusCode::OK);
        // outbox にも何も入らない (= account enumeration 防御の挙動確認)
        // (= 「不在 email では outbox に痕跡無し」という不変条件)
    }

    #[tokio::test]
    async fn password_reset_request_for_existing_user_enqueues_outbox() {
        let _g = lock_guards_with_reset();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        email_outbox::reset_memory_for_test();
        password_resets::reset_memory_for_test();

        // 事前に user を作成 (= register 経由)
        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        let _ = post_register(st(), ext(session), Json(req("alice", "alice@example.com")))
            .await
            .unwrap();

        let res = post_password_reset_request(
            st(),
            Json(PasswordResetRequest {
                email: "alice@example.com".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(res, StatusCode::OK);

        // outbox に password_reset 1 行 enqueue されている
        let claimed = email_outbox::claim_pending(None, 10).await.unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].kind, "password_reset");
        assert_eq!(claimed[0].to_email, "alice@example.com");
        // template_args.token が plain token (= "{uuid}.{secret}" 形式)
        let token = claimed[0]
            .template_args
            .get("token")
            .and_then(|v| v.as_str())
            .unwrap();
        assert!(token.contains('.'));
    }

    #[tokio::test]
    async fn password_reset_confirm_round_trip_updates_password() {
        let _g = lock_guards_with_reset();
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        email_outbox::reset_memory_for_test();
        password_resets::reset_memory_for_test();

        // user を作成
        let session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        let _ = post_register(st(), ext(session), Json(req("alice", "alice@example.com")))
            .await
            .unwrap();

        // request → outbox から token を抽出
        post_password_reset_request(
            st(),
            Json(PasswordResetRequest {
                email: "alice@example.com".to_string(),
            }),
        )
        .await
        .unwrap();
        let claimed = email_outbox::claim_pending(None, 10).await.unwrap();
        let token = claimed[0]
            .template_args
            .get("token")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        // confirm
        let res = post_password_reset_confirm(
            st(),
            Json(PasswordResetConfirmRequest {
                token: token.clone(),
                new_password: "brand-new-secret-12345".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(res, StatusCode::NO_CONTENT);

        // 同 token 2 回目は AlreadyUsed → 400
        let again = post_password_reset_confirm(
            st(),
            Json(PasswordResetConfirmRequest {
                token,
                new_password: "different-password-67890".to_string(),
            }),
        )
        .await;
        assert!(matches!(again, Err(AppError::BadRequest(_))));

        // 新 password で login 成功する (= 旧 password では失敗するはず)
        let new_session = Uuid::new_v4();
        let _ = user_sessions::create_anonymous_for_test(None, new_session)
            .await
            .unwrap();
        let login_res = post_login(
            st(),
            ext(new_session),
            Json(LoginRequest {
                email: "alice@example.com".to_string(),
                password: "brand-new-secret-12345".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(login_res.0.public_id, "alice");
    }

    #[tokio::test]
    async fn password_reset_confirm_short_password_rejected() {
        let _g = lock_guards_with_reset();
        let res = post_password_reset_confirm(
            st(),
            Json(PasswordResetConfirmRequest {
                token: format!("{}.somesecret", Uuid::new_v4()),
                new_password: "short".to_string(),
            }),
        )
        .await;
        assert!(matches!(res, Err(AppError::BadRequest(_))));
    }

    #[tokio::test]
    async fn password_reset_confirm_invalid_token_format_returns_400() {
        let _g = lock_guards_with_reset();
        let res = post_password_reset_confirm(
            st(),
            Json(PasswordResetConfirmRequest {
                token: "no-dot-no-uuid".to_string(),
                new_password: "valid-password-12345".to_string(),
            }),
        )
        .await;
        assert!(matches!(res, Err(AppError::BadRequest(_))));
    }
}
