//! - パスワードは argon2、セッショントークンは乱数32byteをSHA-256でハッシュ保存
//! - Cookie は HttpOnly + SameSite=Lax(同一オリジン運用が前提。Secure は本番で付与)
//! - 保護したいハンドラは引数に `AuthUser` を足すだけ(未ログインは 401)

use axum::Json;
use axum::extract::{FromRequestParts, State};
use axum::http::{StatusCode, request::Parts};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use argon2::Argon2;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};

use crate::AppState;
use crate::error::{ApiError, internal, invalid, unauthorized};

const SESSION_COOKIE: &str = "insect_session";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex(&bytes)
}

fn hash_token(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

// ── 現在ユーザ ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
}

/// 認証必須ハンドラ用 extractor。引数に足すだけで未ログインを 401 にする。
pub struct AuthUser(pub UserInfo);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_request_parts(parts, state)
            .await
            .map_err(internal)?;
        let Some(cookie) = jar.get(SESSION_COOKIE) else {
            return Err(unauthorized());
        };
        let row: Option<(Uuid, String, String)> = sqlx::query_as(
            "SELECT u.id, u.email, u.display_name \
             FROM sessions s JOIN users u ON u.id = s.user_id \
             WHERE s.token_hash = $1 AND s.expires_at > now()",
        )
        .bind(hash_token(cookie.value()))
        .fetch_optional(&state.pool)
        .await
        .map_err(internal)?;
        let Some((user_id, email, display_name)) = row else {
            return Err(unauthorized());
        };
        Ok(AuthUser(UserInfo {
            user_id,
            email,
            display_name,
        }))
    }
}

/// 任意認証。未ログインを 401 にせず `None` を返す(公開ページのGET用)。
pub struct MaybeUser(pub Option<UserInfo>);

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        match AuthUser::from_request_parts(parts, state).await {
            Ok(AuthUser(user)) => Ok(MaybeUser(Some(user))),
            Err((StatusCode::UNAUTHORIZED, _)) => Ok(MaybeUser(None)),
            Err(e) => Err(e),
        }
    }
}

// ── ハンドラ ───────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RegisterReq {
    email: String,
    password: String,
    display_name: String,
}

pub async fn register(
    State(st): State<AppState>,
    jar: CookieJar,
    Json(req): Json<RegisterReq>,
) -> Result<(CookieJar, Json<UserInfo>), ApiError> {
    let email = req.email.trim().to_lowercase();
    let name = req.display_name.trim().to_string();
    if !email.contains('@') {
        return Err(invalid("メールアドレスの形式が正しくありません"));
    }
    if req.password.chars().count() < 8 {
        return Err(invalid("パスワードは8文字以上にしてください"));
    }
    if name.is_empty() {
        return Err(invalid("表示名を入力してください"));
    }
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(req.password.as_bytes(), &salt)
        .map_err(internal)?
        .to_string();
    let row: (Uuid,) = sqlx::query_as(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(&email)
    .bind(&password_hash)
    .bind(&name)
    .fetch_one(&st.pool)
    .await
    .map_err(|_| invalid("登録できません(このメールアドレスは使用済みの可能性があります)"))?;
    // オンボーディング: デフォルトの4タブを作成(自由に改名・削除できる)
    sqlx::query(
        "INSERT INTO specimen_groups (owner_id, label, sort_order) \
         VALUES ($1, '卵', 1), ($1, '幼虫', 2), ($1, '蛹', 3), ($1, '成虫', 4)",
    )
    .bind(row.0)
    .execute(&st.pool)
    .await
    .map_err(internal)?;
    start_session(
        &st,
        jar,
        UserInfo {
            user_id: row.0,
            email,
            display_name: name,
        },
    )
    .await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LoginReq {
    email: String,
    password: String,
}

pub async fn login(
    State(st): State<AppState>,
    jar: CookieJar,
    Json(req): Json<LoginReq>,
) -> Result<(CookieJar, Json<UserInfo>), ApiError> {
    let email = req.email.trim().to_lowercase();
    let wrong = || {
        (
            StatusCode::UNAUTHORIZED,
            "メールアドレスまたはパスワードが違います".to_string(),
        )
    };
    let row: Option<(Uuid, String, String)> =
        sqlx::query_as("SELECT id, password_hash, display_name FROM users WHERE email = $1")
            .bind(&email)
            .fetch_optional(&st.pool)
            .await
            .map_err(internal)?;
    let Some((user_id, stored_hash, display_name)) = row else {
        return Err(wrong());
    };
    // ハッシュが argon2 形式でない場合(無効化されたシードユーザ等)もログイン不可扱い
    let Ok(parsed) = PasswordHash::new(&stored_hash) else {
        return Err(wrong());
    };
    if Argon2::default()
        .verify_password(req.password.as_bytes(), &parsed)
        .is_err()
    {
        return Err(wrong());
    }
    start_session(
        &st,
        jar,
        UserInfo {
            user_id,
            email,
            display_name,
        },
    )
    .await
}

async fn start_session(
    st: &AppState,
    jar: CookieJar,
    user: UserInfo,
) -> Result<(CookieJar, Json<UserInfo>), ApiError> {
    let token = new_token();
    sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) \
         VALUES ($1, $2, now() + interval '30 days')",
    )
    .bind(hash_token(&token))
    .bind(user.user_id)
    .execute(&st.pool)
    .await
    .map_err(internal)?;
    let cookie = Cookie::build((SESSION_COOKIE, token))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .build();
    Ok((jar.add(cookie), Json(user)))
}

pub async fn logout(
    State(st): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), ApiError> {
    if let Some(cookie) = jar.get(SESSION_COOKIE) {
        sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
            .bind(hash_token(cookie.value()))
            .execute(&st.pool)
            .await
            .map_err(internal)?;
    }
    let removal = Cookie::build((SESSION_COOKIE, "")).path("/").build();
    Ok((jar.remove(removal), StatusCode::NO_CONTENT))
}

pub async fn me(AuthUser(user): AuthUser) -> Json<UserInfo> {
    Json(user)
}
