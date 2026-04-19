use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct HelloResponse {
    pub message: String,
}

pub async fn hello() -> Json<HelloResponse> {
    Json(HelloResponse {
        message: "hello from axum".to_string(),
    })
}
