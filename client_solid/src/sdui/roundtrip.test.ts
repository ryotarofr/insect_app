// roundtrip.test.ts — TS 側 property-based ラウンドトリップ等価性テスト (M8 / 設計書 §13.6)
//
// **狙い**:
//   1. branded.ts 経由の TS 値を任意生成し、JSON 経由のラウンドトリップで等価性を assert
//   2. branded.ts と generated/sdui.ts の構造的互換性を実行時で確認
//   3. discriminator (e.g. CtaAction.type, Localizable.source) の untagged / tagged 揺れを攻める
//
// **戦略**:
//   - fast-check で各 SDUI 型に対する arbitrary を定義
//   - JSON.parse(JSON.stringify(x)) === x (deep equal) を property として確認
//   - branded 型は構造的部分型 (= TS 型レベルの brand のみ) なので runtime では generated 型と
//     完全互換 → 同じ JSON が両者で読める
//
// **Rust 側との関係**:
//   server/tests/sdui_roundtrip.rs (M8 Rust 側) と同じ意図で TS 側でも独立に検証する。
//   将来 server が生成した JSON schema (schemars 出力) を ajv で検証する段階で
//   両者を cross-check できるようにしておく (= ajv 統合は §13.6 の TODO)。

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import type {
  Block,
  Localizable,
  CheckoutFieldAction,
  CheckoutMethodAction,
  LineItemAction,
  Href,
  I18nKey,
} from "./branded";
import { asHref, asI18nKey } from "./branded";
import type {
  AnalyticsEvent,
  AnalyticsEventBatch,
  AnalyticsEventType,
  CtaAction,
} from "../generated/sdui";

// ──────────────────────────────────────────────────────────────────────
// Arbitraries
// ──────────────────────────────────────────────────────────────────────

/** I18nKey 形式 (`<scope>.<key>`) の文字列。branded 型に as でキャスト。 */
const arbI18nKey = (): fc.Arbitrary<I18nKey> =>
  fc
    .tuple(fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/), fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/))
    .map(([s, k]) => asI18nKey(`${s}.${k}`));

/** Href: 内部相対パスのみ生成。 */
const arbHref = (): fc.Arbitrary<Href> =>
  fc.stringMatching(/^\/[a-z][a-z0-9/_-]{0,30}$/).map((s) => asHref(s));

/** raw text (空文字を避ける = 設計書 §10.4 規約)。 */
const arbRawText = (): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.trim().length > 0);

/** Localizable.params の値型 (string | number)。 */
const arbParamValue = (): fc.Arbitrary<string | number> =>
  fc.oneof(arbRawText(), fc.integer({ min: -1_000_000, max: 1_000_000 }));

/** Localizable: i18n / raw 両方を網羅。i18n は params あり/なしで揺らす。 */
const arbLocalizable = (): fc.Arbitrary<Localizable> =>
  fc.oneof(
    fc
      .record({
        source: fc.constant("i18n" as const),
        key: arbI18nKey(),
      })
      .map((o) => ({ ...o }) as Localizable),
    arbRawText().map(
      (text) => ({ source: "raw" as const, text }) as Localizable,
    ),
    // i18n + params の variant
    fc
      .record({
        source: fc.constant("i18n" as const),
        key: arbI18nKey(),
        params: fc.dictionary(fc.stringMatching(/^[a-z]{1,4}$/), arbParamValue(), {
          maxKeys: 3,
        }),
      })
      .map(({ source, key, params }) => {
        // 空 dict は省略 (= JSON 側 skip_serializing_if と整合)。
        const hasKeys = Object.keys(params).length > 0;
        return hasKeys
          ? { source, key, params }
          : { source, key };
      }) as fc.Arbitrary<Localizable>,
  );

/** CheckoutFieldAction. */
const arbCheckoutFieldAction = (): fc.Arbitrary<CheckoutFieldAction> =>
  fc
    .stringMatching(/^[a-z][a-zA-Z0-9]{2,16}$/)
    .map((fieldName) => ({ type: "patch_field", fieldName }) as CheckoutFieldAction);

/** CheckoutMethodAction (= payload なし固定). */
const arbCheckoutMethodAction = (): fc.Arbitrary<CheckoutMethodAction> =>
  fc.constant({ type: "patch_method" } as CheckoutMethodAction);

/** LineItemAction: set_qty / remove. */
const arbLineItemAction = (): fc.Arbitrary<LineItemAction> =>
  fc.oneof(
    fc
      .record({
        type: fc.constant("set_qty" as const),
        token: fc.stringMatching(/^[a-z0-9_]{4,16}$/),
        qty: fc.integer({ min: 1, max: 99 }),
      })
      .map((o) => o as LineItemAction),
    fc
      .record({
        type: fc.constant("remove" as const),
        token: fc.stringMatching(/^[a-z0-9_]{4,16}$/),
      })
      .map((o) => o as LineItemAction),
  );

/** CtaAction: add_to_cart / toggle_watch. */
const arbCtaAction = (): fc.Arbitrary<CtaAction> =>
  fc.oneof(
    fc
      .record({
        type: fc.constant("add_to_cart" as const),
        productId: fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/),
        qty: fc.integer({ min: 1, max: 99 }),
      })
      .map((o) => o as CtaAction),
    fc
      .record({
        type: fc.constant("toggle_watch" as const),
        productId: fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/),
      })
      .map((o) => o as CtaAction),
  );

/** Block.key の安定 token (一意性は呼び出し側で連番 prefix を付与して確保)。 */
const arbKey = (): fc.Arbitrary<string> =>
  fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/);

/** 単独 Block: 主要 9 variant を網羅。Rust 側 arb_simple_block と対応。 */
const arbBlock = (): fc.Arbitrary<Block> =>
  fc.oneof(
    // Text (5 role)
    fc
      .record({
        type: fc.constant("text" as const),
        key: arbKey(),
        role: fc.constantFrom(
          "eyebrow" as const,
          "subhead" as const,
          "lead" as const,
          "body" as const,
          "caption" as const,
        ),
        content: arbLocalizable(),
      })
      .map((o) => o as Block),
    // Cta
    fc
      .record({
        type: fc.constant("cta" as const),
        key: arbKey(),
        intent: fc.constantFrom(
          "primary" as const,
          "secondary" as const,
          "tertiary" as const,
          "destructive" as const,
        ),
        label: arbLocalizable(),
        href: arbHref(),
      })
      .map((o) => o as Block),
    // Badge
    fc
      .record({
        type: fc.constant("badge" as const),
        key: arbKey(),
        role: fc.constantFrom(
          "status" as const,
          "evidence" as const,
          "warning" as const,
          "promo" as const,
        ),
        label: arbLocalizable(),
      })
      .map((o) => o as Block),
    // Price
    fc
      .record({
        type: fc.constant("price" as const),
        key: arbKey(),
        amount: fc.integer({ min: 0, max: 100_000_000 }),
        currency: fc.constant("JPY" as const),
        taxIncluded: fc.boolean(),
      })
      .map((o) => o as Block),
    // Divider
    fc
      .record({ type: fc.constant("divider" as const), key: arbKey() })
      .map((o) => o as Block),
  );

/** AnalyticsEvent: serverReceivedAtMs は意図的に Some / undefined 両方生成して
 *  JSON 経由でも区別が保たれることを確認。 */
const arbAnalyticsEvent = (): fc.Arbitrary<AnalyticsEvent> =>
  fc.record(
    {
      analyticsId: fc.stringMatching(/^[a-z][a-z0-9._-]{0,32}$/),
      eventType: fc.constantFrom(
        "impression" as AnalyticsEventType,
        "click" as AnalyticsEventType,
      ),
      timestampMs: fc.integer({ min: 0, max: 1_900_000_000_000 }),
      context: fc.option(
        fc.dictionary(fc.stringMatching(/^[a-z]{1,4}$/), fc.stringMatching(/^[a-z0-9]{1,8}$/), {
          maxKeys: 3,
        }),
        { nil: undefined },
      ),
      serverReceivedAtMs: fc.option(
        fc.integer({ min: 0, max: 1_900_000_000_000 }),
        { nil: undefined },
      ),
    },
    { requiredKeys: ["analyticsId", "eventType", "timestampMs"] },
  ) as fc.Arbitrary<AnalyticsEvent>;

// ──────────────────────────────────────────────────────────────────────
// Roundtrip helper
// ──────────────────────────────────────────────────────────────────────

/** JSON.parse(JSON.stringify(x)) で deep equal を確認する。
 *  fast-check の `expect.toEqual` は asymmetric matcher と相性が悪いので、純粋に
 *  string 比較もしくは Vitest の `expect.equal` で済ませる。 */
const assertJsonRoundtrip = <T>(value: T): void => {
  const json = JSON.stringify(value);
  const parsed = JSON.parse(json) as T;
  expect(parsed).toEqual(value);
};

// ──────────────────────────────────────────────────────────────────────
// Property tests (fc.assert)
// ──────────────────────────────────────────────────────────────────────

const FC_RUNS = 256;

describe("SDUI roundtrip (TS 側 / M8 §13.6)", () => {
  it("Localizable: i18n / raw / params の JSON ラウンドトリップ", () => {
    fc.assert(
      fc.property(arbLocalizable(), (v) => {
        assertJsonRoundtrip(v);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it("CheckoutFieldAction: discriminator + camelCase 整合性", () => {
    fc.assert(
      fc.property(arbCheckoutFieldAction(), (v) => {
        assertJsonRoundtrip(v);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it("CheckoutMethodAction: payload-less variant の安定性", () => {
    fc.assert(
      fc.property(arbCheckoutMethodAction(), (v) => {
        assertJsonRoundtrip(v);
      }),
      { numRuns: 8 }, // payload-less なので少なくて十分
    );
  });

  it("LineItemAction: set_qty / remove discriminator", () => {
    fc.assert(
      fc.property(arbLineItemAction(), (v) => {
        assertJsonRoundtrip(v);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it("CtaAction: add_to_cart / toggle_watch discriminator", () => {
    fc.assert(
      fc.property(arbCtaAction(), (v) => {
        assertJsonRoundtrip(v);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it("Block (主要 5 variant): type discriminator + key 維持", () => {
    fc.assert(
      fc.property(arbBlock(), (v) => {
        assertJsonRoundtrip(v);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it("AnalyticsEvent: serverReceivedAtMs / context optional の null vs missing", () => {
    fc.assert(
      fc.property(arbAnalyticsEvent(), (v) => {
        // JSON.stringify は undefined フィールドを drop する。
        // 結果として「optional + undefined」と「key 自体が無い」は等価になる。
        const json = JSON.stringify(v);
        const parsed = JSON.parse(json) as AnalyticsEvent;

        // 必須フィールドは保持
        expect(parsed.analyticsId).toBe(v.analyticsId);
        expect(parsed.eventType).toBe(v.eventType);
        expect(parsed.timestampMs).toBe(v.timestampMs);

        // optional: 元が undefined or 値ありで分岐
        if (v.context !== undefined) {
          expect(parsed.context).toEqual(v.context);
        } else {
          expect(parsed.context).toBeUndefined();
        }
        if (v.serverReceivedAtMs !== undefined) {
          expect(parsed.serverReceivedAtMs).toBe(v.serverReceivedAtMs);
        } else {
          expect(parsed.serverReceivedAtMs).toBeUndefined();
        }
      }),
      { numRuns: FC_RUNS },
    );
  });

  it("AnalyticsEventBatch: 入れ子配列の JSON ラウンドトリップ", () => {
    fc.assert(
      fc.property(
        fc.array(arbAnalyticsEvent(), { minLength: 0, maxLength: 5 }),
        (events) => {
          const batch: AnalyticsEventBatch = { events };
          // batch 自体の roundtrip — undefined フィールドは drop されるので element ごとに比較
          const parsed = JSON.parse(JSON.stringify(batch)) as AnalyticsEventBatch;
          expect(parsed.events.length).toBe(events.length);
          for (let i = 0; i < events.length; i += 1) {
            expect(parsed.events[i].analyticsId).toBe(events[i].analyticsId);
            expect(parsed.events[i].eventType).toBe(events[i].eventType);
            expect(parsed.events[i].timestampMs).toBe(events[i].timestampMs);
          }
        },
      ),
      { numRuns: 64 },
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// 静的 sanity test (fc 外): branded 型 ↔ generated 型の構造互換性
// ──────────────────────────────────────────────────────────────────────

describe("branded vs generated compat (M8 §13.6)", () => {
  it("branded.Localizable 値はそのまま generated.Localizable として扱える", () => {
    const b: Localizable = {
      source: "i18n",
      key: asI18nKey("badge.featured"),
    };
    // branded 型の I18nKey は runtime では string なので、JSON 経由で
    // generated 型 (= raw string) としても等価に読める。
    const json = JSON.stringify(b);
    const parsed = JSON.parse(json) as { source: string; key: string };
    expect(parsed.source).toBe("i18n");
    expect(parsed.key).toBe("badge.featured");
  });

  it("branded.Href の brand は runtime に影響しない (= 文字列のまま JSON に乗る)", () => {
    const href = asHref("/products/DHH-0271");
    const json = JSON.stringify({ href });
    const parsed = JSON.parse(json) as { href: string };
    expect(parsed.href).toBe("/products/DHH-0271");
  });
});
