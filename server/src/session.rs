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
    response::{IntoResponse, Response},
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
    // production (= HTTPS reverse-proxy 経由) では `KOCHU_COOKIE_SECURE=true` を env に
    // 設定して Secure 属性を付ける。dev (http://localhost) では未設定のまま (= Secure
    // を付けると localhost で cookie が立たない)。
    let secure_attr = if cookie_secure_enabled() { "; Secure" } else { "" };
    let cookie_value = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax{}",
        SESSION_COOKIE_NAME, session_id, secure_attr
    );
    if let Ok(hv) = HeaderValue::from_str(&cookie_value) {
        response.headers_mut().append(header::SET_COOKIE, hv);
    }

    response
}

/// `KOCHU_COOKIE_SECURE` env が `"true"` の時のみ Secure 属性を有効化する。
/// それ以外 (= 未設定 / "false" / 任意の文字列) は disable。
fn cookie_secure_enabled() -> bool {
    std::env::var("KOCHU_COOKIE_SECURE").ok().as_deref() == Some("true")
}

// ──────────────────────────────────────────────────────────────────────
// CSRF 保護 (= Origin ヘッダチェック / Phase 9.x hardening)
// ──────────────────────────────────────────────────────────────────────
//
// 状態変更メソッド (POST / PATCH / DELETE / PUT) に対して、リクエストの `Origin`
// ヘッダが `KOCHU_ALLOWED_ORIGINS` env (= CSV) のいずれかに一致しているかをチェック
// する。一致しない / Origin 欠落 → 403。
//
// **設計判断**:
//   - 単純な Origin ヘッダ照合は SameSite=Lax / HTTPS と組み合わせると実用十分。
//     synchronizer token / double-submit cookie まで実装する必要は production 規模に
//     達するまで無し (= MVP 範囲)。
//   - GET / HEAD / OPTIONS は副作用なしなので skip。
//   - `/api/v1/stripe/webhook` は HMAC-SHA256 で別経路の検証 (= Origin = stripe.com の
//     server-to-server) なので skip。
//   - env 未設定 (= dev / test) は CSRF check 自体をスキップして、ローカル開発を
//     妨げない (= scaffolding mode)。production では必ず env を設定すること。

/// `axum::middleware::from_fn` 直接渡し可能な関数。
///
/// state-changing request の `Origin` を `KOCHU_ALLOWED_ORIGINS` (CSV) と照合する。
pub async fn csrf_middleware(req: Request, next: Next) -> Response {
    use axum::http::{Method, StatusCode};

    let method = req.method().clone();
    let path = req.uri().path().to_string();

    // ── 安全なメソッドは無条件 pass ───────────────────────────────
    if matches!(method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return next.run(req).await;
    }
    // ── stripe webhook は HMAC で別経路の検証 → skip ──────────────
    if path == "/api/v1/stripe/webhook" {
        return next.run(req).await;
    }
    // ── env 未設定 → scaffolding mode (= dev) で skip ──────────────
    let allowed = match std::env::var("KOCHU_ALLOWED_ORIGINS") {
        Ok(s) if !s.trim().is_empty() => s,
        _ => return next.run(req).await,
    };

    // ── Origin ヘッダを CSV と比較 ────────────────────────────────
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let ok = allowed
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .any(|allow| allow == origin);
    if !ok {
        tracing::warn!(
            "csrf_middleware: rejected origin={:?} method={} path={}",
            origin,
            method,
            path
        );
        return (StatusCode::FORBIDDEN, "csrf check failed").into_response();
    }
    next.run(req).await
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

    /// `KOCHU_COOKIE_SECURE` env を弄る 3 テストを逐次化する mutex。
    /// 並列実行下で他テストが同じ env を書くと set/assert 間で値が入れ替わるため、
    /// poison-tolerant な共有 GUARD で 1 つずつ走らせる。
    fn cookie_secure_guard() -> std::sync::MutexGuard<'static, ()> {
        static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
        GUARD.lock().unwrap_or_else(|p| p.into_inner())
    }

    #[test]
    fn cookie_secure_default_is_off() {
        let _g = cookie_secure_guard();
        // env を空にしてからのテスト。SAFETY: edition 2024 では set_var が unsafe。
        unsafe {
            std::env::remove_var("KOCHU_COOKIE_SECURE");
        }
        assert!(!cookie_secure_enabled(), "未設定なら disable");
    }

    #[test]
    fn cookie_secure_enabled_when_env_is_true() {
        let _g = cookie_secure_guard();
        unsafe {
            std::env::set_var("KOCHU_COOKIE_SECURE", "true");
        }
        assert!(cookie_secure_enabled());
        unsafe {
            std::env::remove_var("KOCHU_COOKIE_SECURE");
        }
    }

    #[test]
    fn cookie_secure_disabled_when_env_is_other() {
        let _g = cookie_secure_guard();
        unsafe {
            std::env::set_var("KOCHU_COOKIE_SECURE", "1"); // "true" 以外
        }
        assert!(
            !cookie_secure_enabled(),
            "厳密な \"true\" マッチのみ enable"
        );
        unsafe {
            std::env::remove_var("KOCHU_COOKIE_SECURE");
        }
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

    // ── CSRF middleware ─────────────────────────────────────────────

    /// CSRF テストは `KOCHU_ALLOWED_ORIGINS` env を弄るので逐次化が必要。
    fn csrf_guard() -> std::sync::MutexGuard<'static, ()> {
        static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
        GUARD.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn unset_csrf_env() {
        unsafe {
            std::env::remove_var("KOCHU_ALLOWED_ORIGINS");
        }
    }

    fn build_csrf_app() -> axum::Router {
        use axum::{Router, routing::get};
        async fn ok() -> &'static str {
            "ok"
        }
        Router::new()
            .route("/x", get(ok).post(ok))
            .route("/api/v1/stripe/webhook", axum::routing::post(ok))
            .layer(axum::middleware::from_fn(csrf_middleware))
    }

    #[tokio::test]
    async fn csrf_skips_get_requests() {
        let _g = csrf_guard();
        unset_csrf_env();
        unsafe {
            std::env::set_var("KOCHU_ALLOWED_ORIGINS", "https://kochu.example");
        }

        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let res = build_csrf_app()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/x")
                    .header(header::ORIGIN, "https://attacker.example") // 無関係でも GET なので通る
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        unset_csrf_env();
    }

    #[tokio::test]
    async fn csrf_skips_when_env_unset() {
        let _g = csrf_guard();
        unset_csrf_env();

        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let res = build_csrf_app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/x")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 200, "env 未設定 (= dev) では CSRF check skip");
    }

    #[tokio::test]
    async fn csrf_accepts_matching_origin() {
        let _g = csrf_guard();
        unsafe {
            std::env::set_var("KOCHU_ALLOWED_ORIGINS", "https://kochu.example");
        }

        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let res = build_csrf_app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/x")
                    .header(header::ORIGIN, "https://kochu.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        unset_csrf_env();
    }

    #[tokio::test]
    async fn csrf_rejects_mismatched_origin() {
        let _g = csrf_guard();
        unsafe {
            std::env::set_var("KOCHU_ALLOWED_ORIGINS", "https://kochu.example");
        }

        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let res = build_csrf_app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/x")
                    .header(header::ORIGIN, "https://attacker.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 403);
        unset_csrf_env();
    }

    #[tokio::test]
    async fn csrf_rejects_missing_origin_header() {
        let _g = csrf_guard();
        unsafe {
            std::env::set_var("KOCHU_ALLOWED_ORIGINS", "https://kochu.example");
        }

        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let res = build_csrf_app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/x")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 403, "Origin 欠落も 403");
        unset_csrf_env();
    }

    #[tokio::test]
    async fn csrf_skips_stripe_webhook_path() {
        let _g = csrf_guard();
        unsafe {
            std::env::set_var("KOCHU_ALLOWED_ORIGINS", "https://kochu.example");
        }

        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        // stripe webhook は HMAC で別経路の検証をするので CSRF は skip
        let res = build_csrf_app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/stripe/webhook")
                    .header(header::ORIGIN, "https://stripe.com") // 一覧に無くても通る
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        unset_csrf_env();
    }

    #[tokio::test]
    async fn csrf_accepts_any_of_csv_origins() {
        let _g = csrf_guard();
        unsafe {
            std::env::set_var(
                "KOCHU_ALLOWED_ORIGINS",
                "https://a.example, https://b.example,https://c.example",
            );
        }

        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        for origin in ["https://a.example", "https://b.example", "https://c.example"] {
            let res = build_csrf_app()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/x")
                        .header(header::ORIGIN, origin)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(res.status(), 200, "{origin} should be allowed");
        }
        unset_csrf_env();
    }
}
