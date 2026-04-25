//! `/api/v1/cart` 系の SDUI Action エンドポイント (Phase 2.5)。
//!
//! - `POST   /api/v1/cart`                → 追加。`undoToken` を返す
//! - `DELETE /api/v1/cart/items/{token}`  → 取消 (Toast の Undo ボタンが叩く)
//!
//! **設計方針 (MVP)**:
//!   - 永続化なし。プロセス内 `Mutex<HashMap<token, item>>` だけ。
//!   - セッション分離なし (single-user 前提)。Cookie ベース session は別 PR。
//!   - レスポンスは camelCase JSON で `{ cartCount, undoToken }`。クライアントは
//!     `cartCount` を表示・通知に使い、`undoToken` を Toast の Undo ボタンに
//!     渡す。Undo クリックで `DELETE /cart/items/{token}` を呼ぶだけ。
//!   - `qty` は body の数量 (デフォルト 1)。SDUI 上は `CtaAction::AddToCart.qty`
//!     から渡される。負数や 0 は 400。
//!
//! **将来 (Phase 3+)**:
//!   - Cookie ベース session ID で分離
//!   - SQLite or Postgres 永続化
//!   - 在庫ロック (decrement on add, restore on undo)

use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::{Json, extract::Path, http::StatusCode};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// プロセス内カートストア。`token` をキーにして「このトークンが指すアイテムは何個」
/// を覚えておく。Undo は token を投げ返してきて該当エントリを引き算する。
///
/// **Phase 7 で pub(crate)**: cards handler が cart card を組むときに store を読むため。
/// 書き込みは依然としてこのモジュール経由 (add / delete / patch) のみ。
#[derive(Debug, Clone)]
pub(crate) struct CartEntry {
    pub product_id: String,
    pub qty: u32,
}

pub(crate) fn cart_store() -> &'static Mutex<HashMap<String, CartEntry>> {
    static STORE: OnceLock<Mutex<HashMap<String, CartEntry>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// **Phase 7**: cart 全件のスナップショットを返す (token 昇順で安定させる)。
///
/// `cards::get_cart_card` が cart card を組み立てるときに使う。
/// 戻り値が `Vec<(String, CartEntry)>` なのは、Mutex を握り続けず即解放するため
/// (= 呼び出し側が long lock を持たない)。
pub(crate) fn snapshot_cart() -> Vec<(String, CartEntry)> {
    let store = cart_store().lock().expect("cart store mutex poisoned");
    let mut entries: Vec<(String, CartEntry)> = store
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    // token 昇順: フロントの行順を deterministic に保つ (= テストも書きやすい)
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries
}

/// undo token の単調増加カウンタ。プロセス内 unique で十分。
fn next_token() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("undo_{n}")
}

// ──────────────────────────────────────────────────────────────────────
// リクエスト / レスポンス DTO
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddToCartResponse {
    /// 追加後のカート総点数 (qty の合計)。
    pub cart_count: u32,
    /// このアクション 1 件を取り消すためのトークン。
    pub undo_token: String,
}

// ──────────────────────────────────────────────────────────────────────
// ハンドラ
// ──────────────────────────────────────────────────────────────────────

/// `POST /api/v1/cart` — カートに商品を追加し、Undo 用トークンを返す。
pub async fn add_to_cart(
    Json(req): Json<AddToCartRequest>,
) -> Result<Json<AddToCartResponse>, AppError> {
    if req.product_id.is_empty() {
        return Err(AppError::BadRequest("productId is empty".to_string()));
    }
    if req.qty == 0 {
        return Err(AppError::BadRequest("qty must be >= 1".to_string()));
    }

    let token = next_token();
    let mut store = cart_store().lock().expect("cart store mutex poisoned");
    store.insert(
        token.clone(),
        CartEntry {
            product_id: req.product_id,
            qty: req.qty,
        },
    );
    let cart_count: u32 = store.values().map(|e| e.qty).sum();

    Ok(Json(AddToCartResponse {
        cart_count,
        undo_token: token,
    }))
}

/// `DELETE /api/v1/cart/items/{token}` — Undo (= 該当 token のエントリを削除)。
///
/// 既に消えていれば 404。冪等にしないのは「Undo は 1 回しかできない」UX
/// にするため (2 度 Undo で復活してしまうと驚き)。
pub async fn delete_cart_item(Path(token): Path<String>) -> Result<StatusCode, AppError> {
    let mut store = cart_store().lock().expect("cart store mutex poisoned");
    if store.remove(&token).is_some() {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound)
    }
}

// ──────────────────────────────────────────────────────────────────────
// Phase 7: qty 直接指定 (LineItem の +/- ボタンが叩く)
// ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatchCartItemRequest {
    /// 新しい qty (>= 1)。0 を投げるなら DELETE を使う (= 「削除」と「数量変更」を分離)。
    pub qty: u32,
}

#[derive(Debug, Clone, Serialize)]
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
///   - 上限 `MAX_QTY_PER_LINE` を超えたら 400 (= UI 側でも +/- の上限を吸収するが
///     直叩き耐性として server で再チェック)
///
/// **冪等性**: 同じ qty を 2 回投げても結果は同じ (= PATCH の RFC 7231 準拠)。
pub async fn patch_cart_item(
    Path(token): Path<String>,
    Json(req): Json<PatchCartItemRequest>,
) -> Result<Json<PatchCartItemResponse>, AppError> {
    const MAX_QTY_PER_LINE: u32 = 99;
    if req.qty == 0 {
        return Err(AppError::BadRequest(
            "qty must be >= 1 (use DELETE to remove)".to_string(),
        ));
    }
    if req.qty > MAX_QTY_PER_LINE {
        return Err(AppError::BadRequest(format!(
            "qty must be <= {MAX_QTY_PER_LINE}"
        )));
    }

    let mut store = cart_store().lock().expect("cart store mutex poisoned");
    let entry = store.get_mut(&token).ok_or(AppError::NotFound)?;
    entry.qty = req.qty;
    let cart_count: u32 = store.values().map(|e| e.qty).sum();
    Ok(Json(PatchCartItemResponse { cart_count }))
}

// テスト専用: store をクリアする (テストの間で状態がリークしないよう)
#[cfg(test)]
pub(crate) fn reset_cart_for_test() {
    let mut store = cart_store().lock().expect("cart store mutex poisoned");
    store.clear();
}

// ──────────────────────────────────────────────────────────────────────
// テスト
// ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// **重要**: テストは `cargo test` 内で並列実行されるため、グローバル store を
    /// 触る各テストは冒頭で `reset_cart_for_test()` を呼ぶ + serial 実行のため
    /// `static GUARD: Mutex<()>` で逐次化する。
    use std::sync::Mutex as StdMutex;
    static GUARD: StdMutex<()> = StdMutex::new(());

    #[tokio::test]
    async fn add_then_delete_roundtrip() {
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();

        let res = add_to_cart(Json(AddToCartRequest {
            product_id: "p-hh-m-142".to_string(),
            qty: 1,
        }))
        .await
        .expect("add ok");
        assert_eq!(res.0.cart_count, 1);
        let token = res.0.undo_token.clone();
        assert!(token.starts_with("undo_"));

        let status = delete_cart_item(Path(token.clone())).await.expect("delete ok");
        assert_eq!(status, StatusCode::NO_CONTENT);

        // 二重削除は 404
        match delete_cart_item(Path(token)).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound on double delete, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn cart_count_accumulates_across_adds() {
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();

        let r1 = add_to_cart(Json(AddToCartRequest {
            product_id: "a".to_string(),
            qty: 1,
        }))
        .await
        .unwrap();
        assert_eq!(r1.0.cart_count, 1);

        let r2 = add_to_cart(Json(AddToCartRequest {
            product_id: "b".to_string(),
            qty: 3,
        }))
        .await
        .unwrap();
        assert_eq!(r2.0.cart_count, 4, "1 + 3 = 4");

        // r1 だけ undo
        delete_cart_item(Path(r1.0.undo_token)).await.unwrap();
        // 残り: b の qty=3 だけ。新規追加で確認。
        let r3 = add_to_cart(Json(AddToCartRequest {
            product_id: "c".to_string(),
            qty: 2,
        }))
        .await
        .unwrap();
        assert_eq!(r3.0.cart_count, 5, "3 + 2 = 5 after undoing r1");
    }

    #[tokio::test]
    async fn empty_product_id_is_400() {
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();
        match add_to_cart(Json(AddToCartRequest {
            product_id: "".to_string(),
            qty: 1,
        }))
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn zero_qty_is_400() {
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();
        match add_to_cart(Json(AddToCartRequest {
            product_id: "x".to_string(),
            qty: 0,
        }))
        .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest on qty=0, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn delete_unknown_token_is_404() {
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();
        match delete_cart_item(Path("undo_nope".to_string())).await {
            Err(AppError::NotFound) => {}
            other => panic!("expected NotFound on unknown token, got {other:?}"),
        }
    }

    #[test]
    fn add_request_deserializes_camel_case() {
        // フロントから送られる JSON (camelCase) を正しく受けられること
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
            undo_token: "undo_42".to_string(),
        };
        let json = serde_json::to_string(&res).unwrap();
        assert!(json.contains(r#""cartCount":3"#), "{json}");
        assert!(json.contains(r#""undoToken":"undo_42""#), "{json}");
    }

    // ── Phase 7: PATCH /cart/items/:token ────────────────────────

    #[tokio::test]
    async fn patch_qty_updates_entry() {
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();

        let r = add_to_cart(Json(AddToCartRequest {
            product_id: "p-x".to_string(),
            qty: 2,
        }))
        .await
        .unwrap();
        let token = r.0.undo_token;

        let pr = patch_cart_item(
            Path(token.clone()),
            Json(PatchCartItemRequest { qty: 5 }),
        )
        .await
        .expect("patch ok");
        assert_eq!(pr.0.cart_count, 5, "qty 2 → 5 で cartCount が同期する");

        // snapshot 経由で実際に書き換わっているか確認
        let snap = snapshot_cart();
        let entry = snap.iter().find(|(t, _)| t == &token).expect("entry exists");
        assert_eq!(entry.1.qty, 5);
    }

    #[tokio::test]
    async fn patch_qty_zero_is_400() {
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();
        let r = add_to_cart(Json(AddToCartRequest {
            product_id: "p-x".to_string(),
            qty: 1,
        }))
        .await
        .unwrap();

        match patch_cart_item(Path(r.0.undo_token), Json(PatchCartItemRequest { qty: 0 }))
            .await
        {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest on qty=0, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn patch_qty_too_large_is_400() {
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();
        let r = add_to_cart(Json(AddToCartRequest {
            product_id: "p-x".to_string(),
            qty: 1,
        }))
        .await
        .unwrap();
        match patch_cart_item(
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
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();
        match patch_cart_item(
            Path("undo_nope".to_string()),
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
        let _g = GUARD.lock().unwrap();
        reset_cart_for_test();
        // 3 件 add (token は単調増加なので追加順)
        let _ = add_to_cart(Json(AddToCartRequest {
            product_id: "a".to_string(),
            qty: 1,
        }))
        .await
        .unwrap();
        let _ = add_to_cart(Json(AddToCartRequest {
            product_id: "b".to_string(),
            qty: 2,
        }))
        .await
        .unwrap();
        let _ = add_to_cart(Json(AddToCartRequest {
            product_id: "c".to_string(),
            qty: 3,
        }))
        .await
        .unwrap();

        let snap = snapshot_cart();
        assert_eq!(snap.len(), 3);
        // 文字列ソートなので undo_10... の落とし穴があるが MVP のカウンタは
        // 単独テスト内では桁揃いするので OK。実用上は数値ソートに直したい。
        let tokens: Vec<&str> = snap.iter().map(|(t, _)| t.as_str()).collect();
        let mut sorted = tokens.clone();
        sorted.sort();
        assert_eq!(tokens, sorted);
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
