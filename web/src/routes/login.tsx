import { Title } from "@solidjs/meta";
import { Show, createSignal } from "solid-js";
import { authLogin, authRegister } from "~/sdui/api";
import { Button, Field, FormStack, Row, Status } from "~/sdui/primitives";

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
          <Button
            intent={mode() === "login" ? "primary" : "default"}
            onClick={() => setMode("login")}
          >
            ログイン
          </Button>
          <Button
            intent={mode() === "register" ? "primary" : "default"}
            onClick={() => setMode("register")}
          >
            新規登録
          </Button>
        </div>

        <FormStack form onSubmit={submit}>
          <Show when={mode() === "register"}>
            <Field label="表示名">
              <input
                value={name()}
                required
                placeholder="例: Ryotaro"
                onInput={e => setName(e.currentTarget.value)}
              />
            </Field>
          </Show>
          <Field label="メールアドレス">
            <input
              type="email"
              value={email()}
              required
              autocomplete="email"
              onInput={e => setEmail(e.currentTarget.value)}
            />
          </Field>
          <Field label={`パスワード${mode() === "register" ? "(8文字以上)" : ""}`}>
            <input
              type="password"
              value={password()}
              required
              autocomplete={mode() === "login" ? "current-password" : "new-password"}
              onInput={e => setPassword(e.currentTarget.value)}
            />
          </Field>
          <Show when={error()}>
            <Status error>{error()}</Status>
          </Show>
          <Row gap="sm">
            <Button intent="primary" type="submit" disabled={busy()}>
              {mode() === "login" ? "ログイン" : "登録してはじめる"}
            </Button>
          </Row>
        </FormStack>
      </section>
    </div>
  );
}
