//! `/api/v1/events` — SDUI Analytics ingest (Phase 3)。
//!
//! クライアントの `client_solid/src/sdui/analytics.ts` が定期的に batch で
//! POST してくる Analytics イベントを、プロセス内 ring buffer に積む。
//!
//! **設計方針 (MVP)**:
//!   - 永続化なし。`Mutex<VecDeque<AnalyticsEvent>>` を OnceLock で保持。
//!   - 容量は 1000 件 (RING_CAP)。溢れたら最古から落とす。
//!   - 集計や可視化は Phase 4 以降。今は debug 用に GET で生データを返すだけ。
//!   - batch 内に 1 件でも無効 (analyticsId 空) があれば 400 で全件リジェクト
//!     (部分受理は debug を難しくするので避ける)。
//!
//! **将来 (Phase 4+)**:
//!   - SQLite/Postgres 永続化
//!   - 集計テーブル (analyticsId × eventType × hour)
//!   - 認証付きの GET (現状は debug 用に open)

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use axum::{Json, extract::Query, http::StatusCode};
use serde::Deserialize;

use crate::error::AppError;
use crate::sdui::analytics::{AnalyticsEvent, AnalyticsEventBatch};

/// ring buffer 容量。1000 件 = MVP では十分 (1 ユーザの数十分の操作量)。
const RING_CAP: usize = 1000;

fn buffer() -> &'static Mutex<VecDeque<AnalyticsEvent>> {
    static B: OnceLock<Mutex<VecDeque<AnalyticsEvent>>> = OnceLock::new();
    B.get_or_init(|| Mutex::new(VecDeque::with_capacity(RING_CAP)))
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/v1/events  — batch ingest
// ──────────────────────────────────────────────────────────────────────

/// `POST /api/v1/events` — batch でイベントを受け取る。
///
/// - 空 batch は 202 Accepted で no-op (sendBeacon の race 対策)。
/// - 1 件でも `analyticsId` が空なら 400 で **全件** リジェクト。
/// - 受理時は 202 Accepted (= 受け取ったが処理を保証しない、という意味で暗に
///   集計は別経路という設計を表現)。
pub async fn post_events(
    Json(req): Json<AnalyticsEventBatch>,
) -> Result<StatusCode, AppError> {
    if req.events.is_empty() {
        return Ok(StatusCode::ACCEPTED);
    }
    for ev in &req.events {
        if ev.analytics_id.is_empty() {
            return Err(AppError::BadRequest(
                "analyticsId is empty".to_string(),
            ));
        }
    }

    let mut buf = buffer().lock().expect("events buffer mutex poisoned");
    for ev in req.events {
        if buf.len() >= RING_CAP {
            buf.pop_front();
        }
        buf.push_back(ev);
    }
    Ok(StatusCode::ACCEPTED)
}

// ──────────────────────────────────────────────────────────────────────
// GET /api/v1/events  — debug 用 (新しい順)
// ──────────────────────────────────────────────────────────────────────

/// `GET /api/v1/events?limit=N` のクエリ。
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// 取得件数。`RING_CAP` を超える指定は `RING_CAP` に丸める。
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    100
}

/// `GET /api/v1/events?limit=N` — 直近 N 件 (新しい順) を返す debug エンドポイント。
///
/// 認証なし。本番では reverse proxy で塞ぐ想定。
pub async fn list_events(Query(q): Query<ListQuery>) -> Json<Vec<AnalyticsEvent>> {
    let cap = q.limit.min(RING_CAP);
    let buf = buffer().lock().expect("events buffer mutex poisoned");
    // 新しい順 = back から rev で取り出す
    let out: Vec<AnalyticsEvent> = buf.iter().rev().take(cap).cloned().collect();
    Json(out)
}

// ──────────────────────────────────────────────────────────────────────
// テスト
// ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
pub(crate) fn reset_events_for_test() {
    let mut buf = buffer().lock().expect("events buffer mutex poisoned");
    buf.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    use crate::sdui::analytics::{AnalyticsEvent, AnalyticsEventType};

    /// グローバル ring buffer を触るため逐次化する。
    static GUARD: StdMutex<()> = StdMutex::new(());

    fn ev(id: &str, ty: AnalyticsEventType, ts: i64) -> AnalyticsEvent {
        AnalyticsEvent {
            analytics_id: id.into(),
            event_type: ty,
            timestamp_ms: ts,
            context: Default::default(),
        }
    }

    #[tokio::test]
    async fn empty_batch_is_accepted() {
        let _g = GUARD.lock().unwrap();
        reset_events_for_test();
        let res = post_events(Json(AnalyticsEventBatch { events: vec![] }))
            .await
            .unwrap();
        assert_eq!(res, StatusCode::ACCEPTED);
        let list = list_events(Query(ListQuery { limit: 100 })).await.0;
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn single_event_round_trip() {
        let _g = GUARD.lock().unwrap();
        reset_events_for_test();
        post_events(Json(AnalyticsEventBatch {
            events: vec![ev("home.hero", AnalyticsEventType::Impression, 1_700_000_000_000)],
        }))
        .await
        .unwrap();
        let list = list_events(Query(ListQuery { limit: 10 })).await.0;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].analytics_id, "home.hero");
        assert!(matches!(list[0].event_type, AnalyticsEventType::Impression));
        assert_eq!(list[0].timestamp_ms, 1_700_000_000_000);
    }

    #[tokio::test]
    async fn list_returns_newest_first() {
        let _g = GUARD.lock().unwrap();
        reset_events_for_test();
        for i in 0..5 {
            post_events(Json(AnalyticsEventBatch {
                events: vec![ev(&format!("a{i}"), AnalyticsEventType::Click, i)],
            }))
            .await
            .unwrap();
        }
        let list = list_events(Query(ListQuery { limit: 10 })).await.0;
        assert_eq!(list.len(), 5);
        // 新しい順なので a4 → a3 → ... → a0
        assert_eq!(list[0].analytics_id, "a4");
        assert_eq!(list[4].analytics_id, "a0");
    }

    #[tokio::test]
    async fn list_limit_caps_returned_count() {
        let _g = GUARD.lock().unwrap();
        reset_events_for_test();
        for i in 0..5 {
            post_events(Json(AnalyticsEventBatch {
                events: vec![ev(&format!("a{i}"), AnalyticsEventType::Click, i)],
            }))
            .await
            .unwrap();
        }
        let list = list_events(Query(ListQuery { limit: 3 })).await.0;
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].analytics_id, "a4");
        assert_eq!(list[2].analytics_id, "a2");
    }

    #[tokio::test]
    async fn list_limit_capped_to_ring_cap() {
        let _g = GUARD.lock().unwrap();
        reset_events_for_test();
        // 1 件入れて、巨大な limit を指定 → RING_CAP に丸められて手元の 1 件だけ返る
        post_events(Json(AnalyticsEventBatch {
            events: vec![ev("only", AnalyticsEventType::Click, 1)],
        }))
        .await
        .unwrap();
        let list = list_events(Query(ListQuery {
            limit: usize::MAX,
        }))
        .await
        .0;
        assert_eq!(list.len(), 1);
    }

    #[tokio::test]
    async fn ring_buffer_drops_oldest_on_overflow() {
        let _g = GUARD.lock().unwrap();
        reset_events_for_test();

        // 1001 件入れる → e0 が落ちて、新しい順で e1000 → e1
        let events: Vec<_> = (0..=(RING_CAP as i64))
            .map(|i| ev(&format!("e{i}"), AnalyticsEventType::Click, i))
            .collect();
        post_events(Json(AnalyticsEventBatch { events }))
            .await
            .unwrap();

        let list = list_events(Query(ListQuery {
            limit: RING_CAP + 10,
        }))
        .await
        .0;
        assert_eq!(list.len(), RING_CAP);
        assert_eq!(list[0].analytics_id, format!("e{}", RING_CAP)); // 最新 = e1000
        assert_eq!(list[RING_CAP - 1].analytics_id, "e1"); // e0 が落ちたので最古は e1
    }

    #[tokio::test]
    async fn empty_analytics_id_rejects_whole_batch() {
        let _g = GUARD.lock().unwrap();
        reset_events_for_test();

        // 1 件目は OK だが 2 件目が空 → 全件リジェクトされて buffer は空のまま
        let res = post_events(Json(AnalyticsEventBatch {
            events: vec![
                ev("ok", AnalyticsEventType::Click, 1),
                ev("", AnalyticsEventType::Impression, 2),
            ],
        }))
        .await;
        match res {
            Err(AppError::BadRequest(msg)) => {
                assert!(msg.contains("analyticsId"), "msg={msg}");
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
        let list = list_events(Query(ListQuery { limit: 10 })).await.0;
        assert!(list.is_empty(), "no event should be persisted on rejection");
    }

    #[tokio::test]
    async fn batch_with_context_preserves_context() {
        let _g = GUARD.lock().unwrap();
        reset_events_for_test();

        let mut e = ev("p.detail.cta", AnalyticsEventType::Click, 1);
        e.context.insert("productId".to_string(), "p-x".to_string());
        e.context.insert("variant".to_string(), "featured".to_string());
        post_events(Json(AnalyticsEventBatch { events: vec![e] }))
            .await
            .unwrap();

        let list = list_events(Query(ListQuery { limit: 1 })).await.0;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].context.get("productId").map(String::as_str), Some("p-x"));
        assert_eq!(list[0].context.get("variant").map(String::as_str), Some("featured"));
    }
}
