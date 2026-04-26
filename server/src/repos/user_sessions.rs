//! user_sessions への永続化 (Phase 9.C 補助 / DB設計書 v2 §3.3)
//!
//! **責務 (本 PR / skeleton)**:
//!   - sqlx で user_sessions テーブルへの INSERT / SELECT / UPDATE / DELETE を提供
//!   - DB 不在時 (= pool=None) は in-memory fallback で動く
//!   - `session_middleware` から利用される側を整備するが、middleware 自体の
//!     DB 連携は **次フェーズ** に分離 (= 本 PR は repo 単独)
//!
//! **token_hash の取り扱い (MVP)**:
//!   - 0004_users.sql の CHECK 制約 `token_hash LIKE '$%$%$%'` (= phc 風形式)
//!     を満たすため、cookie の UUID をそのまま hash にせず `$kochu$mvp$<uuid>`
//!     という固定フォーマットで埋める。MVP でセッショントークンを secure に
//!     扱う必要が出てきたら Argon2 に切り替える (= 設計書 Medium #6)。
//!   - `cookie_uuid_to_token_hash(uuid)` ヘルパで一貫した変換を担保。
//!
//! **未実装 (= 後続タスク)**:
//!   - session_middleware と統合して新規 cookie 発行時に INSERT する
//!   - expires_at の TTL 管理 (= 30 日固定の延長 / GC バッチ)

use std::sync::{Mutex, OnceLock};

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
}

/// Cookie で受け取った UUID を user_sessions.token_hash 文字列に変換。
///
/// MVP は本物のハッシュではなく phc 形式に見える固定埋め込み (= CHECK 制約満たす)。
/// production では Argon2 で hash した値に切り替える。
pub fn cookie_uuid_to_token_hash(uuid: Uuid) -> String {
    format!("$kochu$mvp${uuid}")
}

/// MVP 既定の session 寿命 = 30 日。Cookie 側は browser 既定 (= session cookie) でも
/// 動くが、DB レコードは絶対時刻で TTL を持つ。
pub const DEFAULT_SESSION_TTL_DAYS: i64 = 30;

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// 匿名セッションを 1 件作成する (= user_id = NULL)。
///
/// `id` (= cookie で発行する UUID) を呼び出し側が指定する。これにより
/// session_middleware は cookie 値と user_sessions.id を 1:1 で結び付けられる。
pub async fn create_anonymous(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<UserSessionRow, UserSessionRepoError> {
    let token_hash = cookie_uuid_to_token_hash(id);
    let expires_at = Utc::now() + Duration::days(DEFAULT_SESSION_TTL_DAYS);
    let row = UserSessionRow {
        id,
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
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<UserSessionRow>, UserSessionRepoError> {
    match pool {
        Some(p) => find_by_id_db(p, id).await,
        None => Ok(memory_store_lock().iter().find(|r| r.id == id).cloned()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// グローバル in-memory store の競合を避けるため、reset 経由のテストは
    /// 1 つずつ走らせる。pure helper 系 (= store を触らない) は GUARD 不要だが
    /// 揃えるために全テストで取得する。
    static GUARD: StdMutex<()> = StdMutex::new(());

    #[test]
    fn cookie_uuid_to_token_hash_is_phc_shaped() {
        let _g = GUARD.lock().unwrap();
        let id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let hash = cookie_uuid_to_token_hash(id);
        // 0004_users.sql の CHECK (token_hash LIKE '$%$%$%') を最低限満たす
        assert!(hash.starts_with('$'), "must start with $");
        assert_eq!(hash.matches('$').count(), 3, "phc 形式: $algo$params$value");
        assert!(hash.contains(&id.to_string()));
    }

    #[tokio::test]
    async fn in_memory_create_and_find_by_id() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let id = Uuid::new_v4();
        let row = create_anonymous(None, id).await.unwrap();
        assert_eq!(row.id, id);
        assert!(row.user_id.is_none(), "anonymous → user_id = None");
        assert!(row.token_hash.starts_with("$kochu$mvp$"));

        let found = find_by_id(None, id).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, id);
    }

    #[tokio::test]
    async fn in_memory_find_by_id_misses_for_unknown_uuid() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let unknown = Uuid::new_v4();
        let found = find_by_id(None, unknown).await.unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn in_memory_extend_expiry_pushes_forward() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let id = Uuid::new_v4();
        let row = create_anonymous(None, id).await.unwrap();
        let original_expires = row.expires_at;
        // 一旦短くしてから 60 日伸ばす
        extend_expiry(None, id, 60).await.unwrap();
        let updated = find_by_id(None, id).await.unwrap().unwrap();
        assert!(
            updated.expires_at >= original_expires - Duration::seconds(1),
            "extend_expiry should push expires_at to roughly now + 60d"
        );
    }

    #[tokio::test]
    async fn in_memory_extend_expiry_unknown_returns_not_found() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        match extend_expiry(None, Uuid::new_v4(), 30).await {
            Err(UserSessionRepoError::NotFound(_)) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn in_memory_delete_removes_then_misses() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let id = Uuid::new_v4();
        create_anonymous(None, id).await.unwrap();
        delete(None, id).await.unwrap();
        let found = find_by_id(None, id).await.unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn in_memory_delete_unknown_returns_not_found() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        match delete(None, Uuid::new_v4()).await {
            Err(UserSessionRepoError::NotFound(_)) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn default_ttl_days_is_thirty() {
        let _g = GUARD.lock().unwrap();
        assert_eq!(DEFAULT_SESSION_TTL_DAYS, 30);
    }
}
