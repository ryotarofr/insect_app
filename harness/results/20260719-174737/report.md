# ハーネス実行レポート(dry-run)

- 実行: 20260719-174737 / モデル: claude-sonnet-4-5 / temperature: 1.0 / gen-mode: auto
- **validate 通過率: 3/9 = 33%**(目標 90%)

- 条件-: 3/9 = 33%

## 失敗タクソノミ

- L1:unknown_field: 1件
- L1:unknown_variant: 1件
- L1:schema_gap_site_path: 1件
- L2:duplicate_key: 1件
- L2:multiple_headlines: 1件
- L2:limit_out_of_range: 1件

## 明細

| task | 条件 | 生成モード | 判定 | hydrate | tokens(in/out) |
|---|---|---|---|---|---|
| valid_minimal.json | - | fixture | ✔ pass | PUT 204 / GET 200 | -/- |
| valid_full.json | - | fixture | ✔ pass | PUT 204 / GET 200 | -/- |
| valid_context_required.json | - | fixture | ✔ pass | PUT 204 / GET 400 | -/- |
| l1_unknown_field.json | - | fixture | ✘ L1:unknown_field | - | -/- |
| l1_unknown_variant.json | - | fixture | ✘ L1:unknown_variant | - | -/- |
| l1_schema_gap_sitepath.json | - | fixture | ✘ L1:schema_gap_site_path | - | -/- |
| l2_duplicate_key.json | - | fixture | ✘ L2:duplicate_key | - | -/- |
| l2_two_headlines.json | - | fixture | ✘ L2:multiple_headlines | - | -/- |
| l2_limit_out_of_range.json | - | fixture | ✘ L2:limit_out_of_range | - | -/- |

生出力: raw/ 配下に task ごとに保存。
