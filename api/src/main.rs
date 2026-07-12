//! SDUI 配信/書込 + 飼育管理ドメイン API。
//!
//! 書き込みは2種類あり、経路を分けている:
//! - 画面定義への書き込み  → PUT /api/pages/{key}(エージェントと人間で共通の経路)
//! - ドメインデータへの書き込み → /api/specimens 等の REST(変更後にクライアントが再fetch)

use api::AppState;
use api::auth::{self, AuthUser, MaybeUser};
use api::error::{ApiError, domain_err, internal};
use api::hydrate::{HydrateCtx, HydrateError, hydrate};
use api::sdui::{PageView, ValidPageDefinition};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[tokio::main]
async fn main() {
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/insect_r2".to_string());
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("connect to postgres (set DATABASE_URL)");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("run migrations");

    let app = Router::new()
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/pages/{key}", get(get_page).put(put_page))
        .route("/api/pages/{key}/definition", get(get_definition))
        .route("/api/groups", get(list_groups).post(create_group))
        .route("/api/groups/{id}", patch(patch_group).delete(delete_group))
        .route("/api/specimens", post(create_specimen))
        .route(
            "/api/specimens/{id}",
            patch(patch_specimen).delete(delete_specimen),
        )
        .route("/api/specimens/{id}/logs", post(add_care_log))
        .route("/api/specimens/{id}/listing", post(create_listing))
        .route("/api/listings/{id}", patch(patch_listing))
        .route("/api/listings/{id}/withdraw", post(withdraw_listing))
        .route("/api/care_logs/{id}", delete(delete_care_log))
        .route("/api/species_notes/{name}", patch(patch_species_note))
        .with_state(AppState { pool });

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3001")
        .await
        .expect("bind 127.0.0.1:3001");
    println!("api: http://127.0.0.1:3001  (GET/PUT /api/pages/{{key}})");
    axum::serve(listener, app).await.expect("serve");
}

fn hydrate_err(e: HydrateError) -> ApiError {
    match e {
        HydrateError::MissingContext(_) => (StatusCode::BAD_REQUEST, e.to_string()),
        HydrateError::AuthRequired(_) => (StatusCode::UNAUTHORIZED, e.to_string()),
        HydrateError::SpecimenNotFound | HydrateError::ListingNotFound => {
            (StatusCode::NOT_FOUND, e.to_string())
        }
        _ => internal(e),
    }
}

// ── SDUI ページ配信 / 定義書込 ────────────────────────────────

#[derive(Deserialize)]
struct PageQuery {
    specimen: Option<Uuid>,
    listing: Option<Uuid>,
}

async fn load_definition(pool: &PgPool, key: &str) -> Result<ValidPageDefinition, ApiError> {
    let row: Option<(serde_json::Value,)> =
        sqlx::query_as("SELECT definition FROM page_definitions WHERE page_key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .map_err(internal)?;
    let Some((value,)) = row else {
        return Err((StatusCode::NOT_FOUND, format!("page not found: {key}")));
    };
    // 保存済み定義も配信前に必ず再検証する(定義はコードより長生きするため)
    ValidPageDefinition::from_value(value).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("stored definition is invalid: {e}"),
        )
    })
}

async fn get_page(
    State(st): State<AppState>,
    Path(key): Path<String>,
    Query(q): Query<PageQuery>,
    MaybeUser(user): MaybeUser,
) -> Result<Json<PageView>, ApiError> {
    let valid = load_definition(&st.pool, &key).await?;
    let ctx = HydrateCtx {
        specimen: q.specimen,
        listing: q.listing,
        user: user.map(|u| u.user_id),
    };
    let view = hydrate(&st.pool, valid.into_inner(), &ctx)
        .await
        .map_err(hydrate_err)?;
    Ok(Json(view))
}

/// 定義そのものを返す(定義編集UI・エージェントの読み戻し用)
async fn get_definition(
    State(st): State<AppState>,
    Path(key): Path<String>,
    _user: AuthUser,
) -> Result<Json<serde_json::Value>, ApiError> {
    let valid = load_definition(&st.pool, &key).await?;
    let value = serde_json::to_value(valid.get()).map_err(internal)?;
    Ok(Json(value))
}

async fn put_page(
    State(st): State<AppState>,
    Path(key): Path<String>,
    _user: AuthUser,
    body: String,
) -> Result<StatusCode, ApiError> {
    let valid = ValidPageDefinition::parse(&body).map_err(|e| {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("invalid definition: {e}"),
        )
    })?;
    let value = serde_json::to_value(valid.get()).map_err(internal)?;
    sqlx::query(
        "INSERT INTO page_definitions (page_key, definition, updated_by) \
         VALUES ($1, $2, 'api') \
         ON CONFLICT (page_key) DO UPDATE \
         SET definition = EXCLUDED.definition, updated_at = now(), updated_by = 'api'",
    )
    .bind(&key)
    .bind(&value)
    .execute(&st.pool)
    .await
    .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ── タブ(ユーザ定義グループ)─────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupInfo {
    group_id: Uuid,
    label: String,
}

async fn list_groups(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Vec<GroupInfo>>, ApiError> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, label FROM specimen_groups WHERE owner_id = $1 ORDER BY sort_order, label",
    )
    .bind(user.user_id)
    .fetch_all(&st.pool)
    .await
    .map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|(group_id, label)| GroupInfo { group_id, label })
            .collect(),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateGroup {
    label: String,
}

async fn create_group(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateGroup>,
) -> Result<(StatusCode, Json<GroupInfo>), ApiError> {
    let label = req.label.trim();
    if label.is_empty() {
        return Err((StatusCode::UNPROCESSABLE_ENTITY, "label is required".into()));
    }
    // 作成直後にクライアントが新タブをアクティブ化できるよう id を返す
    let (id,): (Uuid,) = sqlx::query_as(
        "INSERT INTO specimen_groups (owner_id, label, sort_order) \
         VALUES ($2, $1, (SELECT COALESCE(MAX(sort_order), 0) + 1 \
                          FROM specimen_groups WHERE owner_id = $2)) \
         RETURNING id",
    )
    .bind(label)
    .bind(user.user_id)
    .fetch_one(&st.pool)
    .await
    .map_err(domain_err)?;
    Ok((
        StatusCode::CREATED,
        Json(GroupInfo {
            group_id: id,
            label: label.to_string(),
        }),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchGroup {
    label: String,
}

async fn patch_group(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    AuthUser(user): AuthUser,
    Json(req): Json<PatchGroup>,
) -> Result<StatusCode, ApiError> {
    let label = req.label.trim();
    if label.is_empty() {
        return Err((StatusCode::UNPROCESSABLE_ENTITY, "label is required".into()));
    }
    let result =
        sqlx::query("UPDATE specimen_groups SET label = $2 WHERE id = $1 AND owner_id = $3")
            .bind(id)
            .bind(label)
            .bind(user.user_id)
            .execute(&st.pool)
            .await
            .map_err(domain_err)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "group not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// 削除ポリシー: 個体が所属しているタブと最後の1タブは削除不可(422)。
async fn delete_group(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    AuthUser(user): AuthUser,
) -> Result<StatusCode, ApiError> {
    let owned: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM specimen_groups WHERE id = $1 AND owner_id = $2")
            .bind(id)
            .bind(user.user_id)
            .fetch_optional(&st.pool)
            .await
            .map_err(internal)?;
    if owned.is_none() {
        return Err((StatusCode::NOT_FOUND, "group not found".into()));
    }
    let (in_use,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM specimens WHERE group_id = $1")
        .bind(id)
        .fetch_one(&st.pool)
        .await
        .map_err(internal)?;
    if in_use > 0 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "個体が所属しているタブは削除できません(先に個体を移動してください)".into(),
        ));
    }
    let (total,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM specimen_groups WHERE owner_id = $1")
            .bind(user.user_id)
            .fetch_one(&st.pool)
            .await
            .map_err(internal)?;
    if total <= 1 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "最後のタブは削除できません".into(),
        ));
    }
    let result = sqlx::query("DELETE FROM specimen_groups WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(user.user_id)
        .execute(&st.pool)
        .await
        .map_err(domain_err)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "group not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── 個体 ─────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CreateSpecimen {
    code: String,
    name: String,
    species_name: String,
    group_id: Uuid,
    scientific_name: Option<String>,
    sex: Option<String>,
    line: Option<String>,
    measure: Option<String>,
    /// "YYYY-MM-DD"
    egg_date: Option<String>,
    next_action: Option<String>,
}

async fn create_specimen(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateSpecimen>,
) -> Result<StatusCode, ApiError> {
    if req.code.trim().is_empty() || req.name.trim().is_empty() {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "code and name are required".into(),
        ));
    }
    check_group_owned(&st, req.group_id, user.user_id).await?;
    sqlx::query(
        "INSERT INTO specimens \
            (code, name, species_name, group_id, owner_id, scientific_name, sex, line, measure, egg_date, next_action) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11)",
    )
    .bind(req.code.trim())
    .bind(req.name.trim())
    .bind(req.species_name.trim())
    .bind(req.group_id)
    .bind(user.user_id)
    .bind(&req.scientific_name)
    .bind(&req.sex)
    .bind(&req.line)
    .bind(&req.measure)
    .bind(&req.egg_date)
    .bind(&req.next_action)
    .execute(&st.pool)
    .await
    .map_err(domain_err)?;
    Ok(StatusCode::CREATED)
}

/// グループがログインユーザの所有であることの確認(他人のタブへの追加/移動を防ぐ)
async fn check_group_owned(st: &AppState, group_id: Uuid, owner: Uuid) -> Result<(), ApiError> {
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM specimen_groups WHERE id = $1 AND owner_id = $2")
            .bind(group_id)
            .bind(owner)
            .fetch_optional(&st.pool)
            .await
            .map_err(internal)?;
    if row.is_none() {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "指定されたグループが存在しません".into(),
        ));
    }
    Ok(())
}

/// 部分更新。指定されたフィールドのみ反映(None は据え置き)。
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PatchSpecimen {
    name: Option<String>,
    species_name: Option<String>,
    scientific_name: Option<String>,
    sex: Option<String>,
    group_id: Option<Uuid>,
    line: Option<String>,
    measure: Option<String>,
    /// "YYYY-MM-DD"
    egg_date: Option<String>,
    next_action: Option<String>,
}

async fn patch_specimen(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    AuthUser(user): AuthUser,
    Json(req): Json<PatchSpecimen>,
) -> Result<StatusCode, ApiError> {
    if let Some(group_id) = req.group_id {
        check_group_owned(&st, group_id, user.user_id).await?;
    }
    let result = sqlx::query(
        "UPDATE specimens SET \
            name = COALESCE($2, name), \
            species_name = COALESCE($3, species_name), \
            scientific_name = COALESCE($4, scientific_name), \
            sex = COALESCE($5, sex), \
            group_id = COALESCE($6, group_id), \
            line = COALESCE($7, line), \
            measure = COALESCE($8, measure), \
            egg_date = COALESCE($9::date, egg_date), \
            next_action = COALESCE($10, next_action), \
            updated_at = now() \
         WHERE id = $1 AND owner_id = $11",
    )
    .bind(id)
    .bind(&req.name)
    .bind(&req.species_name)
    .bind(&req.scientific_name)
    .bind(&req.sex)
    .bind(req.group_id)
    .bind(&req.line)
    .bind(&req.measure)
    .bind(&req.egg_date)
    .bind(&req.next_action)
    .bind(user.user_id)
    .execute(&st.pool)
    .await
    .map_err(domain_err)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "specimen not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// 個体がログインユーザの所有であることの確認(なければ 404)。
/// executor はプールでもトランザクションでも受けられる。
async fn ensure_specimen_owned<'e, E>(executor: E, id: Uuid, owner: Uuid) -> Result<(), ApiError>
where
    E: sqlx::PgExecutor<'e>,
{
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM specimens WHERE id = $1 AND owner_id = $2")
            .bind(id)
            .bind(owner)
            .fetch_optional(executor)
            .await
            .map_err(internal)?;
    if row.is_none() {
        return Err((StatusCode::NOT_FOUND, "specimen not found".into()));
    }
    Ok(())
}

/// 個体の削除。
/// - 出品中(active)の出品がある個体は削除不可(422)— UIを信用せずサーバ+DB制約(RESTRICT)で二重防御
/// - 過去の出品(取り下げ等)は個体と一緒に削除、飼育記録は CASCADE で削除
async fn delete_specimen(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    AuthUser(user): AuthUser,
) -> Result<StatusCode, ApiError> {
    let mut tx = st.pool.begin().await.map_err(internal)?;
    ensure_specimen_owned(&mut *tx, id, user.user_id).await?;
    let (active,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM listings WHERE specimen_id = $1 AND status = 'active'",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    if active > 0 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "出品中の個体は削除できません(先に「出品を取り下げる」を実行してください)".into(),
        ));
    }
    sqlx::query("DELETE FROM listings WHERE specimen_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query("DELETE FROM specimens WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(user.user_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ── 飼育記録 ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AddCareLog {
    /// "YYYY-MM-DD"
    at: String,
    kind: String,
    body: String,
}

async fn add_care_log(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    AuthUser(user): AuthUser,
    Json(req): Json<AddCareLog>,
) -> Result<StatusCode, ApiError> {
    if req.kind.trim().is_empty() {
        return Err((StatusCode::UNPROCESSABLE_ENTITY, "kind is required".into()));
    }
    ensure_specimen_owned(&st.pool, id, user.user_id).await?;
    sqlx::query(
        "INSERT INTO care_logs (specimen_id, at, kind, body) VALUES ($1, $2::date, $3, $4)",
    )
    .bind(id)
    .bind(&req.at)
    .bind(req.kind.trim())
    .bind(&req.body)
    .execute(&st.pool)
    .await
    .map_err(domain_err)?;
    Ok(StatusCode::CREATED)
}

async fn delete_care_log(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    AuthUser(user): AuthUser,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query(
        "DELETE FROM care_logs cl USING specimens s \
         WHERE cl.id = $1 AND s.id = cl.specimen_id AND s.owner_id = $2",
    )
    .bind(id)
    .bind(user.user_id)
    .execute(&st.pool)
    .await
    .map_err(internal)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "care log not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── 出品(個体⇔listingの紐付け)────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CreateListing {
    title: String,
    price_amount: i64,
    seller_comment: Option<String>,
}

/// 個体を出品する。スペック(学名/性別/サイズ)は個体から転記。
/// 1個体につき出品中は1件まで(部分ユニークインデックスで強制)。
async fn create_listing(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateListing>,
) -> Result<StatusCode, ApiError> {
    if req.title.trim().is_empty() {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "タイトルを入力してください".into(),
        ));
    }
    if req.price_amount <= 0 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "価格は1円以上で入力してください".into(),
        ));
    }
    let sp: Option<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT scientific_name, sex, measure FROM specimens WHERE id = $1 AND owner_id = $2",
    )
    .bind(id)
    .bind(user.user_id)
    .fetch_optional(&st.pool)
    .await
    .map_err(internal)?;
    let Some((scientific_name, sex, measure)) = sp else {
        return Err((StatusCode::NOT_FOUND, "specimen not found".into()));
    };
    sqlx::query(
        "INSERT INTO listings \
            (title, price_amount, specimen_id, seller_id, seller_comment, \
             scientific_name, sex, size_note, status) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')",
    )
    .bind(req.title.trim())
    .bind(req.price_amount)
    .bind(id)
    .bind(user.user_id)
    .bind(&req.seller_comment)
    .bind(&scientific_name)
    .bind(&sex)
    .bind(&measure)
    .execute(&st.pool)
    .await
    .map_err(|_| {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            "出品できません(すでに出品中の可能性があります)".into(),
        )
    })?;
    Ok(StatusCode::CREATED)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PatchListing {
    title: Option<String>,
    price_amount: Option<i64>,
    seller_comment: Option<String>,
}

async fn patch_listing(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    AuthUser(user): AuthUser,
    Json(req): Json<PatchListing>,
) -> Result<StatusCode, ApiError> {
    if let Some(price) = req.price_amount {
        if price <= 0 {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                "価格は1円以上で入力してください".into(),
            ));
        }
    }
    let result = sqlx::query(
        "UPDATE listings SET \
            title = COALESCE($2, title), \
            price_amount = COALESCE($3, price_amount), \
            seller_comment = COALESCE($4, seller_comment) \
         WHERE id = $1 AND seller_id = $5",
    )
    .bind(id)
    .bind(&req.title)
    .bind(req.price_amount)
    .bind(&req.seller_comment)
    .bind(user.user_id)
    .execute(&st.pool)
    .await
    .map_err(domain_err)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "listing not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// 出品の取り下げ。市場から消え、個体は再出品可能になる。
async fn withdraw_listing(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
    AuthUser(user): AuthUser,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query(
        "UPDATE listings SET status = 'withdrawn' \
         WHERE id = $1 AND seller_id = $2 AND status = 'active'",
    )
    .bind(id)
    .bind(user.user_id)
    .execute(&st.pool)
    .await
    .map_err(internal)?;
    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "出品が見つかりません(取り下げ済みの可能性)".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── 種の飼育メモ ─────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchSpeciesNote {
    note: String,
}

async fn patch_species_note(
    State(st): State<AppState>,
    Path(name): Path<String>,
    AuthUser(user): AuthUser,
    Json(req): Json<PatchSpeciesNote>,
) -> Result<StatusCode, ApiError> {
    sqlx::query(
        "INSERT INTO species_notes (owner_id, species_name, note) VALUES ($1, $2, $3) \
         ON CONFLICT (owner_id, species_name) DO UPDATE SET note = EXCLUDED.note",
    )
    .bind(user.user_id)
    .bind(&name)
    .bind(&req.note)
    .execute(&st.pool)
    .await
    .map_err(domain_err)?;
    Ok(StatusCode::NO_CONTENT)
}
