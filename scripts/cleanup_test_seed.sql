-- 文字化けして投入された test ユーザのシードデータを掃除する。
-- (コードT-*はASCIIなので無事 → codeで個体を特定して削除。記録はCASCADE)

DO $$
DECLARE uid uuid;
BEGIN
    SELECT id INTO uid FROM users
    WHERE display_name = 'test' OR email LIKE 'test@%'
    ORDER BY created_at LIMIT 1;
    IF uid IS NULL THEN
        RAISE NOTICE 'test ユーザが見つからないため何もしません';
        RETURN;
    END IF;

    DELETE FROM specimens WHERE owner_id = uid AND code LIKE 'T-%';
    DELETE FROM species_notes WHERE owner_id = uid AND species_name LIKE '%?%';
    -- ラベルが ? だけになった化けタブを削除(正常なタブは残る)
    DELETE FROM specimen_groups WHERE owner_id = uid AND label ~ '^\?+$';

    RAISE NOTICE 'test ユーザの化けデータを削除しました';
END $$;
