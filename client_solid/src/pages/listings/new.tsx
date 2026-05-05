// pages/listings/new.tsx — C2C 出品作成ページ
//
// **エントリ**:
//   - 個体カルテ「この個体を出品」ボタン → /listings/new?specimen=:publicId
//   - /products 一覧の「+ 出品する」ボタン (= 個体未指定で開く)
//
// **フロー**:
//   1. 自分の所有個体から 1 件選択 (specimen 指定時はプリセレクト)
//   2. 販売方式 (オークション / 即決) と価格を設定
//   3. 商品説明はカルテから自動生成 (templateFor) → 編集可
//   4. 「出品する」ボタン → POST /api/v1/listings (= 後続 PR で配線)
//
// **旧 Market.tsx::MarketSell からの差分**:
//   - URL クエリ ?specimen= でプリセレクト追加
//   - listSpecimens() (= mock) ではなく serverSpecimens() (= /specimens/me) を優先
//   - submit ボタンは現状 stub (= 後続 PR で /api/v1/listings に POST)

import { createEffect, createSignal, For, Show } from "solid-js";
import { useSearchParams, useNavigate } from "@solidjs/router";
import { getSpecimen, listSpecimens } from "../../api";
import type { Specimen } from "../../data";
import {
  findServerSpecimenByPublicId,
  serverSpecimens,
  normalizeSpecimenForLegacy,
} from "../../store/specimens";
import { isLoggedIn } from "../../store/auth";
import { postListing, SduiFetchError } from "../../sdui/api";
import { loadListings } from "../../store/listings";
import { showToast } from "../../store/toast";

type SellMode = "auction" | "fixed";

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

  // URL クエリ ?specimen= でプリセレクト。findById で存在確認 + 未指定なら null。
  const initialPicked = (() => {
    const raw = searchParams.specimen;
    const pid = Array.isArray(raw) ? raw[0] : raw;
    if (!pid) return null;
    return getSpecimen(pid)?.id ?? pid;
  })();

  const [picked, setPicked] = createSignal<string | null>(initialPicked);
  const [mode, setMode] = createSignal<SellMode>("auction");
  const [desc, setDesc] = createSignal("");
  const [descEdited, setDescEdited] = createSignal(false);
  // 価格 / 終了期間 / 送信中フラグ
  const [priceJpy, setPriceJpy] = createSignal<number>(45000);
  const [durationDays, setDurationDays] = createSignal<3 | 5 | 7>(3);
  const [submitting, setSubmitting] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string | null>(null);

  const pickedSpec = (): Specimen | undefined => {
    const id = picked();
    if (!id) return undefined;
    return getSpecimen(id) ?? myStock().find((s) => s.id === id);
  };

  // 個体選択が変わったらテンプレートを流し込む。
  createEffect(() => {
    const s = pickedSpec();
    if (!s) {
      setDesc("");
      setDescEdited(false);
      return;
    }
    setDesc(templateFor(s));
    setDescEdited(false);
  });

  const onDescInput = (e: InputEvent) => {
    const t = e.currentTarget as HTMLTextAreaElement;
    setDesc(t.value);
    setDescEdited(true);
  };

  const resetDesc = () => {
    const s = pickedSpec();
    if (!s) return;
    setDesc(templateFor(s));
    setDescEdited(false);
  };

  const onCancel = () => {
    navigate(-1 as unknown as string);
  };

  /** 「出品する」ボタンの handler。POST /api/v1/listings に submit。
   *  成功 → loadListings() で一覧 refresh + Toast + /products に navigate。
   *  失敗 → submitError に詰めてフォーム上に赤字表示 (= submit ボタンは再有効化)。 */
  const onSubmit = async () => {
    if (submitting()) return;
    const s = pickedSpec();
    if (!s) {
      setSubmitError("出品する個体を選択してください");
      return;
    }
    if (priceJpy() <= 0) {
      setSubmitError("価格は 1 円以上で入力してください");
      return;
    }

    // server `CreateListingRequest`:
    //   publicId       : "L-..." (= server 側で重複チェック / 自動採番が無いため client 採番)
    //   specimenId     : login user の specimen UUID。anonymous mock は UUID を持たないので Skip。
    //   title          : 個体カルテから生成 (= "ヘラクレス♂ 142mm 自家累代CBF2" 風)
    //   description    : 自動生成テンプレ (or ユーザ編集後の本文)
    //   isAuction      : mode === "auction"
    //   startingPriceJpy : 入力値
    //   endsAt         : auction 時のみ。3/5/7 日後の ISO 8601。
    const isAuction = mode() === "auction";
    const endsAt = isAuction
      ? new Date(Date.now() + durationDays() * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    const title = `${s.species} ${s.sex} ${s.sizeMm ? `${s.sizeMm}mm ` : ""}${s.generation || ""}`.trim();
    // server side specimen_id は UUID 必須。findServerSpecimenByPublicId で internal UUID を引く。
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
        endsAt,
      });
      // 一覧 cache を refresh (= /products 表示時に最新が見える)
      void loadListings();
      showToast({
        tone: "success",
        message: `${res.publicId} を出品しました`,
      });
      navigate("/products");
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
    <>
      <div class="page-head">
        <div>
          <div class="cat">マーケット</div>
          <h1>個体を出品する</h1>
          <p class="page-head-sub">
            所有個体を C2C マーケットに出品 — 説明はカルテから自動生成
          </p>
        </div>
      </div>

      <div class="grid-detail-narrow">
        <div>
          <div class="sec-head">
            <span class="num">§01</span>
            <h2>出品する個体を選ぶ</h2>
            <span class="meta">カルテから自動引用</span>
          </div>
          <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "10px" }}>
            <For each={myStock()}>
              {(s) => (
                <div
                  onClick={() => setPicked(s.id)}
                  class="card"
                  style={{
                    padding: "12px",
                    cursor: "pointer",
                    "border-color": picked() === s.id ? "var(--ink)" : "var(--line)",
                    "border-width": picked() === s.id ? "2px" : "1px",
                  }}
                >
                  <div style={{ display: "flex", gap: "10px" }}>
                    <div
                      class="ph forest"
                      style={{ width: "50px", height: "50px", "flex-shrink": 0 }}
                      role="img"
                      aria-label={`${s.name} ${s.sex} サムネイル (プレースホルダ)`}
                    />
                    <div style={{ flex: 1, "min-width": 0 }}>
                      <div class="mono" style={{ "font-size": "10px", color: "var(--ink-faint)" }}>
                        {s.id}
                      </div>
                      <div
                        style={{
                          "font-weight": 500,
                          "font-size": "13px",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}
                      >
                        {s.name}
                      </div>
                      <div style={{ display: "flex", gap: "4px", "margin-top": "4px" }}>
                        <span class="chip" style={{ "font-size": "9px", padding: "1px 5px" }}>
                          {s.generation}
                        </span>
                        <span class="chip" style={{ "font-size": "9px", padding: "1px 5px" }}>
                          {s.sex}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        <div class="card" style={{ padding: "24px", position: "sticky", top: "72px", "align-self": "start" }}>
          <div class="u-eyebrow">新規出品</div>
          <div class="serif" style={{ "font-size": "20px", "font-weight": 600, "margin-bottom": "16px" }}>
            出品情報
          </div>

          <Show
            when={picked()}
            fallback={
              <div
                style={{
                  "margin-bottom": "14px",
                  padding: "12px",
                  border: "1px dashed var(--line-strong)",
                  "border-radius": "var(--r-md)",
                  color: "var(--ink-faint)",
                  "font-size": "12px",
                  "text-align": "center",
                }}
              >
                ← 左から個体を選択してください
              </div>
            }
          >
            <div
              style={{
                "margin-bottom": "14px",
                padding: "12px",
                background: "var(--accent-forest-soft)",
                "border-radius": "var(--r-md)",
              }}
            >
              <div class="mono" style={{ "font-size": "11px", color: "var(--accent-forest)" }}>
                選択中
              </div>
              <div style={{ "font-weight": 500 }}>{pickedSpec()?.name}</div>
              <div class="mono" style={{ "font-size": "11px", color: "var(--ink-mute)" }}>
                カルテ情報が自動反映されます
              </div>
            </div>
          </Show>

          <label class="label">販売方式</label>
          <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "6px", "margin-bottom": "12px" }}>
            <button
              class="btn sm"
              onClick={() => setMode("auction")}
              style={{
                background: mode() === "auction" ? "var(--bg-inverse)" : "var(--bg-raised)",
                color: mode() === "auction" ? "var(--ink-inverse)" : "var(--ink)",
              }}
            >
              オークション
            </button>
            <button
              class="btn sm"
              onClick={() => setMode("fixed")}
              style={{
                background: mode() === "fixed" ? "var(--bg-inverse)" : "var(--bg-raised)",
                color: mode() === "fixed" ? "var(--ink-inverse)" : "var(--ink)",
              }}
            >
              即決のみ
            </button>
          </div>

          <label class="label">{mode() === "auction" ? "開始価格" : "即決価格"}</label>
          <div style={{ position: "relative" }}>
            <span
              class="mono"
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--ink-mute)",
              }}
            >
              ¥
            </span>
            <input
              class="input mono"
              style={{ "padding-left": "28px" }}
              type="number"
              min="1"
              step="100"
              value={priceJpy()}
              onInput={(e) => {
                const v = Number((e.currentTarget as HTMLInputElement).value);
                if (Number.isFinite(v) && v >= 0) setPriceJpy(v);
              }}
            />
          </div>

          <Show when={mode() === "auction"}>
            <label class="label" style={{ "margin-top": "12px" }}>
              終了期間
            </label>
            <select
              class="select"
              value={String(durationDays())}
              onChange={(e) => {
                const v = Number((e.currentTarget as HTMLSelectElement).value);
                if (v === 3 || v === 5 || v === 7) setDurationDays(v);
              }}
            >
              <option value="3">3日</option>
              <option value="5">5日</option>
              <option value="7">7日</option>
            </select>
          </Show>

          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              "margin-top": "12px",
            }}
          >
            <label class="label" for="market-desc" style={{ margin: 0 }}>
              商品説明（自動生成 / 編集可）
            </label>
            <Show when={picked() && descEdited()}>
              <button
                type="button"
                class="btn sm ghost"
                onClick={resetDesc}
                style={{ "font-size": "11px", padding: "2px 8px" }}
                title="カルテから再生成してテンプレに戻す"
              >
                ↺ テンプレに戻す
              </button>
            </Show>
          </div>
          <textarea
            id="market-desc"
            class="textarea"
            rows={8}
            placeholder="左から個体を選択すると、カルテ情報から下書きを生成します"
            value={desc()}
            onInput={onDescInput}
            disabled={!picked()}
          />

          <div
            style={{
              padding: "12px",
              background: "var(--bg-sunken)",
              "border-radius": "var(--r-md)",
              "margin-top": "14px",
              "font-size": "11px",
              color: "var(--ink-mute)",
              "line-height": 1.7,
            }}
          >
            <div style={{ "font-weight": 600, color: "var(--ink)", "margin-bottom": "4px" }}>
              手数料と保護
            </div>
            販売手数料 10% / Stripe決済手数料 3.6% / エスクロー購入者保護 / 死着自動返金
          </div>

          <Show when={submitError()}>
            <div
              style={{
                "margin-top": "12px",
                padding: "10px 12px",
                background: "var(--accent-rose-soft, #fde8e8)",
                color: "var(--accent-rose-ink, #b91c1c)",
                "border-radius": "var(--r-md)",
                "font-size": "12px",
              }}
              role="alert"
            >
              {submitError()}
            </div>
          </Show>

          <div style={{ display: "flex", gap: "8px", "margin-top": "14px" }}>
            <button type="button" class="btn" onClick={onCancel} disabled={submitting()}>
              キャンセル
            </button>
            <button
              type="button"
              class="btn primary lg"
              style={{ flex: 1 }}
              disabled={!picked() || submitting()}
              onClick={() => void onSubmit()}
            >
              {submitting() ? "送信中…" : "出品する"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

/** L-XXXXXX 形式の暫定 publicId 採番 (= 5 文字 timestamp base36)。
 *  本来は server 側で重複チェック付き自動採番すべきだが、現行 CreateListingRequest は
 *  publicId required のため client 側で生成する。Date.now の base36 末尾 5 桁で
 *  人間が見ても一意感のある短い ID にする。衝突時は server で 409 が返るので、
 *  ユーザに再 submit を促せば良い (= 同 ms に同 user が 2 回出品するケースは稀)。 */
function generateClientFallbackListingId(): string {
  const ts = Date.now().toString(36).slice(-5).toUpperCase();
  return `L-${ts}`;
}
