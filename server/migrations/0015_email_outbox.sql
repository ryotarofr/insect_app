-- 0015_email_outbox.sql — email 送信ジョブの outbox テーブル (Week 2 / N2 メール通知)
--
-- **目的**:
--   apalis ジョブの境界として「メールを送るべき」事実を 1 行で永続化する。送信予定 / 送信中 /
--   送信成功 / 送信失敗 の状態を 1 表に集約し、worker から非同期に処理する。
--
-- **設計判断**:
--   - **outbox パターン**: HTTP handler の transaction 内で email を直接送ろうとすると、
--     外部 API 失敗 = transaction rollback = 業務データも巻き戻る、という連鎖が起こる。
--     handler は「送信する事実」を outbox に INSERT するだけにし、worker が後で送る。
--   - **kind は 列挙 (CHECK)**: `order_confirmation` / `password_reset` / `eclosion_reminder` を
--     現スコープで定義。新規 kind 追加は ALTER TABLE で CHECK を更新する破壊的 migration を切る。
--   - **template_args (JSONB)**: kind ごとに必要な値 (= order_id / token / specimen_id 等) を
--     JSON で保持。worker 側で kind に応じて parse して template にバインドする。
--     型は worker 側 enum (TemplateArgs) で表現し、JSON は contract として安定保つ。
--   - **status の値域**: pending / sending / sent / failed。
--     - pending: 受信直後 / retry 待ち
--     - sending: worker が処理中 (advisory lock 中)
--     - sent: 成功
--     - failed: retry 上限到達
--     apalis 側に同様の状態管理があるが、ここで持つことで「監査ログ + 再送 UI」を作りやすい。
--   - **retry_count + last_error**: 失敗時に worker が更新。dead-letter 監視は WHERE status='failed'。
--   - **scheduled_at**: 即時送信は now()。将来「予約送信」を入れる時の余地。
--   - **owner_user_id NULL 許容**: order_confirmation は user 紐付くが、password_reset_request は
--     「該当 email が users に居なくても 200 を返す」(= user enumeration 防止) ため、
--     NULL を許容する経路を作っておく (= dev 用にメールアドレス直送する debug).
--   - **冪等性キー (idempotency_key)**: kind ごとに「同じ事象で 2 回 enqueue しない」ための
--     UNIQUE 部分 index。例 order_confirmation なら `order:{order_id}` を入れる。Stripe retry 経由で
--     fulfill_paid_order が 2 回走っても、UNIQUE 衝突で同じ outbox 行が 1 件しか生まれない。
--
-- **依存**:
--   - 0004_users.sql (users テーブル)

CREATE TABLE email_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 送信種別。新規 kind は CHECK を更新する破壊的 migration で追加する。
    kind            TEXT NOT NULL CHECK (kind IN (
        'order_confirmation',
        'password_reset',
        'eclosion_reminder'
    )),
    -- メール宛先 (= 直送する email アドレス)。 users.email 変更後に追従する目的では使わない。
    to_email        TEXT NOT NULL CHECK (length(to_email) > 0 AND to_email LIKE '%@%'),
    -- 任意の補助フィールド。kind ごとに contract が決まる JSON。
    -- 例: order_confirmation → { "order_id": "<uuid>", "amount_jpy": 12345 }
    --     password_reset     → { "token": "<plain>", "user_name": "..." }
    template_args   JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 同じ事象で 2 回 enqueue しないための idempotency key (kind ごとに一意)。
    -- 例: order_confirmation なら "order:<order_id>"、password_reset なら "user:<user_id>:<request_at>"。
    idempotency_key TEXT,
    -- 送信状態 (FSM)。詳細は migration コメント冒頭参照。
    status          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    -- retry 上限を超えた回数。worker は失敗のたびに +1 する。
    retry_count     INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    -- 最後の失敗メッセージ (= ops の DLQ 監視用)。成功時は NULL に戻す。
    last_error      TEXT,
    -- 送信予定時刻。即時送信は now()。将来「指定時刻に送る」用に列を持たせておく。
    scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 実際の送信成功時刻 (= status='sent' に遷移した時点)。
    sent_at         TIMESTAMPTZ,
    -- 紐づく user (= 監査用)。匿名 password_reset_request 経路では NULL 可。
    owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- worker pickup 用 index (= scheduled 順 + status pending を効率的に引く)。
CREATE INDEX idx_email_outbox_pickup
    ON email_outbox (scheduled_at)
    WHERE status = 'pending';

-- 失敗監視用 (= ops が DLQ を確認する時)。
CREATE INDEX idx_email_outbox_failed
    ON email_outbox (created_at DESC)
    WHERE status = 'failed';

-- ユーザ別の送信履歴を引く (= マイページ「送ったメール一覧」等の将来要件)。
CREATE INDEX idx_email_outbox_owner
    ON email_outbox (owner_user_id, created_at DESC)
    WHERE owner_user_id IS NOT NULL;

-- idempotency_key の UNIQUE は「同じ kind の中で一意」にする (= kind 跨ぎは別事象として許す)。
-- key は handler が組み立てる (= "order:<uuid>" のような prefix 付き) ので、kind 跨ぎ衝突は実務上起きない。
CREATE UNIQUE INDEX uq_email_outbox_idempotency
    ON email_outbox (kind, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER trg_email_outbox_updated
    BEFORE UPDATE ON email_outbox
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
