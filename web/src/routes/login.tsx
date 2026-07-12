import { Title } from "@solidjs/meta";
import { Show, createSignal } from "solid-js";
import { authLogin, authRegister } from "~/sdui/api";

/**
 * ログイン / 新規登録(固定コード領域)。
 * 認証フォームはSDUI語彙にしない(セキュリティと正確さ優先の方針)。
 * 成功時はフルリロードでヘッダーのユーザ表示を確実に更新する。
 */
export default function Login() {
  const [mode, setMode] = createSignal<"login" | "register">("login");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode() === "login") {
        await authLogin(email(), password());
      } else {
        await authRegister(email(), password(), name());
      }
      window.location.href = "/care";
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div class="auth-page">
      <Title>ログイン | insect_app_r2</Title>
      <section class="sd-card">
        <div class="auth-tabs">
          <button
            class="sd-btn"
            classList={{ "sd-btn--primary": mode() === "login" }}
            onClick={() => setMode("login")}
          >
            ログイン
          </button>
          <button
            class="sd-btn"
            classList={{ "sd-btn--primary": mode() === "register" }}
            onClick={() => setMode("register")}
          >
            新規登録
          </button>
        </div>

        <form class="sd-form" onSubmit={submit}>
          <Show when={mode() === "register"}>
            <label class="sd-field">
              表示名
              <input
                value={name()}
                required
                placeholder="例: Ryotaro"
                onInput={e => setName(e.currentTarget.value)}
              />
            </label>
          </Show>
          <label class="sd-field">
            メールアドレス
            <input
              type="email"
              value={email()}
              required
              autocomplete="email"
              onInput={e => setEmail(e.currentTarget.value)}
            />
          </label>
          <label class="sd-field">
            パスワード{mode() === "register" ? "(8文字以上)" : ""}
            <input
              type="password"
              value={password()}
              required
              autocomplete={mode() === "login" ? "current-password" : "new-password"}
              onInput={e => setPassword(e.currentTarget.value)}
            />
          </label>
          <Show when={error()}>
            <p class="sd-status sd-status--error">{error()}</p>
          </Show>
          <div class="sd-form-row">
            <button class="sd-btn sd-btn--primary" type="submit" disabled={busy()}>
              {mode() === "login" ? "ログイン" : "登録してはじめる"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
