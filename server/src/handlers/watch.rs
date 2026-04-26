//! `/api/v1/watch` 系の SDUI Action エンドポイント (Phase 2.5 / Phase 9.E で session 分離)。
//!
//! - `POST /api/v1/watch/{productId}` → トグル。`{ watching: bool }` を返す
//!
//! **Phase 9.E (= 本 PR で session 分離)**:
//!   - 旧 `Mutex<HashSet<product_id>>` から `Mutex<HashMap<SessionId, HashSet<product_id>>>`
//!     に変更し、cookie middleware の `SessionId` で watch state を分離した。
//!   - これで複数 cookie / 複数ブラウザでの「自分の watch」が混ざらない。
//!
//! **DB 永続化は未実施 (= 将来 Phase 9.E+ )**:
//!   - `repos::product_watches` skeleton は (user_id, product_id) 複合 PK で
//!     login user 想定の設計。匿名 (= cookie のみ) も許す形に schema 拡張するか、
//!     watch を login 必須機能に倒すか、設計判断が要る。
//!   - 現状は in-memory のみ。サーバ再起動で消えるが MVP 範囲。
//!
//! **将来 (Phase 9.E+)**:
//!   - GET /watch で全リスト返す (UI 表示の hydrate 用)
//!   - login 時の session → user_id 引き継ぎ (cart の promote_session_to_user と同様)
//!   - product_watches テーブルへ DB 永続化

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use axum::{Extension, Json, extract::Path};
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::session::SessionId;

/// session_id ごとに `HashSet<product_id>` を持つ in-memory watch ストア。
///
/// **Phase 9.E** で `HashMap<Uuid, HashSet<...>>` に変更。SessionId を key にして、
/// cookie 別にユーザの watch list を分離する。`watch_store_for_session` は
/// 該当 session のエントリを取得 (= 無ければ作る) する helper。
fn watch_store() -> &'static Mutex<HashMap<Uuid, HashSet<String>>> {
    static STORE: OnceLock<Mutex<HashMap<Uuid, HashSet<String>>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleWatchResponse {
    /// トグル後の状態 (true = 今 watching に入った / false = 解除された)。
    pub watching: bool,
}

/// `POST /api/v1/watch/{productId}` — ウォッチ状態をトグルする (= session 別)。
pub async fn toggle_watch(
    Extension(session_id): Extension<SessionId>,
    Path(product_id): Path<String>,
) -> Result<Json<ToggleWatchResponse>, AppError> {
    if product_id.is_empty() {
        return Err(AppError::BadRequest("productId is empty".to_string()));
    }

    let mut store = watch_store().lock().expect("watch store mutex poisoned");
    let set = store.entry(session_id.0).or_default();
    let watching = if set.remove(&product_id) {
        false
    } else {
        set.insert(product_id);
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

    fn ext(session_id: Uuid) -> Extension<SessionId> {
        Extension(SessionId(session_id))
    }

    #[tokio::test]
    async fn toggle_alternates_state() {
        let _g = GUARD.lock().unwrap();
        reset_watch_for_test();
        let session = Uuid::new_v4();

        let r1 = toggle_watch(ext(session), Path("p-x".to_string()))
            .await
            .unwrap();
        assert!(r1.0.watching, "first call: should be true (added)");

        let r2 = toggle_watch(ext(session), Path("p-x".to_string()))
            .await
            .unwrap();
        assert!(!r2.0.watching, "second call: should be false (removed)");

        let r3 = toggle_watch(ext(session), Path("p-x".to_string()))
            .await
            .unwrap();
        assert!(r3.0.watching, "third call: should be true (added again)");
    }

    #[tokio::test]
    async fn different_products_have_independent_state() {
        let _g = GUARD.lock().unwrap();
        reset_watch_for_test();
        let session = Uuid::new_v4();

        let a1 = toggle_watch(ext(session), Path("a".to_string())).await.unwrap();
        let b1 = toggle_watch(ext(session), Path("b".to_string())).await.unwrap();
        assert!(a1.0.watching);
        assert!(b1.0.watching);

        // a だけトグル off → b は true のまま
        let a2 = toggle_watch(ext(session), Path("a".to_string())).await.unwrap();
        assert!(!a2.0.watching);
        let b2 = toggle_watch(ext(session), Path("b".to_string())).await.unwrap();
        assert!(!b2.0.watching, "b is independently toggled");
    }

    #[tokio::test]
    async fn empty_product_id_is_400() {
        let _g = GUARD.lock().unwrap();
        reset_watch_for_test();
        match toggle_watch(ext(Uuid::new_v4()), Path("".to_string())).await {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn watch_is_isolated_per_session() {
        let _g = GUARD.lock().unwrap();
        reset_watch_for_test();
        let session_a = Uuid::new_v4();
        let session_b = Uuid::new_v4();

        // session A で p-x を watch
        let r = toggle_watch(ext(session_a), Path("p-x".to_string()))
            .await
            .unwrap();
        assert!(r.0.watching);

        // session B から見ると p-x は未 watch
        let r = toggle_watch(ext(session_b), Path("p-x".to_string()))
            .await
            .unwrap();
        assert!(
            r.0.watching,
            "session B にとっては新規 watch (= true で追加された)"
        );

        // session A の状態は不変 — もう一度 toggle すると Removed (= false)
        let r = toggle_watch(ext(session_a), Path("p-x".to_string()))
            .await
            .unwrap();
        assert!(!r.0.watching, "session A は元から ON 状態だったので OFF に倒れる");
    }

    #[test]
    fn response_serializes_camel_case() {
        let res = ToggleWatchResponse { watching: true };
        let json = serde_json::to_string(&res).unwrap();
        assert_eq!(json, r#"{"watching":true}"#);
    }
}
