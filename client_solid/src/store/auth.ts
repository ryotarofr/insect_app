// store/auth.ts — login user の reactive state (Phase 9.G)
//
// **責務**:
//   - 現在 login 中の `AuthUser` を module-scope signal で保持
//   - login / logout / register / refreshMe を「DB 側の状態を変更 → 結果で signal 更新」の
//     1 関数で提供 (= 画面側は state を意識せず「login('a@b','x')」だけ呼ぶ)
//   - アプリ起動時に `refreshMe()` を 1 回呼んで、既存 cookie session の user を復元する
//
// **`/auth/me` の 401 解釈**:
//   anonymous / 未登録 session のどちらでも 401 が返る。これを「ログインしていない」と
//   解釈して signal を `null` にするだけで、エラー toast は出さない (= 静かな失敗)。
//   401 以外のエラーは throw して呼び出し側に伝える (= ネットワーク障害は通知したい)。
//
// **server-driven state との関係**:
//   Cookie 自体は session_middleware が自動発行 + 維持するので、本 store は cookie 操作
//   をしない。あくまで「現在の user (誰か)」という派生情報の reactive ミラー。

import { createSignal } from "solid-js";

import {
  type AuthUser,
  type LoginRequest,
  type RegisterRequest,
  SduiFetchError,
  fetchAuthMe,
  postAuthLogin,
  postAuthLogout,
  postAuthRegister,
} from "../sdui/api";
import { clearShippingPersistence } from "./checkout";

const [user, setUser] = createSignal<AuthUser | null>(null);

/** 現在 login 中の user の reactive accessor。anonymous は `null`。 */
export const currentUser = user;

/** login しているかの bool (= currentUser() !== null)。view 側で頻出。 */
export const isLoggedIn = () => user() !== null;

/** 現在の user_id (= UUID 文字列) または null。 */
export const currentUserId = () => user()?.userId ?? null;

/** アプリ起動時 / cookie 復元時に呼ぶ。
 *  401 (= anonymous) は静かに `null` にする。それ以外のエラーは throw。 */
export const refreshMe = async (): Promise<AuthUser | null> => {
  try {
    const me = await fetchAuthMe();
    setUser(me);
    return me;
  } catch (e) {
    if (e instanceof SduiFetchError && e.status === 401) {
      setUser(null);
      return null;
    }
    throw e;
  }
};

/** `POST /auth/login` を叩いて成功なら user を signal に詰める。
 *  失敗 (= 401 / その他) は throw して呼び出し側 (= ログイン画面) に伝える。 */
export const login = async (req: LoginRequest): Promise<AuthUser> => {
  const me = await postAuthLogin(req);
  setUser(me);
  return me;
};

/** `POST /auth/register` で新規 user を作って即 login 状態にする。
 *  server 側で attach_user が走るので、登録直後から /me が 200 を返す。 */
export const register = async (req: RegisterRequest): Promise<AuthUser> => {
  const me = await postAuthRegister(req);
  setUser(me);
  return me;
};

/** `POST /auth/logout` で session の user_id を NULL に倒し、signal も `null` に。
 *  204 を期待。失敗してもクライアント state は anonymous に戻す (= UX 優先)。
 *
 *  PII クリア: 共有端末対策で localStorage 上の配送先 (= name / tel / zip / pref / addr)
 *  も併せて消す。`clearShippingPersistence` は失敗を握りつぶす best-effort。 */
export const logout = async (): Promise<void> => {
  try {
    await postAuthLogout();
  } finally {
    setUser(null);
    clearShippingPersistence();
  }
};

/** テスト専用: signal をリセット。 */
export const resetAuthForTest = (): void => {
  setUser(null);
};

/** テスト専用: signal にフィクスチャ user を直接セットする。
 *  /auth/me を fetch したくない component test (= Shell 等) で使う。 */
export const setAuthForTest = (u: AuthUser | null): void => {
  setUser(u);
};
