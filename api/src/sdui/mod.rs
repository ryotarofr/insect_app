//! SDUI スキーマ (Source of Truth)
//!
//! レイヤ: **Page → Region → Card → Block(Role)**
//!
//! - 定義(`DefBlock`: DB保存・エージェントが著述)とビュー(`ViewBlock`: 配信・hydrate結果)を分離
//! - enum は adjacently-tagged (`tag = "type", content = "content"`) — typeshare 対応形式
//! - タグ付き union にユニット variant は置かない(serde #2294: deny_unknown_fields が効かない)
//! - `flatten` 禁止(deny_unknown_fields と非互換)
//! - 検証済み定義は `ValidPageDefinition::parse` 経由でのみ作れる (parse, don't validate)

mod brand;
mod def;
mod valid;
mod view;

pub use brand::{BlockKey, BrandError, SitePath};
pub use def::{
    Card, CardLayout, CardSize, CardTone, CtaIntent, DefBlock, FeedRegions, ListingQuery,
    ListingSeller, ListingSort, Page, PageDefinition, TextRole, UiAction,
};
pub use valid::{DefinitionError, SCHEMA_VERSION, ValidPageDefinition};
pub use view::{
    AlertItem, CareLogEntry, Currency, GroupTabItem, ListingItem, ListingState, PageView, SpecAttr,
    SpecimenGroup, SpecimenItem, TodoItem, ViewBlock,
};
