// pages/listings/steps.tsx — 出品 Wizard の presentational なステップ群
//
// 状態は親 (new.tsx::ListingNewPage) が集中管理し、各ステップは props で signals を
// 受けるだけ。Stepper / Step1-4 + PhotoUploader / EmptyHint をここに集約する。

import { createMemo, createSignal, For, Show } from "solid-js";
import type { Specimen } from "../../data";
import {
  postStripeConnectOnboarding,
  SduiFetchError,
  uploadFile,
  type ShippingMethodResponse,
} from "../../sdui/api";
import { STEP_LABELS, type SellMode, type WizardStep } from "./types";

export const Stepper = (props: {
  current: WizardStep;
  setStep: (s: WizardStep) => void;
  canAdvance: boolean;
}) => {
  const steps: WizardStep[] = [1, 2, 3, 4];
  return (
    <ol class="wizard-stepper" role="list" aria-label="出品作成ステップ">
      <For each={steps}>
        {(s) => {
          const isCurrent = () => props.current === s;
          const isDone = () => props.current > s;
          // 「進む」方向は canAdvance が true でないと隣接以外に飛べない。
          // ただし「戻る」方向 (= 既に通過した step) は常に戻れる。
          const isClickable = () => isDone() || isCurrent() || s === props.current + 1 && props.canAdvance;
          return (
            <li
              class={
                "wizard-step-pill" +
                (isCurrent() ? " is-current" : "") +
                (isDone() ? " is-done" : "")
              }
              aria-current={isCurrent() ? "step" : undefined}
            >
              <button
                type="button"
                onClick={() => isClickable() && props.setStep(s)}
                disabled={!isClickable()}
                class="wizard-step-btn"
              >
                <span class="wizard-step-num">{s}</span>
                <span class="wizard-step-name">{STEP_LABELS[s]}</span>
              </button>
            </li>
          );
        }}
      </For>
    </ol>
  );
};

// ──────────────────────────────────────────────────────────────────────
// Step 1: 個体を選ぶ
// ──────────────────────────────────────────────────────────────────────

export const StepPickSpecimen = (props: {
  myStock: Specimen[];
  picked: string | null;
  setPicked: (id: string) => void;
}) => (
  <>
    <div class="sec-head">
      <span class="num">§01</span>
      <h2 id="step-1-heading">出品する個体を選ぶ</h2>
      <span class="meta">所有個体 {props.myStock.length} 件</span>
    </div>
    <Show
      when={props.myStock.length > 0}
      fallback={
        <p style={{ color: "var(--ink-mute)", "font-size": "13px" }}>
          所有個体がありません。先に個体を登録してください。
        </p>
      }
    >
      <div class="specimen-grid">
        <For each={props.myStock}>
          {(s) => (
            <button
              type="button"
              onClick={() => props.setPicked(s.id)}
              class={
                "specimen-card-pick" +
                (props.picked === s.id ? " is-selected" : "")
              }
              aria-pressed={props.picked === s.id}
            >
              <div class="specimen-thumb-wrap">
                <div
                  class="ph forest"
                  role="img"
                  aria-label={`${s.name} ${s.sex}`}
                />
              </div>
              <div class="specimen-meta">
                <div class="mono specimen-pubid">{s.id}</div>
                <div class="specimen-name">{s.name}</div>
                <div class="specimen-tags">
                  <span class="chip">{s.generation || "—"}</span>
                  <span class="chip">{s.sex}</span>
                  <Show when={s.sizeMm}>
                    <span class="chip">{s.sizeMm}mm</span>
                  </Show>
                </div>
              </div>
            </button>
          )}
        </For>
      </div>
    </Show>
  </>
);

// ──────────────────────────────────────────────────────────────────────
// Step 2: 写真と説明 (= 6b で写真追加。現状は説明文のみ)
// ──────────────────────────────────────────────────────────────────────

const MAX_PHOTOS = 4;

export const StepDescribe = (props: {
  picked: Specimen | undefined;
  desc: string;
  descEdited: boolean;
  setDesc: (v: string) => void;
  resetDesc: () => void;
  photos: Array<{ assetId: string; publicUrl: string }>;
  setPhotos: (
    updater:
      | Array<{ assetId: string; publicUrl: string }>
      | ((
          prev: Array<{ assetId: string; publicUrl: string }>,
        ) => Array<{ assetId: string; publicUrl: string }>),
  ) => void;
}) => (
  <>
    <div class="sec-head">
      <span class="num">§02</span>
      <h2 id="step-2-heading">写真と説明</h2>
      <span class="meta">カルテから自動生成 / 編集可</span>
    </div>

    <Show when={props.picked} fallback={<EmptyHint />}>
      {(s) => (
        <>
          <div class="picked-summary">
            <div class="mono small forest">選択中</div>
            <div class="picked-name">{s().name}</div>
            <div class="mono small mute">{s().id} ・ {s().generation || "—"}</div>
          </div>

          <PhotoUploader photos={props.photos} setPhotos={props.setPhotos} />

          <div class="desc-toolbar">
            <label class="label" for="market-desc">
              商品説明
            </label>
            <Show when={props.descEdited}>
              <button
                type="button"
                class="btn sm ghost"
                onClick={props.resetDesc}
                title="カルテから再生成してテンプレに戻す"
              >
                ↺ テンプレに戻す
              </button>
            </Show>
          </div>
          <textarea
            id="market-desc"
            class="textarea"
            rows={10}
            placeholder="個体を選択するとカルテ情報から下書きを生成します"
            value={props.desc}
            onInput={(e) => props.setDesc((e.currentTarget as HTMLTextAreaElement).value)}
          />
        </>
      )}
    </Show>
  </>
);

// ──────────────────────────────────────────────────────────────────────
// PhotoUploader (= Step 2 内の 4 スロット + ＋ ボタン)
// ──────────────────────────────────────────────────────────────────────
//
// 1 スロット = 1 枚のアップロード済写真。1 枚目に「カバー」バッジ。
// 「＋」ボタン → file picker → uploadFile (sign / PUT / complete) を 1 枚ずつ実行。
//
// **失敗ハンドリング**:
//   - 1 枚 upload 失敗で他の写真の状態を破棄しない (= 部分成功を許容)。
//   - エラーは inline メッセージで表示 + 次の試行で消える。
//
// **削除**:
//   削除はクライアント state からの除去のみで、server 上の asset は pending/uploaded のまま
//   残る (= GC バッチで abandoned に倒す想定)。listing に attach されない asset は orphan で OK。

const PhotoUploader = (props: {
  photos: Array<{ assetId: string; publicUrl: string }>;
  setPhotos: (
    updater:
      | Array<{ assetId: string; publicUrl: string }>
      | ((
          prev: Array<{ assetId: string; publicUrl: string }>,
        ) => Array<{ assetId: string; publicUrl: string }>),
  ) => void;
}) => {
  const [uploading, setUploading] = createSignal(false);
  const [uploadError, setUploadError] = createSignal<string | null>(null);
  let inputEl: HTMLInputElement | undefined;

  const onPickFile = () => {
    setUploadError(null);
    inputEl?.click();
  };

  const onFileChange = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // 同じファイル名を再選択しても onChange が発火するように value をリセット
    input.value = "";
    if (!file) return;

    if (props.photos.length >= MAX_PHOTOS) {
      setUploadError(`写真は最大 ${MAX_PHOTOS} 枚までです`);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setUploadError("画像ファイルを選択してください");
      return;
    }

    setUploading(true);
    try {
      const result = await uploadFile(file);
      // 関数 setter を使って最新値に append (= 連続クリック時の上書き事故を回避)
      props.setPhotos((prev) => [...prev, result]);
    } catch (err) {
      const msg =
        err instanceof SduiFetchError
          ? `アップロード失敗 (HTTP ${err.status})`
          : err instanceof Error
            ? err.message
            : String(err);
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  };

  const removeAt = (idx: number) => {
    props.setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <>
      <div class="photo-grid" aria-label="出品写真">
        <For each={props.photos}>
          {(p, i) => (
            <div class="photo-slot">
              <img src={p.publicUrl} alt={`出品写真 ${i() + 1}`} />
              <Show when={i() === 0}>
                <span class="photo-cover-badge">カバー</span>
              </Show>
              <button
                type="button"
                class="photo-remove"
                onClick={() => removeAt(i())}
                aria-label={`写真 ${i() + 1} を削除`}
                title="削除"
              >
                ×
              </button>
            </div>
          )}
        </For>
        <Show when={props.photos.length < MAX_PHOTOS}>
          <button
            type="button"
            class="photo-add"
            onClick={onPickFile}
            disabled={uploading()}
            aria-label="写真を追加"
          >
            <Show when={uploading()} fallback={<span>＋ 追加</span>}>
              <span class="mono small">アップロード中…</span>
            </Show>
          </button>
        </Show>
      </div>
      <input
        ref={inputEl}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={(e) => void onFileChange(e)}
      />
      <Show when={uploadError()}>
        {(msg) => (
          <div class="photo-error" role="alert">
            {msg()}
          </div>
        )}
      </Show>
    </>
  );
};

// ──────────────────────────────────────────────────────────────────────
// Step 3: 価格と販売方式
// ──────────────────────────────────────────────────────────────────────

export const StepPriceAndMode = (props: {
  mode: SellMode;
  setMode: (m: SellMode) => void;
  priceJpy: number;
  setPriceJpy: (n: number) => void;
  buyoutPrice: number | null;
  setBuyoutPrice: (n: number | null) => void;
  durationDays: 3 | 5 | 7;
  setDurationDays: (d: 3 | 5 | 7) => void;
  shippingMethods: ShippingMethodResponse[];
  shippingMethodIds: Set<string>;
  setShippingMethodIds: (
    updater: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
}) => {
  // 即決価格の妥当性 (= starting より厳格に大きい) を inline 警告で表示。
  const buyoutInvalid = () => {
    const b = props.buyoutPrice;
    return b !== null && b <= props.priceJpy;
  };

  // 配送方法のチェック切替。最低 1 つは残すよう、解除予定が最後の 1 つなら拒否。
  const toggleShipping = (id: string) => {
    props.setShippingMethodIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <>
      <div class="sec-head">
        <span class="num">§03</span>
        <h2 id="step-3-heading">価格と販売方式</h2>
      </div>

      <label class="label">販売方式</label>
      <div class="seg-2">
        <button
          type="button"
          class={"seg-btn" + (props.mode === "auction" ? " is-on" : "")}
          onClick={() => props.setMode("auction")}
        >
          オークション
        </button>
        <button
          type="button"
          class={"seg-btn" + (props.mode === "fixed" ? " is-on" : "")}
          onClick={() => {
            props.setMode("fixed");
            // 即決のみに切替時は併用即決価格をクリア (= server CHECK 拒否を回避)
            props.setBuyoutPrice(null);
          }}
        >
          即決のみ
        </button>
      </div>

      <label class="label" style={{ "margin-top": "16px" }}>
        {props.mode === "auction" ? "開始価格" : "即決価格"}
      </label>
      <div class="price-input">
        <span class="price-yen mono">¥</span>
        <input
          class="input mono"
          type="number"
          min="1"
          step="100"
          value={props.priceJpy}
          onInput={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            if (Number.isFinite(v) && v >= 0) props.setPriceJpy(v);
          }}
        />
      </div>

      <Show when={props.mode === "auction"}>
        <label class="label" style={{ "margin-top": "16px" }}>
          終了期間
        </label>
        <select
          class="select"
          value={String(props.durationDays)}
          onChange={(e) => {
            const v = Number((e.currentTarget as HTMLSelectElement).value);
            if (v === 3 || v === 5 || v === 7) props.setDurationDays(v);
          }}
        >
          <option value="3">3日</option>
          <option value="5">5日</option>
          <option value="7">7日</option>
        </select>

        {/* 即決価格を併用 (= "Buy It Now")。任意・auction 限定。 */}
        <label class="label" style={{ "margin-top": "16px" }}>
          即決価格を併用
          <span style={{ color: "var(--ink-faint)", "font-weight": 400, "margin-left": "8px", "font-size": "11px" }}>
            任意 / 開始価格より高い額
          </span>
        </label>
        <div class="price-input">
          <span class="price-yen mono">¥</span>
          <input
            class="input mono"
            type="number"
            min="1"
            step="100"
            placeholder="例: 65,000"
            value={props.buyoutPrice ?? ""}
            onInput={(e) => {
              const raw = (e.currentTarget as HTMLInputElement).value;
              if (raw === "") {
                props.setBuyoutPrice(null);
                return;
              }
              const v = Number(raw);
              if (Number.isFinite(v) && v >= 0) props.setBuyoutPrice(v);
            }}
          />
        </div>
        <Show when={buyoutInvalid()}>
          <div class="submit-error" style={{ "margin-top": "8px" }} role="alert">
            即決価格は開始価格 (¥{props.priceJpy.toLocaleString("ja-JP")}) より高く設定してください
          </div>
        </Show>
      </Show>

      {/* 対応可能な配送方法 (= 出品者が選んだ集合のみ checkout で表示される) */}
      <Show when={props.shippingMethods.length > 0}>
        <label class="label" style={{ "margin-top": "16px" }}>
          対応可能な配送方法
          <span style={{ color: "var(--ink-faint)", "font-weight": 400, "margin-left": "8px", "font-size": "11px" }}>
            最低1つ / 購入者はこの中から選択
          </span>
        </label>
        <div class="shipping-method-list">
          <For each={props.shippingMethods}>
            {(m) => {
              const checked = () => props.shippingMethodIds.has(m.id);
              return (
                <label
                  class={"shipping-method-item" + (checked() ? " is-on" : "")}
                  data-checked={checked() ? "1" : "0"}
                >
                  <input
                    type="checkbox"
                    checked={checked()}
                    onChange={() => toggleShipping(m.id)}
                  />
                  <div class="shipping-method-body">
                    <div class="shipping-method-name">{m.name}</div>
                    <Show when={m.description}>
                      <div class="shipping-method-desc">{m.description}</div>
                    </Show>
                  </div>
                  <div class="shipping-method-fee mono">
                    +¥{m.amountJpy.toLocaleString("ja-JP")}
                  </div>
                </label>
              );
            }}
          </For>
        </div>
        <Show when={props.shippingMethodIds.size === 0}>
          <div class="submit-error" style={{ "margin-top": "8px" }} role="alert">
            最低 1 つの配送方法を選択してください
          </div>
        </Show>
      </Show>

      <div class="fee-note">
        <div class="fee-note-head">手数料と保護</div>
        販売手数料 10% / Stripe決済手数料 3.6% / エスクロー購入者保護 / 死着自動返金
      </div>
    </>
  );
};

// ──────────────────────────────────────────────────────────────────────
// Step 4: 確認 → 出品
// ──────────────────────────────────────────────────────────────────────

const FEE_RATE_PLATFORM = 0.10;
const FEE_RATE_STRIPE = 0.036;

export const StepReview = (props: {
  picked: Specimen | undefined;
  mode: SellMode;
  priceJpy: number;
  buyoutPrice: number | null;
  durationDays: 3 | 5 | 7;
  desc: string;
  photos: Array<{ assetId: string; publicUrl: string }>;
  shippingMethods: ShippingMethodResponse[];
  shippingMethodIds: Set<string>;
  /** Stripe Connect 連携状態。'active' 以外なら警告バナーを出す。 */
  stripeConnectStatus: string;
  submitError: string | null;
}) => {

  const onStartOnboarding = async () => {
    try {
      const res = await postStripeConnectOnboarding();
      window.location.href = res.onboardingUrl;
    } catch (e) {
      const msg =
        e instanceof SduiFetchError
          ? `HTTP ${e.status} — ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      alert(`Stripe 連携の開始に失敗しました: ${msg}`);
    }
  };

  // 想定受取額 (= 開始/即決価格を基準に手数料控除)。auction は実際の落札額で再計算されるため
  // ここはあくまで「想定」表示。
  const fees = createMemo(() => {
    const platform = Math.round(props.priceJpy * FEE_RATE_PLATFORM);
    const stripe = Math.round(props.priceJpy * FEE_RATE_STRIPE);
    const net = props.priceJpy - platform - stripe;
    return { platform, stripe, net };
  });

  return (
    <>
      <div class="sec-head">
        <span class="num">§04</span>
        <h2 id="step-4-heading">確認 → 出品</h2>
      </div>

      {/* Stripe Connect 未連携時の警告バナー (= 出品 disabled の理由を可視化) */}
      <Show when={props.stripeConnectStatus !== "active"}>
        <div
          style={{
            padding: "12px 14px",
            background: "var(--accent-amber-soft, oklch(0.96 0.04 80))",
            "border-left": "4px solid var(--accent-amber, oklch(0.78 0.13 80))",
            "border-radius": "var(--r-md)",
            "margin-bottom": "16px",
            display: "flex",
            "align-items": "center",
            gap: "12px",
            "flex-wrap": "wrap",
          }}
          role="alert"
        >
          <div style={{ flex: 1, "min-width": "200px" }}>
            <div style={{ "font-weight": 600, "margin-bottom": "4px", color: "oklch(0.40 0.13 80)" }}>
              Stripe Connect 連携が必要です
            </div>
            <div style={{ "font-size": "12.5px", color: "var(--ink-mute)" }}>
              売上の振込先を Stripe Connect で連携してから出品できます。
              <Show when={props.stripeConnectStatus === "pending"}>
                {" "}（onboarding が進行中です）
              </Show>
              <Show when={props.stripeConnectStatus === "restricted"}>
                {" "}（追加情報の提出が必要です）
              </Show>
            </div>
          </div>
          <button
            type="button"
            class="btn primary"
            onClick={() => void onStartOnboarding()}
            style={{
              padding: "8px 14px",
              "border-radius": "var(--r-md)",
              background: "var(--ink)",
              color: "white",
              "font-weight": 600,
              "font-size": "13px",
              border: "none",
              cursor: "pointer",
              "white-space": "nowrap",
            }}
          >
            連携する →
          </button>
        </div>
      </Show>

      <Show
        when={props.picked}
        fallback={<p style={{ color: "var(--alert)" }}>個体が未選択です</p>}
      >
        {(s) => (
          <>
            <div class="review-card">
              {/* 写真があれば 1 枚目をカバーとして表示、無ければ placeholder */}
              <Show
                when={props.photos.length > 0}
                fallback={
                  <div
                    class="ph forest review-thumb"
                    role="img"
                    aria-label={s().name}
                  />
                }
              >
                <img
                  class="review-thumb-img"
                  src={props.photos[0]!.publicUrl}
                  alt={`${s().name} の出品写真`}
                />
              </Show>
              <div class="review-body">
                <div class="mono small mute">{s().id}</div>
                <div class="review-title">{s().name} {s().sex}</div>
                <div class="mono small mute">
                  {props.mode === "auction"
                    ? `オークション ${props.durationDays}日`
                    : "即決のみ"}
                  {" ・ 写真 "}{props.photos.length}{"枚"}
                </div>
                <div class="review-price serif">
                  ¥{props.priceJpy.toLocaleString("ja-JP")}
                  {props.mode === "auction" && <small>〜</small>}
                </div>
                {/* 即決価格を併用している時は併記 */}
                <Show when={props.mode === "auction" && props.buyoutPrice !== null}>
                  <div class="mono small mute" style={{ "margin-top": "2px" }}>
                    即決 ¥{props.buyoutPrice!.toLocaleString("ja-JP")}
                  </div>
                </Show>
              </div>
            </div>

            <Show when={props.photos.length > 1}>
              <div class="review-photo-strip" aria-label="出品写真サムネイル">
                <For each={props.photos.slice(1)}>
                  {(p, i) => (
                    <img
                      src={p.publicUrl}
                      alt={`サブ写真 ${i() + 2}`}
                      class="review-photo-thumb"
                    />
                  )}
                </For>
              </div>
            </Show>

            <div class="fee-summary">
              <div class="fee-row">
                <span>{props.mode === "auction" ? "想定落札額" : "即決価格"}</span>
                <span class="serif">¥{props.priceJpy.toLocaleString("ja-JP")}</span>
              </div>
              <div class="fee-row mute">
                <span>販売手数料 (10%)</span>
                <span>−¥{fees().platform.toLocaleString("ja-JP")}</span>
              </div>
              <div class="fee-row mute">
                <span>Stripe (3.6%)</span>
                <span>−¥{fees().stripe.toLocaleString("ja-JP")}</span>
              </div>
              <div class="fee-row total">
                <span>あなたの受取額</span>
                <span class="serif">¥{fees().net.toLocaleString("ja-JP")}</span>
              </div>
            </div>

            {/* 対応可能な配送方法サマリ */}
            <Show when={props.shippingMethods.length > 0}>
              <div class="review-shipping" style={{ "margin-top": "16px" }}>
                <div class="label" style={{ "margin-bottom": "6px" }}>
                  対応可能な配送方法
                </div>
                <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
                  <For
                    each={props.shippingMethods.filter((m) =>
                      props.shippingMethodIds.has(m.id),
                    )}
                  >
                    {(m) => (
                      <span
                        class="chip"
                        style={{ background: "var(--accent-forest-soft, oklch(0.93 0.03 150))", color: "var(--accent-forest, oklch(0.45 0.08 150))", "font-size": "12px" }}
                      >
                        {m.name}
                      </span>
                    )}
                  </For>
                  <Show when={props.shippingMethodIds.size === 0}>
                    <span class="chip" style={{ color: "var(--accent-rose, #b91c1c)" }}>
                      未選択
                    </span>
                  </Show>
                </div>
              </div>
            </Show>

            <details class="review-desc">
              <summary>商品説明を確認</summary>
              <pre class="review-desc-body">{props.desc}</pre>
            </details>
          </>
        )}
      </Show>

      <Show when={props.submitError}>
        {(msg) => (
          <div class="submit-error" role="alert">
            {msg()}
          </div>
        )}
      </Show>
    </>
  );
};

// ──────────────────────────────────────────────────────────────────────
// 共通ユーティリティ
// ──────────────────────────────────────────────────────────────────────

export const EmptyHint = () => (
  <div class="empty-hint">
    Step 1 で出品する個体を選んでください
  </div>
);
