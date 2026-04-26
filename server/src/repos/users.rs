//! users + user_sessions への永続化 (Phase 9.C / DB設計書 v2 §3.3)
//!
//! **責務 (本 PR / skeleton)**:
//!   - sqlx で users テーブルから 1 件取得する低位 API を提供
//!   - DB 不在時 (= pool=None) は in-memory fallback で 0004 seed と同値の 1 件を返す
//!   - handler 切替は後続タスクに分離 (本 PR は repo の足場のみ)
//!
//! **設計判断**:
//!   - id = UUID, public_id = handle ("t_yamada") 文字列
//!   - role は CHECK 制約で値域固定 (= "breeder" / "admin" / "shop_owner")
//!   - email は UNIQUE / Optional
//!   - user_sessions は本 skeleton では扱わない (= Cookie middleware 導入時に追加)
//!
//! **将来 (= 後続 Phase 9.C step)**:
//!   - `find_by_session_token(token: &str)` で auth middleware に接続
//!   - `repos::users::cached_anonymous_user_id()` で products.created_by の自動埋め

use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub public_id: String,                              // "t_yamada"
    pub name: String,                                   // "山田 徹"
    pub role: String,                                   // "breeder" / "admin" / "shop_owner"
    pub email: Option<String>,
    pub avatar_initial: String,
    pub is_active: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum UserRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API (skeleton)
// ──────────────────────────────────────────────────────────────────────

/// public_id (= "t_yamada") で 1 件取得。pool=None なら in-memory fallback。
pub async fn find_by_public_id(
    pool: Option<&PgPool>,
    public_id: &str,
) -> Result<Option<UserRow>, UserRepoError> {
    match pool {
        Some(p) => find_by_public_id_db(p, public_id).await,
        None => Ok(memory_users()
            .into_iter()
            .find(|u| u.public_id == public_id)),
    }
}

/// 内部 UUID で 1 件取得。pool=None なら in-memory fallback。
pub async fn find_by_id(
    pool: Option<&PgPool>,
    id: Uuid,
) -> Result<Option<UserRow>, UserRepoError> {
    match pool {
        Some(p) => find_by_id_db(p, id).await,
        None => Ok(memory_users().into_iter().find(|u| u.id == id)),
    }
}

/// active 全 user を public_id 昇順で返す。pool=None なら in-memory fallback。
/// 列挙系ハンドラ (= /api/v1/admin/users 等) 用。
pub async fn find_all_active(
    pool: Option<&PgPool>,
) -> Result<Vec<UserRow>, UserRepoError> {
    match pool {
        Some(p) => find_all_active_db(p).await,
        None => Ok(memory_users()
            .into_iter()
            .filter(|u| u.is_active)
            .collect()),
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn find_by_public_id_db(
    pool: &PgPool,
    public_id: &str,
) -> Result<Option<UserRow>, UserRepoError> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, public_id, name, role, email, avatar_initial, is_active
        FROM users
        WHERE public_id = $1
        "#,
    )
    .bind(public_id)
    .fetch_optional(pool)
    .await
    .map_err(UserRepoError::Db)
}

async fn find_by_id_db(pool: &PgPool, id: Uuid) -> Result<Option<UserRow>, UserRepoError> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, public_id, name, role, email, avatar_initial, is_active
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(UserRepoError::Db)
}

async fn find_all_active_db(pool: &PgPool) -> Result<Vec<UserRow>, UserRepoError> {
    sqlx::query_as::<_, UserRow>(
        r#"
        SELECT id, public_id, name, role, email, avatar_initial, is_active
        FROM users
        WHERE is_active = true
        ORDER BY public_id
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(UserRepoError::Db)
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback (= 0004_users.sql の seed と同値)
// ──────────────────────────────────────────────────────────────────────
//
// id (UUID) は memory 生成のたびに変わると find_by_id が安定しないため、
// 固定 UUID を持たせる (= テストで前提にしないが、同一プロセス内で安定)。
//
// note: in-memory fallback は MVP の dev 起動 / DB 切れ時のみで使う。
// 本番では DB 経由で読まれる前提なので、UUID の固定値はあくまで「便宜」。

fn memory_users() -> Vec<UserRow> {
    vec![UserRow {
        // 固定 UUID v4 (= test 時に find_by_id 等で参照しやすい安定値)
        id: Uuid::parse_str("a0a0a0a0-0000-4000-8000-00000000a0a0").expect("valid uuid"),
        public_id: "t_yamada".to_string(),
        name: "山田 徹".to_string(),
        role: "breeder".to_string(),
        email: None,
        avatar_initial: "山".to_string(),
        is_active: true,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn in_memory_find_by_public_id_hits() {
        let u = find_by_public_id(None, "t_yamada").await.unwrap();
        assert!(u.is_some());
        let u = u.unwrap();
        assert_eq!(u.name, "山田 徹");
        assert_eq!(u.role, "breeder");
        assert_eq!(u.avatar_initial, "山");
        assert!(u.is_active);
        assert!(u.email.is_none());
    }

    #[tokio::test]
    async fn in_memory_find_by_public_id_misses() {
        let u = find_by_public_id(None, "ghost").await.unwrap();
        assert!(u.is_none());
    }

    #[tokio::test]
    async fn in_memory_find_all_active_returns_one() {
        let users = find_all_active(None).await.unwrap();
        assert_eq!(users.len(), 1);
        assert_eq!(users[0].public_id, "t_yamada");
    }

    #[tokio::test]
    async fn in_memory_find_by_id_hits_with_seeded_uuid() {
        let seeded = memory_users()[0].id;
        let u = find_by_id(None, seeded).await.unwrap();
        assert!(u.is_some());
        assert_eq!(u.unwrap().public_id, "t_yamada");
    }

    #[tokio::test]
    async fn in_memory_find_by_id_misses_for_random_uuid() {
        let other = Uuid::new_v4();
        let u = find_by_id(None, other).await.unwrap();
        assert!(u.is_none());
    }

    #[test]
    fn memory_user_role_is_in_check_constraint_set() {
        // 0004_users.sql の CHECK (role IN ('breeder', 'admin', 'shop_owner')) 互換であること
        let u = &memory_users()[0];
        assert!(["breeder", "admin", "shop_owner"].contains(&u.role.as_str()));
    }
}
