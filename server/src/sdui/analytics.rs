//! SDUI Analytics 計装の型定義 (Phase 3)。
//!
//! 詳細: docs/sdui-three-layer-model-v5.md §16 (Analytics 契約)
//!
//! クライアントは各 Block の `analyticsId` を観測し、`impression` (画面に映った)
//! と `click` (ユーザが触った) を区別したイベントを batch で送る。サーバ側は
//! 受け取った payload を validate し、in-memory ring buffer に積むだけ。
//! 集計や可視化は別経路 (Phase 4 以降) に分離する。
//!
//! **設計上の不変条件**:
//!   - `analyticsId` は空不可。空が来たら 400 で全件リジェクト (batch 単位)。
//!   - `eventType` は `impression` / `click` のみ。サーバが新種を黙って受け
//!     入れると、後段集計でゴミが混じるため snake_case enum で固定する。
//!   - `context` は free-form `Map<String, String>`。productId / variant /
//!     experimentKey/bucket 等を入れる想定だが、キー集合は validate しない
//!     (拡張に対して open / 古いクライアントの互換性を壊さないため)。

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 1 件の Analytics イベント。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalyticsEvent {
    /// 対象 Block / Card の analyticsId。空文字は不可。
    pub analytics_id: String,
    /// `impression` (画面に映った) / `click` (ユーザ操作)。
    pub event_type: AnalyticsEventType,
    /// クライアント側 Date.now 相当 (ms epoch)。サーバは値を validate しない。
    /// 設計書 §4.2.2 規約により i64 を ts-rs で number に倒す。
    /// 集計の真実値は server 受信時刻側で持つ想定 (§11.2)。
    #[ts(type = "number")]
    pub timestamp_ms: i64,
    /// 自由記述コンテキスト (productId / variant / experimentKey 等)。
    /// 空 / 未指定は JSON で省略される (skip_serializing_if)。
    /// TS 側は ts(optional) で context?: Record<string, string> として表現する。
    /// client は context があれば Some、無ければ None で送る。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub context: Option<BTreeMap<String, String>>,
}

/// イベント種別。
///
/// `impression` と `click` のみ。snake_case enum で固定する (camelCase でも文字列
/// 一致するが、将来の `dwell_time` 等が来た時に明確に snake_case で受ける意図)。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AnalyticsEventType {
    Impression,
    Click,
}

/// `POST /api/v1/events` で送られる batch payload。
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalyticsEventBatch {
    pub events: Vec<AnalyticsEvent>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_serializes_camel_case() {
        let mut ctx = BTreeMap::new();
        ctx.insert("variant".to_string(), "featured".to_string());
        let e = AnalyticsEvent {
            analytics_id: "home.hero".to_string(),
            event_type: AnalyticsEventType::Click,
            timestamp_ms: 1_700_000_000_000,
            context: Some(ctx),
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains(r#""analyticsId":"home.hero""#), "{json}");
        assert!(json.contains(r#""eventType":"click""#), "{json}");
        assert!(json.contains(r#""timestampMs":1700000000000"#), "{json}");
        assert!(json.contains(r#""variant":"featured""#), "{json}");
    }

    #[test]
    fn empty_context_is_omitted() {
        let e = AnalyticsEvent {
            analytics_id: "x".to_string(),
            event_type: AnalyticsEventType::Impression,
            timestamp_ms: 0,
            context: None,
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(
            !json.contains("context"),
            "empty context should be omitted: {json}"
        );
    }

    #[test]
    fn event_type_round_trips() {
        let json = r#"{"analyticsId":"a","eventType":"impression","timestampMs":1}"#;
        let e: AnalyticsEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(e.event_type, AnalyticsEventType::Impression));
        let json = r#"{"analyticsId":"a","eventType":"click","timestampMs":1}"#;
        let e: AnalyticsEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(e.event_type, AnalyticsEventType::Click));
    }

    #[test]
    fn unknown_event_type_is_rejected() {
        let json = r#"{"analyticsId":"a","eventType":"hover","timestampMs":1}"#;
        let res = serde_json::from_str::<AnalyticsEvent>(json);
        assert!(res.is_err(), "unknown eventType should not deserialize");
    }

    #[test]
    fn batch_with_empty_events_round_trips() {
        let b = AnalyticsEventBatch { events: vec![] };
        let json = serde_json::to_string(&b).unwrap();
        assert_eq!(json, r#"{"events":[]}"#);
    }
}
