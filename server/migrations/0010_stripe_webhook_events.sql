-- 0010_stripe_webhook_events.sql — webhook 受信履歴 + event_id 冪等性 (Phase 9.1 hardening)
--
-- **目的**:
--   Stripe は応答遅延 / 5xx 等で同じ event を retry する。同じ `evt_xxx` を 2 度処理すると
--   注文 status が誤って巻き戻ったり PaymentIntent を二重に書く事故が起こる。本テーブルで
--   受信済み event_id を物理キーで握り、`INSERT ... ON CONFLICT DO NOTHING RETURNING id`
--   が `None` を返したら handler は 200 で no-op にする。
--
-- **設計判断**:
--   - PRIMARY KEY = Stripe の event_id (= "evt_xxx" や mock の "evt_test_xxx")。TEXT で
--     UUID とは別物 (= Stripe 由来の opaque ID)。
--   - `event_type` / `received_at` は監査用。`payload_json` は将来 replay / debug 用に raw を
--     残しておく (= JSONB)。
--   - GC: 90 日以上前の行はバッチで物理削除する想定 (= retry window が現実的に短いため)。
--     本 migration では index だけ用意し、cron は ops 側で追加する。

CREATE TABLE stripe_webhook_events (
    -- Stripe の event id ("evt_xxx") を PRIMARY KEY にすることで、INSERT ON CONFLICT で
    -- 自然に冪等性が成立する。別の UUID 列を持つ必要はない。
    id              TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,                      -- "checkout.session.completed" 等
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- raw body を JSONB で保持 (= replay / debug 用)。MVP は parse 済 fields は別 column
    -- にせず JSONB 1 列だけにする方針。
    payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- GC バッチが `WHERE received_at < now() - interval '90 days'` で削除しやすいよう
-- received_at に index を貼っておく。
CREATE INDEX idx_stripe_webhook_events_received_at
    ON stripe_webhook_events (received_at DESC);
