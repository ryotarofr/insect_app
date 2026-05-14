//! assets テーブルへの永続化 (画像アップロード)。
//!
//! **責務**:
//!   - sign 時の `insert_pending`: 署名 URL 発行のための行を作る (status='pending')
//!   - complete 時の `mark_uploaded`: 完了通知で status='uploaded' に遷移
//!   - 取得系: `find_by_id` (= 所有者チェック / public_url 構築用)
//!   - target 紐付け: `attach_target` (= specimen/product/specimen_log への紐付け)
//!
//! **設計上の注意**:
//!   - in-memory fallback は持たない (= production の挙動が DB 前提なので、dev でも DB を立てる)。
//!     pool=None を受けたら明示的に `Invalid("DB required")` を返す。
//!   - 状態遷移は repo 側で WHERE 条件付き UPDATE にして、CAS 的に冪等性を担保する。
//!     2 回目の `mark_uploaded` (= 既に uploaded) は `Ok(false)` を返し、呼び出し側は warn する。

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct AssetRow {
    pub id: Uuid,
    pub owner_user_id: Uuid,
    pub target_kind: Option<String>,
    pub target_id: Option<Uuid>,
    pub storage_key: String,
    pub mime_type: String,
    pub bytes: i64,
    pub status: String,
    pub uploaded_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct AssetInsert {
    pub owner_user_id: Uuid,
    pub target_kind: Option<String>,
    pub target_id: Option<Uuid>,
    pub storage_key: String,
    pub mime_type: String,
    pub bytes: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum AssetRepoError {
    #[error("invalid asset: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("asset not found: {0}")]
    NotFound(Uuid),
    #[error("DB required for assets repo (pool=None not supported)")]
    PoolMissing,
}

// ──────────────────────────────────────────────────────────────────────
// MIME / size validation
// ──────────────────────────────────────────────────────────────────────

/// 受理する MIME type ホワイトリスト (= migration の CHECK と一致)。
const ALLOWED_MIME_TYPES: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
];

/// アップロードサイズ上限 (= 10MB / migration の CHECK と一致)。
pub const MAX_UPLOAD_BYTES: i64 = 10 * 1024 * 1024;

/// target_kind の値域 (= migration 0017 + 0023 の CHECK と一致)。
const ALLOWED_TARGET_KINDS: &[&str] = &["specimen", "specimen_log", "listing"];

/// `mime_type` が許可リストに含まれるかを判定する。
pub fn is_allowed_mime(mime: &str) -> bool {
    ALLOWED_MIME_TYPES.contains(&mime)
}

/// `target_kind` が許可リストに含まれるかを判定する。
pub fn is_allowed_target_kind(kind: &str) -> bool {
    ALLOWED_TARGET_KINDS.contains(&kind)
}

fn validate(p: &AssetInsert) -> Result<(), AssetRepoError> {
    if !is_allowed_mime(&p.mime_type) {
        return Err(AssetRepoError::Invalid(format!(
            "mime_type not allowed: {} (must be one of {:?})",
            p.mime_type, ALLOWED_MIME_TYPES
        )));
    }
    if p.bytes < 0 || p.bytes > MAX_UPLOAD_BYTES {
        return Err(AssetRepoError::Invalid(format!(
            "bytes out of range (0..={}): got {}",
            MAX_UPLOAD_BYTES, p.bytes
        )));
    }
    if p.storage_key.is_empty() {
        return Err(AssetRepoError::Invalid("storage_key empty".to_string()));
    }
    // target_kind / target_id は両方 NULL or 両方 NOT NULL のみ。
    match (p.target_kind.as_deref(), p.target_id) {
        (None, None) | (Some(_), Some(_)) => {}
        _ => {
            return Err(AssetRepoError::Invalid(
                "target_kind and target_id must be both NULL or both NOT NULL".to_string(),
            ));
        }
    }
    if let Some(kind) = p.target_kind.as_deref()
        && !is_allowed_target_kind(kind)
    {
        return Err(AssetRepoError::Invalid(format!(
            "target_kind not allowed: {} (must be one of {:?})",
            kind, ALLOWED_TARGET_KINDS
        )));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// pending 状態の asset を 1 行 INSERT し、生成した UUID を返す。
/// 状態は default の 'pending' で開始 (= 完了通知後に mark_uploaded で 'uploaded' に遷移)。
pub async fn insert_pending(
    pool: Option<&PgPool>,
    payload: AssetInsert,
) -> Result<Uuid, AssetRepoError> {
    validate(&payload)?;
    let pool = pool.ok_or(AssetRepoError::PoolMissing)?;
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO assets
            (owner_user_id, target_kind, target_id, storage_key, mime_type, bytes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
    )
    .bind(payload.owner_user_id)
    .bind(payload.target_kind.as_deref())
    .bind(payload.target_id)
    .bind(&payload.storage_key)
    .bind(&payload.mime_type)
    .bind(payload.bytes)
    .fetch_one(pool)
    .await
    .map_err(AssetRepoError::Db)?;
    Ok(row.0)
}

/// 1 件取得 (= 所有者チェック / public_url 構築 / GET handler 用)。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<AssetRow>, AssetRepoError> {
    let pool = pool.ok_or(AssetRepoError::PoolMissing)?;
    sqlx::query_as::<_, AssetRow>(
        r#"
        SELECT id, owner_user_id, target_kind, target_id,
               storage_key, mime_type, bytes, status, uploaded_at, created_at
        FROM assets
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(AssetRepoError::Db)
}

/// 完了通知を受けて status='uploaded' + uploaded_at=now() に遷移する (CAS 風 / 冪等性ガード)。
///
/// 戻り値:
///   - `Ok(true)` … この呼び出しで遷移成功 (= 1 行 UPDATE された)
///   - `Ok(false)` … 既に uploaded だった / asset_id が存在しない / abandoned だった
///
/// `WHERE status = 'pending'` で「pending からのみ uploaded に遷移」を強制し、
/// abandoned や既 uploaded の上書きを防ぐ。呼び出し側は false を受けたら warn 程度で続行。
pub async fn mark_uploaded(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<bool, AssetRepoError> {
    let pool = pool.ok_or(AssetRepoError::PoolMissing)?;
    let res = sqlx::query(
        r#"
        UPDATE assets
        SET status = 'uploaded',
            uploaded_at = now()
        WHERE id = $1
          AND status = 'pending'
        "#,
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(AssetRepoError::Db)?;
    Ok(res.rows_affected() > 0)
}

/// asset を target (specimen/product/specimen_log) に紐付ける。
/// 紐付け前 (= target_kind/id 共に NULL) の行のみ許す (= 上書き防止)。
///
/// 戻り値:
///   - `Ok(true)` … 紐付け成功
///   - `Ok(false)` … 既に紐付け済 / asset 不在
pub async fn attach_target(
    pool: Option<&PgPool>,
    id: Uuid,
    target_kind: &str,
    target_id: Uuid,
) -> Result<bool, AssetRepoError> {
    if !is_allowed_target_kind(target_kind) {
        return Err(AssetRepoError::Invalid(format!(
            "target_kind not allowed: {target_kind}"
        )));
    }
    let pool = pool.ok_or(AssetRepoError::PoolMissing)?;
    let res = sqlx::query(
        r#"
        UPDATE assets
        SET target_kind = $2,
            target_id = $3
        WHERE id = $1
          AND target_kind IS NULL
          AND target_id IS NULL
        "#,
    )
    .bind(id)
    .bind(target_kind)
    .bind(target_id)
    .execute(pool)
    .await
    .map_err(AssetRepoError::Db)?;
    Ok(res.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(owner: Uuid) -> AssetInsert {
        AssetInsert {
            owner_user_id: owner,
            target_kind: None,
            target_id: None,
            storage_key: "user/x/test.jpg".to_string(),
            mime_type: "image/jpeg".to_string(),
            bytes: 1024,
        }
    }

    #[test]
    fn allowed_mime_check() {
        assert!(is_allowed_mime("image/jpeg"));
        assert!(is_allowed_mime("image/png"));
        assert!(is_allowed_mime("image/webp"));
        assert!(is_allowed_mime("image/gif"));
        assert!(!is_allowed_mime("image/bmp"));
        assert!(!is_allowed_mime("video/mp4"));
        assert!(!is_allowed_mime(""));
    }

    #[test]
    fn allowed_target_kind_check() {
        assert!(is_allowed_target_kind("specimen"));
        assert!(is_allowed_target_kind("specimen_log"));
        assert!(is_allowed_target_kind("listing"));
        // products は廃止されたので 'product' も拒否
        assert!(!is_allowed_target_kind("product"));
        assert!(!is_allowed_target_kind("order"));
        assert!(!is_allowed_target_kind(""));
    }

    #[tokio::test]
    async fn validate_rejects_bad_mime() {
        let mut p = payload(Uuid::new_v4());
        p.mime_type = "image/bmp".to_string();
        match insert_pending(None, p).await {
            Err(AssetRepoError::Invalid(msg)) => assert!(msg.contains("mime_type")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_bytes_over_limit() {
        let mut p = payload(Uuid::new_v4());
        p.bytes = MAX_UPLOAD_BYTES + 1;
        match insert_pending(None, p).await {
            Err(AssetRepoError::Invalid(msg)) => assert!(msg.contains("bytes")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_partial_target() {
        // target_kind だけ NOT NULL は不正 (= consistency check)
        let mut p = payload(Uuid::new_v4());
        p.target_kind = Some("specimen".to_string());
        p.target_id = None;
        match insert_pending(None, p).await {
            Err(AssetRepoError::Invalid(msg)) => assert!(msg.contains("target_kind")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_passes_valid_payload_but_pool_missing() {
        // pool=None で valid payload を入れた場合は PoolMissing が返る (= validate は通る)
        let p = payload(Uuid::new_v4());
        match insert_pending(None, p).await {
            Err(AssetRepoError::PoolMissing) => {}
            other => panic!("expected PoolMissing, got {other:?}"),
        }
    }
}
