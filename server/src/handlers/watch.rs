//! `/api/v1/watch` 系の SDUI Action エンドポイント (Phase 2.5)。
//!
//! - `POST /api/v1/watch/{productId}` → トグル。`{ watching: bool }` を返す
//!
//! **設計方針 (MVP)**:
//!   - 永続化なし。プロセス内 `Mutex<HashSet<product_id>>` のみ。
//!   - セッション分離なし (single-user 前提)。
//!   - レスポンスは `{ watching: true/false }`。クライアントは Toast の文言を
//!     watching 状態で出し分け (`ウォッチに追加` / `ウォッチを解除`)。
//!   - スコープ: 真値はサーバ側で持つ (= クライアントは onClick 後の値を信用)。
//!     ただし、初期状態 hydrate (`GET /watch`) は MVP+ で別追加することにし、
//!     現状はトグルだけ。
//!
//! **将来 (Phase 3+)**:
//!   - GET /watch で全リスト返す (UI 表示の hydrate 用)
//!   - Cookie session ID で分離
//!   - DB 永続化

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use axum::{Json, extract::Path};
use serde::Serialize;

use crate::error::AppError;

fn watch_store() -> &'static Mutex<HashSet<String>> {
    static STORE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashSet::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleWatchResponse {
    /// トグル後の状態 (true = 今 watching に入った / false = 解除された)。
    pub watching: bool,
}

/// `POST /api/v1/watch/{productId}` — ウォッチ状態をトグルする。
pub async fn toggle_watch(
    Path(product_id): Path<String>,
) -> Result<Json<ToggleWatchResponse>, AppError> {
    if product_id.is_empty() {
        return Err(AppError::BadRequest("productId is empty".to_string()));
    }

    let mut store = watch_store().lock().expect("watch store mutex poisoned");
    // 既にあれば削除 → false、無ければ挿入 → true。
    let watching = if store.remove(&product_id) {
        false
    } else {
        store.insert(product_id);
        true
    };
    Ok(Json(ToggleWatchResponse { watching }))
}

#[cfg(test)]
pub(crate) fn reset_watch_for_test() {
    let mut store = watch_store().lock().expect("watch store mutex poisoned");
    store.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    static GUARD: StdMutex<()> = StdMutex::new(());

    #[tokio::test]
    async fn toggle_alternates_state() {
        let _g = GUARD.lock().unwrap();
        reset_watch_for_test();

        let r1 = toggle_watch(Path("p-x".to_string())).await.unwrap();
        assert!(r1.0.watching, "first call: should be true (added)");

        let r2 = toggle_watch(Path("p-x".to_string())).await.unwrap();
        assert!(!r2.0.watching, "second call: should be false (removed)");

        let r3 = toggle_watch(Path("p-x".to_string())).await.unwrap();
        assert!(r3.0.watching, "third call: should be true (added again)");
    }

    #[tokio::test]
    async fn different_products_have_independent_state() {
        let _g = GUARD.lock().unwrap();
        reset_watch_for_test();

        let a1 = toggle_watch(Path("a".to_string())).await.unwrap();
        let b1 = toggle_watch(Path("b".to_string())).await.unwrap();
        assert!(a1.0.watching);
        assert!(b1.0.watching);

        // a だけトグル off → b は true のまま
        let a2 = toggle_watch(Path("a".to_string())).await.unwrap();
        assert!(!a2.0.watching);
        let b2 = toggle_watch(Path("b".to_string())).await.unwrap();
        assert!(!b2.0.watching, "b is independently toggled");
    }

    #[tokio::test]
    async fn empty_product_id_is_400() {
        let _g = GUARD.lock().unwrap();
        reset_watch_for_test();
        match toggle_watch(Path("".to_string())).await {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn response_serializes_camel_case() {
        let res = ToggleWatchResponse { watching: true };
        let json = serde_json::to_string(&res).unwrap();
        assert_eq!(json, r#"{"watching":true}"#);
    }
}
