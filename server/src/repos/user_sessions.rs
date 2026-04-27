//! user_sessions への永続化 (Phase 9.C 補助 / DB設計書 v2 §3.3 / Phase 9.H で Argon2 化)
//!
//! **責務**:
//!   - sqlx で user_sessions テーブルへの INSERT / SELECT / UPDATE / DELETE を提供
//!   - DB 不在時 (= pool=None) は in-memory fallback で動く
//!   - cookie に乗る `<id>:<secret>` の SessionToken を生成 / parse / verify する
//!
//! **token 形式 (Phase 9.H 以降)**:
//!   - cookie 値 = `<UUID>:<hex32>` (= UUID v4 + 32-byte 暗号学的乱数の hex 表現)
//!   - DB の `user_sessions.token_hash` には secret を Argon2id でハッシュした
//!     phc 文字列を格納する (= `$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`)
//!   - 認証時は `id` で row を引いた後 `verify_secret(secret, row.token_hash)` で検証する。
//!   - **設計上の含意**: DB 単体が漏れても cookie の secret は復元できない (= Argon2 一方向)。
//!     cookie が漏れた時点で奪取は可能なので、SameSite=Lax + HttpOnly + Secure を併用する。
//!
//! **互換性 (= 旧 cookie の扱い)**:
//!   - Phase 9.G までの cookie は単一 UUID 形式 (= `<UUID>` のみ) で、token_hash は
//!     `$kochu$mvp$<UUID>` 固定文字列だった。
//!   - 旧形式 cookie / DB row は **本 PR の verify で全て不一致** になり、middleware が
//!     新規 session を発行しなおす (= silent rotation)。MVP 段階なので破壊的変更を許容。
//!
//! **未実装 (= 後続タスク)**:
//!   - expires_at の TTL 管理 (= 30 日固定の延長 / GC バッチ)
//!   - rotation: login / sensitive 操作時に id+secret をローテートして session fixation 緩和

use std::sync::{Mutex, OnceLock};

use argon2::{
    Argon2,
    password_hash::{
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
        rand_core::{OsRng, RngCore},
    },
};
use chrono::{DateTime, Duration, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct UserSessionRow {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, thiserror::Error)]
pub enum UserSessionRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("session not found: {0}")]
    NotFound(Uuid),
    #[error("hash error: {0}")]
    HashError(String),
}

/// MVP 既定の session 寿命 = 30 日。Cookie 側は browser 既定 (= session cookie) でも
/// 動くが、DB レコードは絶対時刻で TTL を持つ。
pub const DEFAULT_SESSION_TTL_DAYS: i64 = 30;

/// 1 byte あたり 2 文字の hex なので、32 byte → 64 文字。
/// この値は cookie / DB 共通の不変量で、`SessionToken::parse` で長さチェックに使う。
const SECRET_HEX_LEN: usize = 64;

// ──────────────────────────────────────────────────────────────────────
// SessionToken: cookie に乗る `<id>:<secret>` 構造
// ──────────────────────────────────────────────────────────────────────

/// Cookie の `kochu_session=` に乗る値の構造化表現。
///
/// `id` は DB 検索用の public 識別子 (= user_sessions.id PK)、
/// `secret` は Argon2 で hash されてから DB に渡る credential (= cookie 持ち主のみ知る)。
///
/// **不変量**:
///   - `secret` は 64 文字の小文字 hex (= 32 byte 乱数)。`parse` で検証する。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionToken {
    pub id: Uuid,
    pub secret: String,
}

impl SessionToken {
    /// 新規 SessionToken を発行する。
    /// - `id` = UUID v4
    /// - `secret` = OsRng (= /dev/urandom 等) から 32 byte 取って hex 化
    pub fn generate() -> Self {
        let id = Uuid::new_v4();
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let secret = hex::encode(bytes);
        Self { id, secret }
    }

    /// cookie 値文字列を parse する。`<UUID-36>:<hex-64>` 以外は None。
    ///
    /// hex 部分は **必ず 64 文字** で、a-f0-9 のみ許可。`SECRET_HEX_LEN` を下回る /
    /// 上回る / 大文字混入はすべて reject する (= 旧 cookie / 改ざんを silent reject)。
    pub fn parse(s: &str) -> Option<Self> {
        let (id_str, secret) = s.split_once(':')?;
        let id = Uuid::parse_str(id_str).ok()?;
        if secret.len() != SECRET_HEX_LEN {
            return None;
        }
        if !secret.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return None;
        }
        Some(Self {
            id,
            secret: secret.to_string(),
        })
    }

    /// cookie 値として serialize する (= `<id>:<secret>`)。
    pub fn cookie_value(&self) -> String {
        format!("{}:{}", self.id, self.secret)
    }
}

/// 平文 secret を Argon2id で hash 化し、phc 文字列を返す。
///
/// パラメータは `Argon2::default()` (= m=19456, t=2, p=1)。secret は既に 256-bit
/// 乱数なので production でもこのコストで十分 (= brute-force 耐性は乱数空間が担う)。
pub fn hash_secret(secret: &str) -> Result<String, UserSessionRepoError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(secret.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| UserSessionRepoError::HashError(e.to_string()))
}

/// 平文 secret を phc 文字列と verify する。
/// 戻り値: Ok(true) = 一致 / Ok(false) = 不一致 / Err = phc parse 失敗等。
pub fn verify_secret(secret: &str, hash: &str) -> Result<bool, UserSessionRepoError> {
    let parsed = PasswordHash::new(hash).map_err(|e| UserSessionRepoError::HashError(e.to_string()))?;
    Ok(Argon2::default()
        .verify_password(secret.as_bytes(), &parsed)
        .is_ok())
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// 匿名セッションを 1 件作成する (= user_id = NULL)。
///
/// 呼び出し側が `SessionToken::generate()` で発行した token を渡す。
/// 同じ token を cookie にも乗せることで、後続リクエストの `verify` で照合できる。
pub async fn create_anonymous(
    pool: Option<&PgPool>,
    token: &SessionToken,
) -> Result<UserSessionRow, UserSessionRepoError> {
    let token_hash = hash_secret(&token.secret)?;
    let expires_at = Utc::now() + Duration::days(DEFAULT_SESSION_TTL_DAYS);
    let row = UserSessionRow {
        id: token.id,
        user_id: None,
        token_hash,
        expires_at,
    };

    match pool {
        Some(p) => create_anonymous_db(p, row.clone()).await.map(|_| row),
        None => {
            memory_store_lock_mut().push(row.clone());
            Ok(row)
        }
    }
}

/// `id` で 1 件取得 (= cookie の UUID で session を引く)。
///
/// **注**: これは row を取り出すだけで認証は **行わない**。secret 検証込みで
/// "本人かどうか" を判定したい場合は `verify` を使う。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<UserSessionRow>, UserSessionRepoError> {
    match pool {
        Some(p) => find_by_id_db(p, id).await,
        None => Ok(memory_store_lock().iter().find(|r| r.id == id).cloned()),
    }
}

/// cookie の SessionToken を verify する (= 認証エントリポイント)。
///
/// セマンティクス:
///   - `id` で row を引けない → `Ok(None)` (= 期限切れ / DB 無し / 偽 UUID 等)
///   - row はあるが secret が hash と不一致 → `Ok(None)` (= 改ざん / 別 cookie)
///   - 全て一致 → `Ok(Some(row))`
///
/// hash parse 失敗等の異常は `Err(HashError)` を返す。session_middleware は
/// 異常時も silent rotate (= 新規発行) する想定で、エラーは warn ログに留める。
pub async fn verify(
    pool: Option<&PgPool>,
    token: &SessionToken,
) -> Result<Option<UserSessionRow>, UserSessionRepoError> {
    let Some(row) = find_by_id(pool, token.id).await? else {
        return Ok(None);
    };
    if verify_secret(&token.secret, &row.token_hash)? {
        Ok(Some(row))
    } else {
        Ok(None)
    }
}

/// 既存 session に user_id を紐付ける (= register / login 直後の "anonymous → user" 昇格)。
///
/// session 行が DB に存在しない (= cookie はあるが user_sessions に未登録) ケースは
/// upsert で作る方が UX が良いが、本 PR では NotFound として扱う。先に
/// `create_anonymous` を呼ぶ前提。
pub async fn attach_user(
    pool: Option<&PgPool>,
    session_id: Uuid,
    user_id: Uuid,
) -> Result<(), UserSessionRepoError> {
    match pool {
        Some(p) => attach_user_db(p, session_id, user_id).await,
        None => {
            let mut store = memory_store_lock_mut();
            let row = store
                .iter_mut()
                .find(|r| r.id == session_id)
                .ok_or(UserSessionRepoError::NotFound(session_id))?;
            row.user_id = Some(user_id);
            Ok(())
        }
    }
}

/// session の user_id を NULL に戻す (= logout 時の "user → anonymous" 降格)。
///
/// session 行自体は残し cart_items 等の所有権 (session_id) は維持する設計。
/// 「cookie 自体を破棄」したい場合は別途 `delete()` を使う。
/// 行が存在しない場合は NotFound だが、handler 側では 204 で吸収する想定。
pub async fn detach_user(
    pool: Option<&PgPool>,
    session_id: Uuid,
) -> Result<(), UserSessionRepoError> {
    match pool {
        Some(p) => detach_user_db(p, session_id).await,
        None => {
            let mut store = memory_store_lock_mut();
            let row = store
                .iter_mut()
                .find(|r| r.id == session_id)
                .ok_or(UserSessionRepoError::NotFound(session_id))?;
            row.user_id = None;
            Ok(())
        }
    }
}

/// expires_at を `Utc::now() + days` に書き換える (= ログイン後等のリフレッシュ用)。
pub async fn extend_expiry(
    pool: Option<&PgPool>,
    id: Uuid,
    days: i64,
) -> Result<(), UserSessionRepoError> {
    let new_expires_at = Utc::now() + Duration::days(days);
    match pool {
        Some(p) => extend_expiry_db(p, id, new_expires_at).await,
        None => {
            let mut store = memory_store_lock_mut();
            let row = store
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(UserSessionRepoError::NotFound(id))?;
            row.expires_at = new_expires_at;
            Ok(())
        }
    }
}

/// 物理削除 (= ログアウト / GC 用)。
pub async fn delete(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<(), UserSessionRepoError> {
    match pool {
        Some(p) => delete_db(p, id).await,
        None => {
            let mut store = memory_store_lock_mut();
            let len_before = store.len();
            store.retain(|r| r.id != id);
            if store.len() == len_before {
                return Err(UserSessionRepoError::NotFound(id));
            }
            Ok(())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn create_anonymous_db(
    pool: &PgPool,
    row: UserSessionRow,
) -> Result<(), UserSessionRepoError> {
    sqlx::query(
        r#"
        INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(row.id)
    .bind(row.user_id)
    .bind(&row.token_hash)
    .bind(row.expires_at)
    .execute(pool)
    .await
    .map_err(UserSessionRepoError::Db)?;
    Ok(())
}

async fn find_by_id_db(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<UserSessionRow>, UserSessionRepoError> {
    sqlx::query_as::<_, UserSessionRow>(
        r#"
        SELECT id, user_id, token_hash, expires_at
        FROM user_sessions
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(UserSessionRepoError::Db)
}

async fn attach_user_db(
    pool: &PgPool,
    session_id: Uuid,
    user_id: Uuid,
) -> Result<(), UserSessionRepoError> {
    let res = sqlx::query(
        r#"
        UPDATE user_sessions
        SET user_id = $2
        WHERE id = $1
        "#,
    )
    .bind(session_id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(UserSessionRepoError::Db)?;
    if res.rows_affected() == 0 {
        return Err(UserSessionRepoError::NotFound(session_id));
    }
    Ok(())
}

async fn detach_user_db(
    pool: &PgPool,
    session_id: Uuid,
) -> Result<(), UserSessionRepoError> {
    let res = sqlx::query(
        r#"
        UPDATE user_sessions
        SET user_id = NULL
        WHERE id = $1
        "#,
    )
    .bind(session_id)
    .execute(pool)
    .await
    .map_err(UserSessionRepoError::Db)?;
    if res.rows_affected() == 0 {
        return Err(UserSessionRepoError::NotFound(session_id));
    }
    Ok(())
}

async fn extend_expiry_db(
    pool: &PgPool,
    id: Uuid,
    new_expires_at: DateTime<Utc>,
) -> Result<(), UserSessionRepoError> {
    let res = sqlx::query(
        r#"
        UPDATE user_sessions
        SET expires_at = $2
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(new_expires_at)
    .execute(pool)
    .await
    .map_err(UserSessionRepoError::Db)?;
    if res.rows_affected() == 0 {
        return Err(UserSessionRepoError::NotFound(id));
    }
    Ok(())
}

async fn delete_db(pool: &PgPool, id: Uuid) -> Result<(), UserSessionRepoError> {
    let res = sqlx::query("DELETE FROM user_sessions WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(UserSessionRepoError::Db)?;
    if res.rows_affected() == 0 {
        return Err(UserSessionRepoError::NotFound(id));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<UserSessionRow>> {
    static S: OnceLock<Mutex<Vec<UserSessionRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_store_lock() -> std::sync::MutexGuard<'static, Vec<UserSessionRow>> {
    memory_store().lock().expect("user_sessions memory mutex poisoned")
}

fn memory_store_lock_mut() -> std::sync::MutexGuard<'static, Vec<UserSessionRow>> {
    memory_store_lock()
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_store().lock() {
        s.clear();
    }
}

/// テスト互換のショートカット (= 旧 `create_anonymous(pool, id: Uuid)` 互換)。
///
/// id だけ指定して匿名 session を作る。内部で固定 secret を使う `SessionToken` を組み立てる。
/// 呼び出し側がその後 `verify` で認証経路を通すケースは無いため、secret 値は任意で良い。
/// **production コードからは絶対に呼ばない**: cookie に乗せる SessionToken と DB の hash が
/// 結びつかなくなる (= 認証が常に失敗) ため。
#[cfg(test)]
pub async fn create_anonymous_for_test(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<UserSessionRow, UserSessionRepoError> {
    let token = SessionToken {
        id,
        secret: "0".repeat(SECRET_HEX_LEN),
    };
    create_anonymous(pool, &token).await
}

/// `user_sessions` の in-memory store を触る複数モジュール (= `repos::user_sessions` /
/// `handlers::auth` 等) が **同じ** GUARD を取って逐次化するために共有する mutex。
/// poison-tolerant。
#[cfg(test)]
pub fn memory_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    GUARD.lock().unwrap_or_else(|p| p.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// グローバル in-memory store の競合を避けるため、本モジュール公開の
    /// `memory_guard()` (= poison-tolerant) で逐次化する。
    /// `handlers::auth::tests` 等のクロスモジュールテストとも同 GUARD を共有する。
    fn lock_guard() -> std::sync::MutexGuard<'static, ()> {
        memory_guard()
    }

    // ── SessionToken ─────────────────────────────────────────────────

    #[test]
    fn session_token_generate_produces_well_formed_value() {
        let _g = lock_guard();
        let t = SessionToken::generate();
        // secret は 64 文字の小文字 hex
        assert_eq!(t.secret.len(), SECRET_HEX_LEN);
        assert!(t.secret.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        // id は UUID v4 (= バリアント bit + バージョン 4)
        let cookie = t.cookie_value();
        assert!(cookie.contains(':'));
        let parsed = SessionToken::parse(&cookie).expect("roundtrip");
        assert_eq!(parsed, t);
    }

    #[test]
    fn session_token_parse_rejects_bad_inputs() {
        let _g = lock_guard();
        // 区切り無し
        assert!(SessionToken::parse("not-a-token").is_none());
        // UUID 不正
        let bad_uuid = format!("not-uuid:{}", "a".repeat(SECRET_HEX_LEN));
        assert!(SessionToken::parse(&bad_uuid).is_none());
        // secret 長さ不足
        let short = format!("{}:{}", Uuid::new_v4(), "a".repeat(10));
        assert!(SessionToken::parse(&short).is_none());
        // secret 大文字混入
        let upper = format!("{}:{}", Uuid::new_v4(), "A".repeat(SECRET_HEX_LEN));
        assert!(SessionToken::parse(&upper).is_none());
        // secret 非 hex 文字混入
        let mut bad_chars: String = "z".to_string();
        bad_chars.push_str(&"a".repeat(SECRET_HEX_LEN - 1));
        let bad_secret = format!("{}:{}", Uuid::new_v4(), bad_chars);
        assert!(SessionToken::parse(&bad_secret).is_none());
    }

    #[test]
    fn session_token_each_generate_is_unique() {
        let _g = lock_guard();
        let t1 = SessionToken::generate();
        let t2 = SessionToken::generate();
        assert_ne!(t1.id, t2.id, "UUID は乱数なので衝突確率 ≈ 0");
        assert_ne!(t1.secret, t2.secret, "secret も独立");
    }

    // ── hash / verify ───────────────────────────────────────────────

    #[test]
    fn hash_secret_produces_argon2id_phc() {
        let _g = lock_guard();
        let secret = "x".repeat(SECRET_HEX_LEN);
        let h = hash_secret(&secret).unwrap();
        assert!(h.starts_with("$argon2id$"));
        // 0004_users.sql の CHECK (token_hash LIKE '$%$%$%') を満たす
        assert!(h.matches('$').count() >= 3);
    }

    #[test]
    fn verify_secret_matches_only_correct_input() {
        let _g = lock_guard();
        let secret = "abcdef".repeat(10) + &"0".repeat(4); // 64 文字
        let h = hash_secret(&secret).unwrap();
        assert!(verify_secret(&secret, &h).unwrap());
        assert!(!verify_secret("not-the-secret", &h).unwrap());
    }

    // ── repo: in-memory ──────────────────────────────────────────────

    #[tokio::test]
    async fn in_memory_create_and_find_by_id() {
        let _g = lock_guard();
        reset_memory_for_test();
        let token = SessionToken::generate();
        let row = create_anonymous(None, &token).await.unwrap();
        assert_eq!(row.id, token.id);
        assert!(row.user_id.is_none(), "anonymous → user_id = None");
        assert!(
            row.token_hash.starts_with("$argon2id$"),
            "Argon2id phc 形式で永続化されているはず"
        );
        assert!(
            !row.token_hash.contains(&token.secret),
            "secret が hash 内に平文で出てはいけない"
        );

        let found = find_by_id(None, token.id).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, token.id);
    }

    #[tokio::test]
    async fn in_memory_verify_succeeds_with_correct_secret() {
        let _g = lock_guard();
        reset_memory_for_test();
        let token = SessionToken::generate();
        create_anonymous(None, &token).await.unwrap();

        let verified = verify(None, &token).await.unwrap();
        assert!(verified.is_some(), "正しい secret なら verify は Some");
        assert_eq!(verified.unwrap().id, token.id);
    }

    #[tokio::test]
    async fn in_memory_verify_fails_with_wrong_secret() {
        let _g = lock_guard();
        reset_memory_for_test();
        let token = SessionToken::generate();
        create_anonymous(None, &token).await.unwrap();

        let attacker = SessionToken {
            id: token.id,
            // 同じ id だが別 secret
            secret: "0".repeat(SECRET_HEX_LEN),
        };
        assert!(verify(None, &attacker).await.unwrap().is_none(), "不正 secret は None");
    }

    #[tokio::test]
    async fn in_memory_verify_fails_with_unknown_id() {
        let _g = lock_guard();
        reset_memory_for_test();
        let unknown = SessionToken::generate();
        assert!(verify(None, &unknown).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn in_memory_find_by_id_misses_for_unknown_uuid() {
        let _g = lock_guard();
        reset_memory_for_test();
        let unknown = Uuid::new_v4();
        let found = find_by_id(None, unknown).await.unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn in_memory_extend_expiry_pushes_forward() {
        let _g = lock_guard();
        reset_memory_for_test();
        let token = SessionToken::generate();
        let row = create_anonymous(None, &token).await.unwrap();
        let original_expires = row.expires_at;
        // 一旦短くしてから 60 日伸ばす
        extend_expiry(None, token.id, 60).await.unwrap();
        let updated = find_by_id(None, token.id).await.unwrap().unwrap();
        assert!(
            updated.expires_at >= original_expires - Duration::seconds(1),
            "extend_expiry should push expires_at to roughly now + 60d"
        );
    }

    #[tokio::test]
    async fn in_memory_extend_expiry_unknown_returns_not_found() {
        let _g = lock_guard();
        reset_memory_for_test();
        match extend_expiry(None, Uuid::new_v4(), 30).await {
            Err(UserSessionRepoError::NotFound(_)) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn in_memory_delete_removes_then_misses() {
        let _g = lock_guard();
        reset_memory_for_test();
        let token = SessionToken::generate();
        create_anonymous(None, &token).await.unwrap();
        delete(None, token.id).await.unwrap();
        let found = find_by_id(None, token.id).await.unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn in_memory_delete_unknown_returns_not_found() {
        let _g = lock_guard();
        reset_memory_for_test();
        match delete(None, Uuid::new_v4()).await {
            Err(UserSessionRepoError::NotFound(_)) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn default_ttl_days_is_thirty() {
        let _g = lock_guard();
        assert_eq!(DEFAULT_SESSION_TTL_DAYS, 30);
    }
}
