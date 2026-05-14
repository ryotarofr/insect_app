// pages/Login.tsx — login / register を切り替えできるフォーム
//
// **責務**:
//   - email + password (+ register 時は publicId / name / avatarInitial) を入力
//   - submit で store/auth の login() / register() を呼び、成功したら setRoute("mypage")
//   - 失敗 (= SduiFetchError) はインライン文言で表示
//
// **未実装 (= 後続)**:
//   - パスワードリセット (= forgot password flow)
//   - OAuth (Google / Apple)
//   - 2FA / TOTP

import { createSignal, Show } from "solid-js";

import type { RouteKey } from "../data";
import { SduiFetchError } from "../sdui/api";
import { currentUser, login, logout, register } from "../store/auth";

interface Props {
  setRoute: (k: RouteKey) => void;
}

type Mode = "login" | "register";

export const LoginPage = (props: Props) => {
  const [mode, setMode] = createSignal<Mode>("login");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [publicId, setPublicId] = createSignal("");
  const [name, setName] = createSignal("");
  const [avatarInitial, setAvatarInitial] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode() === "login") {
        await login({ email: email().trim(), password: password() });
      } else {
        await register({
          publicId: publicId().trim(),
          name: name().trim(),
          email: email().trim(),
          password: password(),
          avatarInitial: avatarInitial().trim(),
        });
      }
      // 成功 → mypage へ遷移
      props.setRoute("mypage");
    } catch (err) {
      setError(toFriendlyMessage(mode(), err));
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login-page" style={{ "max-width": "420px", margin: "40px auto", padding: "24px" }}>
      {/* 既にログイン済みなら login form は出さず "ログアウト" だけ提示 */}
      <Show when={currentUser()}>
        {(user) => (
          <div>
            <h2 style={{ "margin-bottom": "12px" }}>ログイン中</h2>
            <p>
              <strong>{user().name}</strong> ({user().publicId}) としてログイン中です。
            </p>
            <button
              type="button"
              onClick={onLogout}
              disabled={busy()}
              style={{ "margin-top": "16px", padding: "10px 16px" }}
            >
              ログアウト
            </button>
          </div>
        )}
      </Show>

      <Show when={!currentUser()}>
        <h2 style={{ "margin-bottom": "12px" }}>
          {mode() === "login" ? "ログイン" : "新規登録"}
        </h2>

        <form onSubmit={onSubmit} aria-label={mode()}>
          <Show when={mode() === "register"}>
            <label class="login-field">
              <span>ハンドル名 (= URL に乗る ID)</span>
              <input
                type="text"
                required
                value={publicId()}
                onInput={(e) => setPublicId(e.currentTarget.value)}
                autocomplete="username"
                placeholder="例: t_yamada"
              />
            </label>
            <label class="login-field">
              <span>表示名</span>
              <input
                type="text"
                required
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                autocomplete="name"
                placeholder="例: 山田 徹"
              />
            </label>
            <label class="login-field">
              <span>アイコン文字 (1 文字)</span>
              <input
                type="text"
                required
                maxLength={4}
                value={avatarInitial()}
                onInput={(e) => setAvatarInitial(e.currentTarget.value)}
                placeholder="例: 山"
              />
            </label>
          </Show>

          <label class="login-field">
            <span>メールアドレス</span>
            <input
              type="email"
              required
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              autocomplete="email"
              placeholder="you@example.com"
            />
          </label>

          <label class="login-field">
            <span>パスワード (= 8 文字以上)</span>
            <input
              type="password"
              required
              minLength={8}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autocomplete={mode() === "login" ? "current-password" : "new-password"}
            />
          </label>

          <Show when={error()}>
            {(msg) => (
              <p class="login-error" role="alert" style={{ color: "#c00", "margin-top": "8px" }}>
                {msg()}
              </p>
            )}
          </Show>

          <button
            type="submit"
            disabled={busy()}
            style={{ "margin-top": "16px", padding: "10px 16px" }}
          >
            {mode() === "login" ? "ログイン" : "登録する"}
          </button>
        </form>

        <p style={{ "margin-top": "16px" }}>
          <button
            type="button"
            class="login-toggle"
            onClick={() => {
              setMode(mode() === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode() === "login"
              ? "アカウントをお持ちでない方はこちら"
              : "ログインに戻る"}
          </button>
        </p>
      </Show>
    </div>
  );
};

/** SduiFetchError をユーザー向け日本語メッセージに変換する。 */
function toFriendlyMessage(mode: Mode, err: unknown): string {
  if (err instanceof SduiFetchError) {
    if (err.status === 401) {
      // login で 401 = メール / パスワード不一致 (account enumeration 対策で server 側で同じレス)
      return mode === "login"
        ? "メールアドレスまたはパスワードが違います。"
        : "登録に失敗しました (認証エラー)。";
    }
    if (err.status === 400) {
      return mode === "register"
        ? "入力に問題があります。メール形式 / パスワード 8 文字以上 / ハンドル重複等を確認してください。"
        : "入力を確認してください。";
    }
    if (err.status === 0) {
      return "ネットワーク接続を確認してください。";
    }
    return `サーバエラーが発生しました (status ${err.status})。`;
  }
  return err instanceof Error ? err.message : String(err);
}
