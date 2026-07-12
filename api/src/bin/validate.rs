//! stdin の JSON を PageDefinition として検証する CLI(LLMハーネス用)。
//!
//! 実行例: `cat def.json | cargo run --bin validate`
//! 通過なら exit 0 / "OK"、違反なら exit 1 / 理由を stderr に出す。

use std::io::Read;

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("read stdin");
    match api::sdui::ValidPageDefinition::parse(&input) {
        Ok(_) => println!("OK"),
        Err(e) => {
            eprintln!("INVALID: {e}");
            std::process::exit(1);
        }
    }
}
