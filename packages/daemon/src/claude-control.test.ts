import { describe, expect, test } from "bun:test";
import { controlToEvict, type ControlUse } from "./claude-control.ts";

const use = (lastUsed: number, extra: Partial<ControlUse> = {}): ControlUse => ({ busy: 0, lastUsed, until: 0, ...extra });

describe("controlToEvict", () => {
  test("ends nothing while under the limit", () => {
    expect(controlToEvict(new Map([["chat:a", use(1)]]), 2, 100)).toBeNull();
  });

  test("ends the least recently asked process at the limit", () => {
    const uses = new Map([
      ["chat:a", use(30)],
      ["chat:b", use(10)],
      ["chat:c", use(20)],
    ]);
    expect(controlToEvict(uses, 3, 100)).toBe("chat:b");
  });

  test("never ends one answering a request or holding a sign-in", () => {
    const uses = new Map([
      ["chat:a", use(10, { busy: 1 })],
      ["chat:b", use(5, { until: 500 })],
      ["chat:c", use(20)],
    ]);
    expect(controlToEvict(uses, 3, 100)).toBe("chat:c");
    // A sign-in that has had its time can go.
    expect(controlToEvict(uses, 3, 600)).toBe("chat:b");
  });

  test("ends nothing when every process is in use", () => {
    const uses = new Map([
      ["chat:a", use(10, { busy: 1 })],
      ["chat:b", use(5, { busy: 2 })],
    ]);
    expect(controlToEvict(uses, 2, 100)).toBeNull();
  });
});
