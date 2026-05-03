use std::net::SocketAddr;

use axum::{
    Router,
    http::{HeaderValue, Method, header},
    routing::get,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

use insect_app_server::{
    db, ensure_production_env_or_panic, handlers, openapi, repos, routes, state::AppState, workers,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // .env を読み込む (本番では AWS Secrets Manager 等で env を直接注入する想定)。
    // ファイル不在は無視 (= production の env-only 起動を許す)。
    let _ = dotenvy::dotenv();

    // production 必須 env (HMAC secret / CSRF allowed origins / Cookie Secure 属性) が
    // 揃っていることを起動時に検証する (review fix: blocker)。
    // dev / test (= KOCHU_ENV != "production") では何もしない。
    ensure_production_env_or_panic();

    init_tracing();

    // PostgreSQL pool を best-effort で初期化。DB 不在でもサーバは起動する (MVP)。
    // production では `db::init_pool` 直接呼び出しに切り替えて DB 不在 = fatal にする。
    let db_pool = db::try_init_pool().await;
    // Phase 9.x: pool は AppState 経由で全 handler に届く (`State<AppState>` extractor)。
    //   pool=None でも個々の repo が in-memory fallback を持っているのでサーバは起動可能。

    // Phase 9.B 段階 3: 商品マスタ (cards.rs::product_filter_meta) の DB 同期。
    //   pool 不在時は in-memory fallback (= 0003_products.sql の seed と同値) で warm。
    //   失敗してもサーバ起動は止めない (MVP) — fallback で読まれる。
    if let Err(e) = repos::products::warm_meta_cache(db_pool.as_ref()).await {
        tracing::warn!("warm_meta_cache failed: {e} (using in-memory fallback)");
    }

    // Phase 9.B 段階 6: shipping_methods / prefectures の DB 同期。
    //   両方とも sort_order の確定された master data なので OnceLock 1 回 warm でよい。
    if let Err(e) = repos::shipping_methods::warm_methods_cache(db_pool.as_ref()).await {
        tracing::warn!("warm_methods_cache failed: {e} (using in-memory fallback)");
    }
    if let Err(e) = repos::prefectures::warm_prefectures_cache(db_pool.as_ref()).await {
        tracing::warn!("warm_prefectures_cache failed: {e} (using in-memory fallback)");
    }

    let state = AppState { db: db_pool.clone() };

    // Sprint 2 / N1-N2: バックグラウンド worker (= email_send relay loop /
    // eclosion_daily 等) を `KOCHU_WORKER_ENABLE=true` 時のみ spawn する。
    //   - dev / `cargo test`: env 未設定 → 何もしない (= worker 起動なし)
    //   - prod web task     : env=false → web のみ
    //   - prod worker task  : env=true  → web も並走するが ECS 側で別 task に分ける想定
    //                          (= 単一 task に web+worker 同居も可)
    workers::spawn_all(state.clone());

    let app = build_app(state);

    let bind_addr = std::env::var("KOCHU_BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:3000".to_string());
    let addr: SocketAddr = bind_addr.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on {}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "insect_app=debug,tower_http=debug,axum=debug,sqlx=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
}

fn build_app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(handlers::health::health))
        // Phase 1 / A1: /openapi.json + /swagger-ui を提供 (= dev / CI 用)。
        // 本番では reverse proxy で外部公開を絞る運用想定。
        .merge(openapi::router())
        .nest("/api/v1", routes::api_v1(state))
        .layer(build_cors_layer())
        .layer(TraceLayer::new_for_http())
}

/// CORS layer を `KOCHU_ALLOWED_ORIGINS` ベースで構築する (review fix: minor)。
///
/// - production: env が CSV で設定されていれば、そこに含まれる origin だけ許可。
///   CSRF middleware (Origin 照合) と allowlist を一致させる二重防御。
/// - dev / 未設定: `permissive()` で開発体験を壊さない (= localhost / file:// 等)。
///
/// `Allow-Credentials: true` は cookie ベース session に必須。`allow_methods` は
/// REST 標準 + `OPTIONS` (preflight) を許可、`allow_headers` は `Content-Type`
/// (= JSON body) と `Accept` を許可する。
fn build_cors_layer() -> CorsLayer {
    let methods = [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::OPTIONS,
        Method::HEAD,
    ];
    let allow_headers = [header::CONTENT_TYPE, header::ACCEPT];

    match std::env::var("KOCHU_ALLOWED_ORIGINS") {
        Ok(csv) if !csv.trim().is_empty() => {
            let origins: Vec<HeaderValue> = csv
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .filter_map(|s| s.parse::<HeaderValue>().ok())
                .collect();
            if origins.is_empty() {
                tracing::warn!(
                    "KOCHU_ALLOWED_ORIGINS={csv:?} にパース可能な origin が無いので permissive にフォールバック"
                );
                CorsLayer::permissive()
            } else {
                CorsLayer::new()
                    .allow_origin(origins)
                    .allow_credentials(true)
                    .allow_methods(methods)
                    .allow_headers(allow_headers)
            }
        }
        _ => CorsLayer::permissive(),
    }
}
