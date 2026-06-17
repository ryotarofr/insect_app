## 開発

開発手順をまとめた README。設計・アーキテクチャは [`docs/`](docs/) 配下を参照。


### Docker
```bash
docker compose up -d
docker compose down
```

### サーバ

```bash
cd server
cargo run         # 起動 (= 起動時に migration が自動で走る)
cargo test --lib  # テスト
cargo check --tests
```

### クライアント

```bash
cd client_solid
bun run dev
bun run typecheck
bun run test
bun run build
```

### 型の再生成（API / SDUI を変更したら必ず）

サーバの REST / SDUI スキーマを変更したら、クライアント側の型を再生成して commit する。CI で乖離を検出するので、忘れると落ちる。

```bash
cd client_solid
bun run gen:openapi  # /api/v1/* の REST 型
bun run gen:sdui     # SDUI ブロック / カードの型
```

### i18n キー検証

```bash
cd client_solid
bun run check:i18n
```
