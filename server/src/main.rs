use std::net::SocketAddr;

use axum::{Router, routing::get};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

use insect_app_server::{db, handlers, repos, routes, state::AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // .env を読み込む (本番では AWS Secrets Manager 等で env を直接注入する想定)。
    // ファイル不在は無視 (= production の env-only 起動を許す)。
    let _ = dotenvy::dotenv();

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

    let app = build_app(AppState { db: db_pool.clone() });

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
        .nest("/api/v1", routes::api_v1(state))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
