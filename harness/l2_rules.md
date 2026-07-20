# 画面定義の追加ルール(L2 意味検証)

JSON Schema に表現されていない不変条件。違反すると検証(422)で拒否される。

- `schemaVersion` は必ず `1`
- key の一意性: **カードの key はページ全体で一意**。**ブロックの key は同じカード内で一意**
  (別のカードとなら同じブロック key を使ってよい)
- 見出し: `role: "headline"` の text ブロックは **カード1枚につき最大1個**
- `listing_grid` の `query.limit` は **1〜24**
- `markdown` の本文は **5000文字以内**
- カードは **1リージョンに最大10枚**、ブロックは **1カードに最大10個**
- `regions` は `header` / `body` / `footer` を**必ず全て書く**(空のリージョンは `[]`)
- `href` / `src` は**サイト内パスのみ**: `/` 始まり・`//` 始まりは不可・`..` を含まない・
  空白や制御文字を含まない・512文字以内(外部URLや `javascript:` は書けない)
- key の形式: 英小文字で始まり、英小文字・数字・`-`・`_` のみ(64文字以内)
- コンテキスト必須ブロック(`specimen_profile` / `care_log_list` / `species_note` /
  `listing_settings` / `listing_hero` / `listing_spec`)は、対応するコンテキストを持つ
  ページ(個体詳細・出品詳細)で使うこと
