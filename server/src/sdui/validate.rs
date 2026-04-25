//! `Block.key` のカード内一意性バリデータ。
//!
//! deserialize 後に必ず `card.validate_keys()` を呼ぶ。失敗は API ハンドラで 400 にする。
//!
//! 検証スコープ: `Block.key` は同一 `CardBlock` 内で一意。
//! `MetricItem.key` / `MetaItem.key` は親 Block の `key` と組み合わせた合成キー
//! (`<block.key>::<item.key>`) で一意性を確認する。
//!
//! 詳細: `docs/sdui-three-layer-model-v5.md` §4.3 / §7.6

use std::collections::HashSet;
use thiserror::Error;

use super::blocks::CardBlock;

#[derive(Debug, Error, PartialEq, Eq)]
#[error("duplicate key in card: {key}")]
pub struct KeyConflict {
    pub key: String,
}

pub trait ValidateKeys {
    fn validate_keys(&self) -> Result<(), KeyConflict>;
}

impl ValidateKeys for CardBlock {
    fn validate_keys(&self) -> Result<(), KeyConflict> {
        let mut seen: HashSet<String> = HashSet::new();
        for block in self.iter_blocks() {
            check(&mut seen, block.key())?;
            for item_key in block.iter_item_keys() {
                let composite = format!("{}::{}", block.key(), item_key);
                check(&mut seen, &composite)?;
            }
        }
        Ok(())
    }
}

fn check(seen: &mut HashSet<String>, k: &str) -> Result<(), KeyConflict> {
    if k.is_empty() {
        return Err(KeyConflict {
            key: "<empty>".to_string(),
        });
    }
    if !seen.insert(k.to_string()) {
        return Err(KeyConflict { key: k.to_string() });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdui::blocks::{Block, BadgeRole, CardBlock, Localizable, ProductFeatureVariant};
    use crate::sdui::regions::ProductFeatureRegions;

    fn raw(text: &str) -> Localizable {
        Localizable::Raw {
            text: text.to_string(),
        }
    }

    fn badge(key: &str) -> Block {
        Block::Badge {
            key: key.to_string(),
            role: BadgeRole::Status,
            label: raw("Featured"),
            analytics_id: None,
        }
    }

    fn card(blocks: Vec<Block>) -> CardBlock {
        CardBlock::ProductFeature {
            id: "DHH-0271".to_string(),
            variant: Some(ProductFeatureVariant::Featured),
            experiment: None,
            analytics_id: None,
            regions: ProductFeatureRegions {
                header: blocks,
                ..Default::default()
            },
        }
    }

    #[test]
    fn unique_keys_pass() {
        let c = card(vec![badge("header-b1"), badge("header-b2")]);
        assert!(c.validate_keys().is_ok());
    }

    #[test]
    fn duplicate_block_keys_fail() {
        let c = card(vec![badge("header-b1"), badge("header-b1")]);
        let err = c.validate_keys().unwrap_err();
        assert_eq!(err.key, "header-b1");
    }

    #[test]
    fn empty_block_key_fails() {
        let c = card(vec![badge("")]);
        assert!(c.validate_keys().is_err());
    }
}
