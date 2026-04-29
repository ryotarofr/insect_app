//! password_resets (= 1 回限り使えるパスワードリセット token) の永続化 (PR N-5)
//!
//! **責務**:
//!   - `create(user_id, ttl_sec)` — random secret 発行 + Argon2id hash 保存
//!   - `consume(plain_token)` — token を verify + used_at = now() で 1 回限り保証
//!   - in-memory fallback も提供 (= dev / test)
//!
//! **token 形式**:
//!   `{row_uuid}.{secret_random}` の 2 パート。
//!   - `row_uuid`: DB の password_resets.id (= UUID v4)
//!   - `secret_random`: 32 byte URL-safe base64 (= ~43 文字、エントロピ 256 bit)
//!
//!   server 側は `.` で分割 → `find_by_id(row_uuid)` で row 取得 → Argon2 verify(secret, hash)。
//!   row_uuid を URL に晒しても安全 (= UUID v4 で予測不能)。
//!
//! **設計判断**:
//!   - **token_hash は users.password_hash と同じ Argon2id phc 形式** (= 0016 の CHECK 制約と整合)
//!   - **TTL は env で上書き可** (= `KOCHU_PASSWORD_RESET_TTL_SEC`、default 3600)
//!   - **used_at NOT NULL チェックは 0016 で済**: ここでは UPDATE で `WHERE used_at IS NULL` を握る
//!   - **expires_at past は consume で reject**: 期限切れは 1 回限り保証と独立な防御層
//!   - **rate limit / 件数制限は本層では持たない** (= handler 側 / Redis で別途実装)

use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::repos::users;

/// password_reset token の TTL (= secs)。env `KOCHU_PASSWORD_RESET_TTL_SEC` で上書き可。
pub fn ttl_secs() -> i64 {
    std::env::var("KOCHU_PASSWORD_RESET_TTL_SEC")
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|&s| s > 0)
        .unwrap_or(3600)
}

/// secret 部分の bytes (= 32 で 256 bit エントロピ)。
const SECRET_BYTES: usize = 32;

#[derive(Debug, Clone, FromRow)]
pub struct PasswordResetRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, thiserror::Error)]
pub enum PasswordResetRepoError {
    #[error("invalid token format")]
    InvalidTokenFormat,
    #[error("invalid token")]
    InvalidToken,
    #[error("token already used")]
    AlreadyUsed,
    #[error("token expired")]
    Expired,
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("hash error: {0}")]
    Hash(String),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// `user_id` 用の reset token を発行する。戻り値の `String` は **URL に乗せる plain token**
/// (= `{row_uuid}.{secret}` 形式)。caller (= handler) は email link に組み込んで送る。
pub async fn create(
    pool: Option<&PgPool>,
    user_id: Uuid,
) -> Result<String, PasswordResetRepoError> {
    let secret = generate_secret();
    let token_hash =
        users::hash_password(&secret).map_err(|e| PasswordResetRepoError::Hash(format!("{e}")))?;
    let expires_at = Utc::now() + chrono::Duration::seconds(ttl_secs());

    let row_id = match pool {
        Some(p) => insert_db(p, user_id, &token_hash, expires_at).await?,
        None => insert_memory(user_id, &token_hash, expires_at),
    };
    Ok(format_plain_token(row_id, &secret))
}

/// plain_token を verify + used_at = now() に遷移 (= 1 回限り保証)。
/// 成功時に `user_id` を返す (= caller は password_hash 更新に使う)。
///
/// **失敗ケース**:
///   - token format 不正 → `InvalidTokenFormat`
///   - row_uuid parse 失敗 / 行不存在 / Argon2 verify 失敗 → `InvalidToken` (= 区別せず)
///   - 既に used_at が入っている → `AlreadyUsed`
///   - expires_at < now → `Expired`
pub async fn consume(
    pool: Option<&PgPool>,
    plain_token: &str,
) -> Result<Uuid, PasswordResetRepoError> {
    let (row_id, secret) = parse_plain_token(plain_token)?;
    let row = find_by_id(pool, row_id)
        .await?
        .ok_or(PasswordResetRepoError::InvalidToken)?;

    // verify が落ちる前に状態判定するとタイミング差で「token 存在 / 不在」が漏れるため、
    // 順序を「Argon2 verify を必ず通す」→「状態チェック」にする。
    let ok = users::verify_password(&row.token_hash, &secret)
        .map_err(|e| PasswordResetRepoError::Hash(format!("{e}")))?;
    if !ok {
        return Err(PasswordResetRepoError::InvalidToken);
    }

    if row.used_at.is_some() {
        return Err(PasswordResetRepoError::AlreadyUsed);
    }
    if row.expires_at < Utc::now() {
        return Err(PasswordResetRepoError::Expired);
    }

    // mark used (= 楽観的 UPDATE で WHERE used_at IS NULL を握り、競合する 2 重 confirm を排除)
    let bound = mark_used(pool, row.id).await?;
    if !bound {
        return Err(PasswordResetRepoError::AlreadyUsed);
    }
    Ok(row.user_id)
}

/// row_id で 1 件取得 (= consume の内部 + ops / debug 用)。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<PasswordResetRow>, PasswordResetRepoError> {
    match pool {
        Some(p) => sqlx::query_as::<_, PasswordResetRow>(
            r#"
            SELECT id, user_id, token_hash, expires_at, used_at, created_at
            FROM password_resets
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(p)
        .await
        .map_err(PasswordResetRepoError::Db),
        None => Ok(memory_lock().iter().find(|r| r.id == id).cloned()),
    }
}

/// row.used_at = now() に遷移 (= 競合する 2 重 confirm を排除)。
/// 戻り値 `bool` は「実際に UPDATE が走ったか」(= false なら別 worker / request が先に消費した)。
async fn mark_used(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<bool, PasswordResetRepoError> {
    match pool {
        Some(p) => {
            let res = sqlx::query(
                r#"
                UPDATE password_resets
                SET used_at = now()
                WHERE id = $1 AND used_at IS NULL
                "#,
            )
            .bind(id)
            .execute(p)
            .await
            .map_err(PasswordResetRepoError::Db)?;
            Ok(res.rows_affected() > 0)
        }
        None => {
            let mut store = memory_lock_mut();
            if let Some(row) = store.iter_mut().find(|r| r.id == id && r.used_at.is_none()) {
                row.used_at = Some(Utc::now());
                Ok(true)
            } else {
                Ok(false)
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// token 生成 / parse
// ──────────────────────────────────────────────────────────────────────

/// 32 byte の random data を URL-safe base64 (= padding なし) で返す。
fn generate_secret() -> String {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    let mut buf = [0u8; SECRET_BYTES];
    OsRng.fill_bytes(&mut buf);
    base64_url_no_pad(&buf)
}

/// 標準ライブラリだけで URL-safe base64 (no padding) を実装 (= base64 crate 不採用で軽量化)。
fn base64_url_no_pad(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);

        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() >= 2 {
            out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        }
        if chunk.len() >= 3 {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        }
    }
    out
}

fn format_plain_token(row_id: Uuid, secret: &str) -> String {
    format!("{}.{}", row_id, secret)
}

fn parse_plain_token(plain: &str) -> Result<(Uuid, String), PasswordResetRepoError> {
    let (id_str, secret) = plain
        .split_once('.')
        .ok_or(PasswordResetRepoError::InvalidTokenFormat)?;
    let row_id = Uuid::parse_str(id_str).map_err(|_| PasswordResetRepoError::InvalidTokenFormat)?;
    if secret.is_empty() {
        return Err(PasswordResetRepoError::InvalidTokenFormat);
    }
    Ok((row_id, secret.to_string()))
}

// ──────────────────────────────────────────────────────────────────────
// DB / in-memory 実装
// ──────────────────────────────────────────────────────────────────────

async fn insert_db(
    pool: &PgPool,
    user_id: Uuid,
    token_hash: &str,
    expires_at: DateTime<Utc>,
) -> Result<Uuid, PasswordResetRepoError> {
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO password_resets (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(token_hash)
    .bind(expires_at)
    .fetch_one(pool)
    .await
    .map_err(PasswordResetRepoError::Db)?;
    Ok(row.0)
}

fn insert_memory(user_id: Uuid, token_hash: &str, expires_at: DateTime<Utc>) -> Uuid {
    let id = Uuid::new_v4();
    memory_lock_mut().push(PasswordResetRow {
        id,
        user_id,
        token_hash: token_hash.to_string(),
        expires_at,
        used_at: None,
        created_at: Utc::now(),
    });
    id
}

fn memory_store() -> &'static Mutex<Vec<PasswordResetRow>> {
    static S: OnceLock<Mutex<Vec<PasswordResetRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_lock() -> std::sync::MutexGuard<'static, Vec<PasswordResetRow>> {
    memory_store().lock().expect("password_resets memory poisoned")
}

fn memory_lock_mut() -> std::sync::MutexGuard<'static, Vec<PasswordResetRow>> {
    memory_lock()
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_store().lock() {
        s.clear();
    }
}

#[cfg(test)]
pub fn memory_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    GUARD.lock().unwrap_or_else(|p| p.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }

    #[tokio::test]
    async fn create_then_consume_round_trip() {
        let _g = memory_guard();
        reset_memory_for_test();
        let token = create(None, user()).await.unwrap();
        let returned_user = consume(None, &token).await.unwrap();
        assert_eq!(returned_user, user());
    }

    #[tokio::test]
    async fn consume_twice_rejects_second() {
        let _g = memory_guard();
        reset_memory_for_test();
        let token = create(None, user()).await.unwrap();
        consume(None, &token).await.unwrap();
        let res = consume(None, &token).await;
        assert!(matches!(res, Err(PasswordResetRepoError::AlreadyUsed)));
    }

    #[tokio::test]
    async fn consume_with_invalid_format_returns_format_error() {
        let _g = memory_guard();
        reset_memory_for_test();
        let res = consume(None, "no-dot-no-uuid").await;
        assert!(matches!(res, Err(PasswordResetRepoError::InvalidTokenFormat)));
    }

    #[tokio::test]
    async fn consume_with_unknown_row_id_returns_invalid() {
        let _g = memory_guard();
        reset_memory_for_test();
        let fake = format!("{}.{}", Uuid::new_v4(), "anysecret");
        let res = consume(None, &fake).await;
        assert!(matches!(res, Err(PasswordResetRepoError::InvalidToken)));
    }

    #[tokio::test]
    async fn consume_with_wrong_secret_returns_invalid() {
        let _g = memory_guard();
        reset_memory_for_test();
        let token = create(None, user()).await.unwrap();
        // row_id 部分はそのまま、secret 部分を別文字列に差し替え
        let (id_part, _) = token.split_once('.').unwrap();
        let bad = format!("{id_part}.wrong-secret-XYZ");
        let res = consume(None, &bad).await;
        assert!(matches!(res, Err(PasswordResetRepoError::InvalidToken)));
    }

    #[tokio::test]
    async fn consume_expired_token_returns_expired() {
        let _g = memory_guard();
        reset_memory_for_test();
        // expires_at を過去に直接書き換え (= TTL 経過を再現)
        let token = create(None, user()).await.unwrap();
        let (id_part, _) = token.split_once('.').unwrap();
        let row_id = Uuid::parse_str(id_part).unwrap();
        {
            let mut store = memory_lock_mut();
            store
                .iter_mut()
                .find(|r| r.id == row_id)
                .unwrap()
                .expires_at = Utc::now() - chrono::Duration::seconds(1);
        }
        let res = consume(None, &token).await;
        assert!(matches!(res, Err(PasswordResetRepoError::Expired)));
    }

    #[test]
    fn generate_secret_has_expected_length() {
        // 32 bytes → base64 (no pad) は ceil(32 / 3) * 4 = 44 chars、padding 削減で 43 chars
        let s = generate_secret();
        assert!(s.len() >= 40 && s.len() <= 44, "len={}", s.len());
    }

    #[test]
    fn ttl_secs_falls_back_to_3600() {
        // env が設定されていない / parse 不能なら default。
        unsafe {
            std::env::remove_var("KOCHU_PASSWORD_RESET_TTL_SEC");
        }
        assert_eq!(ttl_secs(), 3600);
    }

    #[test]
    fn parse_plain_token_handles_uuid_secret() {
        let id = Uuid::new_v4();
        let token = format!("{id}.abc-secret");
        let (parsed_id, secret) = parse_plain_token(&token).unwrap();
        assert_eq!(parsed_id, id);
        assert_eq!(secret, "abc-secret");
    }
}
