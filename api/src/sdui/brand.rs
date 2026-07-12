//! ブランド型 — ワイヤ上(deserialize時)で必ず検証される文字列型。
//!
//! insect_app 本体の `Experiment`(try_from 中間表現)パターンの一般化。
//! `#[serde(transparent)]` は使わない(検証がバイパスされるため)。
//!
//! JSON Schema は手実装し、serde の受理集合と同じ pattern を載せる
//! (LLM structured outputs が見る Schema と実際の検証を一致させるため)。

use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BrandError {
    #[error("invalid block key (expected ^[a-z][a-z0-9_-]{{0,63}}$): {0:?}")]
    InvalidBlockKey(String),
    #[error("invalid site path (internal '/' path, no '..', max 512 chars): {0:?}")]
    InvalidSitePath(String),
}

// ──────────────────────────────────────────────────────────────
// BlockKey: ブロック / カードの識別子
// ──────────────────────────────────────────────────────────────

pub const BLOCK_KEY_PATTERN: &str = "^[a-z][a-z0-9_-]{0,63}$";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(try_from = "String")]
pub struct BlockKey(String);

impl BlockKey {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn is_valid(s: &str) -> bool {
        if s.len() > 64 {
            return false;
        }
        let mut chars = s.chars();
        match chars.next() {
            Some(c) if c.is_ascii_lowercase() => {}
            _ => return false,
        }
        chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    }
}

impl TryFrom<String> for BlockKey {
    type Error = BrandError;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        if Self::is_valid(&s) {
            Ok(Self(s))
        } else {
            Err(BrandError::InvalidBlockKey(s))
        }
    }
}

impl JsonSchema for BlockKey {
    fn schema_name() -> Cow<'static, str> {
        "BlockKey".into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "string", "pattern": BLOCK_KEY_PATTERN })
    }
}

// ──────────────────────────────────────────────────────────────
// SitePath: サイト内部パス('/'始まりのみ。外部URL・スキームは語彙ごと排除)
// ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(try_from = "String")]
pub struct SitePath(String);

impl SitePath {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn is_valid(s: &str) -> bool {
        s.starts_with('/')
            && !s.starts_with("//")
            && s.len() <= 512
            && !s.contains("..")
            && s.chars()
                .all(|c| !c.is_control() && !c.is_whitespace() && c != '\\')
    }
}

impl TryFrom<String> for SitePath {
    type Error = BrandError;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        if Self::is_valid(&s) {
            Ok(Self(s))
        } else {
            Err(BrandError::InvalidSitePath(s))
        }
    }
}

impl JsonSchema for SitePath {
    fn schema_name() -> Cow<'static, str> {
        "SitePath".into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        // pattern では「'//'不可・'..'不可」まで表現しない(Schemaは僅かに緩い)。
        // その差分は serde 側(try_from)が必ず拒否する = 計測上は validate 失敗として現れる。
        json_schema!({ "type": "string", "pattern": "^/", "maxLength": 512 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_key_accepts_valid() {
        for ok in ["a", "hero-title", "na_grid2", "k"] {
            assert!(BlockKey::try_from(ok.to_string()).is_ok(), "{ok}");
        }
    }

    #[test]
    fn block_key_rejects_invalid() {
        for ng in [
            "",
            "A",
            "1abc",
            "日本語",
            "has space",
            "-lead",
            &"x".repeat(65),
        ] {
            assert!(BlockKey::try_from(ng.to_string()).is_err(), "{ng}");
        }
    }

    #[test]
    fn site_path_accepts_internal_paths() {
        for ok in ["/", "/listings", "/listings?sort=newest", "/assets/abc.png"] {
            assert!(SitePath::try_from(ok.to_string()).is_ok(), "{ok}");
        }
    }

    #[test]
    fn site_path_rejects_external_and_dangerous() {
        for ng in [
            "",
            "https://evil.example.com",
            "javascript:alert(1)",
            "//evil.example.com",
            "/a/../../etc/passwd",
            "/has space",
        ] {
            assert!(SitePath::try_from(ng.to_string()).is_err(), "{ng}");
        }
    }

    #[test]
    fn brand_validation_runs_on_deserialize() {
        // transparent ではなく try_from 経由であること(= ワイヤ上の検証)の確認
        let err = serde_json::from_str::<SitePath>(r#""https://evil.example.com""#);
        assert!(err.is_err());
        let ok = serde_json::from_str::<SitePath>(r#""/listings""#);
        assert!(ok.is_ok());
    }
}
