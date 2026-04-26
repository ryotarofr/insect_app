//! specimens (個体カルテ) への永続化 (Phase 9.D / DB設計書 v2 §3.4)
//!
//! **責務 (本 PR / skeleton)**:
//!   - sqlx で specimens テーブルから 1 件取得 / list / insert / archive を提供
//!   - DB 不在時 (= pool=None) は in-memory fallback で動く
//!   - handler 統合は本 PR 範囲外 (= 既存 handler は specimens を使っていない)
//!
//! **未実装 (= 後続タスク)**:
//!   - specimen_status_history への履歴 INSERT (= life_status 変更時に必須)
//!   - specimen_logs / mating_records 用の専用 repo モジュール
//!   - 計測値 (size_mm / weight_g / stage_progress) の NUMERIC ↔ Rust 型変換の精緻化
//!     (現状は f64 で受けるが、表示精度が要る場面では BigDecimal 移行を検討)

use std::sync::{Mutex, OnceLock};

use chrono::NaiveDate;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct SpecimenRow {
    pub id: Uuid,
    pub public_id: String,                  // "#DHH-0271"
    pub owner_user_id: Uuid,
    pub species_id: String,                 // "dhh"
    pub name: String,                       // "ヘラクレス 黒曜"
    pub sex: String,                        // "male" / "female" / "unknown"
    pub stage: String,                      // 自由文字列
    /// NUMERIC(3,2) → f64 cast。表示に直接使わず progress bar 等の比率にだけ。
    pub stage_progress: f64,
    pub size_mm: Option<f64>,               // NUMERIC(5,1)
    pub weight_g: Option<f64>,              // NUMERIC(6,2)
    pub birth_date: Option<NaiveDate>,
    pub purchased_at: Option<NaiveDate>,
    pub purchased_from_shop_id: Option<Uuid>,
    pub generation: Option<String>,
    pub purchase_price_jpy: Option<i64>,
    pub eclosion_eta: Option<NaiveDate>,
    pub life_status: String,                // "active" / "deceased" / "transferred" / "escaped"
    pub life_status_at: Option<NaiveDate>,
    pub life_status_note: Option<String>,
    pub notes: Option<String>,
    pub father_id: Option<Uuid>,
    pub mother_id: Option<Uuid>,
    pub father_label: Option<String>,
    pub mother_label: Option<String>,
    pub is_archived: bool,
}

/// INSERT 用 payload。version / created_by / updated_by 等は handler 側で付ける。
#[derive(Debug, Clone)]
pub struct SpecimenInsert {
    pub public_id: String,
    pub owner_user_id: Uuid,
    pub species_id: String,
    pub name: String,
    pub sex: String,
    pub stage: String,
    pub stage_progress: f64,
    pub size_mm: Option<f64>,
    pub weight_g: Option<f64>,
    pub birth_date: Option<NaiveDate>,
    pub purchased_at: Option<NaiveDate>,
    pub purchased_from_shop_id: Option<Uuid>,
    pub generation: Option<String>,
    pub purchase_price_jpy: Option<i64>,
    pub eclosion_eta: Option<NaiveDate>,
    pub father_id: Option<Uuid>,
    pub mother_id: Option<Uuid>,
    pub father_label: Option<String>,
    pub mother_label: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum SpecimenRepoError {
    #[error("invalid specimen: {0}")]
    Invalid(String),
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
    #[error("specimen not found: {0}")]
    NotFound(Uuid),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// 内部 UUID で 1 件取得。pool=None なら in-memory fallback。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<SpecimenRow>, SpecimenRepoError> {
    match pool {
        Some(p) => find_by_id_db(p, id).await,
        None => Ok(memory_store_lock().iter().find(|r| r.id == id).cloned()),
    }
}

/// public_id (= "#DHH-0271") で 1 件取得。
pub async fn find_by_public_id(
    pool: Option<&PgPool>,
    public_id: &str,
) -> Result<Option<SpecimenRow>, SpecimenRepoError> {
    match pool {
        Some(p) => find_by_public_id_db(p, public_id).await,
        None => Ok(memory_store_lock()
            .iter()
            .find(|r| r.public_id == public_id)
            .cloned()),
    }
}

/// 1 ユーザの所有 specimens を返す (= マイページ / 飼育リスト)。
/// `include_archived=false` で archived 行は除外。
pub async fn find_by_owner(
    pool: Option<&PgPool>,
    owner_user_id: Uuid,
    include_archived: bool,
) -> Result<Vec<SpecimenRow>, SpecimenRepoError> {
    match pool {
        Some(p) => find_by_owner_db(p, owner_user_id, include_archived).await,
        None => Ok(memory_store_lock()
            .iter()
            .filter(|r| {
                r.owner_user_id == owner_user_id && (include_archived || !r.is_archived)
            })
            .cloned()
            .collect()),
    }
}

/// validate + INSERT。生成された UUID を返す。
pub async fn insert(
    pool: Option<&PgPool>,
    payload: SpecimenInsert,
) -> Result<Uuid, SpecimenRepoError> {
    validate(&payload)?;
    match pool {
        Some(p) => insert_db(p, payload).await,
        None => {
            let id = Uuid::new_v4();
            memory_store_lock_mut().push(SpecimenRow {
                id,
                public_id: payload.public_id,
                owner_user_id: payload.owner_user_id,
                species_id: payload.species_id,
                name: payload.name,
                sex: payload.sex,
                stage: payload.stage,
                stage_progress: payload.stage_progress,
                size_mm: payload.size_mm,
                weight_g: payload.weight_g,
                birth_date: payload.birth_date,
                purchased_at: payload.purchased_at,
                purchased_from_shop_id: payload.purchased_from_shop_id,
                generation: payload.generation,
                purchase_price_jpy: payload.purchase_price_jpy,
                eclosion_eta: payload.eclosion_eta,
                life_status: "active".to_string(),
                life_status_at: None,
                life_status_note: None,
                notes: payload.notes,
                father_id: payload.father_id,
                mother_id: payload.mother_id,
                father_label: payload.father_label,
                mother_label: payload.mother_label,
                is_archived: false,
            });
            Ok(id)
        }
    }
}

/// archive フラグを true にして表示から除外する。physical DELETE はしない方針。
pub async fn archive(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<(), SpecimenRepoError> {
    match pool {
        Some(p) => archive_db(p, id).await,
        None => {
            let mut store = memory_store_lock_mut();
            let row = store
                .iter_mut()
                .find(|r| r.id == id)
                .ok_or(SpecimenRepoError::NotFound(id))?;
            row.is_archived = true;
            Ok(())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────
// validation
// ──────────────────────────────────────────────────────────────────────

fn validate(p: &SpecimenInsert) -> Result<(), SpecimenRepoError> {
    if p.public_id.trim().is_empty() {
        return Err(SpecimenRepoError::Invalid("public_id is empty".to_string()));
    }
    if p.name.trim().is_empty() {
        return Err(SpecimenRepoError::Invalid("name is empty".to_string()));
    }
    if !["male", "female", "unknown"].contains(&p.sex.as_str()) {
        return Err(SpecimenRepoError::Invalid(format!(
            "sex must be male/female/unknown, got {}",
            p.sex
        )));
    }
    if p.stage.trim().is_empty() {
        return Err(SpecimenRepoError::Invalid("stage is empty".to_string()));
    }
    if !(0.0..=1.0).contains(&p.stage_progress) {
        return Err(SpecimenRepoError::Invalid(format!(
            "stage_progress must be 0.0..=1.0, got {}",
            p.stage_progress
        )));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装 (sqlx runtime queries)
// ──────────────────────────────────────────────────────────────────────

const SELECT_FIELDS: &str = r#"
    id, public_id, owner_user_id, species_id, name, sex, stage,
    stage_progress::DOUBLE PRECISION AS stage_progress,
    size_mm::DOUBLE PRECISION AS size_mm,
    weight_g::DOUBLE PRECISION AS weight_g,
    birth_date, purchased_at, purchased_from_shop_id,
    generation, purchase_price_jpy, eclosion_eta,
    life_status, life_status_at, life_status_note, notes,
    father_id, mother_id, father_label, mother_label, is_archived
"#;

async fn find_by_id_db(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<SpecimenRow>, SpecimenRepoError> {
    let q = format!("SELECT {SELECT_FIELDS} FROM specimens WHERE id = $1");
    sqlx::query_as::<_, SpecimenRow>(&q)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(SpecimenRepoError::Db)
}

async fn find_by_public_id_db(
    pool: &PgPool,
    public_id: &str,
) -> Result<Option<SpecimenRow>, SpecimenRepoError> {
    let q = format!("SELECT {SELECT_FIELDS} FROM specimens WHERE public_id = $1");
    sqlx::query_as::<_, SpecimenRow>(&q)
        .bind(public_id)
        .fetch_optional(pool)
        .await
        .map_err(SpecimenRepoError::Db)
}

async fn find_by_owner_db(
    pool: &PgPool,
    owner_user_id: Uuid,
    include_archived: bool,
) -> Result<Vec<SpecimenRow>, SpecimenRepoError> {
    let q = format!(
        r#"
        SELECT {SELECT_FIELDS}
        FROM specimens
        WHERE owner_user_id = $1
          AND ($2 = true OR is_archived = false)
        ORDER BY created_at DESC, id
        "#
    );
    sqlx::query_as::<_, SpecimenRow>(&q)
        .bind(owner_user_id)
        .bind(include_archived)
        .fetch_all(pool)
        .await
        .map_err(SpecimenRepoError::Db)
}

async fn insert_db(
    pool: &PgPool,
    p: SpecimenInsert,
) -> Result<Uuid, SpecimenRepoError> {
    let row: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO specimens (
            public_id, owner_user_id, species_id, name, sex, stage,
            stage_progress, size_mm, weight_g, birth_date, purchased_at,
            purchased_from_shop_id, generation, purchase_price_jpy,
            eclosion_eta, father_id, mother_id, father_label, mother_label,
            notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING id
        "#,
    )
    .bind(&p.public_id)
    .bind(p.owner_user_id)
    .bind(&p.species_id)
    .bind(&p.name)
    .bind(&p.sex)
    .bind(&p.stage)
    .bind(p.stage_progress)
    .bind(p.size_mm)
    .bind(p.weight_g)
    .bind(p.birth_date)
    .bind(p.purchased_at)
    .bind(p.purchased_from_shop_id)
    .bind(p.generation.as_deref())
    .bind(p.purchase_price_jpy)
    .bind(p.eclosion_eta)
    .bind(p.father_id)
    .bind(p.mother_id)
    .bind(p.father_label.as_deref())
    .bind(p.mother_label.as_deref())
    .bind(p.notes.as_deref())
    .fetch_one(pool)
    .await
    .map_err(SpecimenRepoError::Db)?;
    Ok(row.0)
}

async fn archive_db(pool: &PgPool, id: Uuid) -> Result<(), SpecimenRepoError> {
    let res = sqlx::query("UPDATE specimens SET is_archived = true WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(SpecimenRepoError::Db)?;
    if res.rows_affected() == 0 {
        return Err(SpecimenRepoError::NotFound(id));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback
// ──────────────────────────────────────────────────────────────────────

fn memory_store() -> &'static Mutex<Vec<SpecimenRow>> {
    static S: OnceLock<Mutex<Vec<SpecimenRow>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_store_lock() -> std::sync::MutexGuard<'static, Vec<SpecimenRow>> {
    memory_store().lock().expect("specimens memory mutex poisoned")
}

fn memory_store_lock_mut() -> std::sync::MutexGuard<'static, Vec<SpecimenRow>> {
    memory_store_lock()
}

#[cfg(test)]
pub fn reset_memory_for_test() {
    if let Ok(mut s) = memory_store().lock() {
        s.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// グローバル in-memory store の競合を避けるため逐次化。
    static GUARD: StdMutex<()> = StdMutex::new(());

    fn owner() -> Uuid {
        Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").unwrap()
    }

    fn payload(public_id: &str) -> SpecimenInsert {
        SpecimenInsert {
            public_id: public_id.to_string(),
            owner_user_id: owner(),
            species_id: "dhh".to_string(),
            name: "ヘラクレス テスト".to_string(),
            sex: "male".to_string(),
            stage: "幼虫 3齢".to_string(),
            stage_progress: 0.5,
            size_mm: Some(120.0),
            weight_g: Some(30.5),
            birth_date: None,
            purchased_at: None,
            purchased_from_shop_id: None,
            generation: Some("CBF2".to_string()),
            purchase_price_jpy: None,
            eclosion_eta: None,
            father_id: None,
            mother_id: None,
            father_label: None,
            mother_label: None,
            notes: None,
        }
    }

    #[tokio::test]
    async fn validate_rejects_empty_public_id() {
        let _g = GUARD.lock().unwrap();
        let mut p = payload("ok");
        p.public_id = "".to_string();
        match insert(None, p).await {
            Err(SpecimenRepoError::Invalid(msg)) => {
                assert!(msg.contains("public_id"))
            }
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_invalid_sex() {
        let _g = GUARD.lock().unwrap();
        let mut p = payload("ok");
        p.sex = "alien".to_string();
        match insert(None, p).await {
            Err(SpecimenRepoError::Invalid(msg)) => assert!(msg.contains("sex")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn validate_rejects_stage_progress_out_of_range() {
        let _g = GUARD.lock().unwrap();
        for bad in [-0.1f64, 1.1, 2.0] {
            let mut p = payload("ok");
            p.stage_progress = bad;
            match insert(None, p).await {
                Err(SpecimenRepoError::Invalid(msg)) => assert!(msg.contains("stage_progress")),
                other => panic!("expected Invalid for {bad}, got {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn in_memory_insert_and_find_by_id_and_public_id() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let id = insert(None, payload("#DHH-TEST-1")).await.unwrap();

        let by_id = find_by_id(None, id).await.unwrap();
        assert!(by_id.is_some());
        let row = by_id.unwrap();
        assert_eq!(row.public_id, "#DHH-TEST-1");
        assert_eq!(row.life_status, "active", "新規は active で始まる");
        assert!(!row.is_archived);

        let by_pub = find_by_public_id(None, "#DHH-TEST-1").await.unwrap();
        assert!(by_pub.is_some());
        assert_eq!(by_pub.unwrap().id, id);
    }

    #[tokio::test]
    async fn in_memory_find_by_owner_filters_archived() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let active_id = insert(None, payload("#DHH-A")).await.unwrap();
        let arch_id = insert(None, payload("#DHH-B")).await.unwrap();
        archive(None, arch_id).await.unwrap();

        let visible = find_by_owner(None, owner(), false).await.unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].id, active_id);

        let all = find_by_owner(None, owner(), true).await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn in_memory_archive_unknown_returns_not_found() {
        let _g = GUARD.lock().unwrap();
        reset_memory_for_test();
        let unknown = Uuid::new_v4();
        match archive(None, unknown).await {
            Err(SpecimenRepoError::NotFound(id)) => assert_eq!(id, unknown),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}
