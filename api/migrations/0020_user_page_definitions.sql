-- ユーザ毎ページ定義(copy-on-write)。care のパーソナライズ用(docs/CARD_BUILDER.md §1)。
-- GET はユーザ行 → 共有(page_definitions)の順で解決する。
-- PUT /api/pages/{key}/mine が upsert(初回書込 = その時点の共有定義を土台にしたコピー)。
-- DELETE /api/pages/{key}/mine で行を消す = 「共有の最新に戻す」リセット。

CREATE TABLE user_page_definitions (
    owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_key   text NOT NULL,
    definition jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, page_key)
);
