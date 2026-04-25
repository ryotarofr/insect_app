// AnalyticsContext.test.tsx — Provider / hook / toAnalyticsContext のテスト

import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import {
  AnalyticsCardProvider,
  toAnalyticsContext,
  useAnalyticsCardContext,
  type AnalyticsCardContext,
} from "./AnalyticsContext";

describe("useAnalyticsCardContext", () => {
  it("Provider 外なら undefined を返す", () => {
    let captured: AnalyticsCardContext | undefined = { cardId: "should-be-overwritten" };
    const Probe = () => {
      captured = useAnalyticsCardContext();
      return <span>probe</span>;
    };
    render(() => <Probe />);
    expect(captured).toBeUndefined();
  });

  it("Provider 内なら value を読める", () => {
    let captured: AnalyticsCardContext | undefined;
    const Probe = () => {
      captured = useAnalyticsCardContext();
      return <span>probe</span>;
    };
    render(() => (
      <AnalyticsCardProvider
        value={{
          cardId: "p-x",
          variant: "featured",
          experiment: { key: "hero_2026q2", bucket: "B" },
        }}
      >
        <Probe />
      </AnalyticsCardProvider>
    ));
    expect(captured).toBeDefined();
    expect(captured!.cardId).toBe("p-x");
    expect(captured!.variant).toBe("featured");
    expect(captured!.experiment?.key).toBe("hero_2026q2");
    expect(captured!.experiment?.bucket).toBe("B");
  });
});

describe("toAnalyticsContext", () => {
  it("ambient なし + extra なし → 空オブジェクト", () => {
    expect(toAnalyticsContext(undefined)).toEqual({});
  });

  it("ambient (cardId のみ) を flat に展開", () => {
    expect(toAnalyticsContext({ cardId: "p-x" })).toEqual({ cardId: "p-x" });
  });

  it("variant / experiment があれば全部 flat に展開", () => {
    const out = toAnalyticsContext({
      cardId: "p-x",
      variant: "featured",
      experiment: { key: "k", bucket: "A" },
    });
    expect(out).toEqual({
      cardId: "p-x",
      variant: "featured",
      experimentKey: "k",
      experimentBucket: "A",
    });
  });

  it("extra でマージ + 上書きできる", () => {
    const out = toAnalyticsContext(
      { cardId: "p-x", variant: "default" },
      { productId: "p-x", variant: "featured" }, // variant を上書き
    );
    expect(out.variant).toBe("featured");
    expect(out.productId).toBe("p-x");
  });

  it("extra の undefined / 空文字キーは無視される", () => {
    const out = toAnalyticsContext(
      { cardId: "p-x" },
      { productId: undefined, variant: "" },
    );
    expect(out).toEqual({ cardId: "p-x" });
  });
});
