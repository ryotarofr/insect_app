//! 羽化予測 daily job
//!
//! **責務**:
//!   - 毎日 03:00 JST に全 active specimen を scan し、`eclosion_eta` が **7 日以内** の
//!     個体について `eclosion_reminder` を email_outbox に enqueue する
//!   - idempotency_key=`eclosion:{specimen_id}:{eta_iso}` で同 (specimen, eta) の重複を排除
//!     (= 同じ眼鏡 7 日窓を翌日 / 翌々日も走らせて UNIQUE で絞る冪等設計)
//!
//! **設計判断**:
//!   - apalis-cron / tokio-cron-scheduler は使わず、`tokio::time::sleep` + 自前の
//!     `next_03_jst()` で十分 (= 1 日 1 回のシンプル cron)
//!   - **JST 固定**: 利用者は当面国内のみ。多国展開時に user.timezone から計算する
//!   - eclosion_eta の自動計算は **handler 側 (= create_specimen)** が責務。ここでは
//!     既にセットされている eta を読むだけで、再計算はしない (= AI3 でモデル化する時に
//!     別 worker で再計算する設計余地)
//!
//! **失敗時**:
//!   - 1 specimen あたりの enqueue 失敗は warn ログだけ残して次へ進む
//!   - tick 全体が落ちても run() のループは継続 (= 翌日に再走できる)

use std::time::Duration;

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use sqlx::PgPool;

use crate::repos::{email_outbox, specimens, users};

/// 7 日前リマインダの window (= eclosion_eta が `(today, today + WINDOW_DAYS]` の specimen が対象)。
pub const WINDOW_DAYS: i64 = 7;

/// 03:00 JST に対応する UTC 時刻 = 18:00 UTC (前日)。
const FIRE_HOUR_UTC: u32 = 18;

/// daily job のメインループ。`KOCHU_WORKER_ENABLE=true` 時のみ spawn される。
pub async fn run(pool: Option<PgPool>) {
    tracing::info!("eclosion_daily worker started (fires at 03:00 JST = 18:00 UTC)");
    loop {
        let now = Utc::now();
        let next = next_fire_time(now);
        let wait = next.signed_duration_since(now);
        let wait_std = wait.to_std().unwrap_or(Duration::from_secs(60));
        tracing::info!(
            sleep_secs = wait_std.as_secs(),
            next_fire = %next,
            "eclosion_daily sleeping until next fire"
        );
        tokio::time::sleep(wait_std).await;

        if let Err(e) = tick(pool.as_ref(), today_jst()).await {
            tracing::error!("eclosion_daily tick failed: {e}");
        }
    }
}

/// `now` から見た「次の 03:00 JST」(= 18:00 UTC) の時刻を返す。
///
/// **境界**: 既に 03:00 JST を過ぎていれば翌日 03:00 JST へ送る。
fn next_fire_time(now: DateTime<Utc>) -> DateTime<Utc> {
    // 今日の 18:00 UTC = 当日 03:00 JST (翌日)
    let today_fire = Utc
        .with_ymd_and_hms(
            now.date_naive().year(),
            now.date_naive().month(),
            now.date_naive().day(),
            FIRE_HOUR_UTC,
            0,
            0,
        )
        .single()
        .unwrap_or(now);
    if today_fire > now {
        today_fire
    } else {
        today_fire + chrono::Duration::days(1)
    }
}

/// JST の今日 (= UTC + 9h) の `NaiveDate` を返す。
fn today_jst() -> NaiveDate {
    let jst_offset = chrono::FixedOffset::east_opt(9 * 3600).expect("valid JST offset");
    Utc::now().with_timezone(&jst_offset).date_naive()
}

/// 1 サイクル分の処理。test から直接呼び出して 1 batch だけ流せるように分離。
/// `today_jst` は test 用に注入できるようにパラメータ化。
pub async fn tick(
    pool: Option<&PgPool>,
    today: NaiveDate,
) -> Result<usize, TickError> {
    let candidates = specimens::list_with_upcoming_eclosion(pool, today, WINDOW_DAYS)
        .await
        .map_err(|e| TickError::Repo(format!("list_with_upcoming_eclosion: {e}")))?;

    let mut enqueued = 0_usize;
    for s in candidates {
        let Some(eta) = s.eclosion_eta else { continue };
        // owner email を取得 (= NULL の user はスキップ)
        let user = match users::find_by_id(pool, s.owner_user_id).await {
            Ok(Some(u)) => u,
            Ok(None) => {
                tracing::warn!(
                    "eclosion_daily: user {} not found (specimen={}); skipping",
                    s.owner_user_id,
                    s.id
                );
                continue;
            }
            Err(e) => {
                tracing::warn!(
                    "eclosion_daily: user lookup failed for {}: {e}; skipping",
                    s.owner_user_id
                );
                continue;
            }
        };
        let Some(to_email) = user.email else {
            tracing::debug!(
                "eclosion_daily: user {} has NULL email (specimen={}); skipping reminder",
                s.owner_user_id,
                s.id
            );
            continue;
        };

        let payload = email_outbox::OutboxEnqueue {
            kind: "eclosion_reminder".to_string(),
            to_email,
            template_args: serde_json::json!({
                "specimen_name": s.name,
                "eclosion_eta": eta.format("%Y-%m-%d").to_string(),
            }),
            // 同じ specimen + eta では複数日 enqueue しても UNIQUE で 1 行に潰れる
            idempotency_key: Some(format!(
                "eclosion:{}:{}",
                s.id,
                eta.format("%Y-%m-%d")
            )),
            owner_user_id: Some(s.owner_user_id),
        };

        match email_outbox::enqueue(pool, payload).await {
            Ok(_) => {
                enqueued += 1;
                tracing::debug!(
                    "eclosion_daily: enqueued reminder for specimen {} (eta={})",
                    s.id,
                    eta
                );
            }
            Err(e) => {
                tracing::warn!(
                    "eclosion_daily: enqueue failed for specimen {}: {e}",
                    s.id
                );
            }
        }
    }

    tracing::info!(
        enqueued = enqueued,
        "eclosion_daily tick completed"
    );
    Ok(enqueued)
}

#[derive(Debug, thiserror::Error)]
pub enum TickError {
    #[error("repo error: {0}")]
    Repo(String),
}

// chrono::Datelike を使うため
use chrono::Datelike;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::email_outbox::{self, OutboxEnqueue};

    // FIRE_HOUR_UTC = 18 (= 03:00 JST 翌日)。
    // now < 18:00 UTC: 同日の 18:00 UTC が次の fire / now >= 18:00 UTC: 翌日の 18:00 UTC。

    #[test]
    fn next_fire_time_returns_today_18utc_when_before() {
        // UTC 09:00 < 18:00 → 同日 18:00 UTC が次
        let now = Utc.with_ymd_and_hms(2026, 5, 1, 9, 0, 0).unwrap();
        assert_eq!(
            next_fire_time(now),
            Utc.with_ymd_and_hms(2026, 5, 1, 18, 0, 0).unwrap()
        );
    }

    #[test]
    fn next_fire_time_returns_tomorrow_when_at_or_after_fire() {
        // UTC 18:00 ちょうど → 同日 18:00 と等しいので「過ぎてる」扱い、翌日へ
        let now = Utc.with_ymd_and_hms(2026, 5, 1, 18, 0, 0).unwrap();
        assert_eq!(
            next_fire_time(now),
            Utc.with_ymd_and_hms(2026, 5, 2, 18, 0, 0).unwrap()
        );

        // UTC 19:00 → 翌日 18:00 UTC
        let now = Utc.with_ymd_and_hms(2026, 5, 1, 19, 0, 0).unwrap();
        assert_eq!(
            next_fire_time(now),
            Utc.with_ymd_and_hms(2026, 5, 2, 18, 0, 0).unwrap()
        );
    }

    #[test]
    fn next_fire_time_returns_today_18utc_until_just_before() {
        // UTC 17:59:59 → まだ 18:00 過ぎてないので同日 18:00 UTC
        let now = Utc.with_ymd_and_hms(2026, 5, 1, 17, 59, 59).unwrap();
        assert_eq!(
            next_fire_time(now),
            Utc.with_ymd_and_hms(2026, 5, 1, 18, 0, 0).unwrap()
        );
    }

    #[tokio::test]
    async fn tick_with_no_candidates_returns_zero() {
        let _g = email_outbox::memory_guard();
        email_outbox::reset_memory_for_test();
        let today = NaiveDate::from_ymd_opt(2026, 5, 1).unwrap();
        let n = tick(None, today).await.unwrap();
        assert_eq!(n, 0);
    }

    #[tokio::test]
    async fn tick_idempotent_repeated_calls() {
        // 注: in-memory specimens を使って候補を作る統合テストは specimens.rs の
        // memory_store にも書き込みが要るためフルセットアップが大きい。
        // ここでは「再実行しても新規 enqueue ゼロ」(= idempotency_key 経路) の挙動だけを
        // outbox 経由で確認する。
        let _g = email_outbox::memory_guard();
        email_outbox::reset_memory_for_test();

        let payload = || OutboxEnqueue {
            kind: "eclosion_reminder".to_string(),
            to_email: "alice@example.com".to_string(),
            template_args: serde_json::json!({}),
            idempotency_key: Some("eclosion:abc:2026-05-08".to_string()),
            owner_user_id: None,
        };
        let id1 = email_outbox::enqueue(None, payload()).await.unwrap();
        let id2 = email_outbox::enqueue(None, payload()).await.unwrap();
        assert_eq!(id1, id2, "同 (specimen, eta) で 2 回呼んでも 1 行のまま");
    }
}
