//! Repository 層 (Phase 9.x DB 移行)
//!
//! sqlx で DB アクセスする関数群をテーブル別に分離。
//! handler 側は repo の関数だけを呼び、SQL を直接書かない。

pub mod assets;
pub mod bids;
pub mod cart_items;
pub mod listing_watches;
pub mod listings;
pub mod mating_records;
pub mod order_fulfillment;
pub mod orders;
pub mod prefectures;
pub mod product_watches;
pub mod products;
pub mod shipping_methods;
pub mod specimen_logs;
pub mod specimen_status_history;
pub mod specimens;
pub mod stripe_webhook_events;
pub mod user_sessions;
pub mod users;
