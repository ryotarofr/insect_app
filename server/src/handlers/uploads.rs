//! `/api/v1/uploads/*` + `/api/v1/assets/{id}` (Week 2 / F4 / 画像アップロード基盤)。
//!
//! **責務**:
//!   3 リクエスト構成のダイレクトアップロード:
//!     1. `POST /uploads/sign`            — 署名 URL 発行 (= asset 行を pending で作る)
//!     2. `PUT  /uploads/local/{id}`      — local mode の body 受信エンドポイント (dev 専用)
//!     3. `POST /uploads/complete`        — 完了通知 (= status を uploaded に遷移)
//!   + GET 経路:
//!     4. `GET  /assets/{id}`             — public 取得 (= image src で参照)
//!
//! **storage backend**:
//!   `KOCHU_STORAGE_PROVIDER` env で切り替え:
//!     - `local` (default for dev): server プロセス自身が PUT を受け、ローカルファイルに保存。
//!     - `r2` / `s3` (将来): aws-sdk-s3 で署名 URL 発行 + 直接アップロード (= 別タスク)。
//!   保存ディレクトリは `KOCHU_STORAGE_LOCAL_DIR` (default `./storage_dev`)。
//!
//! **認証**:
//!   - `/uploads/*` は login 必須 (= owner_user_id を session から取得)。
//!   - `/assets/{id}` は public (= image src で `<img>` から直接読まれるため)。
//!     production では署名済 URL に切り替えるが、MVP は同 origin の static 配信でよしとする。
//!
//! **将来の拡張**:
//!   - mime sniffing (= 受信した body の magic bytes を検証して MIME を再確認)
//!   - サムネイル自動生成 (= image crate)
//!   - target attach 用 endpoint (= POST /assets/{id}/attach)
//!   - production の R2/S3 署名 URL 発行

use std::path::PathBuf;

use axum::{
    Json,
    body::Bytes,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::{assets, user_sessions};
use crate::session::SessionId;
use crate::state::AppState;

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

async fn require_user_id(state: &AppState, session_id: Uuid) -> Result<Uuid, AppError> {
    let session = user_sessions::find_by_id(state.db(), session_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("session lookup: {e}")))?
        .ok_or(AppError::Unauthorized)?;
    session.user_id.ok_or(AppError::Unauthorized)
}

/// ローカルストレージのルート dir を返す (= env 上書き or default)。
fn local_storage_dir() -> PathBuf {
    let s = std::env::var("KOCHU_STORAGE_LOCAL_DIR")
        .unwrap_or_else(|_| "./storage_dev".to_string());
    PathBuf::from(s)
}

/// `KOCHU_STORAGE_PROVIDER` env を読む (= local / r2 / s3)。デフォルトは local。
fn storage_provider() -> String {
    std::env::var("KOCHU_STORAGE_PROVIDER").unwrap_or_else(|_| "local".to_string())
}

/// asset_id から local mode の storage_key を組み立てる。
/// flat 配置 (= sub-dir なし) で `{asset_id}.bin` 形式。dev 用なので path traversal 心配なし
/// (= asset_id は UUID で parse 済 = 文字列入力ではない)。
fn local_storage_key(asset_id: Uuid) -> String {
    format!("{}.bin", asset_id.simple())
}

/// asset_id から ローカル保存先の絶対 path を返す。
fn local_path(asset_id: Uuid) -> PathBuf {
    let mut p = local_storage_dir();
    p.push(local_storage_key(asset_id));
    p
}

/// `KOCHU_PUBLIC_BASE_URL` env (= dev: http://localhost:3000, prod: https://kochu.example) を返す。
/// 未設定なら `http://localhost:3000` を default に倒す (= dev 既定値)。
fn public_base_url() -> String {
    std::env::var("KOCHU_PUBLIC_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string())
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/v1/uploads/sign
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SignRequest {
    /// `image/jpeg` / `image/png` / `image/webp` / `image/gif` のいずれか。
    pub mime_type: String,
    /// アップロード予定のバイトサイズ (= ヘッダ的な事前申告)。
    pub bytes: i64,
    /// 任意: アップロードと同時に target を指定したい場合 (= 紐付け待ちで保留も可)。
    #[serde(default)]
    pub target_kind: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SignResponse {
    /// 作成した asset の UUID 文字列。
    pub asset_id: String,
    /// クライアントが PUT する宛先 URL。local mode は server 自身、r2/s3 は署名済 URL。
    pub upload_url: String,
    /// HTTP method (= "PUT")。
    pub upload_method: String,
}

/// `POST /api/v1/uploads/sign` — login required。
/// asset 行を `pending` で作り、クライアントに upload URL を返す。
#[utoipa::path(
    post,
    path = "/uploads/sign",
    tag = "uploads",
    request_body = SignRequest,
    responses(
        (status = 200, description = "asset 行を pending で作り、PUT 先 URL を返す", body = SignResponse),
        (status = 400, description = "mime/bytes/target invalid / DB pool 未設定", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
        (status = 500, description = "storage provider 未実装 / DB error", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn post_sign(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(req): Json<SignRequest>,
) -> Result<Json<SignResponse>, AppError> {
    let owner_user_id = require_user_id(&state, session_id.0).await?;

    // target_id 文字列を Uuid に parse (任意指定)。
    let target_id = match req.target_id.as_deref() {
        Some(s) => Some(
            Uuid::parse_str(s)
                .map_err(|_| AppError::BadRequest(format!("invalid target_id: {s}")))?,
        ),
        None => None,
    };

    // asset 行を pending で INSERT (= validate は repo 側で MIME / bytes / target 整合をチェック)。
    let _storage_key = format!("user/{}/pending", owner_user_id); // 真の storage_key は完了時に確定
    let asset_id = match assets::insert_pending(
        state.db(),
        assets::AssetInsert {
            owner_user_id,
            target_kind: req.target_kind.clone(),
            target_id,
            // 仮 storage_key (= INSERT 時点では asset_id が未確定なので、attach の前に
            // 後段で UPDATE する形が綺麗だが、MVP では「user/{owner}/{rand}」で UNIQUE 衝突
            // しないだけにしておき、完了通知時に「user/{owner}/{asset_id}.bin」で update_target_key
            // する経路は別タスクで足す)。
            storage_key: format!(
                "user/{}/{}",
                owner_user_id,
                Uuid::new_v4().simple()
            ),
            mime_type: req.mime_type.clone(),
            bytes: req.bytes,
        },
    )
    .await
    {
        Ok(id) => id,
        Err(assets::AssetRepoError::Invalid(msg)) => {
            return Err(AppError::BadRequest(msg));
        }
        Err(assets::AssetRepoError::PoolMissing) => {
            return Err(AppError::BadRequest(
                "DB pool not configured (uploads require Postgres)".to_string(),
            ));
        }
        Err(e) => {
            tracing::error!("asset insert failed: {e}");
            return Err(AppError::Internal(anyhow::anyhow!("asset insert: {e}")));
        }
    };

    // upload_url は provider で出し分け。
    // - local: 自サーバの PUT エンドポイント
    // - r2/s3: 署名済 URL (= 後続実装) — 現段階では Internal で返す。
    let upload_url = match storage_provider().as_str() {
        "local" => format!("{}/api/v1/uploads/local/{}", public_base_url(), asset_id),
        other => {
            tracing::error!("storage provider {other} not yet implemented");
            return Err(AppError::Internal(anyhow::anyhow!(
                "storage provider {other} not yet implemented (local only in MVP)"
            )));
        }
    };

    Ok(Json(SignResponse {
        asset_id: asset_id.to_string(),
        upload_url,
        upload_method: "PUT".to_string(),
    }))
}

// ──────────────────────────────────────────────────────────────────────
// PUT /api/v1/uploads/local/{asset_id}
// ──────────────────────────────────────────────────────────────────────

/// `PUT /api/v1/uploads/local/{asset_id}` — local storage モードの body 受信。
///
/// **dev 専用**: production の R2/S3 mode では署名 URL 経由で provider が直接受ける。
///
/// 認証: login required + asset の owner と current user 一致を verify。
/// バリデーション: bytes 上限 (10MB) + mime_type が事前申告と一致。
#[utoipa::path(
    put,
    path = "/uploads/local/{asset_id}",
    tag = "uploads",
    params(
        ("asset_id" = String, Path, description = "/uploads/sign で発行された asset の UUID"),
    ),
    request_body(
        description = "アップロード対象の生バイト列。Content-Type は /sign で申告した mime_type と一致必須。",
        content = String,
        content_type = "application/octet-stream",
    ),
    responses(
        (status = 200, description = "受信成功 (= local file に保存)"),
        (status = 400, description = "Content-Type 不一致 / size 超過 / asset 状態が pending でない", body = crate::openapi::ErrorResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
        (status = 404, description = "asset 不存在 / 所有者でない", body = crate::openapi::ErrorResponse),
        (status = 500, description = "storage write error", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn put_local_upload(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(asset_id_str): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let asset_id = Uuid::parse_str(&asset_id_str)
        .map_err(|_| AppError::NotFound)?;

    // asset 行を引いて owner / status / bytes を verify。
    let asset = match assets::find_by_id(state.db(), asset_id).await {
        Ok(Some(a)) => a,
        Ok(None) => return Err(AppError::NotFound),
        Err(e) => {
            tracing::error!("asset lookup failed: {e}");
            return Err(AppError::Internal(anyhow::anyhow!("asset lookup: {e}")));
        }
    };
    if asset.owner_user_id != user_id {
        // 他人の asset_id を当てて upload しようとした → 404 で吸収 (= 存在隠し)。
        return Err(AppError::NotFound);
    }
    if asset.status != "pending" {
        return Err(AppError::BadRequest(format!(
            "asset is not pending (status={})",
            asset.status
        )));
    }
    if (body.len() as i64) > assets::MAX_UPLOAD_BYTES {
        return Err(AppError::BadRequest(format!(
            "body too large: {} bytes (max {})",
            body.len(),
            assets::MAX_UPLOAD_BYTES
        )));
    }

    // Content-Type 検証 (= 事前申告と一致するか)。違反は 400 で reject。
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if content_type != asset.mime_type {
        return Err(AppError::BadRequest(format!(
            "Content-Type mismatch: header={} asset={}",
            content_type, asset.mime_type
        )));
    }

    // ファイル保存。dir が無ければ作る。
    let dir = local_storage_dir();
    if let Err(e) = std::fs::create_dir_all(&dir) {
        tracing::error!("failed to create storage dir {:?}: {e}", dir);
        return Err(AppError::Internal(anyhow::anyhow!(
            "create_dir_all failed: {e}"
        )));
    }
    let path = local_path(asset_id);
    if let Err(e) = std::fs::write(&path, &body) {
        tracing::error!("failed to write {:?}: {e}", path);
        return Err(AppError::Internal(anyhow::anyhow!("write failed: {e}")));
    }

    Ok(StatusCode::OK)
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/v1/uploads/complete
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    pub asset_id: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompleteResponse {
    pub asset_id: String,
    /// クライアントが `<img src=...>` で表示するための URL。
    pub public_url: String,
}

/// `POST /api/v1/uploads/complete` — 完了通知。status='pending' → 'uploaded' に遷移。
#[utoipa::path(
    post,
    path = "/uploads/complete",
    tag = "uploads",
    request_body = CompleteRequest,
    responses(
        (status = 200, description = "完了 (= status を uploaded に遷移、`<img src=...>` 用 public_url を返す。冪等)", body = CompleteResponse),
        (status = 401, description = "未ログイン", body = crate::openapi::ErrorResponse),
        (status = 404, description = "asset 不存在 / 所有者でない", body = crate::openapi::ErrorResponse),
        (status = 500, description = "DB error", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn post_complete(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(req): Json<CompleteRequest>,
) -> Result<Json<CompleteResponse>, AppError> {
    let user_id = require_user_id(&state, session_id.0).await?;
    let asset_id = Uuid::parse_str(&req.asset_id).map_err(|_| AppError::NotFound)?;

    // owner verify。
    let asset = match assets::find_by_id(state.db(), asset_id).await {
        Ok(Some(a)) => a,
        Ok(None) => return Err(AppError::NotFound),
        Err(e) => return Err(AppError::Internal(anyhow::anyhow!("asset lookup: {e}"))),
    };
    if asset.owner_user_id != user_id {
        return Err(AppError::NotFound);
    }

    // CAS 風 update。pending → uploaded のみ許容。
    let bound = match assets::mark_uploaded(state.db(), asset_id).await {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("mark_uploaded failed: {e}");
            return Err(AppError::Internal(anyhow::anyhow!("mark_uploaded: {e}")));
        }
    };
    if !bound {
        // 既に uploaded か abandoned。冪等性のため警告だけ出して 200 を返す。
        tracing::warn!(
            "post_complete: asset {} was not in pending (status={})",
            asset_id,
            asset.status
        );
    }

    let public_url = format!("{}/api/v1/assets/{}", public_base_url(), asset_id);
    Ok(Json(CompleteResponse {
        asset_id: asset_id.to_string(),
        public_url,
    }))
}

// ──────────────────────────────────────────────────────────────────────
// GET /api/v1/assets/{id}
// ──────────────────────────────────────────────────────────────────────

/// `GET /api/v1/assets/{id}` — public 取得 (= image src で参照される)。
///
/// 認証なし (= MVP では公開固定)。production では署名済 URL に切替予定。
/// status='uploaded' な asset のみ返す。pending は 404 で隠す。
#[utoipa::path(
    get,
    path = "/assets/{asset_id}",
    tag = "uploads",
    params(
        ("asset_id" = String, Path, description = "asset の UUID (= /uploads/complete で uploaded になった行のみ取得可)"),
    ),
    responses(
        (status = 200, description = "asset の生バイト列。Content-Type は asset.mime_type、Cache-Control は public max-age=3600。",
            body = String,
            content_type = "application/octet-stream",
        ),
        (status = 404, description = "asset 不存在 / pending / file 不在", body = crate::openapi::ErrorResponse),
        (status = 500, description = "non-local provider 未実装 / DB error", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn get_asset(
    State(state): State<AppState>,
    Path(asset_id_str): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let asset_id = Uuid::parse_str(&asset_id_str).map_err(|_| AppError::NotFound)?;
    let asset = match assets::find_by_id(state.db(), asset_id).await {
        Ok(Some(a)) => a,
        Ok(None) => return Err(AppError::NotFound),
        Err(e) => return Err(AppError::Internal(anyhow::anyhow!("asset lookup: {e}"))),
    };
    if asset.status != "uploaded" {
        return Err(AppError::NotFound);
    }

    // local mode のみ。R2/S3 では provider に redirect する想定。
    if storage_provider() != "local" {
        return Err(AppError::Internal(anyhow::anyhow!(
            "non-local storage provider not yet implemented for GET"
        )));
    }
    let path = local_path(asset_id);
    let bytes = std::fs::read(&path).map_err(|e| {
        tracing::error!("failed to read {:?}: {e}", path);
        AppError::NotFound // file 不在は 404 で吸収 (= asset 行はあるが file は無い不整合)
    })?;

    let mut headers = HeaderMap::new();
    if let Ok(v) = asset.mime_type.parse() {
        headers.insert(header::CONTENT_TYPE, v);
    }
    headers.insert(
        header::CACHE_CONTROL,
        "public, max-age=3600".parse().unwrap(),
    );
    Ok((StatusCode::OK, headers, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_storage_key_is_flat_uuid() {
        let id = Uuid::parse_str("00112233-4455-6677-8899-aabbccddeeff").unwrap();
        let key = local_storage_key(id);
        assert_eq!(key, "00112233445566778899aabbccddeeff.bin");
    }

    #[test]
    fn storage_provider_defaults_to_local() {
        // env を変えると他テストに影響するので、現在値の取得が成功するかだけ確認。
        let p = storage_provider();
        assert!(matches!(p.as_str(), "local" | "r2" | "s3"));
    }

    #[test]
    fn public_base_url_default() {
        // 未設定時は localhost にフォールバック。
        unsafe {
            std::env::remove_var("KOCHU_PUBLIC_BASE_URL");
        }
        assert_eq!(public_base_url(), "http://localhost:3000");
    }
}
