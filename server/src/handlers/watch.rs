//! `/api/v1/watch` 系の SDUI Action エンドポイント (Phase 2.5 / Phase 9.E で DB 永続化)。
//!
//! - `POST /api/v1/watch/{productId}` → トグル。`{ watching: bool }` を返す
//!
//! **Phase 9.E (= 本 PR で完了)**:
//!   - 旧 `Mutex<HashMap<SessionId, HashSet<...>>>` in-memory store を撤去。
//!   - `repos::product_watches` 経由で DB / in-memory fallback どちらでも動く。
//!   - login user → `WatchOwner::User(user_id)` / 匿名 → `WatchOwner::Session(session_id)`
//!     で owner を分岐 (= 0012_product_watches_session_owner.sql で許容)。
//!   - login で session 経由の watch を user に承継したい場合は別 endpoint
//!     (= `repos::product_watches::promote_session_to_user`) を呼ぶ想定。
//!
//! **設計**:
//!   - product_id は public_id 文字列のまま受け、handler 内で `repos::products::find_uuid_for_public_id`
//!     で UUID 解決。未知 id は 400。
//!   - watch state は cookie session 別 (= `Extension<SessionId>`) で分離される。

use axum::{Extension, Json, extract::{Path, State}};
use serde::Serialize;

use crate::error::AppError;
use crate::repos::{product_watches, products, user_sessions};
use crate::session::SessionId;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleWatchResponse {
    /// トグル後の状態 (true = 今 watching に入った / false = 解除された)。
    pub watching: bool,
}

/// `POST /api/v1/watch/{productId}` — ウォッチ状態をトグルする (= cookie session 別 / login user 優先)。
pub async fn toggle_watch(
    State(state): State<AppState>,
    Extension(session_id): Extension<SessionId>,
    Path(product_id): Path<String>,
) -> Result<Json<ToggleWatchResponse>, AppError> {
    if product_id.is_empty() {
        return Err(AppError::BadRequest("productId is empty".to_string()));
    }

    // public_id (= "p-hh-m-142") を内部 UUID に解決。未知 id は 400。
    let product_uuid = products::find_uuid_for_public_id(state.db(), &product_id)
        .await
        .map_err(|e| AppError::BadRequest(format!("product lookup: {e}")))?
        .ok_or_else(|| {
            AppError::BadRequest(format!("unknown productId: {}", product_id))
        })?;

    // owner を決める: session.user_id があれば User、無ければ Session。
    let owner = match user_sessions::find_by_id(state.db(), session_id.0).await {
        Ok(Some(s)) => match s.user_id {
            Some(u) => product_watches::WatchOwner::User(u),
            None => product_watches::WatchOwner::Session(session_id.0),
        },
        // session 行が無い (= cookie はあるが user_sessions 未登録) でも cookie 経由で
        // anonymous 扱いできるよう Session(session_id) で進める。
        _ => product_watches::WatchOwner::Session(session_id.0),
    };

    let outcome = product_watches::toggle(state.db(), owner, product_uuid)
        .await
        .map_err(|e| AppError::BadRequest(format!("watch toggle: {e}")))?;

    let watching = matches!(outcome, product_watches::ToggleOutcome::Added);
    Ok(Json(ToggleWatchResponse { watching }))
}

#[cfg(test)]
pub(crate) fn reset_watch_for_test() {
    product_watches::reset_memory_for_test();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::{product_watches, user_sessions, users};
    use uuid::Uuid;

    fn st() -> State<AppState> {
        State(AppState::default())
    }
    fn ext(session_id: Uuid) -> Extension<SessionId> {
        Extension(SessionId(session_id))
    }

    fn lock_all() -> (
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
    ) {
        let u = users::memory_guard();
        let s = user_sessions::memory_guard();
        let w = product_watches::memory_guard();
        (u, s, w)
    }

    fn reset_all() {
        users::reset_dynamic_for_test();
        user_sessions::reset_memory_for_test();
        product_watches::reset_memory_for_test();
    }

    async fn anonymous_session() -> Uuid {
        let session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        session
    }

    async fn login_session() -> (Uuid, Uuid) {
        let session = Uuid::new_v4();
        user_sessions::create_anonymous_for_test(None, session).await.unwrap();
        let id = users::create_with_password(
            None,
            users::UserRegisterInput {
                public_id: format!("u_{}", &session.to_string()[..8]),
                name: "test".to_string(),
                email: format!("{}@example.com", &session.to_string()[..8]),
                password_plain: "long-enough-password".to_string(),
                avatar_initial: "T".to_string(),
                role: "breeder".to_string(),
            },
        )
        .await
        .unwrap();
        user_sessions::attach_user(None, session, id).await.unwrap();
        (session, id)
    }

    #[tokio::test]
    async fn toggle_alternates_state_for_anonymous_session() {
        let _g = lock_all();
        reset_all();
        let session = anonymous_session().await;

        let r1 = toggle_watch(st(), ext(session), Path("p-hh-m-142".to_string()))
            .await
            .unwrap();
        assert!(r1.0.watching, "first call: should be true (added)");

        let r2 = toggle_watch(st(), ext(session), Path("p-hh-m-142".to_string()))
            .await
            .unwrap();
        assert!(!r2.0.watching, "second call: should be false (removed)");

        let r3 = toggle_watch(st(), ext(session), Path("p-hh-m-142".to_string()))
            .await
            .unwrap();
        assert!(r3.0.watching, "third call: should be true (added again)");
    }

    #[tokio::test]
    async fn toggle_isolates_per_session() {
        let _g = lock_all();
        reset_all();
        let session_a = anonymous_session().await;
        let session_b = anonymous_session().await;

        // session A で p-hh-m-142 を watch
        toggle_watch(st(), ext(session_a), Path("p-hh-m-142".to_string()))
            .await
            .unwrap();

        // session B から見ると p-hh-m-142 は未 watch (= 新規 Added)
        let r = toggle_watch(st(), ext(session_b), Path("p-hh-m-142".to_string()))
            .await
            .unwrap();
        assert!(r.0.watching, "session B にとっては新規 watch (= Added)");
    }

    #[tokio::test]
    async fn toggle_separates_anonymous_from_login_user() {
        let _g = lock_all();
        reset_all();
        let anon_session = anonymous_session().await;
        let (user_session, _user_id) = login_session().await;

        // anon が watch
        toggle_watch(st(), ext(anon_session), Path("p-hh-m-142".to_string()))
            .await
            .unwrap();
        // login user は別 owner なので独立 (= Added)
        let r = toggle_watch(st(), ext(user_session), Path("p-hh-m-142".to_string()))
            .await
            .unwrap();
        assert!(r.0.watching, "login user は別 owner で独立 watch");
    }

    #[tokio::test]
    async fn empty_product_id_is_400() {
        let _g = lock_all();
        reset_all();
        let session = anonymous_session().await;
        match toggle_watch(st(), ext(session), Path("".to_string())).await {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn unknown_product_id_is_400() {
        let _g = lock_all();
        reset_all();
        let session = anonymous_session().await;
        match toggle_watch(st(), ext(session), Path("p-galaxy-invader".to_string())).await {
            Err(AppError::BadRequest(msg)) => {
                assert!(msg.contains("p-galaxy-invader"))
            }
            other => panic!("expected BadRequest for unknown product, got {other:?}"),
        }
    }

    #[test]
    fn response_serializes_camel_case() {
        let res = ToggleWatchResponse { watching: true };
        let json = serde_json::to_string(&res).unwrap();
        assert_eq!(json, r#"{"watching":true}"#);
    }
}
