// pages/listings/new.tsx — C2C 出品作成 Wizard (ドラフト保存対応)
//
// **エントリ**:
//   - 個体カルテ「この個体を出品」ボタン → /listings/new?specimen=:publicId
//   - /products 一覧の「+ 出品する」 / マイ出品ページの「+ 出品する」
//   - モバイル BottomTabBar の中央 FAB ActionSheet「出品する」
//
// **Wizard 構成**:
//   Step 1: 個体を選ぶ  (specimen picker)
//   Step 2: 写真と説明  (description editor + 写真追加)
//   Step 3: 価格と販売方式 (mode + price + auction duration + 配送 / 推奨価格)
//   Step 4: 確認 → 出品  (review summary + submit)
//
// **責務分担**:
//   - state は ListingNewPage 内で集中管理 (= step ごとに分割しない単一フォーム)。
//   - 各ステップは presentational に近い (= props で signals を受けるだけ)。
//   - validation は `canAdvance(step)` で次へ進めるかを判定。
//
// **画面サイズ共通の挙動**:
//   - active な step を 1 つだけ表示 (= 真の wizard / タブ切替)。
//   - Stepper のクリックで該当 step にジャンプ (= 進む方向は canAdvance ガード、戻るは自由)。
//   - sticky bottom CTA bar に「戻る / 次へ / 出品する」を集約。
//   - mobile では Stepper のラベルを隠して数字バッジのみ + bottom CTA は BottomTabBar の上に固定。

import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from "solid-js";
import { useSearchParams, useNavigate } from "@solidjs/router";
import { getSpecimen, listSpecimens } from "../../api";
import type { Specimen } from "../../data";
import {
  findServerSpecimenByPublicId,
  serverSpecimens,
  normalizeSpecimenForLegacy,
} from "../../store/specimens";
import { currentUser, isLoggedIn } from "../../store/auth";
import {
  fetchShippingMethods,
  postListing,
  SduiFetchError,
  type ShippingMethodResponse,
} from "../../sdui/api";
import { loadListings } from "../../store/listings";
import {
  clearListingDraft,
  loadListingDraft,
  saveListingDraft,
} from "../../store/listingDraft";
import { triggerMyListingsRefresh } from "../../store/myListings";
import { showToast } from "../../store/toast";
import { STEP_LABELS, type SellMode, type WizardStep } from "./types";
import {
  Stepper,
  StepPickSpecimen,
  StepDescribe,
  StepPriceAndMode,
  StepReview,
} from "./steps";

/**
 * カルテ情報から出品ドラフト本文を生成する。
 *   - サイズ・性別・累代・血統・産地(shop)・羽化目安を箇条書きで盛り込む
 *   - 累代未登録 (F0 / WILD) の場合は「野生個体」として文面を切替
 *   - photo / 死着補償 の案内は固定
 */
export const templateFor = (s: Specimen): string => {
  const size = s.sizeMm ? `${s.sizeMm}mm` : "サイズ未計測";
  const weight = s.weightG ? ` / ${s.weightG}g` : "";
  const gen = s.generation || "累代不明";
  const isWild = /WILD|F0/i.test(gen);
  const parents =
    s.bloodline && (s.bloodline.father || s.bloodline.mother)
      ? `父 ${s.bloodline.father || "—"} / 母 ${s.bloodline.mother || "—"}`
      : "親個体情報なし";
  const eclo = s.eclosionETA
    ? `羽化目安 ${s.eclosionETA} (あと約 ${s.eclosionInDays ?? "?"} 日)`
    : "羽化済み / 成虫";

  const head = `${s.name} (${s.sex})`;
  const lines = [
    head,
    "",
    `■ サイズ: ${size}${weight}`,
    `■ 累代: ${gen}${isWild ? " (野生個体)" : ""}`,
    `■ 血統: ${parents}`,
    `■ 産地: ${s.shop || "—"}`,
    `■ ステータス: ${s.stage} / ${eclo}`,
    "",
    "血統書付・累代管理個体です。",
    "死着補償および温度制御便に対応しております。",
  ];
  return lines.join("\n");
};

export const ListingNewPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // 個体選択肢: login 中なら server 値、anonymous なら mock。
  const myStock = (): Specimen[] => {
    const sv = serverSpecimens();
    if (isLoggedIn() && sv) {
      return sv.map(normalizeSpecimenForLegacy);
    }
    return listSpecimens();
  };

  // URL クエリ ?specimen= でプリセレクト。
  const urlSpecimen = (() => {
    const raw = searchParams.specimen;
    const pid = Array.isArray(raw) ? raw[0] : raw;
    if (!pid) return null;
    return getSpecimen(pid)?.id ?? pid;
  })();

  // localStorage から下書きを復元。
  //   - URL ?specimen= があれば、その個体を最優先 (= ユーザの直近の意思を尊重)。
  //     URL の specimen が draft.picked と一致するなら他フィールドもそのまま復元。
  //     一致しないなら picked のみ URL を採用し、step は 1 にリセットして他は draft 値。
  //   - URL 指定がなければ draft をそのまま全復元。
  //   - draft がなければ通常の初期値。
  const draft = loadListingDraft();
  const draftWasRestored = draft !== null;

  const initialPicked: string | null = urlSpecimen ?? draft?.picked ?? null;
  const initialStep: WizardStep =
    urlSpecimen && draft && draft.picked !== urlSpecimen
      ? 2 // URL が draft と異なる個体なので step 1 はスキップ + 他フィールドは流用
      : draft?.step ?? (initialPicked ? 2 : 1);

  const [step, setStep] = createSignal<WizardStep>(initialStep);
  const [picked, setPicked] = createSignal<string | null>(initialPicked);
  const [mode, setMode] = createSignal<SellMode>(draft?.mode ?? "auction");
  const [desc, setDesc] = createSignal(draft?.desc ?? "");
  const [descEdited, setDescEdited] = createSignal(draft?.descEdited ?? false);
  const [priceJpy, setPriceJpy] = createSignal<number>(
    draft?.priceJpy ?? 45000,
  );
  // 即決価格 (auction 限定の任意設定)。
  // - null: 未設定 (= Buy It Now なし)
  // - number: starting_price_jpy より大きい必要がある (= server validate でも握る)
  const [buyoutPrice, setBuyoutPrice] = createSignal<number | null>(
    draft?.buyoutPrice ?? null,
  );
  const [durationDays, setDurationDays] = createSignal<3 | 5 | 7>(
    draft?.durationDays ?? 3,
  );
  // 出品者が対応可能な配送方法 ID 集合。空 Set = 「全方法 OK」。
  // 初期は配送方法マスタを fetch してから「全選択」状態にする (= 出品者の意思を尊重しつつ
  // デフォルトで漏れなく対応すると申告する形)。
  // draft があれば配列 → Set に戻す。
  const [shippingMethodIds, setShippingMethodIds] = createSignal<Set<string>>(
    new Set(draft?.shippingMethodIds ?? []),
  );

  // 配送方法マスタ (= /api/v1/shipping_methods)。Step 3 で表示する。
  // anonymous でも fetch 可能 (公開 endpoint)。失敗時は空配列。
  const [shippingMethods] = createResource<ShippingMethodResponse[]>(async () => {
    try {
      return await fetchShippingMethods();
    } catch (e) {
      console.warn("fetchShippingMethods failed:", e);
      return [];
    }
  });

  // 配送方法マスタが読み込めたら、初期値として全選択にする (= 既定 = 全方法 OK の意思表示)。
  // ただしドラフトを復元した場合はユーザの選択を尊重するため auto-fill しない
  // (= 「draft 内で意図的に空にした」可能性があるため上書きしない)。
  createEffect(() => {
    const methods = shippingMethods();
    if (
      !draftWasRestored &&
      methods &&
      methods.length > 0 &&
      shippingMethodIds().size === 0
    ) {
      setShippingMethodIds(new Set(methods.map((m) => m.id)));
    }
  });
  const [submitting, setSubmitting] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string | null>(null);
  // アップロード済写真。最大 4 枚。1 枚目がカバー。
  // 各要素は `{ assetId, publicUrl }`。listing submit 時に assetId を渡して attach。
  // draft があれば復元 (= asset GC 後は <img> が 404 する可能性あるが許容)。
  const [photos, setPhotos] = createSignal<
    Array<{ assetId: string; publicUrl: string }>
  >(draft?.photos ?? []);

  // draft 復元時は info toast を 1 回だけ表示 (= サイレント復元の confusion 回避)。
  if (draftWasRestored) {
    showToast({
      tone: "info",
      message: "前回の下書きを復元しました",
    });
  }

  // 全フィールド変更を 500ms debounce で localStorage に保存。
  //   debounce することで、textarea で 1 文字打つたびに JSON.stringify が走る無駄を避ける。
  //   page unmount 時 / 次回 effect 再走時の cleanup でタイマーを clear する。
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    // 全 signal を effect 内で読むことで依存登録 (= どれが変わっても再走)
    const snapshot = {
      step: step(),
      picked: picked(),
      mode: mode(),
      desc: desc(),
      descEdited: descEdited(),
      priceJpy: priceJpy(),
      buyoutPrice: buyoutPrice(),
      durationDays: durationDays(),
      shippingMethodIds: Array.from(shippingMethodIds()),
      photos: photos(),
      savedAt: Date.now(),
    };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveListingDraft(snapshot);
    }, 500);
  });
  onCleanup(() => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  const pickedSpec = (): Specimen | undefined => {
    const id = picked();
    if (!id) return undefined;
    return getSpecimen(id) ?? myStock().find((s) => s.id === id);
  };

  // 個体選択が変わったらテンプレートを流し込む (= ユーザ編集前のみ)。
  createEffect(() => {
    const s = pickedSpec();
    if (!s) {
      setDesc("");
      setDescEdited(false);
      return;
    }
    if (!descEdited()) {
      setDesc(templateFor(s));
    }
  });

  // Stripe Connect 連携が 'active' でないと「出品する」を許可しない。
  // store/auth の currentUser().stripeConnectStatus を見る (= /me で同期済)。
  const isStripeConnectActive = createMemo(() => {
    const u = currentUser();
    if (!u) return false;
    return u.stripeConnectStatus === "active";
  });

  // ステップごとに「次へ」進める条件を定義。
  const canAdvance = createMemo<boolean>(() => {
    switch (step()) {
      case 1:
        return picked() != null;
      case 2:
        return desc().trim().length > 0;
      case 3: {
        // 即決価格を設定する場合は starting より厳格に大きい必要がある。
        // null (= 未設定) は OK。
        if (priceJpy() <= 0) return false;
        const buyout = buyoutPrice();
        if (buyout !== null && buyout <= priceJpy()) return false;
        // 配送方法を最低 1 つ選択している必要がある (= 「対応無し」出品は禁止)。
        // ただし配送方法マスタの取得が失敗した時 (= shippingMethods()=[]) は要求しない (= graceful degrade)。
        const methods = shippingMethods();
        if (methods && methods.length > 0 && shippingMethodIds().size === 0) {
          return false;
        }
        return true;
      }
      default:
        return true;
    }
  });

  const goNext = () => {
    const s = step();
    if (!canAdvance() || s === 4) return;
    setStep((s + 1) as WizardStep);
    // モバイルで step 切替時にスクロール先頭へ (= 長文入力後の confusion 回避)
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  };

  /**
   * 下書きを破棄して全フィールドを初期値に戻す。
   *   - confirm() で誤操作を防ぐ (= 入力途中で間違えて押した時の救済)。
   *   - localStorage を即時クリアし、その後 auto-save effect で「空 draft」が
   *     再書き込みされても無害 (= 次回開いた時の初期値と等価)。
   */
  const discardDraft = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("下書きを破棄して入力をリセットしますか？")
    ) {
      return;
    }
    setStep(urlSpecimen ? 2 : 1);
    setPicked(urlSpecimen);
    setMode("auction");
    setDesc("");
    setDescEdited(false);
    setPriceJpy(45000);
    setBuyoutPrice(null);
    setDurationDays(3);
    // 配送方法は「フレッシュ初期値 = 全選択」に戻す (= 通常起動時の既定 UX と同じ)。
    // マスタ未読なら空 Set。読み込み完了は createResource 経由で同期取れないため
    // ベストエフォート (= まだ未読なら、ユーザが Step 3 に到達するまでに自然に揃う)。
    const methods = shippingMethods();
    setShippingMethodIds(
      methods && methods.length > 0
        ? new Set(methods.map((m) => m.id))
        : new Set<string>(),
    );
    setPhotos([]);
    setSubmitError(null);
    clearListingDraft();
  };
  const goPrev = () => {
    const s = step();
    if (s === 1) {
      navigate(-1 as unknown as string);
      return;
    }
    setStep((s - 1) as WizardStep);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  };

  /** 確認ステップでの「出品する」: POST /api/v1/listings に送信 → 一覧 refresh + Toast + 遷移。 */
  const onSubmit = async () => {
    if (submitting()) return;
    const s = pickedSpec();
    if (!s) {
      setSubmitError("出品する個体を選択してください");
      setStep(1);
      return;
    }
    if (priceJpy() <= 0) {
      setSubmitError("価格は 1 円以上で入力してください");
      setStep(3);
      return;
    }

    const isAuction = mode() === "auction";
    const endsAt = isAuction
      ? new Date(Date.now() + durationDays() * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    const title = `${s.species} ${s.sex} ${s.sizeMm ? `${s.sizeMm}mm ` : ""}${
      s.generation || ""
    }`.trim();
    const sv = findServerSpecimenByPublicId(s.id);
    const specimenUuid = sv?.id;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await postListing({
        publicId: generateClientFallbackListingId(),
        specimenId: specimenUuid,
        title,
        description: desc(),
        isAuction,
        startingPriceJpy: priceJpy(),
        // 即決価格は auction かつ buyoutPrice() != null のときだけ送る。
        // 即決のみ出品 (= isAuction=false) では server CHECK で reject されるので明示的に skip。
        buyoutPriceJpy: isAuction ? buyoutPrice() : null,
        endsAt,
        // アップロード済 asset を listing に attach する
        assetIds: photos().map((p) => p.assetId),
        // 出品者が対応可能な配送方法 (= 全方法選択時もそのまま送る = 集合を明示)
        shippingMethodIds: Array.from(shippingMethodIds()),
      });
      // マイ出品 cache も同期 (= 出品直後にマイ出品ページが最新)
      void loadListings();
      triggerMyListingsRefresh();
      // submit 成功で下書きを破棄。失敗時は残しておき再送可能にする。
      clearListingDraft();
      showToast({
        tone: "success",
        message: `${res.publicId} を出品しました`,
      });
      navigate("/listings/me");
    } catch (e) {
      const msg =
        e instanceof SduiFetchError
          ? `HTTP ${e.status} — ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="listing-new">
      {/* ── ヘッダ + ステッパー ─────────────────────────────────── */}
      <div class="page-head">
        <div>
          <div class="cat">マーケット</div>
          <h1>個体を出品する</h1>
          <p class="page-head-sub">
            所有個体を C2C マーケットに出品 — 説明はカルテから自動生成、編集可
          </p>
        </div>
        {/* 下書きを破棄してフォームをリセットする (= 別個体を新規に出品し直す時) */}
        <div class="page-actions">
          <button
            type="button"
            class="btn sm ghost"
            onClick={discardDraft}
            title="入力中の下書きを破棄してフォームをリセット"
            disabled={submitting()}
          >
            下書きを破棄
          </button>
        </div>
      </div>

      <Stepper current={step()} setStep={setStep} canAdvance={canAdvance()} />

      {/* ── Wizard 本体 ─────────────────────────────────────────
          Stepper のクリックと整合させるため、画面サイズに関わらず active な step
          だけを表示する。CSS の `[data-active="0"] { display: none }` で出し分け。 */}
      <div class="wizard-body">
        <section
          class="wizard-step"
          data-step="1"
          data-active={step() === 1 ? "1" : "0"}
          aria-labelledby="step-1-heading"
        >
          <StepPickSpecimen
            myStock={myStock()}
            picked={picked()}
            setPicked={setPicked}
          />
        </section>

        <section
          class="wizard-step"
          data-step="2"
          data-active={step() === 2 ? "1" : "0"}
          aria-labelledby="step-2-heading"
        >
          <StepDescribe
            picked={pickedSpec()}
            desc={desc()}
            descEdited={descEdited()}
            setDesc={(v) => {
              setDesc(v);
              setDescEdited(true);
            }}
            resetDesc={() => {
              const s = pickedSpec();
              if (s) {
                setDesc(templateFor(s));
                setDescEdited(false);
              }
            }}
            photos={photos()}
            setPhotos={setPhotos}
          />
        </section>

        <section
          class="wizard-step"
          data-step="3"
          data-active={step() === 3 ? "1" : "0"}
          aria-labelledby="step-3-heading"
        >
          <StepPriceAndMode
            mode={mode()}
            setMode={setMode}
            priceJpy={priceJpy()}
            setPriceJpy={setPriceJpy}
            buyoutPrice={buyoutPrice()}
            setBuyoutPrice={setBuyoutPrice}
            durationDays={durationDays()}
            setDurationDays={setDurationDays}
            shippingMethods={shippingMethods() ?? []}
            shippingMethodIds={shippingMethodIds()}
            setShippingMethodIds={setShippingMethodIds}
          />
        </section>

        <section
          class="wizard-step"
          data-step="4"
          data-active={step() === 4 ? "1" : "0"}
          aria-labelledby="step-4-heading"
        >
          <StepReview
            picked={pickedSpec()}
            mode={mode()}
            priceJpy={priceJpy()}
            buyoutPrice={buyoutPrice()}
            durationDays={durationDays()}
            desc={desc()}
            photos={photos()}
            shippingMethods={shippingMethods() ?? []}
            shippingMethodIds={shippingMethodIds()}
            stripeConnectStatus={currentUser()?.stripeConnectStatus ?? "unlinked"}
            submitError={submitError()}
          />
        </section>
      </div>

      {/* ── sticky bottom CTA bar ─────────────────────────────── */}
      <div class="wizard-cta">
        <button
          type="button"
          class="btn"
          onClick={goPrev}
          disabled={submitting()}
        >
          {step() === 1 ? "キャンセル" : "戻る"}
        </button>
        <div class="wizard-cta-step mono" aria-live="polite">
          {step()} / 4 · {STEP_LABELS[step()]}
        </div>
        <Show
          when={step() === 4}
          fallback={
            <button
              type="button"
              class="btn primary"
              onClick={goNext}
              disabled={!canAdvance()}
            >
              次へ →
            </button>
          }
        >
          <button
            type="button"
            class="btn primary lg"
            onClick={() => void onSubmit()}
            disabled={submitting() || !canAdvance() || !isStripeConnectActive()}
            title={
              !isStripeConnectActive()
                ? "Stripe Connect 連携が必要です"
                : undefined
            }
          >
            {submitting() ? "送信中…" : "出品する"}
          </button>
        </Show>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────
// 共通ユーティリティ
// ──────────────────────────────────────────────────────────────────────

/** L-XXXXXX 形式の暫定 publicId 採番。
 *  本来は server 側で重複チェック付き自動採番すべき。 */
function generateClientFallbackListingId(): string {
  const ts = Date.now().toString(36).slice(-5).toUpperCase();
  return `L-${ts}`;
}
