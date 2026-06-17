-- 0007_specimens.sql — 個体カルテ + ログ + 交配記録 (Phase 9.D / DB設計書 v2 §3.4-3.6)
--
-- **目的**:
--   - 飼育中の昆虫個体 (specimens) を登録・更新・履歴管理する基盤テーブル群
--   - 飼育ログ (specimen_logs) と交配記録 (mating_records) を 1 migration にまとめる
--     (= 元 plan は 0005/0006/0007 の 3 分割だったが、互いに小規模なので 1 つに集約)
--
-- **本 migration が扱う範囲**:
--   - `specimens`              : 個体マスタ + ライフステータス current 値
--   - `specimen_status_history`: 状態遷移の不可逆履歴 (Medium #3)
--   - `specimen_logs`          : 飼育ログ (体重 / 餌 / マット / 脱皮 / 観察)
--   - `mating_records`         : 交配試行記録 (= specimens 化前の段階)
--
-- **設計判断** (= db-schema-design.md §3.4-3.6 / レビュー反映済):
--   - High #5: specimen_logs.logged_at_time を TIME (TZ なし) に
--   - Medium #3: specimen_status_history を最初から作成 (= 状態遷移の歴史を消失させない)
--   - Medium #4: NUMERIC で計測値の表示信頼性確保 (size_mm / weight_g / stage_progress)
--   - Medium #5: audit (created_by/updated_by) + 楽観ロック (version)
--   - Low #1: _id サフィックスで naming 統一 (purchased_from_shop_id 等)
--   - 削除しない方針: specimens.is_archived フラグで非表示化 (= 表示は「故」「譲渡済」より上の概念)

-- ──────────────────────────────────────────────────────────────────────
-- specimens: 個体カルテ
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE specimens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id       TEXT NOT NULL UNIQUE,                   -- "#DHH-0271"
    owner_user_id   UUID NOT NULL REFERENCES users(id),
    species_id      TEXT NOT NULL REFERENCES species(id),
    name            TEXT NOT NULL,                          -- "ヘラクレス 黒曜"
    sex             TEXT NOT NULL CHECK (sex IN ('male', 'female', 'unknown')),
    -- 飼育ステージ (= 蛹 / 成虫 / 幼虫 N齢 / 前蛹)。自由文字列で UI 表示で使う。
    stage           TEXT NOT NULL,
    -- Medium #4: REAL → NUMERIC で表示信頼性確保 (= 0.30 → 0.300000... 回避)
    stage_progress  NUMERIC(3,2) NOT NULL CHECK (stage_progress >= 0 AND stage_progress <= 1),
    -- 物理計測値 (= 表示そのまま記録 = 28.4 → 28.4 が確定)
    size_mm         NUMERIC(5,1),                           -- 142.0
    weight_g        NUMERIC(6,2),                           -- 28.4
    -- ライフサイクル日付
    birth_date      DATE,                                   -- 2024-08-12
    purchased_at    DATE,                                   -- 2025-11-03
    -- Low #1: _id サフィックスで命名統一
    purchased_from_shop_id  UUID REFERENCES shops(id),
    -- 系統
    generation      TEXT,                                   -- "CBF2" 等
    purchase_price_jpy BIGINT,                              -- 取得時価格 (任意)
    -- 羽化予測
    eclosion_eta    DATE,                                   -- "2026-05-04"
    -- ライフステータス (= 現在値スナップショット;
    --   遷移履歴は specimen_status_history で別途記録 = Medium #3)
    life_status     TEXT NOT NULL DEFAULT 'active'
                       CHECK (life_status IN ('active', 'deceased', 'transferred', 'escaped')),
    life_status_at  DATE,                                   -- 死着日 / 譲渡日 / 脱走日
    life_status_note TEXT,
    -- 自由メモ (= 旧 specimen.notes + memos の統合)
    notes           TEXT,
    -- 血統リンク (= specimens 自己参照、deceased 個体も参照する想定で ON DELETE は SET NULL)
    father_id       UUID REFERENCES specimens(id) ON DELETE SET NULL,
    mother_id       UUID REFERENCES specimens(id) ON DELETE SET NULL,
    -- "野生" 等で specimens に登録されない親の自由テキスト fallback (= 設計書 §8.3)
    father_label    TEXT,
    mother_label    TEXT,
    -- 削除しない方針: archived フラグで非表示化
    is_archived     BOOLEAN NOT NULL DEFAULT false,
    -- Medium #5: ops 監査 + 楽観ロック
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    version         INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Low #2: 部分 index は archived 比率を計測してから判断 (= MVP は通常 index)
CREATE INDEX idx_specimens_owner            ON specimens (owner_user_id);
CREATE INDEX idx_specimens_archived         ON specimens (is_archived);
CREATE INDEX idx_specimens_species          ON specimens (species_id);
CREATE INDEX idx_specimens_eclosion_eta     ON specimens (eclosion_eta) WHERE eclosion_eta IS NOT NULL;
CREATE INDEX idx_specimens_father           ON specimens (father_id) WHERE father_id IS NOT NULL;
CREATE INDEX idx_specimens_mother           ON specimens (mother_id) WHERE mother_id IS NOT NULL;
-- public_id は UNIQUE 制約で自動 index される

CREATE TRIGGER trg_specimens_updated
    BEFORE UPDATE ON specimens
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- specimen_status_history: 状態遷移の履歴 (Medium #3)
-- ──────────────────────────────────────────────────────────────────────
-- specimens.life_status は最新値のスナップショット。履歴は別テーブルに残し、
-- application 側で UPDATE specimens.life_status する際に必ず本テーブルへ INSERT する規律。
-- 過去データが消失すると回復不能なので、最初から作る。
CREATE TABLE specimen_status_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    specimen_id     UUID NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
    status          TEXT NOT NULL
                       CHECK (status IN ('active', 'deceased', 'transferred', 'escaped')),
    changed_at      DATE NOT NULL,
    note            TEXT,
    author_user_id  UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_specimen_status_specimen
    ON specimen_status_history (specimen_id, changed_at DESC);

-- ──────────────────────────────────────────────────────────────────────
-- specimen_logs: 飼育ログ (= 体重 / 餌 / マット / 脱皮 / 観察)
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE specimen_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    specimen_id     UUID NOT NULL REFERENCES specimens(id) ON DELETE CASCADE,
    author_user_id  UUID NOT NULL REFERENCES users(id),
    -- log 種別 (= LogType と完全一致 / コード側 enum と source of truth を共有)
    log_type        TEXT NOT NULL CHECK (log_type IN ('weight', 'feed', 'mat', 'molt', 'observation')),
    -- ユーザ表示日 (Date.now() ではなく user 入力)
    logged_at       DATE NOT NULL,
    -- High #5: TEXT → TIME 型で型安全 + ORDER BY が時間順になる
    -- 24h 表記、TZ なし (= 日本時刻ローカル前提)。NULL 許容は維持。
    logged_at_time  TIME WITHOUT TIME ZONE,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL DEFAULT '',
    has_photo       BOOLEAN NOT NULL DEFAULT false,
    -- 構造化フィールド (log_type ごとに使う / 使わないが揺れる) は JSONB で。
    -- 例: weight log なら { "weight_g": 28.4 }
    --     molt  log なら { "head_width_mm": 12.5, "instar": 3 }
    metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_specimen_logs_specimen     ON specimen_logs (specimen_id, logged_at DESC);
CREATE INDEX idx_specimen_logs_type         ON specimen_logs (log_type);
CREATE INDEX idx_specimen_logs_author       ON specimen_logs (author_user_id);

-- ──────────────────────────────────────────────────────────────────────
-- mating_records: 交配試行記録 (= specimens に登録される前の planning 段階)
-- ──────────────────────────────────────────────────────────────────────
-- specimens.father_id / mother_id で完成した系図は表現できるが、
-- 「交配を計画 → 採卵 → 孵化失敗」のような途中経過は本テーブルで管理する。
CREATE TABLE mating_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    breeder_user_id UUID NOT NULL REFERENCES users(id),
    -- 雄雌 (= specimens に登録済みの個体への参照)
    father_id       UUID REFERENCES specimens(id) ON DELETE SET NULL,
    mother_id       UUID REFERENCES specimens(id) ON DELETE SET NULL,
    -- 親が "野生" 等で specimens テーブルに無い場合の fallback (= 自由テキスト)
    father_label    TEXT,
    mother_label    TEXT,
    -- 交配日 / 採卵日 / 状態
    mated_at        DATE NOT NULL,
    egg_count       INTEGER CHECK (egg_count IS NULL OR egg_count >= 0),
    status          TEXT NOT NULL DEFAULT 'planned'
                       CHECK (status IN ('planned', 'mated', 'eggs_laid', 'hatched', 'failed')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mating_records_breeder ON mating_records (breeder_user_id, mated_at DESC);
CREATE INDEX idx_mating_records_father  ON mating_records (father_id) WHERE father_id IS NOT NULL;
CREATE INDEX idx_mating_records_mother  ON mating_records (mother_id) WHERE mother_id IS NOT NULL;

CREATE TRIGGER trg_mating_records_updated
    BEFORE UPDATE ON mating_records
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
