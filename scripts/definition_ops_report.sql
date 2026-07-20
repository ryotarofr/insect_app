-- 画面定義の運用実績レポート(Phase 4 着手判断の材料。docs/PLAN.md「Phase 4 の着手条件」参照)
--
-- 実行例:
--   docker compose exec -T db psql -U postgres -d insect_r2 -f - < scripts/definition_ops_report.sql
--   (または psql 接続後に \i scripts/definition_ops_report.sql)
--
-- updated_by の読み方:
--   seed          … 初期データのまま(運用なし)
--   migration:NNNN … コード付随の移行で更新
--   api:<email>   … PUT /api/pages/{key} 経由の運用(人間の編集UI・エージェント共通の経路。
--                    エージェントには専用アカウントを使わせてここで区別する)
--   api           … 旧形式(書き手記録の導入以前の PUT)

-- 1) ページ別の最終更新(誰が・いつ)
SELECT page_key, updated_by, updated_at
FROM page_definitions
ORDER BY updated_at DESC;

-- 2) 書き手種別の集計 — 「定義運用が実際に発生しているか」の一目判定
SELECT CASE
         WHEN updated_by LIKE 'migration:%' THEN 'migration'
         WHEN updated_by LIKE 'api:%' OR updated_by = 'api' THEN 'api(運用)'
         ELSE updated_by
       END AS writer,
       COUNT(*)        AS pages,
       MAX(updated_at) AS last_update
FROM page_definitions
GROUP BY 1
ORDER BY last_update DESC;

-- 3) ユーザ毎ページ(パーソナライズ / カードビルダー)の運用 — これも定義運用の実発生
SELECT u.email AS owner, upd.page_key, upd.updated_at
FROM user_page_definitions upd
JOIN users u ON u.id = upd.owner_id
ORDER BY upd.updated_at DESC;
