//! 定義側スキーマの JSON Schema を書き出す(LLMハーネスの入力)。
//!
//! 実行: `cd api && cargo run --bin dump_schema` → `../schema/page_definition.schema.json`

fn main() {
    let schema = schemars::schema_for!(api::sdui::PageDefinition);
    let json = serde_json::to_string_pretty(&schema).expect("serialize schema");
    let dir = std::path::Path::new("../schema");
    std::fs::create_dir_all(dir).expect("create ../schema");
    let path = dir.join("page_definition.schema.json");
    std::fs::write(&path, json).expect("write schema file");
    println!("wrote {}", path.display());
}
