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
import { moveMyCard, patchDefinitionBlock, removeMyCard } from "./api";
import { useSduiActions } from "./actions";
import { Button, Cta, FormStack, Row, Text } from "./primitives";
import { CareAlertsView, TodoListView } from "./widgets";
import { ListingHeroView, ListingSettingsView, ListingSpecView } from "./listing";
import {
  CareLogListView,
  GroupTabsView,
  SpeciesNoteView,
  SpecimenListView,
  SpecimenProfileView,
  SpecimenRowsView,
} from "./specimen";
import type {
  Card as CardData,
  CtaIntent,
  ListingItem,
  PageView,
  TextRole,
  ViewBlock,
} from "./types";

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

/**
 * sidebar レイアウトで側柱になれるブロック型。
 * `layout: "sidebar"` のカードは、最初の対応ブロックを側柱・それより前を全幅の前置行・
 * 残りを本体として描く(対応ブロックが無ければ stack と同じ = 壊れない解釈)。
 */
const SIDEBAR_CAPABLE = new Set<string>(["group_tabs"]);

/** 視覚サーフェス。size / tone / layout のセマンティックトークンを解釈する */
function CardView(props: { card: CardData; region?: string }) {
  const actions = useSduiActions();
  // 未知の size / tone / layout 値は default 扱い(進化規約4)
  const sidebarIndex = () =>
    props.card.layout === "sidebar"
      ? props.card.blocks.findIndex(b => SIDEBAR_CAPABLE.has(b.type))
      : -1;
  // 自分のページ(pageScope=mine)では並べ替え可(footer = 入口ボタン置き場は固定)。
  // 削除はビルダー作成カード("my-" prefix)のみ。ツールはカードにホバーで現れる
  const movable = () => actions?.pageScope === "mine" && props.region !== "footer";
  const deletable = () => actions?.pageScope === "mine" && props.card.key.startsWith("my-");
  const moveCard = async (dir: -1 | 1) => {
    if (!actions) return;
    try {
      if (await moveMyCard(actions.pageKey, props.card.key, dir)) actions.refreshAll();
    } catch (e) {
      alert(String(e));
    }
  };
  const removeCard = async () => {
    if (!actions || !confirm("このカードを削除しますか?")) return;
    try {
      await removeMyCard(actions.pageKey, props.card.key);
      actions.refreshAll();
    } catch (e) {
      alert(String(e));
    }
  };
  return (
    <section
      class="sd-card"
      classList={{
        "sd-card--half": props.card.size === "half",
        "sd-card--accent": props.card.tone === "accent",
      }}
    >
      <Show when={movable() || deletable()}>
        <Row gap="xs" class="sd-card-tools">
          <Show when={movable()}>
            <Button intent="ghost" title="1つ上へ移動" onClick={() => void moveCard(-1)}>
              ↑
            </Button>
            <Button intent="ghost" title="1つ下へ移動" onClick={() => void moveCard(1)}>
              ↓
            </Button>
          </Show>
          <Show when={deletable()}>
            <Button
              intent="ghost"
              title="このカードを削除(自分のページから)"
              onClick={() => void removeCard()}
            >
              ✕
            </Button>
          </Show>
        </Row>
      </Show>
      <Show
        when={sidebarIndex() >= 0}
        fallback={
          <For each={props.card.blocks}>
            {block => <BlockView block={block} cardKey={props.card.key} />}
          </For>
        }
      >
        <For each={props.card.blocks.slice(0, sidebarIndex())}>
          {block => <BlockView block={block} cardKey={props.card.key} />}
        </For>
        {/* 意味トークン(sidebar)→ primitive 合成。sd-card-cols はモバイル分岐のフックのみ */}
        <Row align="start" gap="md" class="sd-card-cols">
          <div class="sd-card-side">
            <BlockView block={props.card.blocks[sidebarIndex()]} cardKey={props.card.key} />
          </div>
          <div class="sd-card-main">
            <For each={props.card.blocks.slice(sidebarIndex() + 1)}>
              {block => <BlockView block={block} cardKey={props.card.key} />}
            </For>
          </div>
        </Row>
      </Show>
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
        <For each={props.cards}>{card => <CardView card={card} region={props.name} />}</For>
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
        <Cta intent={b.content.intent} href={b.content.href}>
          {b.content.label}
        </Cta>
      );
    case "action_button":
      return <ActionButtonView content={b.content} />;
    case "listing_grid":
      return <ListingGridView items={b.content.items} emptyText={b.content.emptyText} />;
    case "specimen_list":
      return <SpecimenListView groups={b.content.groups} />;
    case "group_tabs":
      return <GroupTabsView content={b.content} />;
    case "specimen_rows":
      return <SpecimenRowsView content={b.content} />;
    case "specimen_profile":
      return <SpecimenProfileView profile={b.content} />;
    case "care_log_list":
      return (
        <CareLogListView
          specimenId={b.content.specimenId}
          entries={b.content.entries}
          emptyText={b.content.emptyText}
        />
      );
    case "species_note":
      return <SpeciesNoteView speciesName={b.content.speciesName} note={b.content.note} />;
    case "listing_hero":
      return <ListingHeroView content={b.content} />;
    case "listing_spec":
      return <ListingSpecView attrs={b.content.attrs} emptyText={b.content.emptyText} />;
    case "listing_settings":
      return <ListingSettingsView content={b.content} />;
    case "todo_list":
      return <TodoListView content={b.content} />;
    case "care_alerts":
      return <CareAlertsView content={b.content} />;
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
      await patchDefinitionBlock(
        a.pageKey,
        props.cardKey,
        props.blockKey,
        "text",
        { text: draft() },
        a.pageScope ?? "shared",
      );
      setEditing(false);
      a.refresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  // body + 未知 role は本文扱い(進化規約4。Text 側で未知roleの修飾クラスは無効に落ちる)
  const body = () => <Text role={props.role}>{props.text}</Text>;

  return (
    // 編集アフォーダンスはスキーマ側の editable 宣言があるブロックにだけ出す
    <Show when={!!actions && props.editable} fallback={body()}>
      <Show
        when={editing()}
        fallback={
          <div class="sd-textwrap">
            {body()}
            <Button
              intent="ghost"
              class="sd-editbtn"
              title="文言を編集(画面定義を更新)"
              onClick={() => {
                setDraft(props.text);
                setEditing(true);
              }}
            >
              編集
            </Button>
          </div>
        }
      >
        <FormStack>
          <textarea
            rows={3}
            value={draft()}
            onInput={e => setDraft(e.currentTarget.value)}
          />
          <Row gap="sm">
            <Button intent="primary" disabled={busy()} onClick={save}>
              保存
            </Button>
            <Button disabled={busy()} onClick={() => setEditing(false)}>
              キャンセル
            </Button>
          </Row>
        </FormStack>
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
      await patchDefinitionBlock(
        a.pageKey,
        props.cardKey,
        props.blockKey,
        "markdown",
        { markdown: draft() },
        a.pageScope ?? "shared",
      );
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
            <Button
              intent="ghost"
              class="sd-editbtn"
              title="Markdownを編集(画面定義を更新)"
              onClick={() => {
                setDraft(props.markdown);
                setEditing(true);
              }}
            >
              編集
            </Button>
          </div>
        }
      >
        <FormStack>
          <textarea
            rows={8}
            value={draft()}
            onInput={e => setDraft(e.currentTarget.value)}
          />
          <Text role="caption">
            Markdownが使えます(**太字**・- リスト・[リンク](/care) 等)
          </Text>
          <Row gap="sm">
            <Button intent="primary" disabled={busy()} onClick={save}>
              保存
            </Button>
            <Button disabled={busy()} onClick={() => setEditing(false)}>
              キャンセル
            </Button>
          </Row>
        </FormStack>
      </Show>
    </Show>
  );
}

/**
 * action_button ブロック。ボタンの存在・位置・文言(構成)は定義が持ち、
 * 押下の振る舞いはページの actions provider(runAction)の閉じた動詞実装が持つ
 * (docs/REFACTOR.md §2 の線引き)。provider が無いページでは無効表示
 * (未知の動詞は provider 側で no-op — どちらも「落とさない」契約)。
 */
function ActionButtonView(props: {
  content: { key: string; intent: CtaIntent; label: string; action: string };
}) {
  const actions = useSduiActions();
  return (
    <Row justify="end" gap="sm">
      <Button
        intent={props.content.intent === "primary" ? "primary" : "default"}
        disabled={!actions?.runAction}
        onClick={() => actions?.runAction?.(props.content.action)}
      >
        {props.content.label}
      </Button>
    </Row>
  );
}

// 空状態の文言は定義側 emptyText を優先(未指定はコード既定 = additive 互換)
function ListingGridView(props: { items: ListingItem[]; emptyText?: string }) {
  return (
    <Show
      when={props.items.length > 0}
      fallback={<Text role="caption">{props.emptyText ?? "該当する出品がありません"}</Text>}
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
