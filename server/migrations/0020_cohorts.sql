-- 0020_cohorts.sql — 群飼育 (cohorts) と群ログ (cohort_logs)
--
-- **目的** (docs/breeder-pivot-and-features.md §3, docs/cohort-implementation-plan.md):
--   業者の業務実態 (容器単位で多数の卵 / 幼虫を管理) を表現するため、
--   `specimens` (1 行 = 1 個体) とは別に `cohorts` (1 行 = 1 ロット) を導入。
--   3 齢以降 / 蛹化前後で「個体化」して specimens 化する 2 段モデル。
--
-- **本 migration の範囲**:
--   - `cohorts`         : 群本体 (1 ロット = 1 行)
--   - `cohort_logs`     : 群単位の作業ログ (餌交換 / マット / 観察 / 死亡)
--   - `specimens` への `cohort_id` / `promoted_from_cohort_at` 追加
--
-- **設計判断**:
--   - `public_id` は LOT-{YYYY}-{4桁} 形式 (採番ロジックは application 側)
--   - `current_count` を保持 (派生値だが集計コスト削減のためデノーマライズ)
--   - `archived_at` の有無で active / archived を分岐 (status enum を増やさない)
--   - `version` を持たせ楽観的並行制御に対応 (UPDATE ... WHERE version = ?)
--   - `parent_mating_id` は任意 (野外採集など由来不明のロットも作れる)

-- ──────────────────────────────────────────────────────────────────────
-- cohorts: 群本体
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE cohorts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id           TEXT NOT NULL UNIQUE,
    owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- species.id は TEXT slug ("dhh" など)。specimens と同じ型に揃える。
    species_id          TEXT NOT NULL REFERENCES species(id),
    -- 任意の表示用名前 / 系統 (能勢 YG など、bloodlines テーブルとの紐付けは将来)
    name                TEXT,
    bloodline_name      TEXT,

    origin_kind         TEXT NOT NULL CHECK (origin_kind IN ('egg_lay', 'purchase', 'field_collected')),
    -- egg_lay 由来のとき、起点となる交配記録
    parent_mating_id    UUID REFERENCES mating_records(id),

    initial_count       INTEGER NOT NULL CHECK (initial_count > 0),
    current_count       INTEGER NOT NULL CHECK (current_count >= 0),
    stage               TEXT NOT NULL CHECK (stage IN ('egg', 'larva_l1', 'larva_l2', 'larva_l3', 'pupa', 'mixed')),

    start_date          DATE NOT NULL,
    notes               TEXT,
    -- 全個体化が終わった瞬間 (current_count = 0) に application 側で now() を入れる。
    -- 中断 (= 一部だけ個体化して終了) は archived_at = NULL のまま。
    archived_at         TIMESTAMPTZ,
    -- 楽観的並行制御。UPDATE 時に version + 1 で書き戻す
    version             INTEGER NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- current_count は initial_count を超えない (個体化で増えることはない)
    CHECK (current_count <= initial_count)
);

DROP TRIGGER IF EXISTS trg_cohorts_set_updated_at ON cohorts;
CREATE TRIGGER trg_cohorts_set_updated_at
    BEFORE UPDATE ON cohorts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- 一覧 (= GET /cohorts/me) で active / archived を分けて引くため
CREATE INDEX idx_cohorts_owner_active ON cohorts(owner_user_id) WHERE archived_at IS NULL;
CREATE INDEX idx_cohorts_owner_archived ON cohorts(owner_user_id, archived_at) WHERE archived_at IS NOT NULL;
-- 検索 / typeahead 用
CREATE INDEX idx_cohorts_species ON cohorts(species_id);

-- ──────────────────────────────────────────────────────────────────────
-- cohort_logs: 群単位の作業ログ
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE cohort_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id           UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    log_type            TEXT NOT NULL CHECK (log_type IN ('feed', 'mat', 'death', 'observation')),
    -- 死亡記録なら -3 等。観察 / 餌 / マットでは NULL。
    count_delta         INTEGER,
    metrics             JSONB,
    body                TEXT,
    logged_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    author_user_id      UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cohort_logs_cohort_logged ON cohort_logs(cohort_id, logged_at DESC);

-- ──────────────────────────────────────────────────────────────────────
-- specimens への cohort 由来カラム追加
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE specimens
    ADD COLUMN cohort_id UUID REFERENCES cohorts(id),
    ADD COLUMN promoted_from_cohort_at TIMESTAMPTZ;

-- 群経由の個体は cohort_id が埋まる。逆引き (個体一覧で「LOT-XXXX 由来」フィルタ) 用。
CREATE INDEX idx_specimens_cohort ON specimens(cohort_id) WHERE cohort_id IS NOT NULL;
