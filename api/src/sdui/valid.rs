//! 検証の強制配線 (parse, don't validate)。
//!
//! `ValidPageDefinition` を作る方法は `parse` / `from_value` / `from_def` しかなく、
//! いずれも L1(構造 = serde)+ L2(意味)を通る。ハンドラ・DB層はこの型だけを受け取る
//! ため、検証の呼び忘れはコンパイルエラーになる。

use std::collections::HashSet;

use super::def::{Card, DefBlock, FeedRegions, Page, PageDefinition, TextRole};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_CARDS_PER_REGION: usize = 10;
pub const MAX_BLOCKS_PER_CARD: usize = 10;
pub const LISTING_LIMIT_MIN: u8 = 1;
pub const LISTING_LIMIT_MAX: u8 = 24;
pub const MAX_MARKDOWN_CHARS: usize = 5000;
/// emptyText 等の短いUI文言の上限(1行〜2行の想定。長文は markdown ブロックの領分)
pub const MAX_UI_TEXT_CHARS: usize = 200;

#[derive(Debug, thiserror::Error)]
pub enum DefinitionError {
    /// L1: 構造違反(未知フィールド / 未知タグ / ブランド型違反 / 型不一致)
    #[error("structural: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported schemaVersion {0} (expected {SCHEMA_VERSION})")]
    SchemaVersion(u32),
    #[error("duplicate key: {0}")]
    DuplicateKey(String),
    #[error("card {card:?} has {count} headline blocks (max 1)")]
    MultipleHeadlines { card: String, count: usize },
    #[error(
        "listing_grid {key:?}: limit {limit} out of range {LISTING_LIMIT_MIN}..={LISTING_LIMIT_MAX}"
    )]
    LimitOutOfRange { key: String, limit: u8 },
    #[error("markdown {key:?}: {len} chars exceeds max {MAX_MARKDOWN_CHARS}")]
    MarkdownTooLong { key: String, len: usize },
    #[error("{key:?}: ui text {len} chars exceeds max {MAX_UI_TEXT_CHARS}")]
    UiTextTooLong { key: String, len: usize },
    #[error("region {region:?} has {count} cards (max {MAX_CARDS_PER_REGION})")]
    TooManyCards { region: &'static str, count: usize },
    #[error("card {card:?} has {count} blocks (max {MAX_BLOCKS_PER_CARD})")]
    TooManyBlocks { card: String, count: usize },
}

/// 検証済みの画面定義。中身は private。
pub struct ValidPageDefinition(PageDefinition);

impl ValidPageDefinition {
    pub fn parse(json: &str) -> Result<Self, DefinitionError> {
        Self::from_def(serde_json::from_str(json)?)
    }

    pub fn from_value(value: serde_json::Value) -> Result<Self, DefinitionError> {
        Self::from_def(serde_json::from_value(value)?)
    }

    pub fn from_def(def: PageDefinition) -> Result<Self, DefinitionError> {
        validate(&def)?;
        Ok(Self(def))
    }

    pub fn get(&self) -> &PageDefinition {
        &self.0
    }

    pub fn into_inner(self) -> PageDefinition {
        self.0
    }
}

/// L2: 意味検証。型では表現しない不変条件はすべてここに集約する。
fn validate(def: &PageDefinition) -> Result<(), DefinitionError> {
    if def.schema_version != SCHEMA_VERSION {
        return Err(DefinitionError::SchemaVersion(def.schema_version));
    }
    let Page::Feed { regions } = &def.page;
    let mut seen: HashSet<String> = HashSet::new();
    for (name, cards) in region_entries(regions) {
        if cards.len() > MAX_CARDS_PER_REGION {
            return Err(DefinitionError::TooManyCards {
                region: name,
                count: cards.len(),
            });
        }
        for card in cards {
            validate_card(card, &mut seen)?;
        }
    }
    Ok(())
}

/// emptyText 等の短いUI文言の長さ検証(未指定は常にOK)
fn check_ui_text(key: &super::brand::BlockKey, text: Option<&str>) -> Result<(), DefinitionError> {
    if let Some(t) = text {
        let len = t.chars().count();
        if len > MAX_UI_TEXT_CHARS {
            return Err(DefinitionError::UiTextTooLong {
                key: key.as_str().to_string(),
                len,
            });
        }
    }
    Ok(())
}

fn region_entries<B>(r: &FeedRegions<B>) -> [(&'static str, &Vec<Card<B>>); 3] {
    [
        ("header", &r.header),
        ("body", &r.body),
        ("footer", &r.footer),
    ]
}

fn validate_card(card: &Card<DefBlock>, seen: &mut HashSet<String>) -> Result<(), DefinitionError> {
    let ck = card.key.as_str().to_string();
    if !seen.insert(ck.clone()) {
        return Err(DefinitionError::DuplicateKey(ck));
    }
    if card.blocks.len() > MAX_BLOCKS_PER_CARD {
        return Err(DefinitionError::TooManyBlocks {
            card: ck,
            count: card.blocks.len(),
        });
    }
    let mut headlines = 0usize;
    for block in &card.blocks {
        let composite = format!("{ck}::{}", block.key().as_str());
        if !seen.insert(composite.clone()) {
            return Err(DefinitionError::DuplicateKey(composite));
        }
        match block {
            DefBlock::Text {
                role: TextRole::Headline,
                ..
            } => headlines += 1,
            DefBlock::Markdown { key, markdown, .. } => {
                let len = markdown.chars().count();
                if len > MAX_MARKDOWN_CHARS {
                    return Err(DefinitionError::MarkdownTooLong {
                        key: key.as_str().to_string(),
                        len,
                    });
                }
            }
            DefBlock::ListingGrid {
                key,
                query,
                empty_text,
            } => {
                if !(LISTING_LIMIT_MIN..=LISTING_LIMIT_MAX).contains(&query.limit) {
                    return Err(DefinitionError::LimitOutOfRange {
                        key: key.as_str().to_string(),
                        limit: query.limit,
                    });
                }
                check_ui_text(key, empty_text.as_deref())?;
            }
            DefBlock::SpecimenRows { key, empty_text }
            | DefBlock::CareLogList { key, empty_text }
            | DefBlock::ListingSpec { key, empty_text }
            | DefBlock::TodoList { key, empty_text }
            | DefBlock::CareAlerts { key, empty_text } => {
                check_ui_text(key, empty_text.as_deref())?;
            }
            _ => {}
        }
    }
    if headlines > 1 {
        return Err(DefinitionError::MultipleHeadlines {
            card: ck,
            count: headlines,
        });
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────
// テスト: スキーマの閉鎖性はここで実測して釘打ちする
// (serde の deny_unknown_fields はタグ形式ごとに癖があるため、属性を信用しない)
// ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    /// seed と同型の正当な定義(全フィールド明示 = round-trip 等値比較用)
    fn sample() -> Value {
        json!({
            "schemaVersion": 1,
            "page": {
                "template": "feed",
                "content": {
                    "regions": {
                        "header": [
                            { "key": "hero", "size": "full", "blocks": [
                                { "type": "text", "content": { "key": "hero-title", "role": "headline", "text": "夏のヘラクレス特集" } },
                                { "type": "text", "content": { "key": "hero-lead", "role": "lead", "text": "新着からピックアップ" } }
                            ] }
                        ],
                        "body": [
                            { "key": "new-arrivals", "size": "full", "blocks": [
                                { "type": "listing_grid", "content": { "key": "na-grid", "query": { "sort": "newest", "limit": 6 } } }
                            ] },
                            { "key": "guide", "size": "half", "blocks": [
                                { "type": "cta", "content": { "key": "guide-link", "intent": "secondary", "label": "ガイドを読む", "href": "/guide" } }
                            ] }
                        ],
                        "footer": []
                    }
                }
            }
        })
    }

    fn parse(v: &Value) -> Result<ValidPageDefinition, DefinitionError> {
        ValidPageDefinition::parse(&v.to_string())
    }

    #[test]
    fn valid_definition_parses() {
        assert!(parse(&sample()).is_ok());
    }

    #[test]
    fn roundtrip_preserves_definition() {
        let valid = parse(&sample()).unwrap();
        let back = serde_json::to_value(valid.get()).unwrap();
        assert_eq!(back, sample());
    }

    #[test]
    fn wire_format_is_adjacently_tagged() {
        let s = sample().to_string();
        let parsed = ValidPageDefinition::parse(&s).unwrap();
        let out = serde_json::to_string(parsed.get()).unwrap();
        assert!(out.contains(r#""type":"text""#), "{out}");
        assert!(out.contains(r#""content":{"#), "{out}");
        assert!(out.contains(r#""template":"feed""#), "{out}");
    }

    // ── 閉鎖性: 未知フィールドは全階層で拒否 ──

    #[test]
    fn rejects_unknown_field_at_envelope() {
        let mut v = sample();
        v["junk"] = json!(1);
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn rejects_unknown_field_at_regions() {
        let mut v = sample();
        v["page"]["content"]["regions"]["sidebar"] = json!([]);
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn rejects_unknown_field_at_card() {
        let mut v = sample();
        v["page"]["content"]["regions"]["header"][0]["style"] = json!("red");
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn rejects_unknown_field_in_block_content() {
        let mut v = sample();
        v["page"]["content"]["regions"]["header"][0]["blocks"][0]["content"]["junk"] = json!(1);
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn rejects_unknown_field_in_query() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][0]["blocks"][0]["content"]["query"]["where"] =
            json!("1=1");
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn rejects_unknown_block_type() {
        let mut v = sample();
        v["page"]["content"]["regions"]["header"][0]["blocks"][0]["type"] = json!("carousel");
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn rejects_unknown_card_size() {
        // サーバは書き込みに厳格(未知トークン拒否)。クライアント側 fallback とは別のルール
        let mut v = sample();
        v["page"]["content"]["regions"]["header"][0]["size"] = json!("third");
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn rejects_external_href() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"][0]["content"]["href"] =
            json!("https://evil.example.com");
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn default_size_is_full() {
        let mut v = sample();
        v["page"]["content"]["regions"]["header"][0]
            .as_object_mut()
            .unwrap()
            .remove("size");
        let valid = parse(&v).unwrap();
        let super::Page::Feed { regions } = &valid.get().page;
        assert_eq!(regions.header[0].size, crate::sdui::CardSize::Full);
    }

    // ── action_button(SDUI改修 Phase 1)──

    #[test]
    fn action_button_roundtrips() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"] = json!([
            { "type": "action_button", "content": {
                "key": "add-btn", "intent": "secondary",
                "label": "＋ 個体を追加", "action": "add_specimen" } }
        ]);
        let valid = parse(&v).unwrap();
        let back = serde_json::to_value(valid.get()).unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn rejects_unknown_ui_action() {
        // 閉じた動詞 enum: 未知の動詞は L1(serde)で拒否 = PUT では 422
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"] = json!([
            { "type": "action_button", "content": {
                "key": "add-btn", "intent": "secondary",
                "label": "＋", "action": "self_destruct" } }
        ]);
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn rejects_unknown_field_in_action_button() {
        // 任意イベント定義(onClick 等)の混入は構造で拒否(docs/REFACTOR.md §5)
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"] = json!([
            { "type": "action_button", "content": {
                "key": "add-btn", "intent": "secondary",
                "label": "＋", "action": "add_specimen", "onClick": "alert(1)" } }
        ]);
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    // ── Card.layout(SDUI改修 Phase 3)──

    #[test]
    fn card_layout_roundtrips_and_absent_by_default() {
        // 指定時は round-trip で保持される
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][0]["layout"] = json!("sidebar");
        let valid = parse(&v).unwrap();
        let back = serde_json::to_value(valid.get()).unwrap();
        assert_eq!(back, v);
        // 未指定は出力に乗らない(additive 互換 = 進化規約1)
        let plain = parse(&sample()).unwrap();
        let s = serde_json::to_string(plain.get()).unwrap();
        assert!(!s.contains("layout"), "{s}");
    }

    #[test]
    fn rejects_unknown_card_layout() {
        // サーバは書き込みに厳格(未知トークン拒否)。クライアント側 fallback とは別のルール
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][0]["layout"] = json!("grid");
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    // ── emptyText(ブロック隣接文言の定義化)──

    #[test]
    fn empty_text_roundtrips_and_absent_by_default() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][0]["blocks"][0]["content"]["emptyText"] =
            json!("出品はまだありません。最初の出品者になりませんか?");
        let valid = parse(&v).unwrap();
        let back = serde_json::to_value(valid.get()).unwrap();
        assert_eq!(back, v);
        // 未指定は出力に乗らない(additive 互換)
        let plain = parse(&sample()).unwrap();
        let s = serde_json::to_string(plain.get()).unwrap();
        assert!(!s.contains("emptyText"), "{s}");
    }

    #[test]
    fn rejects_too_long_empty_text() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][0]["blocks"][0]["content"]["emptyText"] =
            json!("あ".repeat(201));
        assert!(matches!(
            parse(&v),
            Err(DefinitionError::UiTextTooLong { len: 201, .. })
        ));
    }

    // ── todo_list / care_alerts / add_card(カードビルダー v1)──

    #[test]
    fn user_widget_blocks_roundtrip() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"] = json!([
            { "type": "todo_list",   "content": { "key": "todos", "emptyText": "TODOはありません" } },
            { "type": "care_alerts", "content": { "key": "alerts" } },
            { "type": "action_button", "content": {
                "key": "add-card", "intent": "secondary",
                "label": "＋ カードを追加", "action": "add_card" } }
        ]);
        let valid = parse(&v).unwrap();
        let back = serde_json::to_value(valid.get()).unwrap();
        assert_eq!(back, v);
    }

    // ── group_tabs / specimen_rows(SDUI改修 Phase 2)──

    #[test]
    fn group_tabs_and_specimen_rows_roundtrip() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"] = json!([
            { "type": "group_tabs",    "content": { "key": "tabs" } },
            { "type": "specimen_rows", "content": { "key": "rows" } }
        ]);
        let valid = parse(&v).unwrap();
        let back = serde_json::to_value(valid.get()).unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn rejects_unknown_field_in_group_tabs() {
        // 定義側の語彙は { key } のみ。選択状態はコンテキスト(URL)であって定義ではない
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"] = json!([
            { "type": "group_tabs", "content": { "key": "tabs", "activeGroupId": "x" } }
        ]);
        assert!(matches!(parse(&v), Err(DefinitionError::Json(_))));
    }

    #[test]
    fn markdown_block_parses_and_rejects_too_long() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"] = json!([
            { "type": "markdown", "content": { "key": "md1", "markdown": "**太字** と\n\n- リスト", "editable": true } }
        ]);
        assert!(parse(&v).is_ok());

        let mut v2 = v.clone();
        v2["page"]["content"]["regions"]["body"][1]["blocks"][0]["content"]["markdown"] =
            json!("あ".repeat(5001));
        assert!(matches!(
            parse(&v2),
            Err(DefinitionError::MarkdownTooLong { .. })
        ));
    }

    #[test]
    fn text_editable_defaults_false_and_roundtrips_when_true() {
        // true は roundtrip で保持される
        let mut v = sample();
        v["page"]["content"]["regions"]["header"][0]["blocks"][1]["content"]["editable"] =
            json!(true);
        let valid = parse(&v).unwrap();
        let back = serde_json::to_value(valid.get()).unwrap();
        assert_eq!(back, v);
        // 未指定は false 扱いで、false は出力に乗らない(additive互換)
        let plain = parse(&sample()).unwrap();
        let s = serde_json::to_string(plain.get()).unwrap();
        assert!(!s.contains("editable"), "{s}");
    }

    // ── 意味検証 (L2) ──

    #[test]
    fn rejects_wrong_schema_version() {
        let mut v = sample();
        v["schemaVersion"] = json!(2);
        assert!(matches!(parse(&v), Err(DefinitionError::SchemaVersion(2))));
    }

    #[test]
    fn rejects_duplicate_card_keys() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["key"] = json!("new-arrivals");
        assert!(matches!(parse(&v), Err(DefinitionError::DuplicateKey(_))));
    }

    #[test]
    fn rejects_duplicate_block_keys_in_same_card() {
        let mut v = sample();
        v["page"]["content"]["regions"]["header"][0]["blocks"][1]["content"]["key"] =
            json!("hero-title");
        assert!(matches!(parse(&v), Err(DefinitionError::DuplicateKey(_))));
    }

    #[test]
    fn allows_same_block_key_in_different_cards() {
        // 合成キー (card.key::block.key) 単位で一意なので、カードが違えば同名OK
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"][0]["content"]["key"] =
            json!("na-grid");
        assert!(parse(&v).is_ok());
    }

    #[test]
    fn rejects_two_headlines_in_one_card() {
        let mut v = sample();
        v["page"]["content"]["regions"]["header"][0]["blocks"][1]["content"]["role"] =
            json!("headline");
        assert!(matches!(
            parse(&v),
            Err(DefinitionError::MultipleHeadlines { count: 2, .. })
        ));
    }

    #[test]
    fn allows_one_headline_per_card() {
        let mut v = sample();
        v["page"]["content"]["regions"]["body"][1]["blocks"] = json!([
            { "type": "text", "content": { "key": "guide-title", "role": "headline", "text": "ガイド" } }
        ]);
        assert!(parse(&v).is_ok());
    }

    #[test]
    fn rejects_limit_out_of_range() {
        for bad in [0u8, 25] {
            let mut v = sample();
            v["page"]["content"]["regions"]["body"][0]["blocks"][0]["content"]["query"]["limit"] =
                json!(bad);
            assert!(
                matches!(parse(&v), Err(DefinitionError::LimitOutOfRange { limit, .. }) if limit == bad),
                "limit={bad}"
            );
        }
        for ok in [1u8, 24] {
            let mut v = sample();
            v["page"]["content"]["regions"]["body"][0]["blocks"][0]["content"]["query"]["limit"] =
                json!(ok);
            assert!(parse(&v).is_ok(), "limit={ok}");
        }
    }

    #[test]
    fn rejects_too_many_cards() {
        let mut v = sample();
        let card = v["page"]["content"]["regions"]["body"][1].clone();
        let body = v["page"]["content"]["regions"]["body"]
            .as_array_mut()
            .unwrap();
        for i in 0..10 {
            let mut c = card.clone();
            c["key"] = json!(format!("filler-{i}"));
            c["blocks"][0]["content"]["key"] = json!(format!("filler-cta-{i}"));
            body.push(c);
        }
        assert!(matches!(
            parse(&v),
            Err(DefinitionError::TooManyCards { .. })
        ));
    }
}
