import { describe, expect, it, vi } from "vitest";
import { createPhantomChannel } from "./phantom-channel";
import { childPath, rootPath, type GridPath } from "../types/identity";
import type { PhantomRow } from "../types/level-row";

const A = rootPath("rows");
const B = childPath(A, "row-1", "items");

function phantom(
  rowKey: string,
  columns: Record<string, unknown> = {},
): PhantomRow {
  return { rowKey, columns, state: { kind: "editing" } };
}

describe("PhantomChannel", () => {
  it("get returns identity-stable arrays across no-op reads", () => {
    const ch = createPhantomChannel();
    expect(ch.get(A)).toBe(ch.get(A));
    ch.add(A, phantom("p1"));
    const after = ch.get(A);
    expect(ch.get(A)).toBe(after);
  });

  it("get on an untouched path returns the shared EMPTY constant", () => {
    const ch1 = createPhantomChannel();
    const ch2 = createPhantomChannel();
    expect(ch1.get(A)).toBe(ch2.get(A));
  });

  it("add allocates a new array for that path; other paths' arrays unchanged", () => {
    const ch = createPhantomChannel();
    const beforeA = ch.get(A);
    const beforeB = ch.get(B);
    ch.add(A, phantom("p1"));
    expect(ch.get(A)).not.toBe(beforeA);
    expect(ch.get(B)).toBe(beforeB);
  });

  it("add replaces a phantom on rowKey collision", () => {
    const ch = createPhantomChannel();
    ch.add(A, phantom("p1", { name: "first" }));
    ch.add(A, phantom("p1", { name: "second" }));
    expect(ch.get(A)).toHaveLength(1);
    expect(ch.get(A)[0].columns.name).toBe("second");
  });

  it("remove drops the phantom and evicts the path on last-remove", () => {
    const ch = createPhantomChannel();
    ch.add(A, phantom("p1"));
    ch.remove(A, "p1");
    const fresh = createPhantomChannel();
    expect(ch.get(A)).toBe(fresh.get(A));
  });

  it("remove of a non-existent rowKey is a no-op (no allocation, no notification)", () => {
    const ch = createPhantomChannel();
    ch.add(A, phantom("p1"));
    const before = ch.get(A);
    const sub = vi.fn();
    ch.subscribe(A, sub);
    ch.remove(A, "missing");
    expect(ch.get(A)).toBe(before);
    expect(sub).not.toHaveBeenCalled();
  });

  it("remove on a never-touched path is a no-op", () => {
    const ch = createPhantomChannel();
    const sub = vi.fn();
    ch.subscribe(A, sub);
    ch.remove(A, "anything");
    expect(sub).not.toHaveBeenCalled();
  });

  it("setCell mutates only the matching phantom; siblings keep their references", () => {
    const ch = createPhantomChannel();
    ch.add(A, phantom("p1", { name: "" }));
    ch.add(A, phantom("p2", { name: "" }));
    const before = ch.get(A);
    const beforeP1 = before[0];
    const beforeP2 = before[1];

    ch.setCell(A, "p1", "name", "Pear");
    const after = ch.get(A);
    expect(after).not.toBe(before);
    expect(after[0]).not.toBe(beforeP1);
    expect(after[0].columns.name).toBe("Pear");
    expect(after[1]).toBe(beforeP2);
  });

  it("setCell on a non-existent rowKey is a no-op", () => {
    const ch = createPhantomChannel();
    ch.add(A, phantom("p1"));
    const before = ch.get(A);
    const sub = vi.fn();
    ch.subscribe(A, sub);
    ch.setCell(A, "missing", "name", "x");
    expect(ch.get(A)).toBe(before);
    expect(sub).not.toHaveBeenCalled();
  });

  it("subscribe fires on changes to its path; unrelated paths do not notify", () => {
    const ch = createPhantomChannel();
    const subA = vi.fn();
    const subB = vi.fn();
    ch.subscribe(A, subA);
    ch.subscribe(B, subB);

    ch.add(A, phantom("p1"));
    expect(subA).toHaveBeenCalledTimes(1);
    expect(subB).not.toHaveBeenCalled();

    ch.add(B, phantom("p2"));
    expect(subA).toHaveBeenCalledTimes(1);
    expect(subB).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further notifications", () => {
    const ch = createPhantomChannel();
    const sub = vi.fn();
    const unsub = ch.subscribe(A, sub);
    ch.add(A, phantom("p1"));
    expect(sub).toHaveBeenCalledTimes(1);
    unsub();
    ch.add(A, phantom("p2"));
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it("seed map preserves entries by reference", () => {
    const seed = new Map<GridPath, PhantomRow[]>();
    const arrA: PhantomRow[] = [phantom("p1", { name: "x" })];
    seed.set(A, arrA);

    const ch = createPhantomChannel(seed);
    expect(ch.get(A)).toBe(arrA);
  });

  it("seed map skips empty arrays so an empty seed behaves like no seed", () => {
    const seed = new Map<GridPath, PhantomRow[]>();
    seed.set(A, []);
    const ch = createPhantomChannel(seed);
    const fresh = createPhantomChannel();
    expect(ch.get(A)).toBe(fresh.get(A));
  });
});
