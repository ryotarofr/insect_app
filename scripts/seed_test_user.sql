-- 「test」ユーザの飼育一覧にサンプルデータを投入するスクリプト。
--
-- 前提: 表示名 test(または email が test@…)のユーザが登録済みであること。
-- 実行(Windows/PowerShell): パイプは文字コードが壊れるため docker cp + psql -f を使うこと
--   docker cp scripts\seed_test_user.sql insect_r2_db:/tmp/seed.sql
--   docker exec insect_r2_db psql -U postgres -d insect_r2 -f /tmp/seed.sql
--
-- - 日付は実行日基準の相対値(いつ実行しても「それらしい」状態になる)
-- - 個体は再実行しても重複しない(ON CONFLICT DO NOTHING)。飼育記録は重複し得るので注意

DO $$
DECLARE
    uid     uuid;
    g_egg   uuid;
    g_larva uuid;
    g_pupa  uuid;
    g_adult uuid;
BEGIN
    SELECT id INTO uid FROM users
    WHERE display_name = 'test' OR email LIKE 'test@%'
    ORDER BY created_at LIMIT 1;
    IF uid IS NULL THEN
        RAISE EXCEPTION 'ユーザ "test" が見つかりません。先に /login の新規登録で表示名 test のユーザを作成してください。';
    END IF;

    -- デフォルトタブを取得(無ければ作成)
    SELECT id INTO g_egg   FROM specimen_groups WHERE owner_id = uid AND label = '卵';
    IF g_egg IS NULL THEN
        INSERT INTO specimen_groups (owner_id, label, sort_order) VALUES (uid, '卵', 1) RETURNING id INTO g_egg;
    END IF;
    SELECT id INTO g_larva FROM specimen_groups WHERE owner_id = uid AND label = '幼虫';
    IF g_larva IS NULL THEN
        INSERT INTO specimen_groups (owner_id, label, sort_order) VALUES (uid, '幼虫', 2) RETURNING id INTO g_larva;
    END IF;
    SELECT id INTO g_pupa  FROM specimen_groups WHERE owner_id = uid AND label = '蛹';
    IF g_pupa IS NULL THEN
        INSERT INTO specimen_groups (owner_id, label, sort_order) VALUES (uid, '蛹', 3) RETURNING id INTO g_pupa;
    END IF;
    SELECT id INTO g_adult FROM specimen_groups WHERE owner_id = uid AND label = '成虫';
    IF g_adult IS NULL THEN
        INSERT INTO specimen_groups (owner_id, label, sort_order) VALUES (uid, '成虫', 4) RETURNING id INTO g_adult;
    END IF;

    -- 個体(卵2 / 幼虫3 / 蛹1 / 成虫2)
    INSERT INTO specimens
        (owner_id, group_id, code, name, species_name, scientific_name, sex, line, measure, egg_date, next_action, alert)
    VALUES
        (uid, g_egg,   'T-E01', 'ヘラクレス 卵',       'ヘラクレスヘラクレス', 'Dynastes hercules hercules', NULL, 'CB F1', NULL,
         current_date - 12, '割出予定 ' || to_char(current_date + 7, 'MM/DD') || ' ― 転卵しない', false),
        (uid, g_egg,   'T-E02', 'ニジイロ 卵',         'ニジイロクワガタ',     'Phalacrognathus muelleri',   NULL, 'CB F2', NULL,
         current_date - 8, NULL, false),
        (uid, g_larva, 'T-L01', 'ヘラクレス 3令 ♂',   'ヘラクレスヘラクレス', 'Dynastes hercules hercules', '♂', 'CB F1', '96g(3令)',
         current_date - 300, 'マット交換 ' || to_char(current_date + 3, 'MM/DD'), false),
        (uid, g_larva, 'T-L02', 'ヘラクレス 3令 ♀',   'ヘラクレスヘラクレス', 'Dynastes hercules hercules', '♀', 'CB F1', '58g(3令)',
         current_date - 300, 'マット交換 10日経過', true),
        (uid, g_larva, 'T-L03', 'オオクワ 2令',        'オオクワガタ',         'Dorcus hopei binodulosus',   NULL, '能勢YG CB', NULL,
         current_date - 90, NULL, false),
        (uid, g_pupa,  'T-P01', 'ヘラクレス 蛹 ♂',    'ヘラクレスヘラクレス', 'Dynastes hercules hercules', '♂', 'CB F1', '96g(3令時)',
         current_date - 320, '羽化予測 ' || to_char(current_date + 14, 'MM/DD') || ' ±5日 ― 蛹室に振動を与えない', false),
        (uid, g_adult, 'T-A01', 'ニジイロ ♂ 51mm',    'ニジイロクワガタ',     'Phalacrognathus muelleri',   '♂', 'CB F2', '51mm',
         current_date - 400, 'ゼリー交換 ' || to_char(current_date + 2, 'MM/DD'), false),
        (uid, g_adult, 'T-A02', 'オオクワ ♀ 44mm',    'オオクワガタ',         'Dorcus hopei binodulosus',   '♀', 'CB F4', '44mm',
         current_date - 500, '産卵セット中 ― 割出 ' || to_char(current_date + 10, 'MM/DD'), false)
    ON CONFLICT (owner_id, code) DO NOTHING;

    -- 飼育記録
    INSERT INTO care_logs (specimen_id, at, kind, body) VALUES
        ((SELECT id FROM specimens WHERE owner_id = uid AND code = 'T-E01'), current_date - 12, '採卵',        '産卵セットから割出、個別管理へ'),
        ((SELECT id FROM specimens WHERE owner_id = uid AND code = 'T-L01'), current_date - 20, 'マット交換',   'Uマット 8L、加水やや強め'),
        ((SELECT id FROM specimens WHERE owner_id = uid AND code = 'T-L01'), current_date - 20, '計測',        '3令 96g'),
        ((SELECT id FROM specimens WHERE owner_id = uid AND code = 'T-L02'), current_date - 30, 'マット交換',   'Uマット 5L'),
        ((SELECT id FROM specimens WHERE owner_id = uid AND code = 'T-P01'), current_date - 25, 'ステージ変化', '蛹化を確認(3令 → 蛹)'),
        ((SELECT id FROM specimens WHERE owner_id = uid AND code = 'T-P01'), current_date - 2,  'メモ',        '色づき始め。人工蛹室の湿度維持'),
        ((SELECT id FROM specimens WHERE owner_id = uid AND code = 'T-A01'), current_date - 3,  'ゼリー交換',   '高タンパク 16g'),
        ((SELECT id FROM specimens WHERE owner_id = uid AND code = 'T-A02'), current_date - 15, 'メモ',        '産卵セット投入。材2本・マット固詰め');

    -- 種の飼育メモ
    INSERT INTO species_notes (owner_id, species_name, note) VALUES
        (uid, 'ヘラクレスヘラクレス', 'ヘラクレスの蛹期は約2ヶ月。羽化直後は上翅が白く、硬化まで3週間は掘り出さないこと。'),
        (uid, 'ニジイロクワガタ',     'ニジイロは高温に弱く25℃以下を維持。菌糸・マットどちらでも飼育可。')
    ON CONFLICT (owner_id, species_name) DO NOTHING;

    RAISE NOTICE 'test ユーザ(%)に個体8・記録8・種メモ2を投入しました', uid;
END $$;
