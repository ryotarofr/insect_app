// ShippingMethodPicker.test.tsx — `Block.type === "shipping_method_picker"` (Phase 8)
//
// **狙い**:
//   - options が radio として描画され、selectedId が checked になる
//   - name / description / amount が見える
//   - 別 option 選択 → PATCH /checkout/shipping_method + reload
//   - 同 id クリックは no-op
//   - PATCH 失敗 → toast
//
// **戦略**:
//   - global fetch を vi.stubGlobal で stub
//   - reload は CartReloadProvider 経由で vi.fn()

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block } from "../branded";
import { ShippingMethodPickerView } from "./ShippingMethodPicker";
import { CartReloadProvider } from "../CartContext";
import { clearToasts, toastList } from "../../store/toast";

const raw = (text: string) => ({ source: "raw" as const, text });

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type PickerBlock = Extract<Block, { type: "shipping_method_picker" }>;

const makeBlock = (overrides: Partial<PickerBlock> = {}): PickerBlock =>
  ({
    type: "shipping_method_picker",
    key: "smp-method",
    options: [
      {
        id: "cold",
        name: raw("温度制御便（推奨）"),
        description: raw("生体含むため必須設定 · 15〜25℃"),
        amount: 1800,
        currency: "JPY",
      },
      {
        id: "normal",
        name: raw("通常便"),
        description: raw("用品のみ・常温配送"),
        amount: 800,
        currency: "JPY",
      },
    ],
    selectedId: "cold",
    patchAction: { type: "patch_method" },
    ...overrides,
  }) as PickerBlock;

beforeEach(() => {
  clearToasts();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ShippingMethodPickerView (rendering)", () => {
  it("options が radio として描画され selectedId が checked", () => {
    const { container } = render(() => <ShippingMethodPickerView block={makeBlock()} />);

    const radios = container.querySelectorAll(
      "input[type='radio']",
    ) as NodeListOf<HTMLInputElement>;
    expect(radios.length).toBe(2);
    expect(radios[0].value).toBe("cold");
    expect(radios[0].checked).toBe(true);
    expect(radios[1].value).toBe("normal");
    expect(radios[1].checked).toBe(false);
  });

  it("name / description / amount (¥1,800) が見える", () => {
    const { container } = render(() => <ShippingMethodPickerView block={makeBlock()} />);
    const text = container.textContent ?? "";
    expect(text).toContain("温度制御便（推奨）");
    expect(text).toContain("15〜25℃");
    expect(text).toContain("¥1,800");
    expect(text).toContain("通常便");
    expect(text).toContain("¥800");
  });

  it("data-selected 属性が selected に対して 'true'", () => {
    const { container } = render(() => <ShippingMethodPickerView block={makeBlock()} />);
    const labels = container.querySelectorAll("label.sdui-shipping-method__label");
    expect(labels[0].getAttribute("data-selected")).toBe("true");
    expect(labels[1].getAttribute("data-selected")).toBe("false");
  });
});

describe("ShippingMethodPickerView (PATCH flow)", () => {
  it("別 option 選択 → PATCH /checkout/shipping_method + reload", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okJson({ id: "normal" }));
    vi.stubGlobal("fetch", fetchSpy);
    const reload = vi.fn();

    const { container } = render(() => (
      <CartReloadProvider value={reload}>
        <ShippingMethodPickerView block={makeBlock()} />
      </CartReloadProvider>
    ));
    const radios = container.querySelectorAll(
      "input[type='radio']",
    ) as NodeListOf<HTMLInputElement>;

    fireEvent.click(radios[1]); // normal を選択

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/checkout/shipping_method");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.id).toBe("normal");

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("同じ id クリックは no-op (PATCH 飛ばさない)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { container } = render(() => <ShippingMethodPickerView block={makeBlock()} />);
    const radios = container.querySelectorAll(
      "input[type='radio']",
    ) as NodeListOf<HTMLInputElement>;

    fireEvent.click(radios[0]); // cold は既に selectedId

    // 1 tick 待ってから check
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("PATCH 失敗 → toast に error が積まれる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("bad", { status: 400 })),
    );

    const { container } = render(() => <ShippingMethodPickerView block={makeBlock()} />);
    const radios = container.querySelectorAll(
      "input[type='radio']",
    ) as NodeListOf<HTMLInputElement>;

    fireEvent.click(radios[1]);

    await waitFor(() => expect(toastList().length).toBeGreaterThan(0));
    expect(toastList()[0].tone).toBe("error");
  });
});
