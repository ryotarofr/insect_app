// pages/products/index.tsx — C2C 出品一覧
//
// **役割**:
//   C2C「ユーザが出品した個体」一覧。
//   /products URL は維持 (= ブックマーク救済)、表示内容は serverListings() に切替。
//
// **データ源**:
//   store/listings.ts::serverListings() (= GET /api/v1/listings).
//   起動時に App.tsx から loadListings() 済 (= public 閲覧 OK)。
//
// **CTA**:
//   - login 中 → 「+ 出品する」 → /listings/new
//   - anonymous → 「ログインして出品」 → /login
//
// **ProductDetail (= /products/:id)**:
//   listing 1 件の詳細ページとして本実装。fetchListing で取得し、価格 / 出品者 /
//   description を表示。即決 → カート追加、auction → 入札 / ウォッチをアクションとして提供。
//   /listings/:publicId への URL リネームは別 PR (= ブックマーク救済のため URL は維持)。

import { For, Show, createMemo, createResource, createSignal, onMount } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import type { RouteKey } from "../../data";
import { listMarketListings } from "../../api";
import { ListingCard } from "../../components/market/ListingCard";
import { loadListings } from "../../store/listings";
import { currentUser, isLoggedIn } from "../../store/auth";
import {
  fetchListing,
  postCartAdd,
  postListingBid,
  postListingCancel,
  SduiFetchError,
  type ListingViewWithCounts,
} from "../../sdui/api";
import { showToast } from "../../store/toast";

interface ProductsListProps {
  setRoute: (r: RouteKey) => void;
  setSelectedProduct: (id: string) => void;
}

export const ProductsList = (_props: ProductsListProps) => {
  // 起動時 1 回 fetch 済だが、画面復帰時に最新を取り直す。
  onMount(() => {
    void loadListings();
  });

  // listMarketListings() は serverListings() を normalize した legacy Listing[] を返す。
  // 出品が 0 件のときの empty state を出すため createMemo で長さを取る。
  const listings = createMemo(() => listMarketListings());

  return (
    <>
      <div class="page-head">
        <div>
          <div class="cat">マーケット</div>
          <h1>出品中の生体</h1>
          <p class="page-head-sub">
            飼育者が出品した個体 — 血統認証 + Stripe Connect エスクロー
          </p>
        </div>
        <div class="page-actions">
          <Show
            when={isLoggedIn()}
            fallback={
              <A class="btn" href="/login">
                ログインして出品
              </A>
            }
          >
            <A class="btn primary" href="/listings/new">
              + 出品する
            </A>
          </Show>
        </div>
      </div>

      {/* 認証バッジ説明 */}
      <div
        class="card"
        style={{
          padding: "16px",
          "margin-bottom": "20px",
          display: "flex",
          "align-items": "center",
          gap: "12px",
          background: "var(--bg-sunken)",
          "border-color": "transparent",
        }}
      >
        <span class="chip indigo">血統認証</span>
        <span style={{ "font-size": "13px", color: "var(--ink-mute)" }}>
          このバッジは、イベントログで累代を検証済の個体に付与されます。
        </span>
        <span class="mono" style={{ "margin-left": "auto", "font-size": "11px", color: "var(--ink-faint)" }}>
          Stripe Connect エスクロー適用
        </span>
      </div>

      <Show
        when={listings().length > 0}
        fallback={
          <div
            class="card"
            style={{
              padding: "32px 24px",
              "text-align": "center",
              color: "var(--ink-mute)",
              "font-size": "13px",
            }}
          >
            <div style={{ "font-weight": 600, color: "var(--ink)", "margin-bottom": "6px" }}>
              現在出品中の個体はありません
            </div>
            <div style={{ "margin-bottom": "16px" }}>
              所有個体を C2C マーケットに出品することができます。
            </div>
            <Show
              when={isLoggedIn()}
              fallback={
                <A class="btn primary" href="/login">
                  ログインして出品
                </A>
              }
            >
              <A class="btn primary" href="/listings/new">
                出品する
              </A>
            </Show>
          </div>
        }
      >
        <div class="grid-cards-2">
          <For each={listings()}>{(l) => <ListingCard listing={l} />}</For>
        </div>
      </Show>
    </>
  );
};

interface ProductDetailProps {
  productId: string;
  setRoute?: (r: RouteKey) => void;
}

/**
 * `/products/:publicId` — listing 1 件の詳細ページ。
 *
 * **データ源**: `GET /api/v1/listings/{public_id}` (= 既存 fetchListing endpoint)。
 *  起動時の loadListings() cache とは別に、本ページでは詳細を都度 fetch する
 *  (= 価格 / 入札数 / 終了時刻のリアルタイム性を取るため)。
 *
 * **表示要素**:
 *   - title (= "ヘラクレス♂ 142mm CBF2" 風)
 *   - 価格 (= 即決価格 / 現在価格 + 開始価格)
 *   - 出品者名 (= sellerName) + 認証マーク
 *   - description (= 出品時の自由記述本文)
 *   - 残時間 (= auction なら ends_at から計算)
 *   - status (= active / sold / canceled / expired)
 *
 * **CTA** (= 自分の出品でない場合のみ表示):
 *   - 即決出品 → 「カート追加」 (= postCartAdd)
 *   - auction → 「入札」 (= postListingBid)
 *
 * **owner CTA** (= 自分の出品の場合):
 *   - 「出品取消」 (= postListingCancel)
 */
export const ProductDetail = (props: ProductDetailProps) => {
  const navigate = useNavigate();
  // publicId から listing を取得。productId は legacy 名 (= router 由来) で実体は listings.public_id。
  const [listing, { refetch }] = createResource(
    () => props.productId,
    (publicId) => fetchListing(publicId),
  );
  const [actionPending, setActionPending] = createSignal(false);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [bidAmountJpy, setBidAmountJpy] = createSignal<number>(0);

  // 入札の最低額 = 現在価格 + 1 (= server 側 validation と整合)。auction 専用。
  const minBid = (l: ListingViewWithCounts): number =>
    (l.currentPriceJpy ?? l.startingPriceJpy) + 1;

  // 自分が出品者なら CTA を「出品取消」だけにする。
  // AuthUser.userId は server users.id (UUID 文字列) と一致する。
  const isOwner = (l: ListingViewWithCounts): boolean => {
    const u = currentUser();
    return !!u && u.userId === l.sellerUserId;
  };

  /** 残時間を「2日 14h」「14h 32m」「終了」形式で整形 (= ListingCard と同じロジック)。 */
  const formatRemaining = (endsAt: string | null | undefined): string => {
    if (!endsAt) return "—";
    const ms = new Date(endsAt).getTime() - Date.now();
    if (ms <= 0) return "終了";
    const totalMin = Math.floor(ms / 60_000);
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin % (60 * 24)) / 60);
    const minutes = totalMin % 60;
    if (days > 0) return `${days}日 ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const handleAddToCart = async (l: ListingViewWithCounts) => {
    if (actionPending()) return;
    setActionPending(true);
    setActionError(null);
    try {
      await postCartAdd(l.publicId, 1);
      showToast({ tone: "success", message: "カートに追加しました" });
      navigate("/cart");
    } catch (e) {
      const msg =
        e instanceof SduiFetchError
          ? `HTTP ${e.status} — ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setActionError(msg);
    } finally {
      setActionPending(false);
    }
  };

  const handlePlaceBid = async (l: ListingViewWithCounts) => {
    if (actionPending()) return;
    const amount = bidAmountJpy();
    if (amount < minBid(l)) {
      setActionError(`入札額は ¥${minBid(l).toLocaleString()} 以上にしてください`);
      return;
    }
    setActionPending(true);
    setActionError(null);
    try {
      const res = await postListingBid(l.id, amount);
      showToast({
        tone: "success",
        message: `入札しました (現在価格 ¥${res.currentPriceJpy.toLocaleString()})`,
      });
      // listing を再 fetch して現在価格を反映
      void refetch();
      void loadListings();
    } catch (e) {
      const msg =
        e instanceof SduiFetchError
          ? `HTTP ${e.status} — ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setActionError(msg);
    } finally {
      setActionPending(false);
    }
  };

  const handleCancel = async (l: ListingViewWithCounts) => {
    if (actionPending()) return;
    if (!confirm("この出品を取り消しますか? (= 取消後は復元できません)")) return;
    setActionPending(true);
    setActionError(null);
    try {
      await postListingCancel(l.id);
      showToast({ tone: "success", message: "出品を取り消しました" });
      void loadListings();
      navigate("/products");
    } catch (e) {
      const msg =
        e instanceof SduiFetchError
          ? `HTTP ${e.status} — ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setActionError(msg);
    } finally {
      setActionPending(false);
    }
  };

  return (
    <Show
      when={!listing.loading}
      fallback={
        <div style={{ padding: "32px", "text-align": "center", color: "var(--ink-mute)" }}>
          読み込み中…
        </div>
      }
    >
      <Show
        when={!listing.error && listing()}
        fallback={<DetailErrorView error={listing.error} onRetry={refetch} />}
      >
        {(l) => (
          <>
            <div class="page-head">
              <div>
                <div class="cat">マーケット · {l().publicId}</div>
                <h1>{l().title}</h1>
              </div>
              <div class="page-actions">
                <A class="btn" href="/products">
                  ← 一覧に戻る
                </A>
              </div>
            </div>

            <div class="grid-detail-narrow">
              {/* 左: 説明 / 出品者情報 */}
              <div>
                <div class="card" style={{ padding: "20px" }}>
                  <div class="u-eyebrow" style={{ "margin-bottom": "8px" }}>
                    出品者
                  </div>
                  <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                    <span style={{ "font-weight": 600 }}>{l().sellerName}</span>
                    <Show when={l().isVerified}>
                      <span class="chip indigo" style={{ "font-size": "10px", padding: "1px 6px" }}>
                        ✓ 認証ブリーダー
                      </span>
                    </Show>
                  </div>
                </div>

                <div class="card" style={{ padding: "20px", "margin-top": "14px" }}>
                  <div class="u-eyebrow" style={{ "margin-bottom": "8px" }}>
                    商品説明
                  </div>
                  <Show
                    when={l().description}
                    fallback={
                      <p style={{ color: "var(--ink-mute)", "font-size": "13px" }}>
                        商品説明は登録されていません。
                      </p>
                    }
                  >
                    <pre
                      style={{
                        "white-space": "pre-wrap",
                        "font-family": "inherit",
                        "font-size": "13px",
                        "line-height": 1.7,
                        margin: 0,
                      }}
                    >
                      {l().description}
                    </pre>
                  </Show>
                </div>

                <div
                  class="card"
                  style={{
                    padding: "16px 20px",
                    "margin-top": "14px",
                    background: "var(--bg-sunken)",
                    "border-color": "transparent",
                    "font-size": "12px",
                    color: "var(--ink-mute)",
                    "line-height": 1.7,
                  }}
                >
                  <div style={{ "font-weight": 600, color: "var(--ink)", "margin-bottom": "4px" }}>
                    取引保護
                  </div>
                  販売手数料 10% / Stripe Connect エスクロー / 死着自動返金 / 温度制御便対応
                </div>
              </div>

              {/* 右: 価格 / CTA (sticky) */}
              <div
                class="card"
                style={{ padding: "24px", position: "sticky", top: "72px", "align-self": "start" }}
              >
                <Show when={l().status !== "active"}>
                  <div
                    class="chip mute"
                    style={{ "margin-bottom": "12px", padding: "4px 10px", "font-size": "11px" }}
                  >
                    状態: {l().status}
                  </div>
                </Show>

                <div class="u-eyebrow">
                  {l().isAuction ? "オークション 現在価格" : "即決価格"}
                </div>
                <div class="serif" style={{ "font-size": "32px", "font-weight": 600, "line-height": 1 }}>
                  ¥{(l().currentPriceJpy ?? l().startingPriceJpy).toLocaleString()}
                </div>

                <Show when={l().isAuction}>
                  <div style={{ "font-size": "11px", color: "var(--ink-mute)", "margin-top": "4px" }}>
                    開始価格 ¥{l().startingPriceJpy.toLocaleString()} · 残 {formatRemaining(l().endsAt)}
                  </div>
                </Show>

                <Show when={actionError()}>
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
                    {actionError()}
                  </div>
                </Show>

                {/* CTA 出し分け: owner / auction / 即決 / status != active */}
                <Show
                  when={l().status === "active"}
                  fallback={
                    <div style={{ "margin-top": "16px", "font-size": "12px", color: "var(--ink-mute)" }}>
                      この出品は既に終了しています。
                    </div>
                  }
                >
                  <Show
                    when={isOwner(l())}
                    fallback={
                      <Show
                        when={isLoggedIn()}
                        fallback={
                          <A
                            class="btn primary lg block"
                            style={{ "margin-top": "16px" }}
                            href="/login"
                          >
                            ログインして購入
                          </A>
                        }
                      >
                        <Show
                          when={l().isAuction}
                          fallback={
                            <button
                              type="button"
                              class="btn primary lg block"
                              style={{ "margin-top": "16px" }}
                              disabled={actionPending()}
                              onClick={() => void handleAddToCart(l())}
                            >
                              {actionPending() ? "送信中…" : "カートに追加"}
                            </button>
                          }
                        >
                          <label class="label" style={{ "margin-top": "16px" }}>
                            入札額 (最低 ¥{minBid(l()).toLocaleString()})
                          </label>
                          <input
                            class="input mono"
                            type="number"
                            min={minBid(l())}
                            step="100"
                            value={bidAmountJpy() || minBid(l())}
                            onInput={(e) => {
                              const v = Number((e.currentTarget as HTMLInputElement).value);
                              if (Number.isFinite(v) && v >= 0) setBidAmountJpy(v);
                            }}
                          />
                          <button
                            type="button"
                            class="btn primary lg block"
                            style={{ "margin-top": "10px" }}
                            disabled={actionPending()}
                            onClick={() => void handlePlaceBid(l())}
                          >
                            {actionPending() ? "送信中…" : "入札する"}
                          </button>
                        </Show>
                      </Show>
                    }
                  >
                    {/* owner: 出品取消ボタンだけ */}
                    <div
                      style={{
                        "margin-top": "16px",
                        padding: "10px 12px",
                        background: "var(--bg-sunken)",
                        "border-radius": "var(--r-md)",
                        "font-size": "12px",
                        color: "var(--ink-mute)",
                      }}
                    >
                      これはあなたの出品です。
                    </div>
                    <button
                      type="button"
                      class="btn block"
                      style={{ "margin-top": "10px" }}
                      disabled={actionPending()}
                      onClick={() => void handleCancel(l())}
                    >
                      {actionPending() ? "送信中…" : "出品を取り消す"}
                    </button>
                  </Show>
                </Show>
              </div>
            </div>
          </>
        )}
      </Show>
    </Show>
  );
};

const DetailErrorView = (props: { error: unknown; onRetry: () => void }) => {
  const isNotFound = () =>
    props.error instanceof SduiFetchError && props.error.status === 404;
  return (
    <div
      class="card"
      style={{
        padding: "32px 24px",
        "text-align": "center",
        color: "var(--accent-rose-ink, #b91c1c)",
        "font-size": "13px",
      }}
    >
      <div style={{ "font-weight": 600, "margin-bottom": "6px" }}>
        {isNotFound() ? "出品が見つかりませんでした" : "出品詳細を取得できませんでした"}
      </div>
      <div style={{ color: "var(--ink-mute)", "margin-bottom": "16px", "font-size": "12px" }}>
        {props.error instanceof SduiFetchError
          ? `HTTP ${props.error.status} — ${props.error.message}`
          : `予期しないエラー: ${String(props.error)}`}
      </div>
      <Show when={!isNotFound()}>
        <button type="button" class="btn" onClick={props.onRetry}>
          再試行
        </button>
      </Show>
          <A class="btn" href="/products" style={{ "margin-left": "8px" }}>
        ← 一覧に戻る
      </A>
    </div>
  );
};
