pub mod auth;
pub mod cart;
pub mod checkout;
pub mod cohorts;
pub mod events;
pub mod health;
pub mod hello;
pub mod listings;
pub mod mating_records;
pub mod orders;
pub mod species;
pub mod specimen_fulfillment;
pub mod specimen_logs;
pub mod specimens;
pub mod stripe_webhook;
pub mod uploads;
// C2C pivot: cards / products / product_bloodlines / watch (= 商品ウォッチ) は削除済。
//   - cards         (= /cards/products / cart) は SDUI Card 配信 = 商品 + cart 用
//   - products      (= /products 一覧 / 詳細)
//   - product_bloodlines (= 商品血統情報)
//   - watch         (= 商品ウォッチトグル)
//   listings に統合済 (= /listings, /listings/:id/watch 経由)。
