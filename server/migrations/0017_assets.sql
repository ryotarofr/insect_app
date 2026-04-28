-- 0017_assets.sql — 画像アップロード asset テーブル (Week 2 / F4)
--
-- **目的**:
--   client から R2 / S3 / local-file へ直接アップロードするためのメタデータ管理。
--   server は署名 URL 発行 + 完了通知の受信のみ担い、ファイルバイト自体は持たない (= 帯域節約)。
--
-- **設計判断**:
--   - **polymorphic owner**: 複数のドメインリソース (specimen / product / specimen_log) から
--     共通に asset を参照するため、別テーブルではなく `target_kind` + `target_id` の 2 列で
--     表現する。FK 整合性は失われるが、3 種類しか無く規模が小さいので許容。
--     拡張時は CHECK の値域を ALTER で追加 (= 破壊的 migration)。
--   - **target_kind / target_id の同期**: 両方 NULL (= 未紐付け / sign 直後)
--     または両方 NOT NULL (= 完了済 + どこかに紐付け済) のみを許す CHECK を入れる。
--     片方だけセットされた状態は serialization mistake なので DB レベルで弾く。
--   - **status FSM**: pending → uploaded、または pending → abandoned (= GC) の 2 経路のみ。
--     uploaded から戻すことは無い (= 物理削除なら DELETE で行う)。
--   - **storage_key UNIQUE**: 1 ファイル = 1 行を強制。同じ storage_key で 2 行できると
--     R2/S3 上の真実値と DB が乖離する事故が起きるので CHECK で潰す。
--   - **mime_type ホワイトリスト**: image/jpeg / png / webp / gif のみ。動画は scope 外
--     (= Phase 3 / Cloudflare Stream で別経路)。
--   - **bytes 上限**: 10MB を CHECK で強制 (= handler 側でも再 validate)。
--   - **GC 用 part index**: 状態 pending かつ created_at が古い行を引きやすいよう、
--     `idx_assets_pending_old` を入れて scheduled cleanup を効率化する。
--
-- **依存**:
--   - 0004_users.sql (users テーブル / owner_user_id FK)

CREATE TABLE assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- アップロードしたユーザ。削除されたら関連 asset も廃棄 (= ON DELETE CASCADE)。
    owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- ターゲット種別 (= polymorphic owner)。NULL は「未紐付け」初期段階。
    -- 値域は MVP の 3 種だけ。新規 kind は ALTER TABLE で CHECK を更新する破壊的 migration で。
    target_kind     TEXT CHECK (target_kind IN ('specimen', 'product', 'specimen_log')),
    -- ターゲット PK (= specimens.id / products.id / specimen_logs.id)。FK は polymorphic
    -- なので張れない (= 整合性は handler 側で検証)。
    target_id       UUID,
    -- ストレージ provider が共通利用する key 形式の文字列。
    -- 例 (local): "user/{owner_user_id}/{asset_id}.jpg"
    -- 例 (R2):   "kochu-assets/user/{owner_user_id}/{asset_id}.jpg"
    storage_key     TEXT NOT NULL UNIQUE,
    -- MIME type ホワイトリスト。動画は scope 外。
    mime_type       TEXT NOT NULL CHECK (mime_type IN (
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif'
    )),
    -- ファイルサイズ (bytes)。上限 10MB。
    bytes           BIGINT NOT NULL CHECK (bytes >= 0 AND bytes <= 10 * 1024 * 1024),
    -- アップロード状態 (FSM):
    --   pending   : 署名 URL 発行済 / 完了通知未受信
    --   uploaded  : 完了通知受信 (= ファイルが provider 上に存在する真実)
    --   abandoned : pending のまま GC 対象に倒した (= 後始末)
    status          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'uploaded', 'abandoned')),
    -- 完了通知時刻。pending / abandoned では NULL。
    uploaded_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- target_kind と target_id は両方 NULL or 両方 NOT NULL (= 中間状態を弾く)。
    CONSTRAINT target_pair_consistent CHECK (
        (target_kind IS NULL AND target_id IS NULL) OR
        (target_kind IS NOT NULL AND target_id IS NOT NULL)
    ),

    -- uploaded なのに uploaded_at NULL は不整合 (= status と uploaded_at の同期を強制)。
    CONSTRAINT uploaded_status_has_timestamp CHECK (
        (status <> 'uploaded' AND uploaded_at IS NULL) OR
        (status = 'uploaded' AND uploaded_at IS NOT NULL)
    )
);

-- ユーザ別のアップロード一覧 (= マイページ「アップロード履歴」用)。
CREATE INDEX idx_assets_owner
    ON assets (owner_user_id, created_at DESC);

-- ターゲット (specimen / product / log) → 紐付く asset の lookup。
-- 紐付け前の row (= target_id NULL) は除外。
CREATE INDEX idx_assets_target
    ON assets (target_kind, target_id)
    WHERE target_id IS NOT NULL;

-- 進行中 (= status='pending') の row だけ引く部分 index。GC バッチ用。
-- 「作成から N 分以上経過した pending を abandoned に倒す」という運用に効く。
CREATE INDEX idx_assets_pending_old
    ON assets (created_at)
    WHERE status = 'pending';

CREATE TRIGGER trg_assets_updated
    BEFORE UPDATE ON assets
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
