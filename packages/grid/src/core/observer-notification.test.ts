import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createObserverList,
  reportObserverError,
} from "./observer-notification";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("observer notification", () => {
  it("reports each failure and continues in registration order", () => {
    const reported: unknown[] = [];
    const calls: string[] = [];
    const firstError = new Error("first observer");
    const secondError = new Error("second observer");
    const observers = createObserverList<[value: string]>((error) => {
      reported.push(error);
    });

    observers.subscribe((value) => calls.push(`first:${value}`));
    observers.subscribe(() => {
      calls.push("throw:first");
      throw firstError;
    });
    observers.subscribe(() => {
      calls.push("throw:second");
      throw secondError;
    });
    observers.subscribe((value) => calls.push(`last:${value}`));

    expect(() => observers.notify("value")).not.toThrow();
    expect(calls).toEqual([
      "first:value",
      "throw:first",
      "throw:second",
      "last:value",
    ]);
    expect(reported).toEqual([firstError, secondError]);
  });

  it("keeps duplicate callbacks as independent registrations", () => {
    const observers = createObserverList<[]>();
    const callback = vi.fn();
    const unsubscribeFirst = observers.subscribe(callback);
    const unsubscribeSecond = observers.subscribe(callback);

    observers.notify();
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribeFirst();
    unsubscribeFirst();
    observers.notify();
    expect(callback).toHaveBeenCalledTimes(3);

    unsubscribeSecond();
    observers.notify();
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("falls back to globalThis.reportError when the app reporter throws", () => {
    const observerError = new Error("observer");
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);

    reportObserverError(observerError, () => {
      throw new Error("app reporter");
    });

    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(observerError);
  });

  it("guards global and console fallback failures", () => {
    const observerError = new Error("observer");
    vi.stubGlobal(
      "reportError",
      vi.fn(() => {
        throw new Error("global reporter");
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console reporter");
    });

    expect(() => reportObserverError(observerError)).not.toThrow();
    expect(console.error).toHaveBeenCalledWith(observerError);
  });

  it("clear is idempotent and deactivates retained unsubscribe functions", () => {
    const observers = createObserverList<[]>();
    const callback = vi.fn();
    const unsubscribe = observers.subscribe(callback);

    observers.clear();
    observers.clear();
    unsubscribe();
    unsubscribe();
    observers.notify();

    expect(callback).not.toHaveBeenCalled();
    expect(observers.size()).toBe(0);
  });
});
