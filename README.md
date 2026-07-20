# insect_app (step 2.0)

昆虫EC + 飼育管理アプリ

## 必要なもの

- Docker
- Rust(stable)
- Node.js 22+ / bun

## 起動手順

```powershell
# 1) DB(Postgres)
docker compose up -d

# 2) API — migration と seed は起動時に自動適用される
cd api
cargo run                  # http://127.0.0.1:3001

# 3) Web(別ターミナルで)
cd web
bun i               # 初回のみ
bun dev                   # http://localhost:3000
```

ブラウザで http://localhost:3000 を開き、右上の「ログイン」→ 新規登録タブでアカウントを作成する。

## migration ファイルを追加したとき

キャッシュ消してから再起動する

```bash
cargo clean -p api
cargo run
```

## 画面定義の運用実績を見る

```powershell
Get-Content scripts/definition_ops_report.sql | docker compose exec -T db psql -U postgres -d insect_r2
```

誰が(seed / migration / api:ユーザ)いつ定義を更新したかが出る。
Phase 4(フォーム語彙化)の着手判断に使う(docs/PLAN.md「Phase 4 の着手条件」参照)。
