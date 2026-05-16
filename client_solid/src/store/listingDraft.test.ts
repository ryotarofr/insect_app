// listingDraft.test.ts — Phase 8 Wizard ドラフト永続化のラウンドトリップテスト
//
// vitest の jsdom 環境下では `localStorage` が利用可能。各 it ごとに beforeEach で
// clear() してテスト間 isolation を担保する。

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearListingDraft,
  hasListingDraft,
  loadListingDraft,
  saveListingDraft,
  type ListingDraft,
} from "./listingDraft";

const sample: ListingDraft = {
  step: 3,
  picked: "spec-public-1",
  mode: "auction",
  desc: "Trypoxylus dichotomus 70mm",
  descEdited: true,
  priceJpy: 50000,
  buyoutPrice: 75000,
  durationDays: 7,
  shippingMethodIds: ["sm-cold", "sm-normal"],
  photos: [
    { assetId: "a-1", publicUrl: "/assets/a-1" },
    { assetId: "a-2", publicUrl: "/assets/a-2" },
  ],
  savedAt: 1_700_000_000_000,
};

beforeEach(() => {
  localStorage.clear();
});

describe("listingDraft store", () => {
  it("load returns null when nothing is saved", () => {
    expect(loadListingDraft()).toBeNull();
    expect(hasListingDraft()).toBe(false);
  });

  it("save → load round-trips exactly", () => {
    saveListingDraft(sample);
    const loaded = loadListingDraft();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(sample);
    expect(hasListingDraft()).toBe(true);
  });

  it("clear removes the draft", () => {
    saveListingDraft(sample);
    clearListingDraft();
    expect(loadListingDraft()).toBeNull();
    expect(hasListingDraft()).toBe(false);
  });

  it("returns null for malformed JSON without throwing", () => {
    localStorage.setItem("kochu:listing-draft:v1", "not-json{{{");
    expect(loadListingDraft()).toBeNull();
  });

  it("returns null when required field types are wrong", () => {
    // step=0 (= invalid: must be 1-4)
    localStorage.setItem(
      "kochu:listing-draft:v1",
      JSON.stringify({ ...sample, step: 0 }),
    );
    expect(loadListingDraft()).toBeNull();
  });

  it("filters out malformed photo entries while keeping valid ones", () => {
    const dirty = {
      ...sample,
      photos: [
        { assetId: "ok", publicUrl: "/x" },
        { assetId: 42, publicUrl: "/x" }, // bad: assetId not string
        null,
        { assetId: "ok2", publicUrl: "/y" },
      ],
    };
    localStorage.setItem("kochu:listing-draft:v1", JSON.stringify(dirty));
    const loaded = loadListingDraft();
    expect(loaded?.photos).toEqual([
      { assetId: "ok", publicUrl: "/x" },
      { assetId: "ok2", publicUrl: "/y" },
    ]);
  });

  it("treats missing buyoutPrice as null", () => {
    const noBuyout = { ...sample };
    // simulate omission via JSON re-encode without the field
    const obj: Record<string, unknown> = { ...noBuyout };
    delete obj.buyoutPrice;
    localStorage.setItem("kochu:listing-draft:v1", JSON.stringify(obj));
    expect(loadListingDraft()?.buyoutPrice).toBeNull();
  });
});
