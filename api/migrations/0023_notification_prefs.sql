-- アプリ内通知のユーザ設定(care_alerts ブロックのドメインデータ)。
-- しきい値等の設定値は定義(全ユーザ共有の配置)ではなくドメインデータに置く
-- (docs/CARD_BUILDER.md §4.2)。行が無いユーザは既定値(enabled=true, stale_days=7)扱い。

CREATE TABLE notification_prefs (
    owner_id   uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled    boolean NOT NULL DEFAULT true,
    stale_days integer NOT NULL DEFAULT 7 CHECK (stale_days BETWEEN 1 AND 365),
    updated_at timestamptz NOT NULL DEFAULT now()
);
