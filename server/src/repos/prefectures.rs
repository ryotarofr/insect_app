//! prefectures (47 都道府県) への永続化 (Phase 9.B 段階 6)
//!
//! **責務**:
//!   - sqlx で prefectures テーブルから 47 行を取得し sort_order 順で返す
//!   - DB 不在時 (= pool=None) は in-memory fallback で 0002 seed と同値の 47 件を返す
//!   - 既存 `cards.rs::japan_prefectures()` の置き換え先として `cached_prefectures_ja()`
//!     を提供 (= name_ja の Vec<String>)
//!
//! **設計判断**:
//!   - text PK (= JIS X 0401 の zero-pad "01"〜"47") をそのまま String で持つ
//!   - i18n は name_ja / name_en の 2 列構造 (= sub-table を作るほどの量ではない)
//!   - sort_order は JIS 順 1〜47 で固定。新元号で都道府県が変わったらここを並び替え
//!   - 47 件は不変 master data → cache はプロセス寿命と等価で OK

use std::sync::{OnceLock, RwLock};

use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct PrefectureView {
    pub code: String,        // "01" 〜 "47"
    pub name_ja: String,     // "北海道"
    pub name_en: Option<String>, // "Hokkaido"
    pub sort_order: i32,     // JIS 順 1〜47
}

#[derive(Debug, thiserror::Error)]
pub enum PrefectureRepoError {
    #[error("database error: {0}")]
    Db(#[source] sqlx::Error),
}

// ──────────────────────────────────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────────────────────────────────

/// 47 都道府県を sort_order 昇順で返す。pool=None なら in-memory fallback。
pub async fn find_all(
    pool: Option<&PgPool>,
) -> Result<Vec<PrefectureView>, PrefectureRepoError> {
    match pool {
        Some(p) => find_all_db(p).await,
        None => Ok(memory_prefectures()),
    }
}

/// 起動時に DB から全 prefectures を読み込み、sort_order 順の Vec で持つ。
pub async fn warm_prefectures_cache(
    pool: Option<&PgPool>,
) -> Result<(), PrefectureRepoError> {
    let mut prefs = find_all(pool).await?;
    prefs.sort_by_key(|p| p.sort_order);
    if let Ok(mut w) = prefectures_cache().write() {
        *w = Some(prefs);
    }
    Ok(())
}

/// warm 後の Vec を返す。warm 前は in-memory fallback。
pub fn cached_prefectures() -> Vec<PrefectureView> {
    if let Ok(r) = prefectures_cache().read()
        && let Some(v) = r.as_ref()
    {
        return v.clone();
    }
    memory_prefectures()
}

/// name_ja のみ Vec<String> で返す (= cards.rs::japan_prefectures() 置換用)。
pub fn cached_prefectures_ja() -> Vec<String> {
    cached_prefectures().into_iter().map(|p| p.name_ja).collect()
}

fn prefectures_cache() -> &'static RwLock<Option<Vec<PrefectureView>>> {
    static C: OnceLock<RwLock<Option<Vec<PrefectureView>>>> = OnceLock::new();
    C.get_or_init(|| RwLock::new(None))
}

#[cfg(test)]
pub fn reset_prefectures_cache_for_test() {
    if let Ok(mut w) = prefectures_cache().write() {
        *w = None;
    }
}

// ──────────────────────────────────────────────────────────────────────
// DB 実装
// ──────────────────────────────────────────────────────────────────────

async fn find_all_db(pool: &PgPool) -> Result<Vec<PrefectureView>, PrefectureRepoError> {
    let rows: Vec<PrefectureView> = sqlx::query_as::<_, PrefectureView>(
        r#"
        SELECT code, name_ja, name_en, sort_order
        FROM prefectures
        ORDER BY sort_order
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(PrefectureRepoError::Db)?;
    Ok(rows)
}

// ──────────────────────────────────────────────────────────────────────
// in-memory fallback (= 0002_master_data.sql の seed と完全一致)
// ──────────────────────────────────────────────────────────────────────

fn memory_prefectures() -> Vec<PrefectureView> {
    // (code, name_ja, name_en, sort_order) のフラット表現で書き、最後に PrefectureView
    // に変換する。sort_order の付け間違いを防ぐため明示的に番号を持たせる。
    const SEED: &[(&str, &str, &str, i32)] = &[
        ("01", "北海道",   "Hokkaido",  1),
        ("02", "青森県",   "Aomori",    2),
        ("03", "岩手県",   "Iwate",     3),
        ("04", "宮城県",   "Miyagi",    4),
        ("05", "秋田県",   "Akita",     5),
        ("06", "山形県",   "Yamagata",  6),
        ("07", "福島県",   "Fukushima", 7),
        ("08", "茨城県",   "Ibaraki",   8),
        ("09", "栃木県",   "Tochigi",   9),
        ("10", "群馬県",   "Gunma",    10),
        ("11", "埼玉県",   "Saitama",  11),
        ("12", "千葉県",   "Chiba",    12),
        ("13", "東京都",   "Tokyo",    13),
        ("14", "神奈川県", "Kanagawa", 14),
        ("15", "新潟県",   "Niigata",  15),
        ("16", "富山県",   "Toyama",   16),
        ("17", "石川県",   "Ishikawa", 17),
        ("18", "福井県",   "Fukui",    18),
        ("19", "山梨県",   "Yamanashi", 19),
        ("20", "長野県",   "Nagano",   20),
        ("21", "岐阜県",   "Gifu",     21),
        ("22", "静岡県",   "Shizuoka", 22),
        ("23", "愛知県",   "Aichi",    23),
        ("24", "三重県",   "Mie",      24),
        ("25", "滋賀県",   "Shiga",    25),
        ("26", "京都府",   "Kyoto",    26),
        ("27", "大阪府",   "Osaka",    27),
        ("28", "兵庫県",   "Hyogo",    28),
        ("29", "奈良県",   "Nara",     29),
        ("30", "和歌山県", "Wakayama", 30),
        ("31", "鳥取県",   "Tottori",  31),
        ("32", "島根県",   "Shimane",  32),
        ("33", "岡山県",   "Okayama",  33),
        ("34", "広島県",   "Hiroshima", 34),
        ("35", "山口県",   "Yamaguchi", 35),
        ("36", "徳島県",   "Tokushima", 36),
        ("37", "香川県",   "Kagawa",   37),
        ("38", "愛媛県",   "Ehime",    38),
        ("39", "高知県",   "Kochi",    39),
        ("40", "福岡県",   "Fukuoka",  40),
        ("41", "佐賀県",   "Saga",     41),
        ("42", "長崎県",   "Nagasaki", 42),
        ("43", "熊本県",   "Kumamoto", 43),
        ("44", "大分県",   "Oita",     44),
        ("45", "宮崎県",   "Miyazaki", 45),
        ("46", "鹿児島県", "Kagoshima", 46),
        ("47", "沖縄県",   "Okinawa",  47),
    ];

    SEED.iter()
        .map(|(code, ja, en, sort)| PrefectureView {
            code: code.to_string(),
            name_ja: ja.to_string(),
            name_en: Some(en.to_string()),
            sort_order: *sort,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn in_memory_returns_47_in_jis_order() {
        let prefs = find_all(None).await.unwrap();
        assert_eq!(prefs.len(), 47);
        assert_eq!(prefs[0].name_ja, "北海道");
        assert_eq!(prefs[0].code, "01");
        assert_eq!(prefs[46].name_ja, "沖縄県");
        assert_eq!(prefs[46].code, "47");
    }

    #[tokio::test]
    async fn warm_prefectures_cache_in_memory_populates_47() {
        reset_prefectures_cache_for_test();
        warm_prefectures_cache(None).await.unwrap();
        let prefs = cached_prefectures();
        assert_eq!(prefs.len(), 47);
        // 並びは sort_order 通り (= JIS 順)
        for (i, p) in prefs.iter().enumerate() {
            assert_eq!(p.sort_order, (i + 1) as i32, "sort_order at {i}");
        }
    }

    #[tokio::test]
    async fn cached_prefectures_ja_returns_47_strings_in_order() {
        reset_prefectures_cache_for_test();
        warm_prefectures_cache(None).await.unwrap();
        let names = cached_prefectures_ja();
        assert_eq!(names.len(), 47);
        assert_eq!(names[0], "北海道");
        assert_eq!(names[12], "東京都"); // index 12 = sort_order 13 = 東京
        assert_eq!(names[46], "沖縄県");
    }

    #[test]
    fn memory_prefectures_carry_english_names() {
        let prefs = memory_prefectures();
        let tokyo = prefs.iter().find(|p| p.name_ja == "東京都").unwrap();
        assert_eq!(tokyo.name_en.as_deref(), Some("Tokyo"));
        let okinawa = prefs.iter().find(|p| p.name_ja == "沖縄県").unwrap();
        assert_eq!(okinawa.name_en.as_deref(), Some("Okinawa"));
    }
}
