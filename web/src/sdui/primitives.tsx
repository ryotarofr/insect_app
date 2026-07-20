/**
 * 閉じた props の primitive 層(docs/FRONTEND_PRIMITIVES.md)。
 *
 * コンテナは Box(とその別名 Stack / Row)のみ — 「Box と Card の2 primitive」原則は不変。
 * props は閉じたトークンだけを受け、任意の CSS 値(px・色)は型レベルで書けない
 * (原則4「CSS値を語彙に入れない」のコード層版)。
 *
 * ⚠ 定義層への漏れ出し禁止(最重要ガード):
 * ここの props はレンダラの**内部命令セット**であり、DefBlock / Card(スキーマ)に
 * direction や gap を生やしてはならない。定義に出してよいのは `layout: "sidebar"` の
 * ような**意味トークン**だけで、その解釈(= primitive の組合せ)はレンダラが持つ。
 * これを破ると REFACTOR.md §3 案ロ(汎用Box再帰・不採用)の再発明になる。
 *
 * 空白トークン(CP2確定値): xs=4 / sm=8 / md=12 / lg=16 / xl=20 px。
 * 旧CSSの 10px は sm、14px は md に丸めて移行した(最大2pxの視差は許容)。
 */
import { Show, splitProps, type JSX } from "solid-js";

type Space = "none" | "xs" | "sm" | "md" | "lg" | "xl";
type Align = "start" | "center" | "end" | "stretch";
type Justify = "start" | "center" | "end" | "between";

// ── Box / Stack / Row ────────────────────────────────────────

export interface BoxProps extends JSX.HTMLAttributes<HTMLDivElement> {
  direction?: "col" | "row";
  gap?: Space;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
}

export function Box(props: BoxProps) {
  const [t, rest] = splitProps(props, [
    "direction",
    "gap",
    "align",
    "justify",
    "wrap",
    "class",
  ]);
  return (
    <div
      {...rest}
      class={`ui ${t.class ?? ""}`}
      classList={{
        "ui--row": t.direction === "row",
        [`ui-gap--${t.gap ?? "none"}`]: true,
        [`ui-align--${t.align ?? "stretch"}`]: true,
        [`ui-just--${t.justify ?? "start"}`]: true,
        "ui--wrap": t.wrap === true,
      }}
    />
  );
}

/** 縦積み(Box の別名)。 */
export const Stack = (p: BoxProps) => <Box direction="col" {...p} />;

/** 横並び(Box の別名)。align 既定は center(1行内の部品を揃える用途が大半のため)。 */
export const Row = (p: BoxProps) => <Box direction="row" align="center" {...p} />;

/**
 * フォーム用グリッド。cols は閉じたレシピ:
 * 2 = 2等分(プロフィール系フォーム) / 3 = 日付+2欄(記録追加フォーム)。
 */
export function Grid(props: { cols: 2 | 3; class?: string; children: JSX.Element }) {
  return (
    <div class={`ui-grid--${props.cols} ${props.class ?? ""}`}>{props.children}</div>
  );
}

// ── Text / Status / Empty ────────────────────────────────────

/** text ブロックの role と同じ閉じた語彙。headline のみ h2、他は p で描く。 */
export function Text(props: {
  role?: "headline" | "lead" | "body" | "caption";
  class?: string;
  children: JSX.Element;
}) {
  const cls = () =>
    `sd-text${props.role && props.role !== "body" ? ` sd-text--${props.role}` : ""} ${props.class ?? ""}`;
  return (
    <Show when={props.role === "headline"} fallback={<p class={cls()}>{props.children}</p>}>
      <h2 class={cls()}>{props.children}</h2>
    </Show>
  );
}

/** ページ状態の1行(読み込み中・エラー)。 */
export function Status(props: { error?: boolean; children: JSX.Element }) {
  return (
    <p class="sd-status" classList={{ "sd-status--error": props.error === true }}>
      {props.children}
    </p>
  );
}

/** 空状態の枠(破線ボックス)。 */
export const Empty = (props: { children: JSX.Element }) => (
  <div class="sd-empty">{props.children}</div>
);

// ── Button / ButtonLink / Cta / Chip ─────────────────────────

type ButtonIntent = "default" | "primary" | "ghost" | "danger";

const buttonClassList = (intent: ButtonIntent | undefined) => ({
  "sd-btn--primary": intent === "primary",
  "sd-btn--ghost": intent === "ghost",
  "sd-btn--danger": intent === "danger",
});

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: ButtonIntent;
}

export function Button(props: ButtonProps) {
  const [t, rest] = splitProps(props, ["intent", "class"]);
  return (
    <button
      {...rest}
      class={`sd-btn ${t.class ?? ""}`}
      classList={buttonClassList(t.intent)}
    />
  );
}

/** ボタンの見た目を持つリンク(例: 「出品ページを見る →」)。 */
export function ButtonLink(
  props: { intent?: ButtonIntent } & JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
) {
  const [t, rest] = splitProps(props, ["intent", "class"]);
  return (
    <a {...rest} class={`sd-btn ${t.class ?? ""}`} classList={buttonClassList(t.intent)} />
  );
}

/** cta ブロックの見た目(intent は SDUI の CtaIntent と同じ語彙)。 */
export function Cta(props: {
  intent: "primary" | "secondary";
  href: string;
  children: JSX.Element;
}) {
  return (
    <a
      class="sd-cta"
      classList={{ "sd-cta--primary": props.intent === "primary" }}
      href={props.href}
    >
      {props.children}
    </a>
  );
}

/** 属性チップ(ラベル+値の粒)。 */
export const Chip = (props: { children: JSX.Element }) => (
  <span class="sd-chip">{props.children}</span>
);

// ── FormStack / Field ────────────────────────────────────────

/**
 * フォームの文脈(縦積み + 配下 input/select/textarea の見た目)。
 * boxed = 枠付き(インライン追加フォーム用)。form=true で <form> として描く。
 */
export function FormStack(props: {
  boxed?: boolean;
  form?: boolean;
  class?: string;
  onSubmit?: JSX.EventHandlerUnion<HTMLFormElement, SubmitEvent & Event>;
  children: JSX.Element;
}) {
  const cls = () =>
    `sd-form${props.boxed ? " sd-form--boxed" : ""} ${props.class ?? ""}`;
  return (
    <Show when={props.form} fallback={<div class={cls()}>{props.children}</div>}>
      <form class={cls()} onSubmit={props.onSubmit}>
        {props.children}
      </form>
    </Show>
  );
}

/** ラベル付き入力欄。children に input / select / textarea を入れる。 */
export const Field = (props: { label: JSX.Element; children: JSX.Element }) => (
  <label class="sd-field">
    {props.label}
    {props.children}
  </label>
);
