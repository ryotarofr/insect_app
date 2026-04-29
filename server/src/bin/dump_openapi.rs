//! OpenAPI 仕様を stdout に dump する CLI binary (Phase 1 / A1 / PR O-6)。
//!
//! **使い方**:
//!   ```bash
//!   cargo run --quiet --bin dump_openapi > openapi.json
//!   # または
//!   cargo run --quiet --bin dump_openapi | bunx openapi-typescript - -o api.d.ts
//!   ```
//!
//! **設計判断**:
//!   - server を起動せず CLI で完結 (= CI で `cargo run --bin dump_openapi` だけで OK)
//!   - 標準出力に書き、shell pipeline で openapi-typescript に流す前提
//!   - エラーは stderr に書き、終了コードで通知
//!   - 標準ライブラリの `print!` が UTF-8 で書き出すため、Windows でも問題なし

fn main() {
    let json = insect_app_server::openapi::runtime_openapi_json();
    print!("{}", json);
}
