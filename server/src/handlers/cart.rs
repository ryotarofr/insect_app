//! `/api/v1/cart` 系の SDUI Action エンドポイント (Phase 2.5 / Phase 9.E で DB 化)。
//!
//! - `POST   /api/v1/cart`                → 追加。`undoToken` を返す
//! - `DELETE /api/v1/cart/items/{token}`  → 取消 (Toast の Undo ボタンが叩く)
//! - `PATCH  /api/v1/cart/items/{token}`  → qty 直接書き換え (LineItem の +/- ボタン)
//!
//! **Phase 9.E (= 本 PR で完了)**:
//!   - 旧 in-memory `cart_store` グローバル (= `Mutex<HashMap<token, entry>>`) を撤去。
//!   - `repos::cart_items` 経由で DB / in-memory fallback どちらでも動く構成へ移行。
//!   - cart は `SessionId` (= cookie middleware が発行する UUID) で分離される。
//!   - `productId` (= public_id) は INSERT 時に `repos::products::find_uuid_for_public_id`
//!     で UUID 解決し、`cart_items.product_id` (UUID) に格納する。
//!   - `undoToken` は `cart_items.id` UUID の文字列表現 (= 旧 "undo_<n>" から変更)。
//!     破壊的変更だが client 側はトークンを opaque に扱う設計なので問題なし。
//!
//! **将来 (Phase 9.E+)**:
//!   - 在庫ロック (decrement on add / restore on undo)
//!   - login 時の session → user_id 引き継ぎ (= `repos::cart_items::promote_session_to_user`)

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::{cart_items, products};
use crate::session::SessionId;
use crate::state::AppState;

/// snapshot_cart の戻り値型。`product_id` は public_id (= "p-hh-m-142") として保持し、
/// 既存 cards.rs / checkout.rs の build ロジックを最小変更で動かす。
///
/// **Phase 9.E**: 旧 `Mutex<HashMap>` 由来の構造体だったが、本 PR で repos::cart_items から
/// 復元する pure data structure に変わった (= snapshot 専用)。
#[derive(Debug, Clone)]
pub(crate) struct CartEntry {
    pub product_id: String,
    pub qty: u32,
}

// ──────────────────────────────────────────────────────────────────────
// snapshot helpers
// ──────────────────────────────────────────────────────────────────────

/// `(SessionId, AppState)` 組から cart の現在内容を返す。
///
/// 戻り値は `Vec<(token_hex, CartEntry)>` で id 昇順 (= deterministic / 表示順安定)。
/// product_uuid → public_id の逆引きは `repos::products::find_by_id` で 1 件ずつ解決
/// (= MVP は cart 内の行数が小さいので N+1 でも実用上問題なし。性能要件が出たら
/// JOIN クエリ or `find_many_by_ids` バッチ取得に切替)。
///
/// **可視性**: `CartEntry` は `pub(crate)` なので関数も `pub(crate)` に揃える
/// (= crate 内部 (cards.rs / checkout.rs) からのみ使う API)。
pub(crate) async fn snapshot_cart_for_session(
    state: &AppState,
    session_id: Uuid,
) -> Result<Vec<(String, CartEntry)>, AppError> {
    let rows = cart_items::find_by_session_id(state.db(), session_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("cart fetch: {e}")))?;

    let mut result: Vec<(String, CartEntry)> = Vec::with_capacity(rows.len());
    for row in rows {
        let public_id = match products::find_by_id(state.db(), row.product_id).await {
            Ok(Some(p)) => p.row.public_id,
            // 商品マスタから消えた行 (= ON DELETE CASCADE で消えるはずだが防御的に) は
            // public_id 不明として skip する。snapshot に出ないので UI も表示しない。
            _ => continue,
        };
        let qty = u32::try_from(row.qty).unwrap_or(0);
        result.push((row.id.to_string(), CartEntry { product_id: public_id, qty }));
    }
    // id (UUID) 順は str ソートで一貫する。tests / UI が deterministic に。
    result.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(result)
}

/// session 内の qty 合計 (= cart_count)。`AddToCartResponse.cart_count` 等で使う。
async fn cart_total_qty_for_session(
    state: &AppState,
    session_id: Uuid,
) -> Result<u32, AppError> {
    let rows = cart_items::find_by_session_id(state.db(), session_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("cart fetch: {e}")))?;
    Ok(rows.iter().map(|r| u32::try_from(r.qty).unwrap_or(0)).sum())
}

// ──────────────────────────────────────────────────────────────────────
// リクエスト / レスポンス DTO
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddToCartRequest {
    pub product_id: String,
    /// 省略時は 1。
    #[serde(default = "default_qty")]
    pub qty: u32,
}

fn default_qty() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddToCartResponse {
    /// 追加後のカート総点数 (qty の合計)。
    pub cart_count: u32,
    /// このアクション 1 件を取り消すためのトークン (= cart_items.id の UUID 文字列)。
    pub undo_token: String,
}

// ──────────────────────────────────────────────────────────────────────
// ハンドラ
// ──────────────────────────────────────────────────────────────────────

/// `POST /api/v1/cart` — カートに商品を追加し、Undo 用トークンを返す。
#[utoipa::path(
    post,
    path = "/cart",
    tag = "cart",
    request_body = AddToCartRequest,
    responses(
        (status = 200, description = "追加成功 (= cartCount + undoToken)", body = AddToCartResponse),
        (status = 400, description = "productId 空 / qty 不正 / 未知 productId", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn add_to_cart(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Json(req): Json<AddToCartRequest>,
) -> Result<Json<AddToCartResponse>, AppError> {
    if req.product_id.is_empty() {
        return Err(AppError::BadRequest("productId is empty".to_string()));
    }
    if req.qty == 0 {
        return Err(AppError::BadRequest("qty must be >= 1".to_string()));
    }

    // public_id → UUID 解決 (= pool 有り時 DB lookup / 無し時は memory_product_uuid map)
    let product_uuid = products::find_uuid_for_public_id(state.db(), &req.product_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("product lookup: {e}")))?
        .ok_or_else(|| {
            AppError::BadRequest(format!("unknown productId: {}", req.product_id))
        })?;

    // INSERT cart_items
    let qty_i32 = i32::try_from(req.qty).map_err(|_| {
        AppError::BadRequest(format!("qty too large: {}", req.qty))
    })?;
    let id = cart_items::insert(
        state.db(),
        cart_items::CartItemInsert {
            session_id: Some(session_id.0),
            user_id: None,
            product_id: product_uuid,
            qty: qty_i32,
        },
    )
    .await
    .map_err(|e| match e {
        cart_items::CartItemRepoError::Invalid(msg) => AppError::BadRequest(msg),
        other => AppError::BadRequest(format!("cart insert: {other}")),
    })?;

    let cart_count = cart_total_qty_for_session(&state, session_id.0).await?;

    Ok(Json(AddToCartResponse {
        cart_count,
        undo_token: id.to_string(),
    }))
}

/// `DELETE /api/v1/cart/items/{token}` — Undo (= 該当 token の cart_items 行を物理削除)。
///
/// 既に消えていれば 404。冪等にしないのは「Undo は 1 回しかできない」UX
/// にするため (2 度 Undo で復活してしまうと驚き)。
#[utoipa::path(
    delete,
    path = "/cart/items/{token}",
    tag = "cart",
    params(
        ("token" = String, Path, description = "add_to_cart 時に発行された undoToken (= cart_items.id の UUID 文字列)"),
    ),
    responses(
        (status = 204, description = "削除成功 (= 該当 cart_items 行を物理削除)"),
        (status = 400, description = "削除中 invalid", body = crate::openapi::ErrorResponse),
        (status = 404, description = "token 不正 / 該当 entry なし (= 二重 Undo は 404)", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn delete_cart_item(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<StatusCode, AppError> {
    let id = parse_token(&token)?;
    match cart_items::delete(state.db(), id).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(cart_items::CartItemRepoError::NotFound(_)) => Err(AppError::NotFound),
        Err(other) => Err(AppError::BadRequest(format!("cart delete: {other}"))),
    }
}

// ──────────────────────────────────────────────────────────────────────
// Phase 7: qty 直接指定 (LineItem の +/- ボタンが叩く)
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatchCartItemRequest {
    /// 新しい qty (>= 1)。0 を投げるなら DELETE を使う (= 「削除」と「数量変更」を分離)。
    pub qty: u32,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchCartItemResponse {
    /// 更新後のカート総点数 (= 全エントリ qty の sum)。
    pub cart_count: u32,
}

/// `PATCH /api/v1/cart/items/{token}` — このトークンの qty を直接書き換える。
///
/// **設計**:
///   - 該当 token が無ければ 404 (= add 経由でしか line は生まれない)
///   - `qty == 0` は 400 (= 削除は DELETE。意味の混線を避ける)
///   - 上限 99 を超えたら 400 (= cart_items DB CHECK と同値)
///
/// **冪等性**: 同じ qty を 2 回投げても結果は同じ (= PATCH の RFC 7231 準拠)。
#[utoipa::path(
    patch,
    path = "/cart/items/{token}",
    tag = "cart",
    params(
        ("token" = String, Path, description = "add_to_cart 時に発行された undoToken (= cart_items.id の UUID 文字列)"),
    ),
    request_body = PatchCartItemRequest,
    responses(
        (status = 200, description = "qty 更新成功 (= 更新後 cartCount を返す)", body = PatchCartItemResponse),
        (status = 400, description = "qty=0 / qty 上限超え / token 不正", body = crate::openapi::ErrorResponse),
        (status = 404, description = "該当 entry なし", body = crate::openapi::ErrorResponse),
    ),
)]
pub async fn patch_cart_item(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(token): Path<String>,
    Json(req): Json<PatchCartItemRequest>,
) -> Result<Json<PatchCartItemResponse>, AppError> {
    if req.qty == 0 {
        return Err(AppError::BadRequest(
            "qty must be >= 1 (use DELETE to remove)".to_string(),
        ));
    }
    let qty_i32 = i32::try_from(req.qty).unwrap_or(i32::MAX);
    let id = parse_token(&token)?;

    match cart_items::set_qty(state.db(), id, qty_i32).await {
        Ok(()) => {}
        Err(cart_items::CartItemRepoError::NotFound(_)) => return Err(AppError::NotFound),
        Err(cart_items::CartItemRepoError::Invalid(msg)) => {
            return Err(AppError::BadRequest(msg))
        }
        Err(other) => return Err(AppError::BadRequest(format!("cart update: {other}"))),
    }

    let cart_count = cart_total_qty_for_session(&state, session_id.0).await?;
    Ok(Json(PatchCartItemResponse { cart_count }))
}

// ──────────────────────────────────────────────────────────────────────
// internal helpers
// ──────────────────────────────────────────────────────────────────────

fn parse_token(token: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(token).map_err(|_| AppError::NotFound)
}

#[cfg(test)]
pub(crate) fn reset_cart_for_test() {
    cart_items::reset_memory_for_test();
}

// ──────────────────────────────────────────────────────────────────────
// テスト
// ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// **重要**: グローバル in-memory store を触る各テストは GUARD で逐次化する。
    /// reset_cart_for_test() を冒頭で呼ばないと前テストの cart が混ざる。
    /// `repos::cart_items::memory_guard()` を共有して、`handlers::auth::tests` 等の
    /// クロスモジュールテストとも同 mutex で逐次化する (= 2 重 GUARD で race するのを回避)。
    fn lock_guard() -> std::sync::MutexGuard<'static, ()> {
        crate::repos::cart_items::memory_guard()
    }

    fn ext(session_id: Uuid) -> Extension<SessionId> {
        Extension(SessionId(session_id))
    }

    fn st() -> State<AppState> {
        State(AppState::default())
    }

    #[tokio::test]
    async fn add_then_delete_roundtrip() {
        let _g = lock_guard();
        reset_cart_for_test();
        let session = Uuid::new_v4();

        let res = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-hh-m-142".to_string(),
                qty: 1,
            }),
        )
        .await
        .expect("add ok");
        assert_eq!(res.0.cart_count, 1);
        let token = res.0.undo_token.clone();
        assert!(
            Uuid::parse_str(&token).is_ok(),
            "token は UUID hex 形式 (Phase 9.E 移行)、got: {token}"
        );

        let status = delete_cart_item(st(), Path(token.clone()))
            .await
            .expect("delete ok");
        assert_eq!(status, StatusCode::NO_CONTENT);

        // 二重削除は 404
        match delete_cart_item(st(), Path(token)).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound on double delete, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn cart_count_accumulates_across_adds() {
        let _g = lock_guard();
        reset_cart_for_test();
        let session = Uuid::new_v4();

        let r1 = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-hh-m-142".to_string(),
                qty: 1,
            }),
        )
        .await
        .unwrap();
        assert_eq!(r1.0.cart_count, 1);

        let r2 = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-cat-l".to_string(),
                qty: 3,
            }),
        )
        .await
        .unwrap();
        assert_eq!(r2.0.cart_count, 4, "1 + 3 = 4");

        // r1 だけ undo
        delete_cart_item(st(), Path(r1.0.undo_token)).await.unwrap();
        // 残り: cat-l の qty=3 だけ。新規追加で確認。
        let r3 = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-jelly".to_string(),
                qty: 2,
            }),
        )
        .await
        .unwrap();
        assert_eq!(r3.0.cart_count, 5, "3 + 2 = 5 after undoing r1");
    }

    #[tokio::test]
    async fn empty_product_id_is_400() {
        let _g = lock_guard();
        reset_cart_for_test();
        match add_to_cart(
            st(),
            ext(Uuid::new_v4()),
            Json(AddToCartRequest {
                product_id: "".to_string(),
                qty: 1,
            }),
        )
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn zero_qty_is_400() {
        let _g = lock_guard();
        reset_cart_for_test();
        match add_to_cart(
            st(),
            ext(Uuid::new_v4()),
            Json(AddToCartRequest {
                product_id: "p-hh-m-142".to_string(),
                qty: 0,
            }),
        )
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest on qty=0, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn unknown_product_id_is_400() {
        let _g = lock_guard();
        reset_cart_for_test();
        match add_to_cart(
            st(),
            ext(Uuid::new_v4()),
            Json(AddToCartRequest {
                product_id: "p-galaxy".to_string(), // memory_product_uuid に無い
                qty: 1,
            }),
        )
        .await
        {
            Err(AppError::BadRequest(msg)) => {
                assert!(msg.contains("p-galaxy"), "expected msg to contain id, got {msg}");
            }
            other => panic!("expected BadRequest on unknown product, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn delete_unknown_token_is_404() {
        let _g = lock_guard();
        reset_cart_for_test();
        // 不正な (UUID parse 失敗) トークン → 404
        match delete_cart_item(st(), Path("undo_nope".to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound on unknown token, got {other:?}"),
        }
        // 形は valid UUID だが存在しない → 404
        let random = Uuid::new_v4();
        match delete_cart_item(st(), Path(random.to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound on missing token, got {other:?}"),
        }
    }

    #[test]
    fn add_request_deserializes_camel_case() {
        let json = r#"{"productId":"p-x","qty":2}"#;
        let req: AddToCartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.product_id, "p-x");
        assert_eq!(req.qty, 2);
    }

    #[test]
    fn add_request_qty_default_is_1() {
        let json = r#"{"productId":"p-x"}"#;
        let req: AddToCartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.qty, 1);
    }

    #[test]
    fn add_response_serializes_camel_case() {
        let res = AddToCartResponse {
            cart_count: 3,
            undo_token: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        };
        let json = serde_json::to_string(&res).unwrap();
        assert!(json.contains(r#""cartCount":3"#), "{json}");
        assert!(
            json.contains(r#""undoToken":"550e8400-e29b-41d4-a716-446655440000""#),
            "{json}"
        );
    }

    // ── PATCH /cart/items/:token ─────────────────────────────────────

    #[tokio::test]
    async fn patch_qty_updates_entry() {
        let _g = lock_guard();
        reset_cart_for_test();
        let session = Uuid::new_v4();

        let r = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-hh-m-142".to_string(),
                qty: 2,
            }),
        )
        .await
        .unwrap();
        let token = r.0.undo_token;

        let pr = patch_cart_item(
            st(),
            ext(session),
            Path(token.clone()),
            Json(PatchCartItemRequest { qty: 5 }),
        )
        .await
        .expect("patch ok");
        assert_eq!(pr.0.cart_count, 5, "qty 2 → 5 で cartCount が同期する");

        let snap = snapshot_cart_for_session(&AppState::default(), session)
            .await
            .unwrap();
        let entry = snap
            .iter()
            .find(|(t, _)| t == &token)
            .expect("entry exists");
        assert_eq!(entry.1.qty, 5);
    }

    #[tokio::test]
    async fn patch_qty_zero_is_400() {
        let _g = lock_guard();
        reset_cart_for_test();
        let session = Uuid::new_v4();
        let r = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-hh-m-142".to_string(),
                qty: 1,
            }),
        )
        .await
        .unwrap();

        match patch_cart_item(
            st(),
            ext(session),
            Path(r.0.undo_token),
            Json(PatchCartItemRequest { qty: 0 }),
        )
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest on qty=0, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn patch_qty_too_large_is_400() {
        let _g = lock_guard();
        reset_cart_for_test();
        let session = Uuid::new_v4();
        let r = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-hh-m-142".to_string(),
                qty: 1,
            }),
        )
        .await
        .unwrap();
        match patch_cart_item(
            st(),
            ext(session),
            Path(r.0.undo_token),
            Json(PatchCartItemRequest { qty: 100 }),
        )
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest on qty=100, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn patch_unknown_token_is_404() {
        let _g = lock_guard();
        reset_cart_for_test();
        match patch_cart_item(
            st(),
            ext(Uuid::new_v4()),
            Path(Uuid::new_v4().to_string()),
            Json(PatchCartItemRequest { qty: 2 }),
        )
        .await
        {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn snapshot_returns_token_sorted() {
        let _g = lock_guard();
        reset_cart_for_test();
        let session = Uuid::new_v4();
        // 3 件 add (token は UUID なので順序は random だが str ソートで安定)
        let _ = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-hh-m-142".to_string(),
                qty: 1,
            }),
        )
        .await
        .unwrap();
        let _ = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-cat-l".to_string(),
                qty: 2,
            }),
        )
        .await
        .unwrap();
        let _ = add_to_cart(
            st(),
            ext(session),
            Json(AddToCartRequest {
                product_id: "p-jelly".to_string(),
                qty: 3,
            }),
        )
        .await
        .unwrap();

        let snap = snapshot_cart_for_session(&AppState::default(), session)
            .await
            .unwrap();
        assert_eq!(snap.len(), 3);
        let tokens: Vec<&str> = snap.iter().map(|(t, _)| t.as_str()).collect();
        let mut sorted = tokens.clone();
        sorted.sort();
        assert_eq!(tokens, sorted);
    }

    #[tokio::test]
    async fn cart_is_isolated_per_session() {
        let _g = lock_guard();
        reset_cart_for_test();
        let session_a = Uuid::new_v4();
        let session_b = Uuid::new_v4();

        let _ = add_to_cart(
            st(),
            ext(session_a),
            Json(AddToCartRequest {
                product_id: "p-hh-m-142".to_string(),
                qty: 2,
            }),
        )
        .await
        .unwrap();

        let snap_a = snapshot_cart_for_session(&AppState::default(), session_a)
            .await
            .unwrap();
        let snap_b = snapshot_cart_for_session(&AppState::default(), session_b)
            .await
            .unwrap();
        assert_eq!(snap_a.len(), 1, "session A は 1 件");
        assert!(snap_b.is_empty(), "session B には影響しない");
    }

    #[test]
    fn patch_request_deserializes_camel_case() {
        let json = r#"{"qty":3}"#;
        let req: PatchCartItemRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.qty, 3);
    }

    #[test]
    fn patch_response_serializes_camel_case() {
        let res = PatchCartItemResponse { cart_count: 7 };
        let json = serde_json::to_string(&res).unwrap();
        assert!(json.contains(r#""cartCount":7"#), "{json}");
    }
}
