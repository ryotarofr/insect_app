//! cohorts (群飼育) への永続化
//!
//! **責務**:
//!   - cohorts テーブルへの insert / find / list / archive
//!   - 個体化 (promote): 1 トランザクションで specimens INSERT + cohorts.current_count -1 + 必要なら archived_at セット + cohort_logs INSERT
//!   - DB 不在時 (= pool=None) は in-memory fallback で動く
//!
//! **設計判断**:
//!   - 並行制御は **悲観ロック** (`SELECT ... FOR UPDATE`) で行う (= `promote_one` 参照)。
//!     `version` 列は監査 / 履歴ヒントとしてインクリメントするが `UPDATE ... WHERE version = ?`
//!     の楽観 CAS は採用していない (= 実装コスト > MVP 規模での効果)。
//!   - current_count = 0 になった瞬間は application 層 (= promote 内) で archived_at をセット
//!   - parent_mating_id 由来の親情報継承は handler 層で別途解決 (repo は cohort 自身のみ扱う)

use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct CohortRow {
    pub id: Uuid,
    pub public_id: String,
    pub owner_user_id: Uuid,
    pub species_id: String,
    pub name: Option<String>,
    pub bloodline_name: Option<String>,
    pub origin_kind: String,
    pub parent_mating_id: Option<Uuid>,
    pub initial_count: i32,
    pub current_count: i32,
    pub stage: String,
    pub start_date: NaiveDate,
    pub notes: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// INSERT 用 payload。
#[derive(Debug, Clone)]
pub struct CohortInsert {
    pub public_id: String,
    pub owner_user_id: Uuid,
    pub species_id: String,
    pub name: Option<String>,
    pub bloodline_name: Option<String>,
    pub origin_kind: String,
    pub parent_mating_id: Option<Uuid>,
    pub initial_count: i32,
    pub stage: String,
    pub start_date: NaiveDate,
    pub notes: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CohortRepoError {
    #[error("invalid cohort: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("cohort not found: {0}")]
    NotFound(Uuid),
    #[error("cohort already archived: {0}")]
    AlreadyArchived(Uuid),
    #[error("cohort empty (current_count = 0): {0}")]
    Empty(Uuid),
}

const ALLOWED_ORIGIN: &[&str] = &["egg_lay", "purchase", "field_collected"];
const ALLOWED_STAGE: &[&str] = &["egg", "larva_l1", "larva_l2", "larva_l3", "pupa", "mixed"];

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<CohortRow>, CohortRepoError> {
    match pool {
        Some(p) => find_by_id_db(p, id).await,
        None => Ok(memory_store_lock().iter().find(|r| r.id == id).cloned()),
    }
}

pub async fn find_by_public_id(
    pool: Option<&PgPool>,
    public_id: &str,
) -> Result<Option<CohortRow>, CohortRepoError> {
    match pool {
        Some(p) => find_by_public_id_db(p, public_id).await,
        None => Ok(memory_store_lock()
            .iter()
            .find(|r| r.public_id == public_id)
            .cloned()),
    }
}

/// 1 ユーザの cohort 一覧。`include_archived=false` で active のみ。
pub async fn list_by_owner(
    pool: Option<&PgPool>,
    owner_user_id: Uuid,
    include_archived: bool,
) -> Result<Vec<CohortRow>, CohortRepoError> {
    match pool {
        Some(p) => list_by_owner_db(p, owner_user_id, include_archived).await,
        None => Ok(memory_store_lock()
            .iter()
            .filter(|r| {
                r.owner_user_id == owner_user_id
                    && (include_archived || r.archived_at.is_none())
            })
            .cloned()
            .collect()),
    }
}

pub async fn insert(
    pool: Option<&PgPool>,
    payload: CohortInsert,
) -> Result<Uuid, CohortRepoError> {
    validate(&payload)?;
    match pool {
        Some(p) => insert_db(p, payload).await,
        None => {
            let id = Uuid::new_v4();
            let now = Utc::now();
            memory_store_lock().push(CohortRow {
                id,
                public_id: payload.public_id,
                owner_user_id: payload.owner_user_id,
                species_id: payload.species_id,
                name: payload.name,
                bloodline_name: payload.bloodline_name,
                origin_kind: payload.origin_kind,
                parent_mating_id: payload.parent_mating_id,
                initial_count: payload.initial_count,
                current_count: payload.initial_count,
                stage: payload.stage,
                start_date: payload.start_date,
                notes: payload.notes,
                archived_at: None,
                version: 0,
                created_at: now,
                updated_at: now,
            });
            Ok(id)
        }
    }
}

/// アーカイブ (中断時の手動アーカイブ用)
pub async fn archive(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<(), CohortRepoError> {
    match pool {
        Some(p) => {
            let res = sqlx::query(
                r#"
                UPDATE cohorts
                SET archived_at = COALESCE(archived_at, now()),
                    version = version + 1
                WHERE id = $1
                "#,
            )
            .bind(id)
            .execute(p)
            .await
            .map_err(CohortRepoError::Db)?;
            if res.rows_affected() == 0 {
                return Err(CohortRepoError::NotFound(id));
            }
            Ok(())
        }
        None => {
            let mut store = memory_store_lock();
            let row = store
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(CohortRepoError::NotFound(id))?;
            if row.archived_at.is_none() {
                row.archived_at = Some(Utc::now());
            }
            row.version += 1;
            Ok(())
        }
    }
}

/// 個体化結果。トランザクション内で specimens INSERT + cohort current_count -1 を実施した後の状態を返す。
#[derive(Debug, Clone)]
pub struct PromoteResult {
    pub specimen_id: Uuid,
    pub cohort_after: CohortRow,
}

/// 個体化を 1 件トランザクションで実行する。
///
/// **流れ**:
///   1. cohort を SELECT FOR UPDATE で lock
///   2. archived_at が NULL かつ current_count > 0 を確認
///   3. specimens に INSERT (cohort_id / promoted_from_cohort_at セット)
///   4. cohorts.current_count -= 1, version += 1
///   5. 結果として current_count = 0 になったら archived_at = now()
///
/// **失敗ケース**:
///   - AlreadyArchived: archived 済の cohort
///   - Empty: current_count = 0
///   - Db: SQL エラー
///
/// `mating_records` から父母情報を継承する処理は本関数の外 (handler 層) で行う。
pub async fn promote_one(
    pool: &PgPool,
    cohort_id: Uuid,
    specimen_insert: &crate::repos::specimens::SpecimenInsert,
) -> Result<PromoteResult, CohortRepoError> {
    let mut tx = pool.begin().await.map_err(CohortRepoError::Db)?;

    // 1. lock
    let row: Option<CohortRow> = sqlx::query_as::<_, CohortRow>(
        &format!(
            "SELECT {SELECT_FIELDS} FROM cohorts WHERE id = $1 FOR UPDATE"
        )
    )
    .bind(cohort_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(CohortRepoError::Db)?;

    let cohort = row.ok_or(CohortRepoError::NotFound(cohort_id))?;

    // 2. precondition
    if cohort.archived_at.is_some() {
        return Err(CohortRepoError::AlreadyArchived(cohort_id));
    }
    if cohort.current_count <= 0 {
        return Err(CohortRepoError::Empty(cohort_id));
    }

    // 3. specimens INSERT (cohort_id / promoted_from_cohort_at 込み)
    let new_specimen_id = Uuid::new_v4();
    let now = Utc::now();
    sqlx::query(
        r#"
        INSERT INTO specimens (
            id, public_id, owner_user_id, species_id, name, sex,
            stage, stage_progress, size_mm, weight_g,
            birth_date, purchased_at, purchased_from_shop_id,
            generation, purchase_price_jpy, eclosion_eta,
            life_status, notes,
            father_id, mother_id, father_label, mother_label,
            cohort_id, promoted_from_cohort_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16,
                'active', $17,
                $18, $19, $20, $21,
                $22, $23)
        "#,
    )
    .bind(new_specimen_id)
    .bind(&specimen_insert.public_id)
    .bind(specimen_insert.owner_user_id)
    .bind(&specimen_insert.species_id)
    .bind(&specimen_insert.name)
    .bind(&specimen_insert.sex)
    .bind(&specimen_insert.stage)
    .bind(specimen_insert.stage_progress)
    .bind(specimen_insert.size_mm)
    .bind(specimen_insert.weight_g)
    .bind(specimen_insert.birth_date)
    .bind(specimen_insert.purchased_at)
    .bind(specimen_insert.purchased_from_shop_id)
    .bind(&specimen_insert.generation)
    .bind(specimen_insert.purchase_price_jpy)
    .bind(specimen_insert.eclosion_eta)
    .bind(&specimen_insert.notes)
    .bind(specimen_insert.father_id)
    .bind(specimen_insert.mother_id)
    .bind(&specimen_insert.father_label)
    .bind(&specimen_insert.mother_label)
    .bind(cohort_id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(CohortRepoError::Db)?;

    // 4. cohorts UPDATE (current_count -1, archived_at if 0)
    let next_count = cohort.current_count - 1;
    let archived_at = if next_count == 0 {
        Some(now)
    } else {
        cohort.archived_at
    };

    let updated: CohortRow = sqlx::query_as::<_, CohortRow>(
        &format!(
            r#"
            UPDATE cohorts
            SET current_count = $2,
                archived_at = $3,
                version = version + 1
            WHERE id = $1
            RETURNING {SELECT_FIELDS}
            "#
        )
    )
    .bind(cohort_id)
    .bind(next_count)
    .bind(archived_at)
    .fetch_one(&mut *tx)
    .await
    .map_err(CohortRepoError::Db)?;

    tx.commit().await.map_err(CohortRepoError::Db)?;

    Ok(PromoteResult {
        specimen_id: new_specimen_id,
        cohort_after: updated,
    })
}

// ──────────────────────────────────────────────────────────────────────
// validation
// ──────────────────────────────────────────────────────────────────────

fn validate(p: &CohortInsert) -> Result<(), CohortRepoError> {
    if p.public_id.trim().is_empty() {
        return Err(CohortRepoError::Invalid("public_id is empty".to_string()));
    }
    if !ALLOWED_ORIGIN.contains(&p.origin_kind.as_str()) {
        return Err(CohortRepoError::Invalid(format!(
            "origin_kind must be one of {ALLOWED_ORIGIN:?}, got {}",
            p.origin_kind
        )));
    }
    if !ALLOWED_STAGE.contains(&p.stage.as_str()) {
        return Err(CohortRepoError::Invalid(format!(
            "stage must be one of {ALLOWED_STAGE:?}, got {}",
            p.stage
        )));
    }
    if p.initial_count <= 0 {
        return Err(CohortRepoError::Invalid(format!(
            "initial_count must be > 0, got {}",
            p.initial_count
        )));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

const SELECT_FIELDS: &str = r#"
    id, public_id, owner_user_id, species_id, name, bloodline_name,
    origin_kind, parent_mating_id,
    initial_count, current_count, stage,
    start_date, notes, archived_at, version,
    created_at, updated_at
"#;

async fn find_by_id_db(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<CohortRow>, CohortRepoError> {
    let q = format!("SELECT {SELECT_FIELDS} FROM cohorts WHERE id = $1");
    sqlx::query_as::<_, CohortRow>(&q)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(CohortRepoError::Db)
}

async fn find_by_public_id_db(
    pool: &PgPool,
    public_id: &str,
) -> Result<Option<CohortRow>, CohortRepoError> {
    let q = format!("SELECT {SELECT_FIELDS} FROM cohorts WHERE public_id = $1");
    sqlx::query_as::<_, CohortRow>(&q)
        .bind(public_id)
        .fetch_optional(pool)
        .await
        .map_err(CohortRepoError::Db)
}

async fn list_by_owner_db(
    pool: &PgPool,
    owner_user_id: Uuid,
    include_archived: bool,
) -> Result<Vec<CohortRow>, CohortRepoError> {
    let q = format!(
        r#"
        SELECT {SELECT_FIELDS}
        FROM cohorts
        WHERE owner_user_id = $1
          AND ($2 = true OR archived_at IS NULL)
        ORDER BY created_at DESC, id
        "#
    );
    sqlx::query_as::<_, CohortRow>(&q)
        .bind(owner_user_id)
        .bind(include_archived)
        .fetch_all(pool)
        .await
        .map_err(CohortRepoError::Db)
}

async fn insert_db(
    pool: &PgPool,
    payload: CohortInsert,
) -> Result<Uuid, CohortRepoError> {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO cohorts (
            id, public_id, owner_user_id, species_id, name, bloodline_name,
            origin_kind, parent_mating_id,
            initial_count, current_count, stage,
            start_date, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12)
        "#,
    )
    .bind(id)
    .bind(&payload.public_id)
    .bind(payload.owner_user_id)
    .bind(payload.species_id)
    .bind(&payload.name)
    .bind(&payload.bloodline_name)
    .bind(&payload.origin_kind)
    .bind(payload.parent_mating_id)
    .bind(payload.initial_count)
    .bind(&payload.stage)
    .bind(payload.start_date)
    .bind(&payload.notes)
    .execute(pool)
    .await
    .map_err(CohortRepoError::Db)?;
    Ok(id)
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<CohortRow>> {
    static S: OnceLock<Mutex<Vec<CohortRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_store_lock() -> std::sync::MutexGuard<'static, Vec<CohortRow>> {
    memory_store().lock().expect("cohorts memory mutex poisoned")
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_store().lock() {
        s.clear();
    }
}

#[cfg(test)]
pub fn memory_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    GUARD.lock().unwrap_or_else(|p| p.into_inner())
}
