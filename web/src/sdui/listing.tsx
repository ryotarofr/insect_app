/**
 * 出品関連のブロックレンダラ。
 * 購入・ウォッチのアクションは Phase C(cart/checkout 領域)まで準備中。
 * listing_settings のフォームは他と同じく固定コード部品(REST + 再fetch)。
 */
import { For, Show, createSignal } from "solid-js";
import { createListing, patchListing, withdrawListing } from "./api";
import { useSduiActions } from "./actions";
import type { ListingHeroContent, ListingSettingsContent, SpecAttr } from "./types";

export function ListingHeroView(props: { content: ListingHeroContent }) {
  const c = () => props.content;
  return (
    <div class="sd-lhero">
      <div class="sd-lhero-gal">
        <Show
          when={c().imageSrc}
          fallback={<div class="sd-listing-thumb sd-listing-thumb--empty sd-lhero-img">個体写真</div>}
        >
          {src => <img class="sd-lhero-img" src={src()} alt="" />}
        </Show>
      </div>
      <div class="sd-lhero-main">
        <h2 class="sd-text sd-text--headline">
          {c().title} <span class="sd-lstatus">{c().status}</span>
        </h2>
        <Show when={c().scientificName}>
          <p class="sd-text sd-text--caption">{c().scientificName}</p>
        </Show>
        <p class="sd-lprice">
          ¥{c().priceAmount.toLocaleString("ja-JP")}{" "}
          <span class="sd-text--caption">税込・送料別</span>
        </p>
        <Show when={c().sellerComment}>
          <p class="sd-text sd-text--lead">「{c().sellerComment}」 — 出品者コメント</p>
        </Show>
        <div class="sd-form-row">
          <button class="sd-btn sd-btn--primary" disabled title="購入フローは今後実装(Phase C)">
            購入する(準備中)
          </button>
          <button class="sd-btn" disabled title="ウォッチは今後実装(Phase C)">
            ウォッチ(準備中)
          </button>
        </div>
      </div>
    </div>
  );
}

/** 個体詳細内の出品設定(未出品 / フォーム / 出品中 の3状態) */
export function ListingSettingsView(props: { content: ListingSettingsContent }) {
  const actions = useSduiActions();
  const [editing, setEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [d, setD] = createSignal({ title: "", price: "", comment: "" });

  const listing = () => props.content.listing;

  const startForm = () => {
    const li = listing();
    setD({
      title: li?.title ?? props.content.suggestedTitle,
      price: li ? String(li.priceAmount) : "",
      comment: li?.sellerComment ?? "",
    });
    setEditing(true);
  };

  const save = async () => {
    const price = Number(d().price);
    if (!d().title.trim() || !Number.isFinite(price) || price <= 0) {
      alert("タイトルと1円以上の価格を入力してください");
      return;
    }
    setBusy(true);
    try {
      const li = listing();
      if (li) {
        await patchListing(li.listingId, {
          title: d().title.trim(),
          priceAmount: price,
          sellerComment: d().comment || undefined,
        });
      } else {
        await createListing(props.content.specimenId, {
          title: d().title.trim(),
          priceAmount: price,
          sellerComment: d().comment || undefined,
        });
      }
      setEditing(false);
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    const li = listing();
    if (!li || !confirm("出品を取り下げますか?(市場から非表示になり、再出品できます)")) return;
    try {
      await withdrawListing(li.listingId);
      actions?.refreshAll();
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div class="sd-form">
      <div class="sd-chips">
        <Show when={listing()} fallback={<span class="sd-chip">未出品</span>}>
          {li => (
            <>
              <span class="sd-chip">
                <b>{li().status}</b>
              </span>
              <span class="sd-chip">
                価格: <b>¥{li().priceAmount.toLocaleString("ja-JP")}</b>
              </span>
            </>
          )}
        </Show>
      </div>

      <Show
        when={editing()}
        fallback={
          <div class="sd-form-row">
            <Show
              when={listing()}
              fallback={
                <button class="sd-btn sd-btn--primary" onClick={startForm}>
                  この個体を出品する
                </button>
              }
            >
              {li => (
                <>
                  <button class="sd-btn" onClick={startForm}>
                    価格・コメントを変更
                  </button>
                  <a class="sd-btn" href={`/listings/${li().listingId}`}>
                    出品ページを見る →
                  </a>
                  <button class="sd-btn sd-btn--ghost" onClick={() => void withdraw()}>
                    出品を取り下げる
                  </button>
                </>
              )}
            </Show>
          </div>
        }
      >
        <div class="sd-form sd-form--boxed">
          <label class="sd-field">
            出品タイトル(個体情報から自動生成・編集可)
            <input
              value={d().title}
              onInput={e => setD({ ...d(), title: e.currentTarget.value })}
            />
          </label>
          <label class="sd-field">
            価格(円・必須)
            <input
              type="number"
              min="1"
              value={d().price}
              placeholder="例: 58000"
              onInput={e => setD({ ...d(), price: e.currentTarget.value })}
            />
          </label>
          <label class="sd-field">
            出品コメント(任意)
            <textarea
              rows={3}
              value={d().comment}
              placeholder="例: 羽化後3ヶ月、後食開始済み。"
              onInput={e => setD({ ...d(), comment: e.currentTarget.value })}
            />
          </label>
          <div class="sd-form-row">
            <button class="sd-btn sd-btn--primary" disabled={busy()} onClick={save}>
              {listing() ? "保存" : "出品"}
            </button>
            <button class="sd-btn" disabled={busy()} onClick={() => setEditing(false)}>
              キャンセル
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

export function ListingSpecView(props: { attrs: SpecAttr[] }) {
  return (
    <Show
      when={props.attrs.length > 0}
      fallback={<p class="sd-text sd-text--caption">スペック情報は未登録です</p>}
    >
      <div class="sd-chips">
        <For each={props.attrs}>
          {a => (
            <span class="sd-chip">
              {a.label}: <b>{a.value}</b>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}
