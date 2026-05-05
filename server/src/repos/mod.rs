//! Repository 層 (Phase 9.x DB 移行)
//!
//! sqlx で DB アクセスする関数群をテーブル別に分離。
//! handler 側は repo の関数だけを呼び、SQL を直接書かない。

pub mod assets;
pub mod bids;
pub mod cart_items;
pub mod cohort_logs;
pub mod cohorts;
pub mod email_outbox;
pub mod listing_watches;
pub mod listings;
pub mod mating_records;
pub mod order_fulfillment;
pub mod orders;
pub mod password_resets;
pub mod prefectures;
pub mod shipping_methods;
pub mod species;
pub mod species_stats;
pub mod specimen_logs;
pub mod specimen_status_history;
pub mod specimens;
pub mod stripe_webhook_events;
pub mod user_sessions;
pub mod users;
// C2C pivot: products / product_bloodlines / product_watches は削除済。
//   listings (= C2C 出品) が販売対象の唯一のエンティティに統一された。
