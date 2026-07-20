/**
 * カードビルダー(固定コードUI)— C→A ハイブリッド構成:
 *   Step 1「ギャラリー」 用途テンプレート(=ブロック構成のプリセット。新語彙は不要)を選ぶ
 *   Step 2「編集」       左で組み立て、右に**本物のライブプレビュー**
 *
 * プレビューは POST /api/preview(未保存定義を既存 hydrate に通すだけ)を実レンダラで描く。
 * 語彙が閉じているため、プレビュー = 本番と同一の描画・このアカウントの実データになる。
 * 保存先は自分のページ定義(PUT /api/pages/{key}/mine)= エージェントと同じ「定義の運用」。
 *
 * 出すのは閉じたトークンの選択肢だけ。自由なCSS値・任意イベントの入力欄は作らない
 * (REFACTOR §5)。検証の最終権威はサーバ(422をモーダル内に表示)。
 * コンテキスト必須ブロック(specimen_profile 等)はパレットに出さない(care では 400)。
 */
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  cardPositions,
  fetchDefinition,
  insertCardIntoDoc,
  previewPage,
  putMyDefinition,
  resetMyDefinition,
} from "./api";
import { SduiActionsContext, useSduiActions } from "./actions";
import { Button, Field, FormStack, Grid, Row, Status, Text } from "./primitives";
import { PageRenderer } from "./renderer";
import type { DefBlockAny, DefCard, DefinitionDoc, PageView } from "./types";

/** APIエラーからユーザ向けメッセージ部分を取り出す */
const apiMessage = (e: unknown) =>
  String(e)
    .replace(/^Error:\s*/, "")
    .replace(/^[A-Z]+ \S+ failed: \d+\s*/, "");

type BuilderBlock =
  | { kind: "text"; role: "body" | "lead" | "caption"; text: string }
  | { kind: "markdown"; markdown: string }
  | { kind: "cta"; label: string; href: string }
  | {
      kind: "listing_grid";
      sort: "newest" | "price_asc" | "price_desc";
      limit: number;
      mine: boolean;
    }
  | { kind: "todo_list" }
  | { kind: "care_alerts" };

type Kind = BuilderBlock["kind"];

const KIND_LABEL: Record<Kind, string> = {
  text: "本文テキスト",
  markdown: "Markdown",
  cta: "リンクボタン",
  listing_grid: "出品グリッド",
  todo_list: "TODOリスト",
  care_alerts: "通知(アプリ内)",
};

const DEFAULTS: Record<Kind, () => BuilderBlock> = {
  text: () => ({ kind: "text", role: "body", text: "" }),
  markdown: () => ({ kind: "markdown", markdown: "" }),
  cta: () => ({ kind: "cta", label: "", href: "/" }),
  listing_grid: () => ({ kind: "listing_grid", sort: "newest", limit: 4, mine: false }),
  todo_list: () => ({ kind: "todo_list" }),
  care_alerts: () => ({ kind: "care_alerts" }),
};

/** 用途テンプレート = タイトル+ブロック構成のプリセット(語彙はすべて既存) */
interface Template {
  id: string;
  name: string;
  desc: string;
  title: string;
  blocks: BuilderBlock[];
}

const TEMPLATES: Template[] = [
  {
    id: "memo",
    name: "メモ",
    desc: "見出し+Markdown本文。飼育メモや覚え書きに",
    title: "メモ",
    blocks: [{ kind: "markdown", markdown: "" }],
  },
  {
    id: "todo",
    name: "TODO",
    desc: "チェックできる自分専用のやることリスト",
    title: "やること",
    blocks: [{ kind: "todo_list" }],
  },
  {
    id: "alerts",
    name: "通知",
    desc: "記録が途切れた個体をしきい値で警告(アプリ内)",
    title: "通知",
    blocks: [{ kind: "care_alerts" }],
  },
  {
    id: "links",
    name: "リンク集",
    desc: "よく使うページへのボタンを並べる",
    title: "リンク",
    blocks: [{ kind: "cta", label: "飼育管理を開く", href: "/care" }],
  },
  {
    id: "watch",
    name: "出品ウォッチ",
    desc: "市場の新着や自分の出品をグリッドで一覧",
    title: "出品ウォッチ",
    blocks: [{ kind: "listing_grid", sort: "newest", limit: 4, mine: false }],
  },
  {
    id: "blank",
    name: "空のカード",
    desc: "白紙からブロックを組み合わせて作る",
    title: "",
    blocks: [],
  },
];

/** BuilderBlock → 定義側ブロック。editable は保存時のみ付与(プレビューでは編集UIを出さない) */
function toDef(b: BuilderBlock, key: string, editable: boolean): DefBlockAny {
  switch (b.kind) {
    case "text": {
      const content: DefBlockAny["content"] = { key, role: b.role, text: b.text };
      if (editable) content.editable = true;
      return { type: "text", content };
    }
    case "markdown": {
      const content: DefBlockAny["content"] = { key, markdown: b.markdown };
      if (editable) content.editable = true;
      return { type: "markdown", content };
    }
    case "cta":
      return { type: "cta", content: { key, intent: "secondary", label: b.label, href: b.href } };
    case "listing_grid":
      return {
        type: "listing_grid",
        content: {
          key,
          query: { sort: b.sort, limit: b.limit, ...(b.mine ? { seller: "mine" } : {}) },
        },
      };
    case "todo_list":
      return { type: "todo_list", content: { key } };
    case "care_alerts":
      return { type: "care_alerts", content: { key } };
  }
}

export function CardBuilder(props: { pageKey: string; onClose: () => void }) {
  const actions = useSduiActions();
  const [step, setStep] = createSignal<"gallery" | "edit">("gallery");
  const [title, setTitle] = createSignal("");
  const [size, setSize] = createSignal<"full" | "half">("full");
  const [accent, setAccent] = createSignal(false);
  const [blocks, setBlocks] = createSignal<BuilderBlock[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // 挿入位置: 現在の自分のページから選択肢を作る(既定 = 末尾)
  const [posDoc] = createResource(() => fetchDefinition(props.pageKey));
  const positions = () => (posDoc() ? cardPositions(posDoc()!) : []);
  const [posIndex, setPosIndex] = createSignal<number | null>(null);
  const effectivePos = () => {
    const opts = positions();
    if (posIndex() !== null) return posIndex()!;
    return opts.length > 0 ? opts[opts.length - 1].flatIndex : 0;
  };

  const selectTemplate = (t: Template) => {
    setTitle(t.title);
    setBlocks(t.blocks.map(b => ({ ...b })));
    setSize("full");
    setAccent(false);
    setError(null);
    setStep("edit");
  };

  const addBlock = (kind: Kind) => setBlocks([...blocks(), DEFAULTS[kind]()]);
  const update = (i: number, b: BuilderBlock) =>
    setBlocks(blocks().map((x, j) => (j === i ? b : x)));
  const remove = (i: number) => setBlocks(blocks().filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => {
    const arr = [...blocks()];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setBlocks(arr);
  };

  /** カードを組み立てる(keyGen と editable を差し替えてプレビュー/保存の両方に使う) */
  const composeCard = (nextKey: () => string, editable: boolean): DefCard => {
    const defBlocks: DefBlockAny[] = [];
    if (title().trim()) {
      const content: DefBlockAny["content"] = {
        key: nextKey(),
        role: "headline",
        text: title().trim(),
      };
      if (editable) content.editable = true;
      defBlocks.push({ type: "text", content });
    }
    for (const b of blocks()) defBlocks.push(toDef(b, nextKey(), editable));
    const card: DefCard = { key: nextKey(), size: size(), blocks: defBlocks };
    if (accent()) card.tone = "accent";
    return card;
  };

  // ── ライブプレビュー(デバウンス → POST /api/preview → 実レンダラ)──
  const [previewView, setPreviewView] = createSignal<PageView | null>(null);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backdropEl: HTMLDivElement | undefined;
  let previewSeq = 0; // 応答の順序逆転で古いプレビューが新しい入力を上書きしないように

  const runPreview = async () => {
    const seq = ++previewSeq;
    if (!title().trim() && blocks().length === 0) {
      setPreviewView(null);
      setPreviewError(null);
      return;
    }
    let n = 0;
    const doc: DefinitionDoc = {
      schemaVersion: 1,
      page: {
        template: "feed",
        content: {
          regions: { header: [], body: [composeCard(() => `pv-${n++}`, false)], footer: [] },
        },
      },
    };
    try {
      const view = await previewPage(doc);
      if (seq !== previewSeq) return; // より新しいプレビューが走っている
      // プレビューDOMの作り直しでモーダルのスクロールが先頭へ飛ばないよう保持する
      const y = backdropEl?.scrollTop ?? 0;
      setPreviewView(view);
      setPreviewError(null);
      requestAnimationFrame(() => {
        if (backdropEl) backdropEl.scrollTop = y;
      });
    } catch (e) {
      if (seq === previewSeq) setPreviewError(apiMessage(e));
    }
  };

  createEffect(() => {
    if (step() !== "edit") return;
    // 依存の購読(値の変更でデバウンス再実行)
    title();
    size();
    accent();
    blocks();
    clearTimeout(timer);
    timer = setTimeout(() => void runPreview(), 400);
  });
  onCleanup(() => clearTimeout(timer));

  // ── 保存 / リセット ──
  const save = async () => {
    setError(null);
    if (!title().trim() && blocks().length === 0) {
      setError("タイトルを入れるか、ブロックを1つ以上追加してください");
      return;
    }
    setBusy(true);
    try {
      const doc = await fetchDefinition(props.pageKey);
      // key はユーザに見せず自動生成。"my-" プレフィックスが「ビルダーで作ったカード」の
      // 目印(カード削除アフォーダンスの条件)
      const used = new Set<string>();
      for (const cards of Object.values(doc.page.content.regions)) {
        for (const c of cards) {
          used.add(c.key);
          for (const b of c.blocks) used.add(b.content.key);
        }
      }
      const freshKey = () => {
        for (;;) {
          const k = `my-${Math.random().toString(36).slice(2, 6)}`;
          if (!used.has(k)) {
            used.add(k);
            return k;
          }
        }
      };
      insertCardIntoDoc(doc, composeCard(freshKey, true), effectivePos());
      await putMyDefinition(props.pageKey, doc); // サーバ検証が最終権威(不正は422)
      actions?.refreshAll();
      props.onClose();
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm("自分の変更をすべて破棄して、共有の最新のページに戻しますか?")) return;
    setBusy(true);
    try {
      await resetMyDefinition(props.pageKey);
      actions?.refreshAll();
      props.onClose();
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sd-modal-backdrop" ref={backdropEl} onClick={props.onClose}>
      <div class="sd-modal sd-modal--wide" onClick={e => e.stopPropagation()}>
        <Button class="sd-modal-close" onClick={props.onClose}>
          ✕
        </Button>

        <Show
          when={step() === "edit"}
          fallback={
            /* ── Step 1: テンプレートギャラリー ── */
            <section class="sd-card">
              <Text role="headline">どんなカードを追加しますか?</Text>
              <Text role="caption">テンプレートはあとから自由に変更できます</Text>
              <div class="sd-tpl-grid">
                <For each={TEMPLATES}>
                  {t => (
                    <button class="sd-tpl" onClick={() => selectTemplate(t)}>
                      <MiniPreview id={t.id} />
                      <span class="sd-tpl-name">{t.name}</span>
                      <span class="sd-tpl-desc">{t.desc}</span>
                    </button>
                  )}
                </For>
              </div>
              <Row justify="between" class="sd-modal-actions">
                <Button disabled={busy()} onClick={props.onClose}>
                  キャンセル
                </Button>
                <Button
                  intent="ghost"
                  title="自分のページを破棄して共有定義に戻す"
                  disabled={busy()}
                  onClick={() => void reset()}
                >
                  共有の最新に戻す
                </Button>
              </Row>
            </section>
          }
        >
          {/* ── Step 2: 2ペイン編集(左: 組み立て / 右: ライブプレビュー)── */}
          <section class="sd-card">
            <Text role="headline">カードを追加</Text>
            <div class="sd-builder-cols">
              <FormStack>
                <Field label="カードのタイトル(見出し・省略可)">
                  <input
                    value={title()}
                    placeholder="例: 今週のやること"
                    onInput={e => setTitle(e.currentTarget.value)}
                  />
                </Field>
                <Grid cols={2}>
                  <Field label="幅">
                    <select
                      value={size()}
                      onChange={e => setSize(e.currentTarget.value as "full" | "half")}
                    >
                      <option value="full">全幅</option>
                      <option value="half">半分</option>
                    </select>
                  </Field>
                  <Field label="色調">
                    <select
                      value={accent() ? "accent" : "default"}
                      onChange={e => setAccent(e.currentTarget.value === "accent")}
                    >
                      <option value="default">標準</option>
                      <option value="accent">アクセント(反転)</option>
                    </select>
                  </Field>
                </Grid>
                <Field label="挿入位置(あとからページ上の↑↓でも動かせます)">
                  <select
                    value={String(effectivePos())}
                    onChange={e => setPosIndex(Number(e.currentTarget.value))}
                  >
                    <For each={positions()}>
                      {p => <option value={String(p.flatIndex)}>{p.label}</option>}
                    </For>
                  </select>
                </Field>

                <Text role="caption">ブロックを追加(上から順に表示されます)</Text>
                <Row wrap gap="sm">
                  <For each={Object.keys(KIND_LABEL) as Kind[]}>
                    {k => <Button onClick={() => addBlock(k)}>＋ {KIND_LABEL[k]}</Button>}
                  </For>
                </Row>

                <For each={blocks()}>
                  {(b, i) => (
                    <FormStack boxed>
                      <Row gap="sm" justify="between">
                        <Text role="caption">{KIND_LABEL[b.kind]}</Text>
                        <Row gap="xs">
                          <Button intent="ghost" title="上へ" onClick={() => move(i(), -1)}>
                            ↑
                          </Button>
                          <Button intent="ghost" title="下へ" onClick={() => move(i(), 1)}>
                            ↓
                          </Button>
                          <Button
                            intent="ghost"
                            title="このブロックを削除"
                            onClick={() => remove(i())}
                          >
                            ✕
                          </Button>
                        </Row>
                      </Row>
                      <BlockEditor block={b} onChange={nb => update(i(), nb)} />
                    </FormStack>
                  )}
                </For>
              </FormStack>

              <div class="sd-builder-preview">
                <p class="sd-pane-label">プレビュー(このアカウントの実データで描画)</p>
                <Show
                  when={previewView()}
                  fallback={
                    <Show
                      when={previewError()}
                      fallback={
                        <Text role="caption">
                          タイトルかブロックを入れると、ここに実物のプレビューが出ます
                        </Text>
                      }
                    >
                      <Status error>プレビューできません: {previewError()}</Status>
                    </Show>
                  }
                >
                  {/* プレビュー内の操作は編集UIを持たない別コンテキストで描く
                      (TODO追加などのドメイン操作は本物として動き、再プレビューされる) */}
                  <SduiActionsContext.Provider
                    value={{
                      pageKey: props.pageKey,
                      refresh: () => void runPreview(),
                      refreshAll: () => void runPreview(),
                    }}
                  >
                    <PageRenderer view={previewView()!} />
                  </SduiActionsContext.Provider>
                </Show>
              </div>
            </div>

            <Show when={error()}>
              <Status error>{error()}</Status>
            </Show>
            <Row gap="sm" justify="between" class="sd-modal-actions">
              <Row gap="sm">
                <Button intent="primary" disabled={busy()} onClick={() => void save()}>
                  このカードを追加
                </Button>
                <Button disabled={busy()} onClick={props.onClose}>
                  キャンセル
                </Button>
              </Row>
              <Button intent="ghost" disabled={busy()} onClick={() => setStep("gallery")}>
                ← テンプレートを選び直す
              </Button>
            </Row>
          </section>
        </Show>
      </div>
    </div>
  );
}

/** ギャラリーのミニプレビュー(装飾のみのスケッチ) */
function MiniPreview(props: { id: string }) {
  return (
    <Switch fallback={<div class="sd-mini" />}>
      <Match when={props.id === "memo"}>
        <div class="sd-mini">
          <div class="sd-mini-bar sd-mini-bar--dark" />
          <div class="sd-mini-bar" />
          <div class="sd-mini-bar sd-mini-bar--half" />
        </div>
      </Match>
      <Match when={props.id === "todo"}>
        <div class="sd-mini">
          <div class="sd-mini-bar sd-mini-bar--dark" />
          <div class="sd-mini-row">
            <span class="sd-mini-box" />
            <div class="sd-mini-bar sd-mini-bar--half" style={{ flex: "1" }} />
          </div>
          <div class="sd-mini-row">
            <span class="sd-mini-box sd-mini-box--on" />
            <div class="sd-mini-bar" style={{ flex: "1", width: "50%" }} />
          </div>
        </div>
      </Match>
      <Match when={props.id === "alerts"}>
        <div class="sd-mini">
          <div class="sd-mini-bar sd-mini-bar--dark" />
          <div class="sd-mini-warn">
            <div class="sd-mini-bar" style={{ width: "40%" }} />
            <span>⚠</span>
          </div>
          <div class="sd-mini-warn">
            <div class="sd-mini-bar" style={{ width: "55%" }} />
            <span>⚠</span>
          </div>
        </div>
      </Match>
      <Match when={props.id === "links"}>
        <div class="sd-mini">
          <div class="sd-mini-bar sd-mini-bar--dark" />
          <div class="sd-mini-bar sd-mini-bar--half" />
          <span class="sd-mini-btn">ガイドを読む →</span>
        </div>
      </Match>
      <Match when={props.id === "watch"}>
        <div class="sd-mini">
          <div class="sd-mini-bar sd-mini-bar--dark" />
          <div class="sd-mini-grid2">
            <div class="sd-mini-thumb" />
            <div class="sd-mini-thumb" />
          </div>
        </div>
      </Match>
      <Match when={props.id === "blank"}>
        <div class="sd-mini">
          <span class="sd-mini-plus">＋</span>
        </div>
      </Match>
    </Switch>
  );
}

/** ブロック種別ごとのパラメータフォーム(すべて閉じた語彙の入力のみ) */
function BlockEditor(props: { block: BuilderBlock; onChange: (b: BuilderBlock) => void }) {
  const b = () => props.block;
  return (
    <Switch>
      <Match when={b().kind === "text"}>
        {(() => {
          const t = () => b() as Extract<BuilderBlock, { kind: "text" }>;
          return (
            <>
              <Field label="役割">
                <select
                  value={t().role}
                  onChange={e =>
                    props.onChange({
                      ...t(),
                      role: e.currentTarget.value as "body" | "lead" | "caption",
                    })
                  }
                >
                  <option value="body">本文</option>
                  <option value="lead">リード(補足見出し)</option>
                  <option value="caption">注釈(小さい文字)</option>
                </select>
              </Field>
              <textarea
                rows={2}
                placeholder="本文を入力"
                value={t().text}
                onInput={e => props.onChange({ ...t(), text: e.currentTarget.value })}
              />
            </>
          );
        })()}
      </Match>
      <Match when={b().kind === "markdown"}>
        {(() => {
          const t = () => b() as Extract<BuilderBlock, { kind: "markdown" }>;
          return (
            <textarea
              rows={4}
              placeholder={"Markdownが使えます(**太字**・- リスト・[リンク](/care) 等)"}
              value={t().markdown}
              onInput={e => props.onChange({ ...t(), markdown: e.currentTarget.value })}
            />
          );
        })()}
      </Match>
      <Match when={b().kind === "cta"}>
        {(() => {
          const t = () => b() as Extract<BuilderBlock, { kind: "cta" }>;
          return (
            <Grid cols={2}>
              <Field label="ボタンの文言">
                <input
                  value={t().label}
                  placeholder="例: 飼育管理を開く"
                  onInput={e => props.onChange({ ...t(), label: e.currentTarget.value })}
                />
              </Field>
              <Field label="リンク先(サイト内パス)">
                <input
                  value={t().href}
                  placeholder="例: /care"
                  onInput={e => props.onChange({ ...t(), href: e.currentTarget.value })}
                />
              </Field>
            </Grid>
          );
        })()}
      </Match>
      <Match when={b().kind === "listing_grid"}>
        {(() => {
          const t = () => b() as Extract<BuilderBlock, { kind: "listing_grid" }>;
          return (
            <Row wrap gap="sm">
              <Field label="並び順">
                <select
                  value={t().sort}
                  onChange={e =>
                    props.onChange({
                      ...t(),
                      sort: e.currentTarget.value as "newest" | "price_asc" | "price_desc",
                    })
                  }
                >
                  <option value="newest">新着順</option>
                  <option value="price_asc">価格が安い順</option>
                  <option value="price_desc">価格が高い順</option>
                </select>
              </Field>
              <Field label="件数(1〜24)">
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={t().limit}
                  onInput={e =>
                    props.onChange({ ...t(), limit: Number(e.currentTarget.value) || 1 })
                  }
                />
              </Field>
              <label class="sd-alert-toggle">
                <input
                  type="checkbox"
                  checked={t().mine}
                  onChange={e => props.onChange({ ...t(), mine: e.currentTarget.checked })}
                />
                自分の出品のみ
              </label>
            </Row>
          );
        })()}
      </Match>
      <Match when={b().kind === "todo_list" || b().kind === "care_alerts"}>
        <Text role="caption">設定はありません(配置のみ。中身はこのアカウントのデータ)</Text>
      </Match>
    </Switch>
  );
}
