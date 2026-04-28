//! `Experiment` — A/B テストの key/bucket をバリデーション付きで保持する。
//!
//! - `key`    : `^[a-z][a-z0-9_]*$` (snake_case)
//! - `bucket` : `^[A-Za-z0-9_-]+$`  (alphanumeric / `_` / `-`)
//!
//! JSON 経由 (`serde::Deserialize`) でも `Experiment::new` 経由でも、
//! 同じ正規表現で弾く。
//!
//! `CardBlock.variant` (マーチャンダイジング) とは独立した概念。
//! 詳細は `docs/sdui-three-layer-model-v6.md` §4.4 / §11.3 を参照。

use once_cell::sync::Lazy;
use regex::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

static KEY_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-z][a-z0-9_]*$").unwrap());
static BUCKET_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9_-]+$").unwrap());

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ExperimentError {
    #[error("invalid experiment key (snake_case required): {0}")]
    InvalidKey(String),
    #[error("invalid experiment bucket (alphanumeric / _ / - only): {0}")]
    InvalidBucket(String),
}

/// JSON deserialize 用の中間表現。`try_from` で `Experiment` に昇格させる。
#[derive(Deserialize)]
struct ExperimentRaw {
    key: String,
    bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(try_from = "ExperimentRaw")]
#[ts(export)]
pub struct Experiment {
    /// 実験のキー (snake_case)。例: `"hero_cta_2026q2"`
    pub key: String,
    /// A/B バケット。例: `"A"` / `"B"` / `"control"`。
    /// `CardBlock.variant` (マーチャンダイジング) とは独立。
    pub bucket: String,
}

impl Experiment {
    /// バリデーション付きコンストラクタ。
    pub fn new(key: impl Into<String>, bucket: impl Into<String>) -> Result<Self, ExperimentError> {
        let key = key.into();
        let bucket = bucket.into();
        if !KEY_RE.is_match(&key) {
            return Err(ExperimentError::InvalidKey(key));
        }
        if !BUCKET_RE.is_match(&bucket) {
            return Err(ExperimentError::InvalidBucket(bucket));
        }
        Ok(Self { key, bucket })
    }
}

impl TryFrom<ExperimentRaw> for Experiment {
    type Error = ExperimentError;
    fn try_from(r: ExperimentRaw) -> Result<Self, Self::Error> {
        Experiment::new(r.key, r.bucket)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_experiment_can_be_constructed() {
        let exp = Experiment::new("hero_cta_2026q2", "B").unwrap();
        assert_eq!(exp.key, "hero_cta_2026q2");
        assert_eq!(exp.bucket, "B");
    }

    #[test]
    fn rejects_uppercase_key() {
        let err = Experiment::new("HeroCta", "A").unwrap_err();
        assert!(matches!(err, ExperimentError::InvalidKey(_)));
    }

    #[test]
    fn rejects_key_starting_with_digit() {
        let err = Experiment::new("2026_hero", "A").unwrap_err();
        assert!(matches!(err, ExperimentError::InvalidKey(_)));
    }

    #[test]
    fn rejects_bucket_with_space() {
        let err = Experiment::new("hero_cta", " B ").unwrap_err();
        assert!(matches!(err, ExperimentError::InvalidBucket(_)));
    }

    #[test]
    fn allows_bucket_with_dash_and_underscore() {
        Experiment::new("hero_cta", "control_v2").unwrap();
        Experiment::new("hero_cta", "v-2").unwrap();
    }

    #[test]
    fn deserialize_invalid_bucket_fails() {
        let json = r#"{"key":"hero_cta","bucket":" B "}"#;
        let result: Result<Experiment, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "deserialize should fail for invalid bucket"
        );
    }

    #[test]
    fn deserialize_valid_roundtrip() {
        let exp = Experiment::new("hero_cta_2026q2", "B").unwrap();
        let json = serde_json::to_string(&exp).unwrap();
        let parsed: Experiment = serde_json::from_str(&json).unwrap();
        assert_eq!(exp, parsed);
    }
}
