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

use crate::error::AppError;
use crate::repos::{cart_items, product_watches, user_sessions, users};
use crate::session::SessionId;
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Clone, Serialize)]
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
    //   どちらも UX 的に「ログインしたら自分の状態が引き継がれる」期待を満たすため。
    //   失敗しても warn ログだけで 200 を返す (= 注文 / 認可は通っているのでクリティカルでない)。
    if let Err(e) =
        cart_items::promote_session_to_user(state.db(), session_id.0, new_user_id).await
    {
        tracing::warn!(
            "post_register: cart promote failed for session={} user={}: {}",
            session_id.0,
            new_user_id,
            e
        );
    }
    if let Err(e) =
        product_watches::promote_session_to_user(state.db(), session_id.0, new_user_id).await
    {
        tracing::warn!(
            "post_register: watch promote failed for session={} user={}: {}",
            session_id.0,
            new_user_id,
            e
        );
    }

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub user_id: String,
    pub public_id: String,
    pub name: String,
    pub email: String,
    pub role: String,
}

/// `POST /api/v1/auth/login` — email + password を検証して session を user に昇格させる。
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

    // **account enumeration 対策**: email 未登録 / password 未設定 / password 不一致を
    // すべて同じ 401 で返す (= "そのメールは存在しない" を漏らさない)。
    let (user, password_hash) = match found {
        Some((u, Some(h))) => (u, h),
        _ => return Err(AppError::Unauthorized),
    };

    // ── 2. password を Argon2 で検証 ─────────────────────────────
    let ok = users::verify_password(&password_hash, &req.password)
        .map_err(|_| AppError::Unauthorized)?;
    if !ok {
        return Err(AppError::Unauthorized);
    }

    // ── 3. session に user を attach ────────────────────────────
    if let Err(e) = user_sessions::attach_user(state.db(), session_id.0, user.id).await {
        tracing::warn!(
            "post_login: attach_user failed for session={} user={}: {}",
            session_id.0,
            user.id,
            e
        );
    }

    // ── 4. cart_items / product_watches の session → user 承継 ───
    if let Err(e) =
        cart_items::promote_session_to_user(state.db(), session_id.0, user.id).await
    {
        tracing::warn!(
            "post_login: cart promote failed for session={} user={}: {}",
            session_id.0,
            user.id,
            e
        );
    }
    if let Err(e) =
        product_watches::promote_session_to_user(state.db(), session_id.0, user.id).await
    {
        tracing::warn!(
            "post_login: watch promote failed for session={} user={}: {}",
            session_id.0,
            user.id,
            e
        );
    }

    Ok(Json(LoginResponse {
        user_id: user.id.to_string(),
        public_id: user.public_id,
        name: user.name,
        email: user.email.unwrap_or_default(),
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
pub async fn post_logout(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
) -> Result<StatusCode, AppError> {
    match user_sessions::detach_user(state.db(), session_id.0).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(user_sessions::UserSessionRepoError::NotFound(_)) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            tracing::warn!("post_logout: detach_user error: {e}");
            // 内部エラーでも client 側は再ログインで復帰できるので 204 で吸収する。
            Ok(StatusCode::NO_CONTENT)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// GET /api/v1/auth/me
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    pub user_id: String,
    pub public_id: String,
    pub name: String,
    pub email: Option<String>,
    pub role: String,
    pub avatar_initial: String,
}

/// `GET /api/v1/auth/me` — 現在 session の user 情報を返す。
///   anonymous (= session.user_id が NULL / session 行未登録) は 401。
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
    }))
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
        get_me(st(), ext(session)).await.unwrap();

        // logout 後は /me が 401
        post_logout(st(), ext(session)).await.unwrap();
        match get_me(st(), ext(session)).await {
            Err(AppError::Unauthorized) => {}
            other => panic!("expected Unauthorized after logout, got {other:?}"),
        }
    }
}
