import { describe, expect, it, vi } from "vitest";
import { rootPath } from "../types/identity";
import { createEmitter } from "./emitter";

describe("GridEmitter", () => {
  it("isolates throwing handlers and keeps duplicate registrations independent", () => {
    const observerError = new Error("handler failed");
    const report = vi.fn();
    const emitter = createEmitter(report);
    const duplicate = vi.fn();
    const later = vi.fn();
    const unsubscribeFirst = emitter.on("levelStatusChanged", duplicate);
    const unsubscribeSecond = emitter.on("levelStatusChanged", duplicate);
    emitter.on("levelStatusChanged", () => {
      throw observerError;
    });
    emitter.on("levelStatusChanged", later);
    const event = { path: rootPath("rows"), status: "ready" as const };

    expect(() => emitter.emit("levelStatusChanged", event)).not.toThrow();
    expect(duplicate).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith(observerError);
    expect(later).toHaveBeenCalledWith(event);

    unsubscribeFirst();
    unsubscribeFirst();
    emitter.emit("levelStatusChanged", event);
    expect(duplicate).toHaveBeenCalledTimes(3);

    unsubscribeSecond();
    emitter.clear();
    emitter.clear();
    emitter.emit("levelStatusChanged", event);
    expect(later).toHaveBeenCalledTimes(2);
  });
});
