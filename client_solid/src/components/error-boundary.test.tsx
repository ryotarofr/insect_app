// error-boundary.test.tsx — AppErrorBoundary のフォールバック挙動
import { render, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { createSignal, Show } from "solid-js";
import { AppErrorBoundary } from "./AppErrorBoundary";

describe("AppErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    const { container } = render(() => (
      <AppErrorBoundary label="test">
        <div>healthy content</div>
      </AppErrorBoundary>
    ));
    expect(container.textContent).toContain("healthy content");
    expect(container.textContent).not.toContain("再試行");
  });

  it("renders fallback UI when child throws", () => {
    const Boom = () => {
      throw new Error("kaboom");
    };
    const { container } = render(() => (
      <AppErrorBoundary label="boom-route">
        <Boom />
      </AppErrorBoundary>
    ));
    expect(container.textContent).toContain("ERROR · boom-route");
    expect(container.textContent).toContain("kaboom");
    expect(container.textContent).toContain("再試行");
  });

  it("reset button retries rendering", () => {
    const [shouldThrow, setShouldThrow] = createSignal(true);
    const Maybe = () => {
      if (shouldThrow()) throw new Error("first time");
      return <div>recovered</div>;
    };

    const { container, getByText } = render(() => (
      <AppErrorBoundary label="retry">
        <Maybe />
      </AppErrorBoundary>
    ));
    expect(container.textContent).toContain("first time");

    setShouldThrow(false);
    fireEvent.click(getByText("再試行"));

    expect(container.textContent).toContain("recovered");
    expect(container.textContent).not.toContain("再試行");
  });

  it("uses default label 'view' if none provided", () => {
    const Boom = () => {
      throw new Error("oops");
    };
    const { container } = render(() => (
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>
    ));
    expect(container.textContent).toContain("ERROR · view");
  });

  it("shows non-Error throw values stringified", () => {
    const ThrowString = () => {
      throw "raw string thrown";
    };
    const { container } = render(() => (
      <AppErrorBoundary label="raw">
        <ThrowString />
      </AppErrorBoundary>
    ));
    expect(container.textContent).toContain("raw string thrown");
  });

  // suppress unused import warning in some toolchains
  void Show;
});
