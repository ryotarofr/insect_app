// FormField.test.tsx — `Block.type === "form_field"` レンダラの単体テスト (Phase 8)
//
// **狙い**:
//   - text / tel / postal_code / select 各 inputType の描画
//   - input → 300ms debounce → PATCH /checkout/shipping_field/{name} → reload
//   - blur で残 debounce を即時 flush
//   - select は debounce 無しで即 PATCH
//   - validation_error → aria-invalid + aria-describedby + role=alert
//   - server エラー → toast に流れる
//   - 同値入力 (props.block.value と一致) なら no-op (round-trip 節約)
//
// **戦略**:
//   - global fetch を vi.stubGlobal で stub
//   - vi.useFakeTimers で debounce を制御
//   - reload は CartReloadProvider 経由で vi.fn() を渡す

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block } from "../branded";
import { FormFieldView } from "./FormField";
import { CartReloadProvider } from "../CartContext";
import { clearToasts, toastList } from "../../store/toast";

const raw = (text: string) => ({ source: "raw" as const, text });

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type FormFieldBlock = Extract<Block, { type: "form_field" }>;

const makeText = (overrides: Partial<FormFieldBlock> = {}): FormFieldBlock =>
  ({
    type: "form_field",
    key: "ff-addressName",
    name: "addressName",
    label: raw("氏名"),
    value: "",
    required: true,
    autocomplete: "name",
    placeholder: raw("山田太郎"),
    kind: { inputType: "text" },
    patchAction: { type: "patch_field", fieldName: "addressName" },
    ...overrides,
  }) as FormFieldBlock;

beforeEach(() => {
  clearToasts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("FormFieldView (rendering)", () => {
  it("text input: label / placeholder / autocomplete / required を出す", () => {
    const { container } = render(() => <FormFieldView block={makeText()} />);
    const label = container.querySelector("label.sdui-form-field__label");
    expect(label?.textContent).toContain("氏名");
    expect(label?.textContent).toContain("*");

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.placeholder).toBe("山田太郎");
    expect(input.autocomplete).toBe("name");
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-required")).toBe("true");
  });

  it("tel: type=tel + inputmode=tel が付く", () => {
    const block = makeText({
      key: "ff-tel",
      name: "addressTel",
      kind: { inputType: "tel" },
      autocomplete: "tel",
    });
    const { container } = render(() => <FormFieldView block={block} />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("tel");
    expect(input.getAttribute("inputmode")).toBe("tel");
  });

  it("postal_code: type=text + inputmode=numeric", () => {
    const block = makeText({
      key: "ff-zip",
      name: "addressZip",
      kind: { inputType: "postal_code" },
      autocomplete: "postal-code",
    });
    const { container } = render(() => <FormFieldView block={block} />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.getAttribute("inputmode")).toBe("numeric");
  });

  it("select: <select> + <option> が options 数だけ出る", () => {
    const block = makeText({
      key: "ff-pref",
      name: "addressPref",
      value: "13",
      kind: {
        inputType: "select",
        options: [
          { id: "01", label: raw("北海道") },
          { id: "13", label: raw("東京都") },
          { id: "47", label: raw("沖縄県") },
        ],
      },
    });
    const { container } = render(() => <FormFieldView block={block} />);
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("13");
    const options = container.querySelectorAll("option");
    expect(options.length).toBe(3);
    expect(options[1].textContent).toBe("東京都");
  });
});

describe("FormFieldView (validationError)", () => {
  it("validationError 有 → aria-invalid=true + aria-describedby + role=alert", () => {
    const block = makeText({
      validationError: raw("氏名は必須です"),
    });
    const { container } = render(() => <FormFieldView block={block} />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const errId = input.getAttribute("aria-describedby");
    expect(errId).toBe("ff-addressName-error");

    const alert = container.querySelector(`#${errId}`) as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.getAttribute("aria-live")).toBe("polite");
    expect(alert.textContent).toContain("氏名は必須です");
  });

  it("validationError 無 → aria-invalid / aria-describedby が付かない", () => {
    const { container } = render(() => <FormFieldView block={makeText()} />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector("[role='alert']")).toBeNull();
  });
});

describe("FormFieldView (PATCH flow)", () => {
  it("input → 300ms debounce → PATCH /checkout/shipping_field/{name} + reload", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(okJson({ value: "山田太郎" }));
    vi.stubGlobal("fetch", fetchSpy);
    const reload = vi.fn();

    const { container } = render(() => (
      <CartReloadProvider value={reload}>
        <FormFieldView block={makeText()} />
      </CartReloadProvider>
    ));
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.input(input, { target: { value: "山田太郎" } });
    expect(fetchSpy).not.toHaveBeenCalled(); // debounce 中

    await vi.advanceTimersByTimeAsync(299);
    expect(fetchSpy).not.toHaveBeenCalled(); // まだ debounce 中

    await vi.advanceTimersByTimeAsync(2);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/checkout/shipping_field/addressName");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.value).toBe("山田太郎");

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("blur で残 debounce が flush される", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockResolvedValue(okJson({ value: "x" }));
    vi.stubGlobal("fetch", fetchSpy);

    const { container } = render(() => <FormFieldView block={makeText()} />);
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.input(input, { target: { value: "x" } });
    fireEvent.blur(input); // debounce を待たずに flush

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it("select change は debounce 無しで即 PATCH", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okJson({ value: "13" }));
    vi.stubGlobal("fetch", fetchSpy);

    const block = makeText({
      key: "ff-pref",
      name: "addressPref",
      value: "01",
      kind: {
        inputType: "select",
        options: [
          { id: "01", label: raw("北海道") },
          { id: "13", label: raw("東京都") },
        ],
      },
    });

    const { container } = render(() => <FormFieldView block={block} />);
    const select = container.querySelector("select") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "13" } });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.value).toBe("13");
  });

  it("同値入力 (block.value と一致) なら PATCH 飛ばさない", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const block = makeText({ value: "山田" });
    const { container } = render(() => <FormFieldView block={block} />);
    const input = container.querySelector("input") as HTMLInputElement;

    // 同じ値で入力
    fireEvent.input(input, { target: { value: "山田" } });
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("PATCH 失敗 → toast に error が積まれる", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })));

    const { container } = render(() => <FormFieldView block={makeText()} />);
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.input(input, { target: { value: "x" } });
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(toastList().length).toBeGreaterThan(0));
    expect(toastList()[0].tone).toBe("error");
  });
});
