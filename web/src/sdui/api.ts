import type { DefCard, DefinitionDoc, PageView } from "./types";

async function http<T = void>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${url} failed: ${res.status} ${await res.text()}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? await res.json() : undefined) as T;
}

// ── 認証(Phase A: セッションCookie方式)─────────────────────

export interface UserInfo {
  userId: string;
  email: string;
  displayName: string;
}

/** ログイン中ユーザ。未ログインなら null(401を正常系として扱う) */
export async function authMe(): Promise<UserInfo | null> {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /api/auth/me failed: ${res.status}`);
  return (await res.json()) as UserInfo;
}

export function authLogin(email: string, password: string): Promise<UserInfo> {
  return http<UserInfo>("POST", "/api/auth/login", { email, password });
}

export function authRegister(
  email: string,
  password: string,
  displayName: string,
): Promise<UserInfo> {
  return http<UserInfo>("POST", "/api/auth/register", { email, password, displayName });
}

export function authLogout(): Promise<void> {
  return http("POST", "/api/auth/logout");
}

// ── SDUI ページ ──────────────────────────────────────────────

/** SDUI ページを取得。コンテキスト付きページは第2引数で id を渡す */
export function fetchPage(
  key: string,
  ctx?: { specimen?: string; listing?: string; group?: string },
): Promise<PageView> {
  const params = new URLSearchParams();
  if (ctx?.specimen) params.set("specimen", ctx.specimen);
  if (ctx?.listing) params.set("listing", ctx.listing);
  if (ctx?.group) params.set("group", ctx.group);
  const q = params.toString();
  return http<PageView>("GET", `/api/pages/${encodeURIComponent(key)}${q ? `?${q}` : ""}`);
}

/** 画面定義(定義編集UI用)。書き戻しは putDefinition で */
export function fetchDefinition(key: string): Promise<DefinitionDoc> {
  return http<DefinitionDoc>("GET", `/api/pages/${encodeURIComponent(key)}/definition`);
}

/** 画面定義の書込 — エージェントと同一経路(サーバ側で L1+L2 検証、不正は 422) */
export function putDefinition(key: string, doc: DefinitionDoc): Promise<void> {
  return http("PUT", `/api/pages/${encodeURIComponent(key)}`, doc);
}

/** 未保存の定義を検証+hydrateしてビューを返す(保存しない)。ビルダーのライブプレビュー用 */
export function previewPage(doc: DefinitionDoc): Promise<PageView> {
  return http<PageView>("POST", "/api/preview", doc);
}

/** 自分のページ定義として保存(care 等のパーソナライズ。初回で共有からコピーオンライト) */
export function putMyDefinition(key: string, doc: DefinitionDoc): Promise<void> {
  return http("PUT", `/api/pages/${encodeURIComponent(key)}/mine`, doc);
}

/** 自分のページ定義を削除 = 「共有の最新に戻す」リセット(冪等) */
export function resetMyDefinition(key: string): Promise<void> {
  return http("DELETE", `/api/pages/${encodeURIComponent(key)}/mine`);
}

/** 自分のページからカードを1枚削除(カードビルダーで作ったカードの削除用) */
export async function removeMyCard(pageKey: string, cardKey: string): Promise<void> {
  const doc = await fetchDefinition(pageKey);
  let removed = false;
  for (const cards of Object.values(doc.page.content.regions)) {
    const i = cards.findIndex(c => c.key === cardKey);
    if (i >= 0) {
      cards.splice(i, 1);
      removed = true;
    }
  }
  // 見つからない(別タブで削除済み等)なら PUT しない
  // = 変更ゼロの書込で不要にページを個人化(CoW)しない
  if (removed) await putMyDefinition(pageKey, doc);
}

// ── 自分のページのカード並び操作(ビルダーの挿入位置 / ページ上の並べ替え)──
//
// ページは header → body → footer の順に1列で描画され、リージョン別の見た目差は無い。
// そこで「ページ全体をひとつの並び」として扱い、**header / footer の枚数を固定したまま**
// 平坦リストを組み替えて書き戻す(枚数固定なので L2 のカード数上限にも影響しない。
// カードが隣のリージョンへ移り変わることがあるが、描画順 = ユーザの見た目は常に一致する)。
// footer は入口ボタン(page-tools)の置き場なので、挿入・移動の対象から外し常に末尾に保つ。

const REGION_ORDER = ["header", "body", "footer"] as const;

function flattenCards(doc: DefinitionDoc): DefCard[] {
  return REGION_ORDER.flatMap(r => doc.page.content.regions[r] ?? []);
}

/** flat 並びを header/footer 枚数固定で regions に書き戻す(doc は挿入前の枚数で判定) */
function reassignRegions(doc: DefinitionDoc, flat: DefCard[]): void {
  const regions = doc.page.content.regions;
  const nHeader = (regions.header ?? []).length;
  const nFooter = (regions.footer ?? []).length;
  regions.header = flat.slice(0, nHeader);
  regions.body = flat.slice(nHeader, flat.length - nFooter);
  regions.footer = flat.slice(flat.length - nFooter);
}

/** カードの表示名(最初の見出しテキスト。無ければ key) */
function cardDisplayName(c: DefCard): string {
  for (const b of c.blocks) {
    const content = b.content as { role?: string; text?: string };
    if (b.type === "text" && content.role === "headline" && content.text) return content.text;
  }
  return c.key;
}

export interface CardPosition {
  label: string;
  flatIndex: number;
}

/** ビルダーの「挿入位置」選択肢(footer の手前まで)。末尾 = 最後の選択肢 */
export function cardPositions(doc: DefinitionDoc): CardPosition[] {
  const flat = flattenCards(doc);
  const nFooter = (doc.page.content.regions.footer ?? []).length;
  const movable = flat.slice(0, flat.length - nFooter);
  return [
    { label: "ページの先頭", flatIndex: 0 },
    ...movable.map((c, i) => ({ label: `「${cardDisplayName(c)}」の後`, flatIndex: i + 1 })),
  ];
}

/** doc の flat 位置 flatIndex にカードを挿入する(putはしない。ビルダーの保存が使う) */
export function insertCardIntoDoc(doc: DefinitionDoc, card: DefCard, flatIndex: number): void {
  const flat = flattenCards(doc);
  const nFooter = (doc.page.content.regions.footer ?? []).length;
  const i = Math.max(0, Math.min(flatIndex, flat.length - nFooter));
  flat.splice(i, 0, card);
  reassignRegions(doc, flat);
}

/** 自分のページ上でカードを1つ上/下へ。端(および footer)は no-op で false を返す */
export async function moveMyCard(
  pageKey: string,
  cardKey: string,
  dir: -1 | 1,
): Promise<boolean> {
  const doc = await fetchDefinition(pageKey);
  const flat = flattenCards(doc);
  const nFooter = (doc.page.content.regions.footer ?? []).length;
  const max = flat.length - nFooter; // 移動できるのは [0, max) の範囲
  const i = flat.findIndex(c => c.key === cardKey);
  const j = i + dir;
  if (i < 0 || i >= max || j < 0 || j >= max) return false;
  [flat[i], flat[j]] = [flat[j], flat[i]];
  reassignRegions(doc, flat);
  await putMyDefinition(pageKey, doc);
  return true;
}

/**
 * 定義内の特定ブロックのフィールドを書き換えて保存する
 * (text / markdown の編集UIが使う共通経路。取得→走査→PUT)。
 */
export async function patchDefinitionBlock(
  pageKey: string,
  cardKey: string,
  blockKey: string,
  blockType: string,
  patch: Record<string, unknown>,
  scope: "shared" | "mine" = "shared",
): Promise<void> {
  const doc = await fetchDefinition(pageKey);
  for (const cards of Object.values(doc.page.content.regions)) {
    for (const card of cards) {
      if (card.key !== cardKey) continue;
      for (const block of card.blocks) {
        if (block.type === blockType && block.content.key === blockKey) {
          Object.assign(block.content, patch);
        }
      }
    }
  }
  // scope=mine はユーザ毎ページ(care 等)への書込。編集も自分のページに閉じる
  await (scope === "mine" ? putMyDefinition(pageKey, doc) : putDefinition(pageKey, doc));
}

// ── タブ(ユーザ定義グループ)────────────────────────────────

export interface GroupInfo {
  groupId: string;
  label: string;
}

/** タブ(ユーザ定義グループ)の一覧 */
export function fetchGroups(): Promise<GroupInfo[]> {
  return http<GroupInfo[]>("GET", "/api/groups");
}

/** タブ(グループ)の新規作成。作成された id が返る(アクティブ化に使う) */
export function createGroup(label: string): Promise<GroupInfo> {
  return http<GroupInfo>("POST", "/api/groups", { label });
}

/** タブ名の変更 */
export function patchGroup(id: string, label: string): Promise<void> {
  return http("PATCH", `/api/groups/${id}`, { label });
}

/** タブの削除(個体が所属している / 最後の1タブはサーバが422で拒否) */
export function deleteGroup(id: string): Promise<void> {
  return http("DELETE", `/api/groups/${id}`);
}

// ── 飼育管理ドメイン(通常のREST。変更後は呼び出し側でページ再fetch)──

export function createSpecimen(req: {
  code: string;
  name: string;
  speciesName: string;
  groupId: string;
  scientificName?: string;
  sex?: string;
  line?: string;
  measure?: string;
  eggDate?: string; // "YYYY-MM-DD"
  nextAction?: string;
}): Promise<void> {
  return http("POST", "/api/specimens", req);
}

export function patchSpecimen(
  id: string,
  patch: Partial<{
    name: string;
    speciesName: string;
    scientificName: string;
    sex: string;
    groupId: string;
    line: string;
    measure: string;
    eggDate: string; // "YYYY-MM-DD"
    nextAction: string;
  }>,
): Promise<void> {
  return http("PATCH", `/api/specimens/${id}`, patch);
}

/** 個体の削除(飼育記録も削除。出品中はサーバが422で拒否) */
export function deleteSpecimen(id: string): Promise<void> {
  return http("DELETE", `/api/specimens/${id}`);
}

export function addCareLog(
  specimenId: string,
  req: { at: string; kind: string; body: string },
): Promise<void> {
  return http("POST", `/api/specimens/${specimenId}/logs`, req);
}

export function deleteCareLog(logId: string): Promise<void> {
  return http("DELETE", `/api/care_logs/${logId}`);
}

export function putSpeciesNote(speciesName: string, note: string): Promise<void> {
  return http("PATCH", `/api/species_notes/${encodeURIComponent(speciesName)}`, { note });
}

// ── 個人TODO(todo_list ブロック)────────────────────────────

export function addTodo(body: string): Promise<void> {
  return http("POST", "/api/todos", { body });
}

export function patchTodo(
  id: string,
  patch: Partial<{ body: string; done: boolean }>,
): Promise<void> {
  return http("PATCH", `/api/todos/${id}`, patch);
}

export function deleteTodo(id: string): Promise<void> {
  return http("DELETE", `/api/todos/${id}`);
}

// ── アプリ内通知の設定(care_alerts ブロック)────────────────

export function patchNotificationPrefs(
  patch: Partial<{ enabled: boolean; staleDays: number }>,
): Promise<void> {
  return http("PATCH", "/api/notification_prefs", patch);
}

// ── 出品(個体⇔listing)──────────────────────────────────────

export function createListing(
  specimenId: string,
  req: { title: string; priceAmount: number; sellerComment?: string },
): Promise<void> {
  return http("POST", `/api/specimens/${specimenId}/listing`, req);
}

export function patchListing(
  listingId: string,
  patch: Partial<{ title: string; priceAmount: number; sellerComment: string }>,
): Promise<void> {
  return http("PATCH", `/api/listings/${listingId}`, patch);
}

export function withdrawListing(listingId: string): Promise<void> {
  return http("POST", `/api/listings/${listingId}/withdraw`);
}
