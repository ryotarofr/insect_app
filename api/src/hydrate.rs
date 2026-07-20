//! 定義(PageDefinition)→ ビュー(PageView)の変換。
//!
//! 静的ブロック(Text / Markdown / Media / Cta)は素通し、データバインドブロックだけ解決する。
//! ここがサーバの「組み立て」の全て — 画面構成そのものはコードに存在しない。
//!
//! **コンテキスト付き hydration**: 個体詳細・出品詳細のようなページは定義1枚を共有し、
//! `?specimen={id}` / `?listing={id}` / ログインユーザ のコンテキストで解決する。
//! コンテキスト必須ブロックがコンテキスト無しで呼ばれたら MissingContext(400)/
//! AuthRequired(401)。

use sqlx::PgPool;
use uuid::Uuid;

use crate::sdui::{
    AlertItem, Card, CareLogEntry, Currency, DefBlock, FeedRegions, GroupTabItem, ListingItem,
    ListingQuery, ListingSeller, ListingSort, ListingState, Page, PageDefinition, PageView,
    SitePath, SpecAttr, SpecimenGroup, SpecimenItem, TodoItem, ViewBlock,
};

pub struct HydrateCtx {
    pub specimen: Option<Uuid>,
    pub listing: Option<Uuid>,
    /// 選択中グループ(`?group=`)。group_tabs / specimen_rows が使う。
    /// 未指定・無効(他人/不存在)はエラーにせずサーバの既定選択にフォールバックする
    /// (所有チェックは各クエリの owner_id 条件で担保される)。
    pub group: Option<Uuid>,
    /// ログインユーザ。飼育系ブロックはこれで自分のデータだけを hydrate する
    /// (定義は全ユーザ共有・データはユーザ毎)
    pub user: Option<Uuid>,
}

#[derive(Debug, thiserror::Error)]
pub enum HydrateError {
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error("block {0:?} requires context (?specimen= / ?listing=)")]
    MissingContext(&'static str),
    #[error("block {0:?} requires login")]
    AuthRequired(&'static str),
    #[error("specimen not found")]
    SpecimenNotFound,
    #[error("listing not found")]
    ListingNotFound,
}

pub async fn hydrate(
    pool: &PgPool,
    def: PageDefinition,
    ctx: &HydrateCtx,
) -> Result<PageView, HydrateError> {
    let Page::Feed { regions } = def.page;
    let mut out = FeedRegions::<ViewBlock> {
        header: Vec::new(),
        body: Vec::new(),
        footer: Vec::new(),
    };
    for (src, dst) in [
        (regions.header, &mut out.header),
        (regions.body, &mut out.body),
        (regions.footer, &mut out.footer),
    ] {
        for card in src {
            let mut blocks = Vec::with_capacity(card.blocks.len());
            for block in card.blocks {
                blocks.push(hydrate_block(pool, block, ctx).await?);
            }
            dst.push(Card {
                key: card.key,
                size: card.size,
                tone: card.tone,
                layout: card.layout,
                blocks,
            });
        }
    }
    Ok(PageView {
        schema_version: def.schema_version,
        page: Page::Feed { regions: out },
    })
}

async fn hydrate_block(
    pool: &PgPool,
    block: DefBlock,
    ctx: &HydrateCtx,
) -> Result<ViewBlock, HydrateError> {
    Ok(match block {
        DefBlock::Text {
            key,
            role,
            text,
            editable,
        } => ViewBlock::Text {
            key,
            role,
            text,
            editable,
        },
        DefBlock::Markdown {
            key,
            markdown,
            editable,
        } => ViewBlock::Markdown {
            key,
            markdown,
            editable,
        },
        DefBlock::Media { key, src, alt } => ViewBlock::Media { key, src, alt },
        DefBlock::Cta {
            key,
            intent,
            label,
            href,
        } => ViewBlock::Cta {
            key,
            intent,
            label,
            href,
        },
        // 構成は定義・振る舞いはクライアントの閉じた動詞。サーバはパススルーのみ
        DefBlock::ActionButton {
            key,
            intent,
            label,
            action,
        } => ViewBlock::ActionButton {
            key,
            intent,
            label,
            action,
        },
        DefBlock::ListingGrid {
            key,
            query,
            empty_text,
        } => {
            let owner = match query.seller {
                Some(ListingSeller::Mine) => {
                    Some(ctx.user.ok_or(HydrateError::AuthRequired("listing_grid"))?)
                }
                None => None,
            };
            ViewBlock::ListingGrid {
                key,
                items: fetch_listings(pool, &query, owner).await?,
                empty_text,
            }
        }
        DefBlock::SpecimenList { key } => {
            let owner = ctx
                .user
                .ok_or(HydrateError::AuthRequired("specimen_list"))?;
            ViewBlock::SpecimenList {
                key,
                groups: fetch_specimen_groups(pool, owner).await?,
            }
        }
        DefBlock::GroupTabs { key } => {
            let owner = ctx.user.ok_or(HydrateError::AuthRequired("group_tabs"))?;
            let groups = fetch_group_tabs(pool, owner).await?;
            ViewBlock::GroupTabs {
                key,
                active_group_id: pick_active_group(&groups, ctx.group),
                groups,
            }
        }
        DefBlock::SpecimenRows { key, empty_text } => {
            let owner = ctx
                .user
                .ok_or(HydrateError::AuthRequired("specimen_rows"))?;
            let tabs = fetch_group_tabs(pool, owner).await?;
            let group_id = pick_active_group(&tabs, ctx.group);
            let items = match group_id {
                Some(g) => fetch_specimen_rows(pool, owner, g).await?,
                None => Vec::new(),
            };
            ViewBlock::SpecimenRows {
                key,
                group_id,
                items,
                empty_text,
            }
        }
        DefBlock::SpecimenProfile { key } => {
            let owner = ctx
                .user
                .ok_or(HydrateError::AuthRequired("specimen_profile"))?;
            let id = ctx
                .specimen
                .ok_or(HydrateError::MissingContext("specimen_profile"))?;
            fetch_profile(pool, id, owner, key).await?
        }
        DefBlock::CareLogList { key, empty_text } => {
            let owner = ctx
                .user
                .ok_or(HydrateError::AuthRequired("care_log_list"))?;
            let id = ctx
                .specimen
                .ok_or(HydrateError::MissingContext("care_log_list"))?;
            ViewBlock::CareLogList {
                key,
                specimen_id: id,
                entries: fetch_care_logs(pool, id, owner).await?,
                empty_text,
            }
        }
        DefBlock::SpeciesNote { key } => {
            let owner = ctx.user.ok_or(HydrateError::AuthRequired("species_note"))?;
            let id = ctx
                .specimen
                .ok_or(HydrateError::MissingContext("species_note"))?;
            fetch_species_note(pool, id, owner, key).await?
        }
        DefBlock::ListingHero { key } => {
            let id = ctx
                .listing
                .ok_or(HydrateError::MissingContext("listing_hero"))?;
            let r = fetch_listing_detail(pool, id).await?;
            ViewBlock::ListingHero {
                key,
                listing_id: r.id,
                title: r.title,
                scientific_name: r.scientific_name,
                price_amount: r.price_amount,
                currency: Currency::Jpy,
                status: status_label(&r.status),
                seller_comment: r.seller_comment,
                image_src: r.image_src.and_then(|s| SitePath::try_from(s).ok()),
            }
        }
        DefBlock::ListingSpec { key, empty_text } => {
            let id = ctx
                .listing
                .ok_or(HydrateError::MissingContext("listing_spec"))?;
            let r = fetch_listing_detail(pool, id).await?;
            let mut attrs = Vec::new();
            for (label, value) in [
                ("性別", r.sex),
                ("サイズ", r.size_note),
                ("累代", r.line),
                ("産地", r.locality),
            ] {
                if let Some(value) = value {
                    attrs.push(SpecAttr {
                        label: label.to_string(),
                        value,
                    });
                }
            }
            ViewBlock::ListingSpec {
                key,
                attrs,
                empty_text,
            }
        }
        DefBlock::ListingSettings { key } => {
            let owner = ctx
                .user
                .ok_or(HydrateError::AuthRequired("listing_settings"))?;
            let id = ctx
                .specimen
                .ok_or(HydrateError::MissingContext("listing_settings"))?;
            fetch_listing_settings(pool, id, owner, key).await?
        }
        DefBlock::TodoList { key, empty_text } => {
            let owner = ctx.user.ok_or(HydrateError::AuthRequired("todo_list"))?;
            ViewBlock::TodoList {
                key,
                items: fetch_todos(pool, owner).await?,
                empty_text,
            }
        }
        DefBlock::CareAlerts { key, empty_text } => {
            let owner = ctx.user.ok_or(HydrateError::AuthRequired("care_alerts"))?;
            let prefs: Option<(bool, i32)> = sqlx::query_as(
                "SELECT enabled, stale_days FROM notification_prefs WHERE owner_id = $1",
            )
            .bind(owner)
            .fetch_optional(pool)
            .await?;
            // 行が無いユーザは既定値(0023 の DEFAULT と一致させる)
            let (enabled, stale_days) = prefs.unwrap_or((true, 7));
            let items = if enabled {
                fetch_care_alerts(pool, owner, stale_days).await?
            } else {
                Vec::new()
            };
            ViewBlock::CareAlerts {
                key,
                enabled,
                stale_days: u32::try_from(stale_days).unwrap_or(7),
                items,
                empty_text,
            }
        }
    })
}

// ── listings ─────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct ListingRow {
    id: Uuid,
    title: String,
    price_amount: i64,
    image_src: Option<String>,
    scientific_name: Option<String>,
}

async fn fetch_listings(
    pool: &PgPool,
    q: &ListingQuery,
    owner: Option<Uuid>,
) -> Result<Vec<ListingItem>, sqlx::Error> {
    // sort / seller はクローズドな enum なので SQL は静的文字列から選ぶだけ(injection 余地なし)
    let mine = owner.is_some();
    let sql = match (q.sort, mine) {
        (ListingSort::Newest, false) => {
            "SELECT id, title, price_amount, image_src, scientific_name FROM listings \
             WHERE status <> 'withdrawn' ORDER BY created_at DESC LIMIT $1"
        }
        (ListingSort::PriceAsc, false) => {
            "SELECT id, title, price_amount, image_src, scientific_name FROM listings \
             WHERE status <> 'withdrawn' ORDER BY price_amount ASC LIMIT $1"
        }
        (ListingSort::PriceDesc, false) => {
            "SELECT id, title, price_amount, image_src, scientific_name FROM listings \
             WHERE status <> 'withdrawn' ORDER BY price_amount DESC LIMIT $1"
        }
        (ListingSort::Newest, true) => {
            "SELECT id, title, price_amount, image_src, scientific_name FROM listings \
             WHERE seller_id = $2 AND status = 'active' ORDER BY created_at DESC LIMIT $1"
        }
        (ListingSort::PriceAsc, true) => {
            "SELECT id, title, price_amount, image_src, scientific_name FROM listings \
             WHERE seller_id = $2 AND status = 'active' ORDER BY price_amount ASC LIMIT $1"
        }
        (ListingSort::PriceDesc, true) => {
            "SELECT id, title, price_amount, image_src, scientific_name FROM listings \
             WHERE seller_id = $2 AND status = 'active' ORDER BY price_amount DESC LIMIT $1"
        }
    };
    let mut query = sqlx::query_as::<_, ListingRow>(sql).bind(i64::from(q.limit));
    if let Some(owner) = owner {
        query = query.bind(owner);
    }
    let rows: Vec<ListingRow> = query.fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|r| ListingItem {
            href: SitePath::try_from(format!("/listings/{}", r.id))
                .expect("server-built path is always valid"),
            image_src: r.image_src.and_then(|s| SitePath::try_from(s).ok()),
            listing_id: r.id,
            title: r.title,
            scientific_name: r.scientific_name,
            price_amount: r.price_amount,
            currency: Currency::Jpy,
        })
        .collect())
}

// ── listing detail(コンテキスト解決) ─────────────────────────

#[derive(sqlx::FromRow)]
struct ListingDetailRow {
    id: Uuid,
    title: String,
    price_amount: i64,
    image_src: Option<String>,
    scientific_name: Option<String>,
    sex: Option<String>,
    size_note: Option<String>,
    line: Option<String>,
    locality: Option<String>,
    seller_comment: Option<String>,
    status: String,
}

async fn fetch_listing_detail(pool: &PgPool, id: Uuid) -> Result<ListingDetailRow, HydrateError> {
    let row: Option<ListingDetailRow> = sqlx::query_as(
        "SELECT id, title, price_amount, image_src, scientific_name, sex, size_note, \
                line, locality, seller_comment, status \
         FROM listings WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.ok_or(HydrateError::ListingNotFound)
}

/// status の表示ラベル。未知値は生のまま返す(進化規約4の精神)
fn status_label(s: &str) -> String {
    match s {
        "active" => "出品中",
        "trading" => "取引中",
        "sold" => "売却済",
        "withdrawn" => "取り下げ",
        other => other,
    }
    .to_string()
}

/// 3桁区切りの円表記(一覧hint用)
fn fmt_yen(amount: i64) -> String {
    let digits = amount.abs().to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    format!("{}¥{}", if amount < 0 { "-" } else { "" }, out)
}

/// コンテキスト個体の出品設定(未出品なら listing = None)
async fn fetch_listing_settings(
    pool: &PgPool,
    specimen_id: Uuid,
    owner: Uuid,
    key: crate::sdui::BlockKey,
) -> Result<ViewBlock, HydrateError> {
    let sp: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT name, measure FROM specimens WHERE id = $1 AND owner_id = $2")
            .bind(specimen_id)
            .bind(owner)
            .fetch_optional(pool)
            .await?;
    let Some((name, measure)) = sp else {
        return Err(HydrateError::SpecimenNotFound);
    };
    let suggested_title = match measure {
        Some(m) => format!("{name} {m}"),
        None => name,
    };
    let row: Option<(Uuid, String, i64, String, Option<String>)> = sqlx::query_as(
        "SELECT id, title, price_amount, status, seller_comment \
         FROM listings WHERE specimen_id = $1 AND status = 'active'",
    )
    .bind(specimen_id)
    .fetch_optional(pool)
    .await?;
    Ok(ViewBlock::ListingSettings {
        key,
        specimen_id,
        suggested_title,
        listing: row.map(
            |(id, title, price_amount, status, seller_comment)| ListingState {
                listing_id: id,
                title,
                price_amount,
                currency: Currency::Jpy,
                status: status_label(&status),
                seller_comment,
            },
        ),
    })
}

// ── group tabs / specimen rows(Phase 2: specimen_list の分割)──

#[derive(sqlx::FromRow)]
struct TabRow {
    group_id: Uuid,
    label: String,
    count: i64,
}

/// ログインユーザのタブ(グループ+件数のみ)。行は specimen_rows が選択グループ分だけ解決する
/// = 旧 specimen_list の「全グループ×全行を毎回解決」の置き換え。
async fn fetch_group_tabs(pool: &PgPool, owner: Uuid) -> Result<Vec<GroupTabItem>, sqlx::Error> {
    let rows: Vec<TabRow> = sqlx::query_as(
        "SELECT g.id AS group_id, g.label, COUNT(s.id) AS count \
         FROM specimen_groups g \
         LEFT JOIN specimens s ON s.group_id = g.id AND s.owner_id = $1 \
         WHERE g.owner_id = $1 \
         GROUP BY g.id, g.label, g.sort_order \
         ORDER BY g.sort_order, g.label",
    )
    .bind(owner)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| GroupTabItem {
            group_id: r.group_id,
            label: r.label,
            count: u32::try_from(r.count).unwrap_or(0),
        })
        .collect())
}

/// 選択グループの解決: `?group=` が自分のタブならそれを採用、無効/未指定は
/// 「個体がいる最初のタブ → 先頭タブ」(旧クライアント実装と同じ既定)。
/// group_tabs / specimen_rows は同じ規則で解決するため表示は一致する
/// (ブロックごとにタブを引き直すが、ずれるのは並行書込と重なった一瞬のみ = POCとして許容)。
fn pick_active_group(tabs: &[GroupTabItem], requested: Option<Uuid>) -> Option<Uuid> {
    if let Some(id) = requested {
        if tabs.iter().any(|t| t.group_id == id) {
            return Some(id);
        }
    }
    tabs.iter()
        .find(|t| t.count > 0)
        .or_else(|| tabs.first())
        .map(|t| t.group_id)
}

#[derive(sqlx::FromRow)]
struct RowItemRow {
    id: Uuid,
    code: String,
    name: String,
    alert: bool,
    next_action: Option<String>,
    last_kind: Option<String>,
    last_at: Option<String>,
    listing_price: Option<i64>,
}

/// 選択グループの個体行のみ解決する。
async fn fetch_specimen_rows(
    pool: &PgPool,
    owner: Uuid,
    group: Uuid,
) -> Result<Vec<SpecimenItem>, sqlx::Error> {
    let rows: Vec<RowItemRow> = sqlx::query_as(
        "SELECT s.id, s.code, s.name, s.alert, s.next_action, \
                l.kind AS last_kind, to_char(l.at, 'MM/DD') AS last_at, \
                li.price_amount AS listing_price \
         FROM specimens s \
         LEFT JOIN LATERAL ( \
             SELECT kind, at, created_at FROM care_logs \
             WHERE specimen_id = s.id ORDER BY at DESC, created_at DESC LIMIT 1 \
         ) l ON true \
         LEFT JOIN listings li ON li.specimen_id = s.id AND li.status = 'active' \
         WHERE s.owner_id = $1 AND s.group_id = $2 \
         ORDER BY s.code",
    )
    .bind(owner)
    .bind(group)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SpecimenItem {
            hint: build_hint(r.next_action, r.listing_price, r.last_kind, r.last_at),
            specimen_id: r.id,
            code: r.code,
            name: r.name,
            alert: r.alert,
        })
        .collect())
}

/// 一覧行 hint の優先順位: 次のアクション > 出品中 > 最新の記録
/// (specimen_rows と旧 specimen_list で共通)。
fn build_hint(
    next_action: Option<String>,
    listing_price: Option<i64>,
    last_kind: Option<String>,
    last_at: Option<String>,
) -> Option<String> {
    next_action
        .or_else(|| listing_price.map(|p| format!("出品中 {}", fmt_yen(p))))
        .or(match (last_kind, last_at) {
            (Some(kind), Some(at)) => Some(format!("{kind} {at}")),
            _ => None,
        })
}

// ── ユーザウィジェット: todo_list / care_alerts ───────────────

#[derive(sqlx::FromRow)]
struct TodoRow {
    id: Uuid,
    body: String,
    done: bool,
}

/// ログインユーザのTODO(未完了 → 完了、それぞれ追加順)。
async fn fetch_todos(pool: &PgPool, owner: Uuid) -> Result<Vec<TodoItem>, sqlx::Error> {
    let rows: Vec<TodoRow> = sqlx::query_as(
        "SELECT id, body, done FROM user_todos \
         WHERE owner_id = $1 ORDER BY done, created_at",
    )
    .bind(owner)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| TodoItem {
            todo_id: r.id,
            body: r.body,
            done: r.done,
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct AlertRow {
    id: Uuid,
    group_id: Uuid,
    code: String,
    name: String,
    alert: bool,
    days_since_log: Option<i32>,
    days_since_created: i32,
}

/// アプリ内通知の警告抽出。理由の優先: 要注意フラグ > 最終記録の経過 > 記録なしの経過。
/// 日数計算はSQL(CURRENT_DATE との差)で行い、しきい値比較だけをここで行う。
async fn fetch_care_alerts(
    pool: &PgPool,
    owner: Uuid,
    stale_days: i32,
) -> Result<Vec<AlertItem>, sqlx::Error> {
    let rows: Vec<AlertRow> = sqlx::query_as(
        "SELECT s.id, s.group_id, s.code, s.name, s.alert, \
                (CURRENT_DATE - l.at)               AS days_since_log, \
                (CURRENT_DATE - s.created_at::date) AS days_since_created \
         FROM specimens s \
         LEFT JOIN LATERAL ( \
             SELECT at FROM care_logs \
             WHERE specimen_id = s.id ORDER BY at DESC, created_at DESC LIMIT 1 \
         ) l ON true \
         WHERE s.owner_id = $1 \
         ORDER BY s.alert DESC, days_since_log DESC NULLS LAST, s.code",
    )
    .bind(owner)
    .fetch_all(pool)
    .await?;
    let mut items = Vec::new();
    for r in rows {
        let reason = if r.alert {
            Some("要注意フラグ".to_string())
        } else {
            match r.days_since_log {
                Some(d) if d > stale_days => Some(format!("最終記録から{d}日")),
                None if r.days_since_created > stale_days => {
                    Some(format!("記録なし・登録から{}日", r.days_since_created))
                }
                _ => None,
            }
        };
        if let Some(reason) = reason {
            items.push(AlertItem {
                specimen_id: r.id,
                group_id: r.group_id,
                code: r.code,
                name: r.name,
                reason,
            });
        }
    }
    Ok(items)
}

// ── specimens ────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct GroupedRow {
    group_id: Uuid,
    label: String,
    // LEFT JOIN のため、空グループでは個体側の列が NULL になる
    id: Option<Uuid>,
    code: Option<String>,
    name: Option<String>,
    alert: Option<bool>,
    next_action: Option<String>,
    last_kind: Option<String>,
    last_at: Option<String>,
    listing_price: Option<i64>,
}

/// ログインユーザのグループ(sort_order順)+ 所属個体。空グループも count=0 で返す。
/// hint の優先順位: 次のアクション > 出品中 > 最新の記録。
async fn fetch_specimen_groups(
    pool: &PgPool,
    owner: Uuid,
) -> Result<Vec<SpecimenGroup>, HydrateError> {
    let rows: Vec<GroupedRow> = sqlx::query_as(
        "SELECT g.id AS group_id, g.label, \
                s.id, s.code, s.name, s.alert, s.next_action, \
                l.kind AS last_kind, to_char(l.at, 'MM/DD') AS last_at, \
                li.price_amount AS listing_price \
         FROM specimen_groups g \
         LEFT JOIN specimens s ON s.group_id = g.id AND s.owner_id = $1 \
         LEFT JOIN LATERAL ( \
             SELECT kind, at, created_at FROM care_logs \
             WHERE specimen_id = s.id ORDER BY at DESC, created_at DESC LIMIT 1 \
         ) l ON true \
         LEFT JOIN listings li ON li.specimen_id = s.id AND li.status = 'active' \
         WHERE g.owner_id = $1 \
         ORDER BY g.sort_order, g.label, s.code",
    )
    .bind(owner)
    .fetch_all(pool)
    .await?;

    let mut groups: Vec<SpecimenGroup> = Vec::new();
    for r in rows {
        if groups.last().map(|g| g.group_id) != Some(r.group_id) {
            groups.push(SpecimenGroup {
                group_id: r.group_id,
                label: r.label.clone(),
                count: 0,
                items: Vec::new(),
            });
        }
        let group = groups.last_mut().expect("just pushed");
        if let Some(id) = r.id {
            let hint = build_hint(r.next_action, r.listing_price, r.last_kind, r.last_at);
            group.items.push(SpecimenItem {
                specimen_id: id,
                code: r.code.unwrap_or_default(),
                name: r.name.unwrap_or_default(),
                hint,
                alert: r.alert.unwrap_or(false),
            });
            group.count += 1;
        }
    }
    Ok(groups)
}

#[derive(sqlx::FromRow)]
struct ProfileRow {
    id: Uuid,
    code: String,
    name: String,
    species_name: String,
    scientific_name: Option<String>,
    sex: Option<String>,
    group_id: Uuid,
    group_label: String,
    line: Option<String>,
    measure: Option<String>,
    egg_date: Option<String>,
    next_action: Option<String>,
}

async fn fetch_profile(
    pool: &PgPool,
    id: Uuid,
    owner: Uuid,
    key: crate::sdui::BlockKey,
) -> Result<ViewBlock, HydrateError> {
    let row: Option<ProfileRow> = sqlx::query_as(
        "SELECT s.id, s.code, s.name, s.species_name, s.scientific_name, s.sex, \
                s.group_id, g.label AS group_label, s.line, s.measure, \
                to_char(s.egg_date, 'YYYY/MM/DD') AS egg_date, s.next_action \
         FROM specimens s \
         JOIN specimen_groups g ON g.id = s.group_id \
         WHERE s.id = $1 AND s.owner_id = $2",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(pool)
    .await?;
    let r = row.ok_or(HydrateError::SpecimenNotFound)?;
    Ok(ViewBlock::SpecimenProfile {
        key,
        specimen_id: r.id,
        code: r.code,
        name: r.name,
        species_name: r.species_name,
        scientific_name: r.scientific_name,
        sex: r.sex,
        group_id: r.group_id,
        group_label: r.group_label,
        line: r.line,
        measure: r.measure,
        egg_date: r.egg_date,
        next_action: r.next_action,
    })
}

#[derive(sqlx::FromRow)]
struct LogRow {
    id: Uuid,
    at: String,
    kind: String,
    body: String,
}

async fn fetch_care_logs(
    pool: &PgPool,
    id: Uuid,
    owner: Uuid,
) -> Result<Vec<CareLogEntry>, sqlx::Error> {
    let rows: Vec<LogRow> = sqlx::query_as(
        "SELECT cl.id, to_char(cl.at, 'MM/DD') AS at, cl.kind, cl.body \
         FROM care_logs cl \
         JOIN specimens s ON s.id = cl.specimen_id \
         WHERE cl.specimen_id = $1 AND s.owner_id = $2 \
         ORDER BY cl.at DESC, cl.created_at DESC",
    )
    .bind(id)
    .bind(owner)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| CareLogEntry {
            log_id: r.id,
            at: r.at,
            kind: r.kind,
            body: r.body,
        })
        .collect())
}

async fn fetch_species_note(
    pool: &PgPool,
    id: Uuid,
    owner: Uuid,
    key: crate::sdui::BlockKey,
) -> Result<ViewBlock, HydrateError> {
    let species: Option<(String,)> =
        sqlx::query_as("SELECT species_name FROM specimens WHERE id = $1 AND owner_id = $2")
            .bind(id)
            .bind(owner)
            .fetch_optional(pool)
            .await?;
    let (species_name,) = species.ok_or(HydrateError::SpecimenNotFound)?;
    let note: Option<(String,)> =
        sqlx::query_as("SELECT note FROM species_notes WHERE owner_id = $1 AND species_name = $2")
            .bind(owner)
            .bind(&species_name)
            .fetch_optional(pool)
            .await?;
    Ok(ViewBlock::SpeciesNote {
        key,
        species_name,
        note: note
            .map(|n| n.0)
            .unwrap_or_else(|| "この種のメモは未登録です。".to_string()),
    })
}
