//! Repository 層 (Phase 9.x DB 移行)
//!
//! sqlx で DB アクセスする関数群をテーブル別に分離。
//! handler 側は repo の関数だけを呼び、SQL を直接書かない。

pub mod orders;
pub mod prefectures;
pub mod products;
pub mod shipping_methods;
