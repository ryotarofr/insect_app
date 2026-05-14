//! Server-Driven UI (SDUI) スキーマの Source of Truth。
//!
//! 設計方針: `docs/sdui-three-layer-model-v6.md`
//!
//! - **Region → Block → Role** の三層モデル
//! - Rust 側を型の単一ソース。`ts-rs` で TypeScript 型を、
//!   `schemars` で JSON Schema を生成 (コンパイル時 + 実行時の二重防御)
//! - 現状は `product_feature` テンプレートのみ実装
//! - `Block.key` のカード内一意性は `ValidateKeys` で deserialize 後に検証

pub mod analytics;
pub mod blocks;
pub mod experiment;
pub mod list;
pub mod regions;
pub mod validate;

// 現状は一部しか直接利用しないが、SDUI モジュールの公開 API として
// 揃えて re-export しておく (binary crate のため `unused_imports` を抑制)。
#[allow(unused_imports)]
pub use analytics::{AnalyticsEvent, AnalyticsEventBatch, AnalyticsEventType};
#[allow(unused_imports)]
pub use blocks::{
    BadgeRole, Block, CardBlock, CartVariant, CheckoutFieldAction, CheckoutMethodAction, CtaAction,
    CtaIntent, Currency, FormFieldKind, Href, HrefError, I18nKey, LineItemAction, Localizable,
    MediaKind, MetaItem, MetaLineItemRole, MetricItem, RegionName, SelectOption,
    ShippingMethodOption, TextRole,
};
#[allow(unused_imports)]
pub use experiment::{Experiment, ExperimentError};
#[allow(unused_imports)]
pub use list::{
    FilterBar, FilterChipItem, FilterGroup, PageLink, Pagination, ProductListResponse, SearchBox,
    SortBar, SortOption,
};
#[allow(unused_imports)]
pub use regions::{CartRegions, ProductDetailRegions, ProductFeatureRegions};
#[allow(unused_imports)]
pub use validate::{A11yViolation, KeyConflict, ValidateA11y, ValidateKeys};
