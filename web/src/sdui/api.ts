import type { DefinitionDoc, PageView } from "./types";

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
  ctx?: { specimen?: string; listing?: string },
): Promise<PageView> {
  const params = new URLSearchParams();
  if (ctx?.specimen) params.set("specimen", ctx.specimen);
  if (ctx?.listing) params.set("listing", ctx.listing);
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
  await putDefinition(pageKey, doc);
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
