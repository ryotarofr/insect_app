// pages/help/Warranty.tsx — 「安心保証」本実装 (P4-4)
//
// P2-10 でプレースホルダとして最低限の文面だけ載せた。P4-4 では:
//   1) 24h 返金フロー図  — 受取 → 申請 → 確認 → 返金 の 4 ノード横組タイムライン
//   2) 死着補償 申請フォーム — 注文番号 / 受取日時 / 個体ID / 状態 / 備考 / 写真(モック)
//   3) 温度制御便 / 自動カルテ生成 の補足は残しつつ、順序を「不安 → フロー → 申請」に整理。
//
// 生体販売の最大の不安は「死んでいたら取り返しがつかない」こと。ここを読み切った人が
// 「24h 以内なら自動返金」と理解して商品ページに戻れること、さらに既に死着があった人は
// ここから直接 申請フォーム で動けること、が P4-4 の完了条件。
//
// フォームは現状 API が無いため、submit は showToast でスタブ。実サーバ連携は
// バックエンド実装フェーズで claims.create(...) に差替える想定。
import { A } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ROUTE_PATHS } from "../../router";
import { showToast } from "../../store/toast";

// ===========================================================================
//  Flow diagram
// ===========================================================================

interface FlowStep {
  n: number;
  t: string;
  title: string;
  desc: string;
  /** user / kochu / 自動 など、誰が動くかを一語で */
  actor: "あなた" | "KOCHŪ" | "自動";
}

const FLOW_STEPS: FlowStep[] = [
  {
    n: 1,
    t: "0h",
    title: "受取",
    desc: "配送員から受け取り、箱を開封して状態を確認。写真を 1 枚撮影。",
    actor: "あなた",
  },
  {
    n: 2,
    t: "〜24h",
    title: "申請",
    desc: "下の申請フォームから 24 時間以内に連絡。添付写真を 1 枚送るだけ。",
    actor: "あなた",
  },
  {
    n: 3,
    t: "24〜48h",
    title: "確認",
    desc: "提携獣医と KOCHŪ サポートが状況を確認。追加の連絡は不要。",
    actor: "KOCHŪ",
  },
  {
    n: 4,
    t: "〜72h",
    title: "返金",
    desc: "商品代金を決済方法に応じて自動返金 (配送料は含まれません)。",
    actor: "自動",
  },
];

const FlowDiagram = () => (
  <ol class="warranty-flow" aria-label="死着補償フロー">
    <For each={FLOW_STEPS}>
      {(s) => (
        <li class="warranty-step">
          <div class="wf-head">
            <span class="wf-num mono">{s.n}</span>
            <span class="wf-time mono">{s.t}</span>
          </div>
          <div class="wf-title serif">{s.title}</div>
          <div class="wf-desc">{s.desc}</div>
          <div class="wf-actor mono">by {s.actor}</div>
        </li>
      )}
    </For>
  </ol>
);

// ===========================================================================
//  Claim form
// ===========================================================================

type Condition = "dead" | "critical" | "limb" | "other";

const CONDITION_OPTIONS: { key: Condition; label: string }[] = [
  { key: "dead", label: "完全死亡" },
  { key: "critical", label: "重篤 / 瀕死" },
  { key: "limb", label: "脚・触角の欠損" },
  { key: "other", label: "その他" },
];

/** 申請フォームは localStorage に保存しない (個体情報 + 注文情報の PII 懸念) */
const ClaimForm = () => {
  const [orderId, setOrderId] = createSignal("");
  const [arrivalAt, setArrivalAt] = createSignal("");
  const [specimenId, setSpecimenId] = createSignal("");
  const [condition, setCondition] = createSignal<Condition>("dead");
  const [photoName, setPhotoName] = createSignal<string>("");
  const [notes, setNotes] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  /** 必須: 注文番号 / 受取日時 / 状態。他はあると早く処理できる程度。 */
  const canSubmit = createMemo(
    () =>
      orderId().trim().length >= 4 &&
      arrivalAt().trim().length > 0 &&
      !submitting(),
  );

  /** 受取から何時間経ったか (超過チェック用) */
  const hoursSinceArrival = createMemo<number | null>(() => {
    const a = arrivalAt();
    if (!a) return null;
    const t = Date.parse(a);
    if (Number.isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 3_600_000);
  });

  const pastDeadline = createMemo(() => {
    const h = hoursSinceArrival();
    return h !== null && h > 24;
  });

  const reset = () => {
    setOrderId("");
    setArrivalAt("");
    setSpecimenId("");
    setCondition("dead");
    setPhotoName("");
    setNotes("");
  };

  const onFile = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    setPhotoName(f ? f.name : "");
  };

  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!canSubmit()) return;
    setSubmitting(true);
    // TODO: バックエンド実装時に api.claims.create({...}) に置き換え
    window.setTimeout(() => {
      setSubmitting(false);
      showToast({
        message: `申請 #${orderId().trim().slice(-6).toUpperCase()} を受付けました。48 時間以内に確認のご連絡をします。`,
        tone: "success",
        duration: 5000,
      });
      reset();
    }, 600);
  };

  return (
    <form class="warranty-form" onSubmit={onSubmit} noValidate>
      <div class="wf-grid">
        <div class="wf-field">
          <label class="label" for="wf-order">
            注文番号 <span class="wf-req">必須</span>
          </label>
          <input
            id="wf-order"
            class="input mono"
            value={orderId()}
            onInput={(e) => setOrderId(e.currentTarget.value)}
            placeholder="K-2026-08-1542"
            autocomplete="off"
            required
          />
        </div>

        <div class="wf-field">
          <label class="label" for="wf-arrival">
            受取日時 <span class="wf-req">必須</span>
          </label>
          <input
            id="wf-arrival"
            class="input mono"
            type="datetime-local"
            value={arrivalAt()}
            onInput={(e) => setArrivalAt(e.currentTarget.value)}
            required
          />
          <Show when={pastDeadline()}>
            <div class="wf-hint warn" role="status">
              ※ 受取から 24 時間を超えています。状況により対応できない場合があります。
            </div>
          </Show>
        </div>

        <div class="wf-field">
          <label class="label" for="wf-specimen">
            個体 ID <span class="wf-opt">任意</span>
          </label>
          <input
            id="wf-specimen"
            class="input mono"
            value={specimenId()}
            onInput={(e) => setSpecimenId(e.currentTarget.value)}
            placeholder="#DHH-0271"
          />
        </div>

        <div class="wf-field">
          <label class="label" for="wf-condition">
            状態
          </label>
          <select
            id="wf-condition"
            class="select"
            value={condition()}
            onChange={(e) => setCondition(e.currentTarget.value as Condition)}
          >
            <For each={CONDITION_OPTIONS}>
              {(o) => <option value={o.key}>{o.label}</option>}
            </For>
          </select>
        </div>

        <div class="wf-field wf-field-wide">
          <label class="label" for="wf-photo">
            写真 (開封直後のもの) <span class="wf-opt">任意</span>
          </label>
          <input
            id="wf-photo"
            class="input"
            type="file"
            accept="image/*"
            onInput={onFile}
          />
          <Show when={photoName()}>
            <div class="wf-hint">添付: {photoName()}</div>
          </Show>
        </div>

        <div class="wf-field wf-field-wide">
          <label class="label" for="wf-notes">
            備考 <span class="wf-opt">任意</span>
          </label>
          <textarea
            id="wf-notes"
            class="input"
            rows="3"
            value={notes()}
            onInput={(e) => setNotes(e.currentTarget.value)}
            placeholder="配送時の外箱の破損、温度表示の異常など気付いた点を記入してください。"
          />
        </div>
      </div>

      <div class="wf-actions">
        <span class="mono wf-req-note">
          <Show
            when={canSubmit()}
            fallback={<>必須項目 (注文番号 / 受取日時) を入力してください</>}
          >
            確認画面はありません。押すと申請が送信されます。
          </Show>
        </span>
        <button
          type="submit"
          class="btn primary"
          disabled={!canSubmit()}
          aria-disabled={!canSubmit()}
        >
          <Show when={submitting()} fallback={<>申請を送信</>}>
            送信中...
          </Show>
        </button>
      </div>
    </form>
  );
};

// ===========================================================================
//  Page
// ===========================================================================

export const WarrantyPage = () => {
  return (
    <section class="stack" aria-labelledby="warranty-head">
      <div class="sec-head">
        <span class="num">§</span>
        <h2 id="warranty-head">安心保証について</h2>
      </div>

      <p
        style={{
          color: "var(--ink-mute)",
          "font-size": "13px",
          "margin-top": "8px",
        }}
      >
        KOCHŪ はすべての生体取引に<strong>死着補償 (24h 以内 自動返金)</strong>・
        <strong>温度制御便</strong>・
        <strong>購入後の自動カルテ生成</strong>を標準で提供します。
        到着後 24 時間以内に下記フォームから申請いただければ、確認後に全額を自動返金します。
      </p>

      {/* ---- 24h 返金フロー ---- */}
      <div class="sec-head" style={{ "margin-top": "24px" }}>
        <span class="num">§01</span>
        <h2>24h 返金フロー</h2>
      </div>
      <div class="card" style={{ padding: "22px" }}>
        <FlowDiagram />
        <div class="warranty-note">
          配送料は返金対象外です。輸送中の箱の損傷や温度計の異常が確認できる写真が
          あると、第 2 ステップの処理が最速 1 時間で完了します。
        </div>
      </div>

      {/* ---- 申請フォーム ---- */}
      <div class="sec-head" style={{ "margin-top": "28px" }}>
        <span class="num">§02</span>
        <h2>死着補償 申請フォーム</h2>
      </div>
      <div class="card" style={{ padding: "22px" }}>
        <ClaimForm />
      </div>

      {/* ---- 既存の補足 (温度便 / カルテ) ---- */}
      <div class="sec-head" style={{ "margin-top": "28px" }}>
        <span class="num">§03</span>
        <h2>同梱される他の保証</h2>
      </div>

      <div class="card" style={{ padding: "20px" }}>
        <h3 class="serif" style={{ margin: 0, "font-size": "18px" }}>
          温度制御便
        </h3>
        <ul
          style={{
            "padding-left": "18px",
            "margin-top": "8px",
            "font-size": "13px",
          }}
        >
          <li>全生体は提携物流の温度管理車両で輸送されます (目安 18〜26℃)。</li>
          <li>夏期・冬期は配送ルートを短縮し、最長でも翌日到着を目指します。</li>
          <li>
            配送トラブル発生時の補償は
            <A href={ROUTE_PATHS.warranty} style={{ "margin-left": "4px" }}>
              §01 死着補償
            </A>
            の対象となります。
          </li>
        </ul>
      </div>

      <div class="card" style={{ padding: "20px", "margin-top": "12px" }}>
        <h3 class="serif" style={{ margin: 0, "font-size": "18px" }}>
          購入後 自動カルテ生成
        </h3>
        <ul
          style={{
            "padding-left": "18px",
            "margin-top": "8px",
            "font-size": "13px",
          }}
        >
          <li>購入が確定すると、個体カルテが自動でマイページに追加されます。</li>
          <li>カルテには血統情報・羽化日・産地などが転記され、後から編集できます。</li>
          <li>飼育ログ・体重推移はそのままカルテに紐付きます。</li>
        </ul>
      </div>

      <div
        style={{
          "margin-top": "18px",
          padding: "12px 14px",
          background: "var(--bg-sunken)",
          "border-radius": "var(--r-md)",
          "font-size": "12px",
          color: "var(--ink-mute)",
        }}
      >
        ※ 本ページは暫定文言です。正式な補償規定は別途「利用規約」に定めます。
        ご不明点は
        <a
          href="mailto:support@kochu.example"
          style={{ "margin-left": "4px" }}
        >
          support@kochu.example
        </a>
        までお問い合わせください。
      </div>

      <div style={{ "margin-top": "22px" }}>
        <A href={ROUTE_PATHS.products} class="btn sm ghost">
          ← 商品一覧に戻る
        </A>
      </div>
    </section>
  );
};
