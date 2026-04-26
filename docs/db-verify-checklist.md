# DB 動作確認チェックリスト (Phase 9.A〜9.F sanity check)

> task #58 の deliverable。`docker compose` 上で 0001〜0007 の migration が cascade で通り、
> Rust server (axum) が PostgreSQL に対して INSERT / SELECT を実行し、
> Cookie 経由の session が `user_sessions` に永続化されることを実機で 1 度通す手順書。

---

## 0. 前提

- Docker Desktop / Rancher Desktop など docker compose v2 系が動くこと
- `cargo` が動く Rust 1.83+ 環境
- 5432 / 8081 ポートが空いていること

---

## 1. PostgreSQL コンテナを起動

```bash
cd <repo root>
docker compose up -d postgres
docker compose ps
# → kochu_postgres_dev が "Up (healthy)" になるまで待つ (= 5〜10 秒)
docker compose logs postgres | tail -20
# → "database system is ready to accept connections" が出ていれば OK
```

---

## 2. Server 起動 + 自動 migration

```bash
cd server
cp .env.example .env  # 既にあれば skip
cargo run
```

期待ログ:

```
INFO insect_app_server::db: connecting to postgres at localhost:5432/kochu_dev
INFO sqlx::query: SELECT ... migrations
INFO sqlx::query: applied migration 0001_initial
INFO sqlx::query: applied migration 0002_master_data
INFO sqlx::query: applied migration 0003_products
INFO sqlx::query: applied migration 0004_users
INFO sqlx::query: applied migration 0005_order_items_product_fk
INFO sqlx::query: applied migration 0006_cart_and_watches
INFO sqlx::query: applied migration 0007_specimens
INFO insect_app_server: warm_meta_cache OK (6 products)
INFO insect_app_server: listening on 0.0.0.0:3000
```

エラーが出る場合の対応:

| 症状                                              | 対応                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `relation "users" does not exist` で 0004 が失敗 | 0001〜0003 が先に適用されているか確認 (= migration 順序ずれ)     |
| `column "product_uuid" already exists` (0005)    | 既に部分適用されている → `docker compose down -v` で volume 削除 |
| connection refused                                | postgres が `Up (healthy)` か `docker compose ps` で確認         |

---

## 3. テーブル / seed 投入確認 (psql)

```bash
docker compose exec postgres psql -U kochu -d kochu_dev
```

```sql
-- マイグレーション履歴
SELECT version, description, success FROM _sqlx_migrations ORDER BY version;
-- → 0001 〜 0007 が success=true で並ぶ

-- マスタ系 seed
SELECT count(*) FROM species;             -- 5
SELECT count(*) FROM shops;               -- 1
SELECT count(*) FROM prefectures;         -- 47
SELECT count(*) FROM shipping_methods;    -- 2
SELECT count(*) FROM products;            -- 6
SELECT count(*) FROM users;               -- 1 (t_yamada)

-- 商品翻訳が cards.rs::ProductMeta と一致
SELECT public_id, t.title
  FROM products p JOIN product_translations t ON p.id = t.product_id
 WHERE t.locale = 'ja'
 ORDER BY public_id;
-- p-aki      アクタエオン WILD F1 ♂
-- p-cat-l    コーカサス幼虫 3齢 ♂ 52g
-- p-hh-m-142 ヘラクレスオオカブト ♂ 142mm
-- p-jelly    高栄養ゼリー 17g × 50個
-- p-mat      完熟発酵マット 10L
-- p-neo-m    ネプチューン ♂ 初令ペア

-- audit FK が 0004 で後付けされている
\d products
-- "fk_products_created_by"  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
-- "fk_products_updated_by"  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL

-- 0005 で order_items に product_uuid が追加されている
\d order_items
-- "product_uuid" uuid REFERENCES products(id) ON DELETE SET NULL
\q
```

---

## 4. API smoke (curl)

別ターミナルで `cargo run` を維持したまま:

```bash
# 4.1 商品一覧 (= cards.rs / DB から products / translations を読む経路)
curl -s -i http://localhost:3000/api/v1/cards/products | head -20
# → 200, Set-Cookie: kochu_session=<UUID>; Path=/; HttpOnly; SameSite=Lax
#   レスポンス JSON.cards に 6 件

# 4.2 cookie を保持して cart 投入
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt \
     -X POST http://localhost:3000/api/v1/cart \
     -H 'content-type: application/json' \
     -d '{"productId":"p-hh-m-142","qty":2}'
# → {"cartCount":2,"undoToken":"<UUID>"}

# 4.3 cart 反映確認
curl -s -b /tmp/cookies.txt http://localhost:3000/api/v1/cards/cart \
  | python -c "import sys,json; r=json.load(sys.stdin); print(r['regions']['items'][0]['title'], r['regions']['items'][0]['qty'])"
# → ヘラクレスオオカブト ♂ 142mm 2

# 4.4 配送先 + 配送方法 input
for f in addressName addressTel addressZip addressPref addressAddr; do
  curl -s -b /tmp/cookies.txt -X PATCH "http://localhost:3000/api/v1/checkout/shipping_field/$f" \
    -H 'content-type: application/json' \
    -d "{\"value\":\"テスト値\"}"
  echo
done

# 4.5 checkout submit (= mock provider / orders + order_items + shipping_addresses INSERT)
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/v1/checkout/submit
# → {"orderId":"<UUID>","sessionUrl":"/checkout/stripe/cs_mock_..."}

# 4.6 stripe mock webhook で paid 遷移
ORDER_ID=<上の orderId>
curl -s -X POST http://localhost:3000/api/v1/stripe/webhook \
  -H 'content-type: application/json' \
  -d "{\"type\":\"checkout.session.completed\",\"data\":{\"object\":{\"clientReferenceId\":\"$ORDER_ID\",\"paymentIntent\":\"pi_test\"}}}"
# → 200
```

---

## 5. DB 永続化確認 (psql)

```sql
-- session が user_sessions に書かれた
SELECT count(*), token_hash LIKE '$kochu$mvp$%' AS phc_shape
  FROM user_sessions GROUP BY token_hash LIKE '$kochu$mvp$%';
-- count > 0, phc_shape = true

-- 注文がある
SELECT id, session_id, status, amount_jpy, stripe_session_id FROM orders ORDER BY created_at DESC LIMIT 3;
-- → status='paid' (webhook 後)、session_id が UUID 文字列、amount_jpy が cart 合計

-- order_items.product_uuid が解決されている
SELECT product_id, product_uuid IS NULL AS uuid_null FROM order_items ORDER BY created_at DESC LIMIT 3;
-- → uuid_null = false (= post_checkout_submit で resolve できた)

-- shipping_addresses が紐付いている
SELECT a.address_name, a.shipping_method_id
  FROM shipping_addresses a JOIN orders o ON a.order_id = o.id
 ORDER BY o.created_at DESC LIMIT 1;

-- 注文確定後は cart_items が空になる (= post_checkout_submit の cart 消費ロジック)
SELECT count(*) FROM cart_items WHERE session_id::text = '<上で発行された session UUID>';
-- → 0
\q
```

---

## 6. クリーンアップ

```bash
# DB を残したまま停止 (= 次回再起動で続きから)
docker compose down

# DB データも削除 (= migration をやり直したい時)
docker compose down -v
```

---

## 7. 既知の落とし穴

- **migration 投入順**: ファイル名の数値順 (0001→...→0007) で sqlx::migrate! が走る。
  途中で migration ファイルを修正すると `migration 0003 was previously applied but has been modified`
  で起動失敗する。dev は `down -v` で volume 削除して redo。production は新 migration を切る。
- **CHECK 制約と NUMERIC**: stage_progress 等 `NUMERIC(3,2) CHECK 0..1` は scale=2 で四捨五入される。
  Rust 側で `0.999` を入れても DB は `1.00` になり CHECK は通る。表示精度の制限を意識。
- **session cookie**: 4.x で `-c` `-b` を両方付けないと cookie が継承されない (= 別 session として扱われる)。
- **timezone**: container は `Asia/Tokyo` だが `created_at` は TIMESTAMPTZ (= UTC 保存 / 表示時に変換)。

---

## 8. 既知の TODO (本検証で次に着手するもの)

- product_watches を匿名 session でも使える schema 拡張 (= cart_items 同様の owner 二択モデル)
- session token を Argon2 hash 化 (= 現状 `$kochu$mvp$<uuid>` プレースホルダ)
- stripe_webhook の HMAC 検証 (= 現状 scaffolding)
- listings / bids / listing_watches + `v_listings_with_counts` VIEW の投入 (= Phase 9.E 残り)
- `client_solid/src/data.ts` の APP_DATA / species を `/api/v1/...` fetch に置換
