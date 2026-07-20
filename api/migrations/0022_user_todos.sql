-- 個人TODO(todo_list ブロックのドメインデータ)。定義は配置のみ、中身はユーザ毎。

CREATE TABLE user_todos (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       text NOT NULL,
    done       boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    done_at    timestamptz
);

CREATE INDEX user_todos_owner ON user_todos (owner_id, done, created_at);
