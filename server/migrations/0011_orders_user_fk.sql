-- 0011_orders_user_fk.sql — orders.user_id を users(id) FK に追加
--
-- **目的**:
--   注文と user の紐付けを `session_id` 経由 (= TEXT 文字列) ではなく直接の FK で表現し、
--   `/api/v1/orders/me` のような「自分の注文一覧」を 1 回の SELECT で引けるようにする。
--   匿名注文 (= 未ログイン) は NULL で許容し、後から user に紐付け直す UPDATE 経路 (=
--   "guest checkout に後でアカウント紐付け") の余地も残す。
--
-- **設計判断**:
--   - NOT NULL にしない (= 既存行 / 匿名注文 / 後付け移行を全て許容)
--   - ON DELETE SET NULL (= ユーザ削除でも注文履歴は残し、user 列だけ NULL に)
--   - email 経由ではなく UUID 直接 (= rename / merge に強い)

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS user_id UUID;

-- 既存 session 経由で user_id が取れる行は backfill (= 現状 dev では該当なしの想定)。
-- session_id 列は TEXT なので UUID として parse できる場合のみ join する。
UPDATE orders o
   SET user_id = us.user_id
  FROM user_sessions us
 WHERE o.user_id IS NULL
   AND us.user_id IS NOT NULL
   AND o.session_id::uuid = us.id;

-- FK 制約 + index を追加
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user_id
    ON orders (user_id, created_at DESC) WHERE user_id IS NOT NULL;
