//! `Block.key` のカード内一意性バリデータ + a11y 不変条件バリデータ。
//!
//! deserialize 後に必ず `card.validate_keys()` と `card.validate_a11y()` を呼ぶ。
//! 失敗は API ハンドラで 400 にする。
//!
//! **ValidateKeys 検証スコープ**: `Block.key` は同一 `CardBlock` 内で一意。
//! `MetricItem.key` / `MetaItem.key` は親 Block の `key` と組み合わせた合成キー
//! (`<block.key>::<item.key>`) で一意性を確認する。
//!
//! **ValidateA11y 検証スコープ**:
//! 設計書 §5.2 / §7.7 の不変条件:
//! - 同一テンプレート内に `text.role: headline` の Block は **0 または 1 個**。
//!   複数 headline はスクリーンリーダーのナビゲーションを破壊するため reject。
//!
//! 詳細: `docs/sdui-three-layer-model-v6.md` §5.2 / §7.6 / §7.7

use std::collections::HashSet;
use thiserror::Error;

use super::blocks::{Block, CardBlock, TextRole};

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

// ──────────────────────────────────────────────────────────────────────
// ValidateA11y — §5.2 / §7.7
// ──────────────────────────────────────────────────────────────────────

/// a11y 不変条件違反の種別。将来 (`<button>` の aria-label 欠落チェック等を加える時)
/// に variant を増やす想定。
#[derive(Debug, Error, PartialEq, Eq)]
pub enum A11yViolation {
    /// 同一テンプレート内に headline ブロックが 2 個以上。
    /// スクリーンリーダーの見出しナビゲーションが破綻するので reject。
    #[error(
        "template {template:?} has {count} headline blocks (expected 0 or 1) — \
         keys: {keys:?}"
    )]
    MultipleHeadlines {
        template: String,
        count: usize,
        keys: Vec<String>,
    },
}

/// a11y 不変条件を検証する trait。`ValidateKeys` と同格で deserialize 後に呼ぶ。
///
/// **使い方** (handler 側):
/// ```ignore
/// let card: CardBlock = serde_json::from_str(body)?;
/// card.validate_keys()?;     // §7.6
/// card.validate_a11y()?;     // §7.7
/// ```
pub trait ValidateA11y {
    fn validate_a11y(&self) -> Result<(), A11yViolation>;
}

impl ValidateA11y for CardBlock {
    fn validate_a11y(&self) -> Result<(), A11yViolation> {
        // headline ブロックの key を集める (= 違反時のエラー文に出すため)
        let headline_keys: Vec<String> = self
            .iter_blocks()
            .filter_map(|b| match b {
                Block::Text {
                    key,
                    role: TextRole::Headline,
                    ..
                } => Some(key.clone()),
                _ => None,
            })
            .collect();

        if headline_keys.len() > 1 {
            return Err(A11yViolation::MultipleHeadlines {
                template: self.template_name().to_string(),
                count: headline_keys.len(),
                keys: headline_keys,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdui::blocks::{
        BadgeRole, Block, CardBlock, Localizable, ProductFeatureVariant, TextRole,
    };
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

    fn text(key: &str, role: TextRole, body: &str) -> Block {
        Block::Text {
            key: key.to_string(),
            role,
            content: raw(body),
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

    /// header / body の 2 region に block を分配したカード (= a11y test 用)。
    fn card_split(header: Vec<Block>, body: Vec<Block>) -> CardBlock {
        CardBlock::ProductFeature {
            id: "DHH-0271".to_string(),
            variant: Some(ProductFeatureVariant::Featured),
            experiment: None,
            analytics_id: None,
            regions: ProductFeatureRegions {
                header,
                body,
                ..Default::default()
            },
        }
    }

    // ── ValidateKeys ──────────────────────────────────────────────

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

    // ── ValidateA11y (§7.7) ─────────────────────────────────

    #[test]
    fn validate_a11y_passes_with_zero_headlines() {
        let c = card(vec![badge("header-b1")]);
        assert_eq!(c.validate_a11y(), Ok(()));
    }

    #[test]
    fn validate_a11y_passes_with_one_headline() {
        let c = card_split(
            vec![badge("header-b1")],
            vec![text("body-hl", TextRole::Headline, "ヘラクレス")],
        );
        assert_eq!(c.validate_a11y(), Ok(()));
    }

    #[test]
    fn validate_a11y_passes_with_non_headline_text_blocks() {
        // eyebrow / subhead / body 等の非 headline は何個あっても OK
        let c = card_split(
            vec![badge("header-b1")],
            vec![
                text("body-eb", TextRole::Eyebrow, "新着"),
                text("body-sh", TextRole::Subhead, "♂ 142mm"),
                text("body-cap", TextRole::Caption, "出品中"),
            ],
        );
        assert_eq!(c.validate_a11y(), Ok(()));
    }

    #[test]
    fn validate_a11y_fails_with_two_headlines_in_same_region() {
        let c = card(vec![
            text("h1", TextRole::Headline, "見出し A"),
            text("h2", TextRole::Headline, "見出し B"),
        ]);
        match c.validate_a11y() {
            Err(A11yViolation::MultipleHeadlines {
                template,
                count,
                keys,
            }) => {
                assert_eq!(template, "product_feature");
                assert_eq!(count, 2);
                assert_eq!(keys, vec!["h1".to_string(), "h2".to_string()]);
            }
            other => panic!("expected MultipleHeadlines, got {other:?}"),
        }
    }

    #[test]
    fn validate_a11y_fails_with_two_headlines_across_regions() {
        // 同 template 内であれば region をまたいでも 2 個目は reject
        let c = card_split(
            vec![text("hdr-h", TextRole::Headline, "ヘッダ見出し")],
            vec![text("body-h", TextRole::Headline, "本文見出し")],
        );
        match c.validate_a11y() {
            Err(A11yViolation::MultipleHeadlines { count, .. }) => assert_eq!(count, 2),
            other => panic!("expected MultipleHeadlines, got {other:?}"),
        }
    }

    #[test]
    fn validate_a11y_error_message_includes_template_and_keys() {
        let c = card(vec![
            text("h1", TextRole::Headline, "A"),
            text("h2", TextRole::Headline, "B"),
            text("h3", TextRole::Headline, "C"),
        ]);
        let err = c.validate_a11y().unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("product_feature"), "msg={msg}");
        assert!(msg.contains("\"h1\""), "msg should list keys: {msg}");
        assert!(msg.contains("\"h2\""), "msg should list keys: {msg}");
        assert!(msg.contains("\"h3\""), "msg should list keys: {msg}");
    }
}
