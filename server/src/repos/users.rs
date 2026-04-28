//! users + user_sessions への永続化 (Phase 9.C / DB設計書 v2 §3.3 / Phase 9.G で password 拡張)
//!
//! **責務**:
//!   - sqlx で users テーブルへの SELECT / INSERT を提供
//!   - DB 不在時 (= pool=None) は in-memory fallback で動く
//!   - Argon2id ベースの password hash 生成 / 検証 ヘルパを提供 (= Phase 9.G で追加)
//!
//! **設計判断**:
//!   - id = UUID, public_id = handle ("t_yamada") 文字列
//!   - role は CHECK 制約で値域固定 (= "breeder" / "admin" / "shop_owner")
//!   - email は UNIQUE / Optional (但し register 経路では必須)
//!   - password_hash は Argon2id phc 文字列。NULL は「OAuth 等で password 不要」または
//!     「seed user のように login 経路を持たない」を表現する。
//!
//! **将来 (= 後続 step)**:
//!   - find_by_session_token(token: &str) で auth middleware に接続
//!   - cached_anonymous_user_id() で products.created_by の自動埋め

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub public_id: String,                              // "t_yamada"
    pub name: String,                                   // "山田 徹"
    pub role: String,                                   // "breeder" / "admin" / "shop_owner"
    pub email: Option<String>,
    pub avatar_initial: String,
    pub is_active: bool,
}

/// register 時の INSERT payload。`password_plain` は呼び出し側が握り、
/// `create_with_password` 内で Argon2id で hash されてから永続化される。
#[derive(Debug, Clone)]
pub struct UserRegisterInput {
    pub public_id: String,                              // "t_yamada"
    pub name: String,
    pub email: String,
    pub password_plain: String,
    pub avatar_initial: String,
    pub role: String,                                   // "breeder" / "admin" / "shop_owner"
}

#[derive(Debug, thiserror::Error)]
pub enum UserRepoError {
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("password hash error: {0}")]
    HashError(String),
    #[error("user not found")]
    NotFound,
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API (skeleton)
// ──────────────────────────────────────────────────────────────────────

/// public_id (= "t_yamada") で 1 件取得。pool=None なら in-memory fallback。
pub async fn find_by_public_id(
    pool: Option<&PgPool>,
    public_id: &str,
) -> Result<Option<UserRow>, UserRepoError> {
    match pool {
        Some(p) => find_by_public_id_db(p, public_id).await,
        None => Ok(memory_users()
            .into_iter()
            .find(|u| u.public_id == public_id)),
    }
}

/// 内部 UUID で 1 件取得。pool=None なら in-memory fallback。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<UserRow>, UserRepoError> {
    match pool {
        Some(p) => find_by_id_db(p, id).await,
        None => Ok(memory_users().into_iter().find(|u| u.id == id)),
    }
}

/// active 全 user を public_id 昇順で返す。pool=None なら in-memory fallback。
/// 列挙系ハンドラ (= /api/v1/admin/users 等) 用。
pub async fn find_all_active(
    pool: Option<&PgPool>,
) -> Result<Vec<UserRow>, UserRepoError> {
    match pool {
        Some(p) => find_all_active_db(p).await,
        None => Ok(memory_users()
            .into_iter()
            .filter(|u| u.is_active)
            .collect()),
    }
}

/// email で 1 件取得 (= login の前段)。pool=None なら in-memory fallback。
pub async fn find_by_email(
    pool: Option<&PgPool>,
    email: &str,
) -> Result<Option<UserRow>, UserRepoError> {
    match pool {
        Some(p) => find_by_email_db(p, email).await,
        None => Ok(memory_users()
            .into_iter()
            .find(|u| u.email.as_deref() == Some(email))),
    }
}

/// email で password_hash も含めて取得 (= login 用)。
/// 戻り値の `Option<String>` は password_hash カラム値そのもの (= phc 文字列 or NULL)。
/// **本関数は handler から直接見せず、`verify_password_for_email` でラップする想定**。
pub async fn find_password_hash_by_email(
    pool: Option<&PgPool>,
    email: &str,
) -> Result<Option<(UserRow, Option<String>)>, UserRepoError> {
    match pool {
        Some(p) => find_password_hash_by_email_db(p, email).await,
        None => {
            let store = memory_dynamic_lock();
            for (u, h) in store.iter() {
                if u.email.as_deref() == Some(email) {
                    return Ok(Some((u.clone(), h.clone())));
                }
            }
            // seed 由来の static user (= t_yamada) は password_hash 持たないので NULL を返す。
            Ok(memory_seed_users()
                .into_iter()
                .find(|u| u.email.as_deref() == Some(email))
                .map(|u| (u, None)))
        }
    }
}

/// 新規ユーザを Argon2id でパスワードハッシュ化して登録する。生成 UUID を返す。
pub async fn create_with_password(
    pool: Option<&PgPool>,
    input: UserRegisterInput,
) -> Result<Uuid, UserRepoError> {
    validate_register_input(&input)?;
    let hash = hash_password(&input.password_plain)?;

    match pool {
        Some(p) => create_with_password_db(p, &input, &hash).await,
        None => {
            let id = Uuid::new_v4();
            memory_dynamic_lock_mut().push((
                UserRow {
                    id,
                    public_id: input.public_id,
                    name: input.name,
                    role: input.role,
                    email: Some(input.email),
                    avatar_initial: input.avatar_initial,
                    is_active: true,
                },
                Some(hash),
            ));
            Ok(id)
        }
    }
}

/// Argon2id で平文 password を hash 化し、phc 文字列を返す。
///
/// パラメータは Argon2 default (= m=19456, t=2, p=1) を使う。production で安全側に倒すなら
/// `Params::new(...)` で上げる。MVP はデフォルトで十分。
pub fn hash_password(plain: &str) -> Result<String, UserRepoError> {
    if plain.is_empty() {
        return Err(UserRepoError::Invalid("password is empty".to_string()));
    }
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(plain.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| UserRepoError::HashError(e.to_string()))
}

/// 平文 password を phc 文字列に対して検証する。一致しない場合は `Ok(false)`、
/// hash 形式が壊れている場合は `Err(HashError)`。
pub fn verify_password(hash: &str, plain: &str) -> Result<bool, UserRepoError> {
    let parsed = PasswordHash::new(hash).map_err(|e| UserRepoError::HashError(e.to_string()))?;
    Ok(Argon2::default()
        .verify_password(plain.as_bytes(), &parsed)
        .is_ok())
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn find_by_public_id_db(
    pool: &PgPool,
    public_id: &str,
) -> Result<Option<UserRow>, UserRepoError> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, public_id, name, role, email, avatar_initial, is_active
        FROM users
        WHERE public_id = $1
        "#,
    )
    .bind(public_id)
    .fetch_optional(pool)
    .await
    .map_err(UserRepoError::Db)
}

async fn find_by_id_db(pool: &PgPool, id: Uuid) -> Result<Option<UserRow>, UserRepoError> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, public_id, name, role, email, avatar_initial, is_active
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(UserRepoError::Db)
}

async fn find_all_active_db(pool: &PgPool) -> Result<Vec<UserRow>, UserRepoError> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, public_id, name, role, email, avatar_initial, is_active
        FROM users
        WHERE is_active = true
        ORDER BY public_id
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(UserRepoError::Db)
}

async fn find_by_email_db(
    pool: &PgPool,
    email: &str,
) -> Result<Option<UserRow>, UserRepoError> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, public_id, name, role, email, avatar_initial, is_active
        FROM users
        WHERE email = $1
        "#,
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .map_err(UserRepoError::Db)
}

async fn find_password_hash_by_email_db(
    pool: &PgPool,
    email: &str,
) -> Result<Option<(UserRow, Option<String>)>, UserRepoError> {
    #[allow(clippy::type_complexity)]
    let row: Option<(Uuid, String, String, String, Option<String>, String, bool, Option<String>)> =
        sqlx::query_as(
            r#"
            SELECT id, public_id, name, role, email, avatar_initial, is_active, password_hash
            FROM users
            WHERE email = $1
            "#,
        )
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(UserRepoError::Db)?;

    Ok(row.map(|(id, public_id, name, role, email, avatar_initial, is_active, password_hash)| {
        (
            UserRow {
                id,
                public_id,
                name,
                role,
                email,
                avatar_initial,
                is_active,
            },
            password_hash,
        )
    }))
}

async fn create_with_password_db(
    pool: &PgPool,
    input: &UserRegisterInput,
    password_hash: &str,
) -> Result<Uuid, UserRepoError> {
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO users (public_id, name, role, email, avatar_initial, password_hash)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
    )
    .bind(&input.public_id)
    .bind(&input.name)
    .bind(&input.role)
    .bind(&input.email)
    .bind(&input.avatar_initial)
    .bind(password_hash)
    .fetch_one(pool)
    .await
    .map_err(UserRepoError::Db)?;
    Ok(row.0)
}

// ──────────────────────────────────────────────────────────────────────
// validation
// ──────────────────────────────────────────────────────────────────────

fn validate_register_input(input: &UserRegisterInput) -> Result<(), UserRepoError> {
    if input.public_id.trim().is_empty() {
        return Err(UserRepoError::Invalid("public_id is empty".to_string()));
    }
    if input.name.trim().is_empty() {
        return Err(UserRepoError::Invalid("name is empty".to_string()));
    }
    if input.email.trim().is_empty() || !input.email.contains('@') {
        return Err(UserRepoError::Invalid(format!(
            "invalid email: {}",
            input.email
        )));
    }
    if input.password_plain.len() < 8 {
        return Err(UserRepoError::Invalid(
            "password must be 8+ chars".to_string(),
        ));
    }
    if !["breeder", "admin", "shop_owner"].contains(&input.role.as_str()) {
        return Err(UserRepoError::Invalid(format!(
            "invalid role: {} (must be breeder/admin/shop_owner)",
            input.role
        )));
    }
    if input.avatar_initial.trim().is_empty() {
        return Err(UserRepoError::Invalid(
            "avatar_initial is empty".to_string(),
        ));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────
//
// **2 層構成**:
//   1. `memory_seed_users()` — 0004_users.sql の seed (= t_yamada) を返す static 関数。
//      password_hash は持たない (= seed user は login 経路無し)。
//   2. `memory_dynamic_lock()` — runtime に register_with_password で追加されたユーザを
//      持つ Mutex<Vec<(UserRow, Option<String>)>>。
//
// `memory_users()` は両方を merge して返す (= find_* 系の seed + dynamic 統合経路)。
// id (UUID) は seed が固定値、dynamic は `Uuid::new_v4()` で発行される。

fn memory_seed_users() -> Vec<UserRow> {
    vec![UserRow {
        // 固定 UUID v4 (= test 時に find_by_id 等で参照しやすい安定値)
        id: Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").expect("valid uuid"),
        public_id: "t_yamada".to_string(),
        name: "山田 徹".to_string(),
        role: "breeder".to_string(),
        email: None,
        avatar_initial: "山".to_string(),
        is_active: true,
    }]
}

#[allow(clippy::type_complexity)]
fn memory_dynamic_store() -> &'static std::sync::Mutex<Vec<(UserRow, Option<String>)>> {
    static S: std::sync::OnceLock<std::sync::Mutex<Vec<(UserRow, Option<String>)>>> =
        std::sync::OnceLock::new();
    S.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

fn memory_dynamic_lock() -> std::sync::MutexGuard<'static, Vec<(UserRow, Option<String>)>> {
    memory_dynamic_store()
        .lock()
        .expect("users dynamic mutex poisoned")
}

fn memory_dynamic_lock_mut() -> std::sync::MutexGuard<'static, Vec<(UserRow, Option<String>)>> {
    memory_dynamic_lock()
}

fn memory_users() -> Vec<UserRow> {
    let mut out = memory_seed_users();
    let dyn_users: Vec<UserRow> = memory_dynamic_lock().iter().map(|(u, _)| u.clone()).collect();
    out.extend(dyn_users);
    out
}

#[cfg(test)]
pub fn reset_dynamic_for_test() {
    if let Ok(mut s) = memory_dynamic_store().lock() {
        s.clear();
    }
}

/// `users` の dynamic store + `user_sessions` を触る複数モジュール (= `repos::users` /
/// `handlers::auth` 等) が **同じ** GUARD を取って逐次化するために共有する mutex。
///
/// 各テスト冒頭で `let _g = memory_guard();` を呼ぶ。orders::memory_guard と同じパターン。
/// poison は他テストの panic 時に起こるが、本 GUARD の中身は () なので inner を取り直す。
#[cfg(test)]
pub fn memory_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    GUARD.lock().unwrap_or_else(|p| p.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// dynamic store を触るテストは並列実行下で reset+register が混ざる可能性があるので
    /// `memory_guard()` (= 本モジュール公開 / poison-tolerant) で逐次化する。
    /// `handlers::auth::tests` 等のクロスモジュールテストとも同じ GUARD を共有する。
    fn lock_guard() -> std::sync::MutexGuard<'static, ()> {
        memory_guard()
    }

    fn register_input(public_id: &str, email: &str) -> UserRegisterInput {
        UserRegisterInput {
            public_id: public_id.to_string(),
            name: "テストユーザ".to_string(),
            email: email.to_string(),
            password_plain: "correct horse battery staple".to_string(),
            avatar_initial: "テ".to_string(),
            role: "breeder".to_string(),
        }
    }

    #[tokio::test]
    async fn in_memory_find_by_public_id_hits_seed() {
        let _g = lock_guard();
        let u = find_by_public_id(None, "t_yamada").await.unwrap();
        assert!(u.is_some());
        let u = u.unwrap();
        assert_eq!(u.name, "山田 徹");
        assert_eq!(u.role, "breeder");
        assert_eq!(u.avatar_initial, "山");
        assert!(u.is_active);
        assert!(u.email.is_none(), "seed user は email 持たない");
    }

    #[tokio::test]
    async fn in_memory_find_by_public_id_misses() {
        let _g = lock_guard();
        reset_dynamic_for_test();
        let u = find_by_public_id(None, "ghost").await.unwrap();
        assert!(u.is_none());
    }

    #[tokio::test]
    async fn in_memory_find_all_active_returns_seed_plus_dynamic() {
        let _g = lock_guard();
        reset_dynamic_for_test();
        let users = find_all_active(None).await.unwrap();
        assert_eq!(users.len(), 1, "初期は seed の t_yamada だけ");
        let _ = create_with_password(None, register_input("alice", "alice@example.com"))
            .await
            .unwrap();
        let users = find_all_active(None).await.unwrap();
        assert_eq!(users.len(), 2, "register で 1 件増える");
    }

    #[tokio::test]
    async fn in_memory_find_by_id_hits_with_seeded_uuid() {
        let _g = lock_guard();
        let seeded = memory_seed_users()[0].id;
        let u = find_by_id(None, seeded).await.unwrap();
        assert!(u.is_some());
        assert_eq!(u.unwrap().public_id, "t_yamada");
    }

    #[tokio::test]
    async fn in_memory_find_by_id_misses_for_random_uuid() {
        let _g = lock_guard();
        let other = Uuid::new_v4();
        let u = find_by_id(None, other).await.unwrap();
        assert!(u.is_none());
    }

    #[test]
    fn memory_seed_user_role_is_in_check_constraint_set() {
        let u = &memory_seed_users()[0];
        assert!(["breeder", "admin", "shop_owner"].contains(&u.role.as_str()));
    }

    // ── password helpers ───────────────────────────────────────────

    #[test]
    fn hash_password_returns_phc_format() {
        let h = hash_password("hunter22-very-secure").unwrap();
        // Argon2id phc は `$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>` の 6 セグメント
        assert!(h.starts_with("$argon2id$"));
        // 0008_users_password.sql の CHECK (password_hash LIKE '$%$%$%') を満たす
        assert!(h.matches('$').count() >= 5);
    }

    #[test]
    fn hash_password_rejects_empty() {
        match hash_password("") {
            Err(UserRepoError::Invalid(msg)) => assert!(msg.contains("password")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn verify_password_accepts_correct_and_rejects_wrong() {
        let h = hash_password("hunter22-very-secure").unwrap();
        assert!(verify_password(&h, "hunter22-very-secure").unwrap());
        assert!(!verify_password(&h, "wrong-password").unwrap());
    }

    #[test]
    fn verify_password_errors_on_malformed_hash() {
        match verify_password("not-a-phc-string", "anything") {
            Err(UserRepoError::HashError(_)) => {}
            other => panic!("expected HashError, got {other:?}"),
        }
    }

    // ── register / find_by_email ────────────────────────────────────

    #[tokio::test]
    async fn validate_rejects_short_password() {
        let _g = lock_guard();
        let mut input = register_input("alice", "alice@example.com");
        input.password_plain = "short".to_string();
        match create_with_password(None, input).await {
            Err(UserRepoError::Invalid(msg)) => assert!(msg.contains("password")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_invalid_email() {
        let _g = lock_guard();
        let mut input = register_input("alice", "no-at-sign");
        input.email = "no-at-sign".to_string();
        match create_with_password(None, input).await {
            Err(UserRepoError::Invalid(msg)) => assert!(msg.contains("email")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_invalid_role() {
        let _g = lock_guard();
        let mut input = register_input("alice", "alice@example.com");
        input.role = "godmode".to_string();
        match create_with_password(None, input).await {
            Err(UserRepoError::Invalid(msg)) => assert!(msg.contains("role")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn create_with_password_then_find_by_email() {
        let _g = lock_guard();
        reset_dynamic_for_test();
        let id = create_with_password(None, register_input("alice", "alice@example.com"))
            .await
            .unwrap();
        let by_email = find_by_email(None, "alice@example.com").await.unwrap();
        assert!(by_email.is_some());
        assert_eq!(by_email.unwrap().id, id);
        let by_id = find_by_id(None, id).await.unwrap();
        assert!(by_id.is_some());
        assert_eq!(by_id.unwrap().public_id, "alice");
    }

    #[tokio::test]
    async fn find_password_hash_by_email_roundtrips_for_login() {
        let _g = lock_guard();
        reset_dynamic_for_test();
        let _ = create_with_password(None, register_input("alice", "alice@example.com"))
            .await
            .unwrap();
        let found = find_password_hash_by_email(None, "alice@example.com")
            .await
            .unwrap();
        assert!(found.is_some());
        let (user, hash) = found.unwrap();
        assert_eq!(user.public_id, "alice");
        let hash = hash.expect("register で hash が書かれている");
        assert!(verify_password(&hash, "correct horse battery staple").unwrap());
        assert!(!verify_password(&hash, "wrong-password").unwrap());
    }

    #[tokio::test]
    async fn find_password_hash_for_seed_user_returns_none_hash() {
        let _g = lock_guard();
        reset_dynamic_for_test();
        // seed t_yamada は email 持たないので find_password_hash_by_email では見つからない
        let found = find_password_hash_by_email(None, "anything@example.com")
            .await
            .unwrap();
        assert!(found.is_none());
    }
}
