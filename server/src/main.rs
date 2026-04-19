use std::net::SocketAddr;

use axum::{Router, routing::get};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

mod error;
mod handlers;
mod routes;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let app = build_app();

    let addr: SocketAddr = "0.0.0.0:3000".parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on {}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "insect_app=debug,tower_http=debug,axum=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
}

fn build_app() -> Router {
    Router::new()
        .route("/health", get(handlers::health::health))
        .nest("/api/v1", routes::api_v1())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
