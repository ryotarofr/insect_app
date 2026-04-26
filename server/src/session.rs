//! Cookie ベースの session_id middleware (Phase 9.E 補助 / 設計書 §3.3 + §8.2)
//!
//! **責務**:
//!   - 各リクエストの `Cookie: kochu_session=<UUID>` を読み取り、`SessionId` を
//!     extension に詰めて handler に届ける。
//!   - cookie が無い / parse 失敗の時は新規 UUID を発行し、レスポンスに
//!     `Set-Cookie: kochu_session=<UUID>; Path=/; HttpOnly; SameSite=Lax` を返す。
//!   - **MVP では DB 永続化しない**: cookie 自体に session_id を格納し、user_sessions
//!     テーブルへの INSERT は **次フェーズ** (= 実 user 登場時) で扱う。
//!     これにより本 PR は単独で完結 + 既存テストを壊さず追加できる。
//!
//! **設計判断**:
//!   - 新 crate 依存を追加せず Cookie 文字列を手書きで parse / format する
//!     (= 1 cookie / シンプルな key=value のみ扱うので tower-cookies を入れる必要なし)。
//!   - SameSite=Lax: SDUI は同じ origin から GET / POST するだけなので Lax で十分。
//!     CSRF 対策が必要な variant が入ったら Strict / 別 token に切り替え。
//!   - HttpOnly: JS から読めないため、XSS 経由で session を盗まれにくい。
//!   - cookie の Secure 属性は **dev では付けない** (= http://localhost で発動するため)。
//!     production では reverse-proxy 側で `Secure` を付与するか、本コードを env で分岐。
//!
//! **handler 側からの取り出し方**:
//!   ```ignore
//!   use axum::Extension;
//!   use insect_app_server::session::SessionId;
//!
//!   async fn my_handler(Extension(session_id): Extension<SessionId>) -> String {
//!       let id: uuid::Uuid = session_id.0;
//!       id.to_string()
//!   }
//!   ```

use axum::{
    extract::{Request, State},
    http::{HeaderValue, header},
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

use crate::state::AppState;

/// 1 リクエストに紐付く session 識別子。Cookie から取り出すか、無ければ新規発行。
///
/// `Copy` 派生: UUID は内部 16 byte で軽量、handler から `session_id.0` で値取り出し可能。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionId(pub Uuid);

/// Cookie 名。複数 cookie を将来導入するなら prefix にしておく。
pub const SESSION_COOKIE_NAME: &str = "kochu_session";

/// `axum::middleware::from_fn_with_state` に渡す async 関数。
///
/// 仕組み:
///   1. リクエストの Cookie ヘッダを読み、`kochu_session=<UUID>` を parse
///   2. 取れなければ `Uuid::new_v4()` で新発行 + (pool 有り時のみ) user_sessions に INSERT
///   3. `SessionId` を extensions に詰めて handler チェーンに流す
///   4. レスポンスに Set-Cookie を追加 (= 既存 cookie でも上書きで OK)
///
/// **DB 永続化のポリシー**:
///   - **新規 cookie 発行時のみ INSERT**: 既存 cookie の re-validation は DB hit を
///     呼ぶので毎リクエストは避ける。session が無効化された場合は cookie 期限で対応。
///   - **INSERT 失敗は warn ログだけで継続**: cookie 自体に session_id が乗っているため、
///     DB が落ちていても認証フローは破綻しない (= graceful degradation)。
///   - pool=None なら DB 書き込みは完全にスキップ (= dev / test 環境)。
pub async fn session_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    // ── 1. Cookie 取得 / parse ─────────────────────────────────────
    let parsed = req
        .headers()
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .and_then(parse_session_cookie);

    let (session_id, is_new) = match parsed {
        Some(id) => (id, false),
        None => (Uuid::new_v4(), true),
    };

    // ── 2. 新規発行時のみ DB に user_sessions 行を作る (best effort) ──
    if is_new {
        if let Some(pool) = state.db() {
            if let Err(e) =
                crate::repos::user_sessions::create_anonymous(Some(pool), session_id).await
            {
                tracing::warn!(
                    "session_middleware: failed to persist new session {}: {}",
                    session_id,
                    e
                );
            }
        }
    }

    // ── 3. extensions に SessionId を詰める ────────────────────────
    req.extensions_mut().insert(SessionId(session_id));

    // ── 4. handler チェーン実行 ────────────────────────────────────
    let mut response = next.run(req).await;

    // ── 5. Set-Cookie を追加 (= 既存 cookie 上書き or 新発行) ──────
    let cookie_value = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax",
        SESSION_COOKIE_NAME, session_id
    );
    if let Ok(hv) = HeaderValue::from_str(&cookie_value) {
        response.headers_mut().append(header::SET_COOKIE, hv);
    }

    response
}

/// `Cookie` ヘッダ文字列から `kochu_session=<UUID>` を取り出す。
///
/// 仕様:
///   - 複数 cookie は `; ` 区切り (例: `foo=bar; kochu_session=...; baz=qux`)
///   - 値は UUID (= hyphen 込みの 36 文字) として parse できないと None
///
/// **注意**: cookie 値の URL-encode は仕様上ありうるが、UUID は hyphen / hex のみで
/// encode 不要なので decode 処理は省略。将来 / が混じる値を扱うなら見直す。
fn parse_session_cookie(header: &str) -> Option<Uuid> {
    for piece in header.split(';') {
        let trimmed = piece.trim();
        let Some((name, value)) = trimmed.split_once('=') else {
            continue;
        };
        if name == SESSION_COOKIE_NAME {
            return Uuid::parse_str(value).ok();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_session_cookie_picks_kochu_session() {
        let h = "foo=bar; kochu_session=550e8400-e29b-41d4-a716-446655440000; baz=qux";
        let id = parse_session_cookie(h).unwrap();
        assert_eq!(
            id,
            Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
        );
    }

    #[test]
    fn parse_session_cookie_returns_none_when_missing() {
        assert!(parse_session_cookie("foo=bar; baz=qux").is_none());
        assert!(parse_session_cookie("").is_none());
    }

    #[test]
    fn parse_session_cookie_returns_none_for_non_uuid_value() {
        let h = "kochu_session=not-a-uuid";
        assert!(parse_session_cookie(h).is_none());
    }

    #[test]
    fn parse_session_cookie_handles_no_space_after_semicolon() {
        let h = "foo=bar;kochu_session=550e8400-e29b-41d4-a716-446655440000";
        let id = parse_session_cookie(h).unwrap();
        assert_eq!(
            id,
            Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
        );
    }

    #[tokio::test]
    async fn middleware_creates_session_when_no_cookie() {
        use axum::{Router, body::Body, http::Request, routing::get};
        use tower::ServiceExt;

        async fn h(axum::Extension(s): axum::Extension<SessionId>) -> String {
            s.0.to_string()
        }

        let app = Router::new()
            .route("/x", get(h))
            .layer(axum::middleware::from_fn_with_state(
                AppState::default(),
                session_middleware,
            ));

        let res = app
            .oneshot(Request::builder().uri("/x").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert!(
            res.headers()
                .get_all(header::SET_COOKIE)
                .iter()
                .any(|v| v.to_str().unwrap_or("").contains(SESSION_COOKIE_NAME)),
            "Set-Cookie に kochu_session が乗っているはず"
        );
    }

    #[tokio::test]
    async fn middleware_reuses_session_when_cookie_present() {
        use axum::{Router, body::Body, http::Request, routing::get};
        use tower::ServiceExt;

        async fn h(axum::Extension(s): axum::Extension<SessionId>) -> String {
            s.0.to_string()
        }

        let app = Router::new()
            .route("/x", get(h))
            .layer(axum::middleware::from_fn_with_state(
                AppState::default(),
                session_middleware,
            ));

        let known = "11111111-2222-3333-4444-555555555555";
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/x")
                    .header(header::COOKIE, format!("kochu_session={known}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body = axum::body::to_bytes(res.into_body(), 1024).await.unwrap();
        let body_str = std::str::from_utf8(&body).unwrap();
        assert_eq!(body_str, known, "既存 cookie がそのまま session_id に");
    }
}
