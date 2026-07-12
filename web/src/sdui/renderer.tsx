/**
 * SDUI レンダラ(コア)。
 *
 * 設計思想「画面はカードの組み合わせでできている」をコンポーネント構造の不変条件にする:
 * - コンテナ primitive は **Box(レイアウト)と Card(面)の2つだけ**
 * - Block はカードの中にしか描画されない葉
 * - 未知の template / block type は fallback カード表示(落とさないことが契約)
 *
 * text / markdown ブロックには「編集」アフォーダンスが付く(editable宣言時のみ)。
 * これは画面定義への書込(PUT /api/pages/{key} = エージェントと同一経路)のヒューマンUI。
 */
import DOMPurify from "dompurify";
import { marked } from "marked";
import { For, Show, createSignal, type JSX } from "solid-js";
import { patchDefinitionBlock } from "./api";
import { useSduiActions } from "./actions";
import { ListingHeroView, ListingSettingsView, ListingSpecView } from "./listing";
import {
  CareLogListView,
  SpeciesNoteView,
  SpecimenListView,
  SpecimenProfileView,
} from "./specimen";
import type { Card as CardData, ListingItem, PageView, TextRole, ViewBlock } from "./types";

// ── markdown 描画(定義は信頼できない入力として扱う)──────────
//
// - 生HTMLはホワイトリスト方式のサニタイズで除去(scriptはもちろん、許可外タグは全て落ちる)
// - 文中見出しは h3 以下へシフト(カード見出し = text.role=headline の専権)
// - 外部リンクは新規タブ + noopener

marked.use({ gfm: true, breaks: true });

DOMPurify.addHook("afterSanitizeAttributes", node => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }
});

const MD_ALLOWED_TAGS = [
  "p", "br", "strong", "em", "del", "code", "pre", "blockquote",
  "ul", "ol", "li", "a", "h3", "h4", "h5", "h6", "hr",
  "table", "thead", "tbody", "tr", "th", "td",
];
const MD_ALLOWED_ATTR = ["href", "title"];

function renderMarkdown(src: string): string {
  const raw = marked.parse(src) as string;
  // h1..h4 → h3..h6 にシフト(h5/h6はそのまま上限h6)
  const shifted = raw.replace(/<(\/?)h([1-4])(?=[\s>])/g, (_m, slash, depth) => {
    return `<${slash}h${Math.min(Number(depth) + 2, 6)}`;
  });
  return DOMPurify.sanitize(shifted, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: MD_ALLOWED_ATTR,
  });
}

// ── primitives ──────────────────────────────────────────────

/** レイアウト専用コンテナ。レイアウト計算(grid/flex)はここと .sd-region に閉じる */
function Box(props: { class?: string; children: JSX.Element }) {
  return <div class={`sd-box ${props.class ?? ""}`}>{props.children}</div>;
}

/** 視覚サーフェス。size / tone のセマンティックトークンを解釈する */
function CardView(props: { card: CardData }) {
  // 未知の size / tone 値は default 扱い(進化規約4)
  return (
    <section
      class="sd-card"
      classList={{
        "sd-card--half": props.card.size === "half",
        "sd-card--accent": props.card.tone === "accent",
      }}
    >
      <For each={props.card.blocks}>
        {block => <BlockView block={block} cardKey={props.card.key} />}
      </For>
    </section>
  );
}

// ── page / region ───────────────────────────────────────────

export function PageRenderer(props: { view: PageView }) {
  return (
    <Show
      when={props.view.page.template === "feed"}
      fallback={
        <div class="sd-fallback">
          未対応のテンプレート: {(props.view.page as { template: string }).template}
        </div>
      }
    >
      <Box class="sd-page">
        <RegionView name="header" cards={props.view.page.content.regions.header} />
        <RegionView name="body" cards={props.view.page.content.regions.body} />
        <RegionView name="footer" cards={props.view.page.content.regions.footer} />
      </Box>
    </Show>
  );
}

function RegionView(props: { name: string; cards: CardData[] }) {
  return (
    <Show when={props.cards.length > 0}>
      <div class={`sd-region sd-region--${props.name}`}>
        <For each={props.cards}>{card => <CardView card={card} />}</For>
      </div>
    </Show>
  );
}

// ── blocks ──────────────────────────────────────────────────

function BlockView(props: { block: ViewBlock; cardKey: string }) {
  const b = props.block;
  switch (b.type) {
    case "text":
      return (
        <TextView
          cardKey={props.cardKey}
          blockKey={b.content.key}
          role={b.content.role}
          text={b.content.text}
          editable={b.content.editable ?? false}
        />
      );
    case "markdown":
      return (
        <MarkdownView
          cardKey={props.cardKey}
          blockKey={b.content.key}
          markdown={b.content.markdown}
          editable={b.content.editable ?? false}
        />
      );
    case "media":
      return <img class="sd-media" src={b.content.src} alt={b.content.alt} loading="lazy" />;
    case "cta":
      return (
        <a class={`sd-cta sd-cta--${b.content.intent}`} href={b.content.href}>
          {b.content.label}
        </a>
      );
    case "listing_grid":
      return <ListingGridView items={b.content.items} />;
    case "specimen_list":
      return <SpecimenListView groups={b.content.groups} />;
    case "specimen_profile":
      return <SpecimenProfileView profile={b.content} />;
    case "care_log_list":
      return <CareLogListView specimenId={b.content.specimenId} entries={b.content.entries} />;
    case "species_note":
      return <SpeciesNoteView speciesName={b.content.speciesName} note={b.content.note} />;
    case "listing_hero":
      return <ListingHeroView content={b.content} />;
    case "listing_spec":
      return <ListingSpecView attrs={b.content.attrs} />;
    case "listing_settings":
      return <ListingSettingsView content={b.content} />;
    default:
      // 未知ブロックの fallback(進化規約2)。ここで例外を投げないことが契約
      return <div class="sd-fallback">未対応のブロック: {(b as { type: string }).type}</div>;
  }
}

/**
 * text ブロック。編集ボタンは「画面定義の該当ブロックの text を書き換えて PUT」する。
 * = 人間がエージェントと同じ経路(定義書込)で画面を運用するUI。
 */
function TextView(props: {
  cardKey: string;
  blockKey: string;
  role: TextRole;
  text: string;
  editable: boolean;
}) {
  const actions = useSduiActions();
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const save = async () => {
    const a = actions;
    if (!a) return;
    setBusy(true);
    try {
      await patchDefinitionBlock(a.pageKey, props.cardKey, props.blockKey, "text", {
        text: draft(),
      });
      setEditing(false);
      a.refresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const body = () => {
    switch (props.role) {
      case "headline":
        return <h2 class="sd-text sd-text--headline">{props.text}</h2>;
      case "lead":
        return <p class="sd-text sd-text--lead">{props.text}</p>;
      case "caption":
        return <p class="sd-text sd-text--caption">{props.text}</p>;
      default:
        // body + 未知 role は本文扱い(進化規約4)
        return <p class="sd-text">{props.text}</p>;
    }
  };

  return (
    // 編集アフォーダンスはスキーマ側の editable 宣言があるブロックにだけ出す
    <Show when={!!actions && props.editable} fallback={body()}>
      <Show
        when={editing()}
        fallback={
          <div class="sd-textwrap">
            {body()}
            <button
              class="sd-btn sd-btn--ghost sd-editbtn"
              title="文言を編集(画面定義を更新)"
              onClick={() => {
                setDraft(props.text);
                setEditing(true);
              }}
            >
              編集
            </button>
          </div>
        }
      >
        <div class="sd-form">
          <textarea
            rows={3}
            value={draft()}
            onInput={e => setDraft(e.currentTarget.value)}
          />
          <div class="sd-form-row">
            <button class="sd-btn sd-btn--primary" disabled={busy()} onClick={save}>
              保存
            </button>
            <button class="sd-btn" disabled={busy()} onClick={() => setEditing(false)}>
              キャンセル
            </button>
          </div>
        </div>
      </Show>
    </Show>
  );
}

/**
 * markdown ブロック。text と同じく、editable なら定義書込(PUT)経由の編集UIを出す。
 */
function MarkdownView(props: {
  cardKey: string;
  blockKey: string;
  markdown: string;
  editable: boolean;
}) {
  const actions = useSduiActions();
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const save = async () => {
    const a = actions;
    if (!a) return;
    setBusy(true);
    try {
      await patchDefinitionBlock(a.pageKey, props.cardKey, props.blockKey, "markdown", {
        markdown: draft(),
      });
      setEditing(false);
      a.refresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const body = () => <div class="sd-markdown" innerHTML={renderMarkdown(props.markdown)} />;

  return (
    <Show when={!!actions && props.editable} fallback={body()}>
      <Show
        when={editing()}
        fallback={
          <div class="sd-textwrap">
            {body()}
            <button
              class="sd-btn sd-btn--ghost sd-editbtn"
              title="Markdownを編集(画面定義を更新)"
              onClick={() => {
                setDraft(props.markdown);
                setEditing(true);
              }}
            >
              編集
            </button>
          </div>
        }
      >
        <div class="sd-form">
          <textarea
            rows={8}
            value={draft()}
            onInput={e => setDraft(e.currentTarget.value)}
          />
          <p class="sd-text sd-text--caption">
            Markdownが使えます(**太字**・- リスト・[リンク](/care) 等)
          </p>
          <div class="sd-form-row">
            <button class="sd-btn sd-btn--primary" disabled={busy()} onClick={save}>
              保存
            </button>
            <button class="sd-btn" disabled={busy()} onClick={() => setEditing(false)}>
              キャンセル
            </button>
          </div>
        </div>
      </Show>
    </Show>
  );
}

function ListingGridView(props: { items: ListingItem[] }) {
  return (
    <Show
      when={props.items.length > 0}
      fallback={<p class="sd-text sd-text--caption">該当する出品がありません</p>}
    >
      <div class="sd-listing-grid">
        <For each={props.items}>{item => <ListingCard item={item} />}</For>
      </div>
    </Show>
  );
}

/** 出品1件も「カード」。sd-card を共有して思想を視覚的に揃える */
function ListingCard(props: { item: ListingItem }) {
  return (
    <a class="sd-card sd-card--listing" href={props.item.href}>
      <Show
        when={props.item.imageSrc}
        fallback={<div class="sd-listing-thumb sd-listing-thumb--empty">個体写真</div>}
      >
        {src => <img class="sd-listing-thumb" src={src()} alt="" loading="lazy" />}
      </Show>
      <span class="sd-listing-title">{props.item.title}</span>
      <Show when={props.item.scientificName}>
        <span class="sd-listing-latin">{props.item.scientificName}</span>
      </Show>
      <span class="sd-listing-price">¥{props.item.priceAmount.toLocaleString("ja-JP")}</span>
    </a>
  );
}
