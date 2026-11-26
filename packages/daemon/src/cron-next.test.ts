import { describe, expect, test } from "bun:test";
import { nextCronTime } from "./cron-next.ts";

const local = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

describe("nextCronTime", () => {
  test("a one-shot ScheduleWakeup's pinned minute and hour: later today", () => {
    expect(nextCronTime("33 16 * * *", local(2026, 11, 26, 16, 31, 32))).toBe(local(2026, 11, 26, 16, 33));
  });

  test("a time already passed today is tomorrow", () => {
    expect(nextCronTime("33 16 * * *", local(2026, 11, 26, 16, 34))).toBe(local(2026, 11, 27, 16, 33));
  });

  test("the current whole minute matches; a minute already begun does not", () => {
    expect(nextCronTime("* * * * *", local(2026, 11, 26, 10, 0))).toBe(local(2026, 11, 26, 10, 0));
    expect(nextCronTime("* * * * *", local(2026, 11, 26, 10, 0, 1))).toBe(local(2026, 11, 26, 10, 1));
  });

  test("steps, ranges and lists", () => {
    expect(nextCronTime("*/5 * * * *", local(2026, 11, 26, 10, 1))).toBe(local(2026, 11, 26, 10, 5));
    expect(nextCronTime("0 9-17/4 * * *", local(2026, 11, 26, 10, 0))).toBe(local(2026, 11, 26, 13, 0));
    expect(nextCronTime("0 9 * * 1-5", local(2026, 11, 28, 12, 0))).toBe(local(2026, 11, 30, 9, 0)); // Sat → Mon
    expect(nextCronTime("30 14 28 2 *", local(2026, 11, 26, 0, 0))).toBe(local(2027, 2, 28, 14, 30));
    expect(nextCronTime("0 0 1,15 * *", local(2026, 11, 2, 0, 0))).toBe(local(2026, 11, 15, 0, 0));
  });

  test("Sunday is 0 or 7", () => {
    expect(nextCronTime("0 8 * * 7", local(2026, 11, 26, 0, 0))).toBe(local(2026, 11, 29, 8, 0));
  });

  test("nonsense and impossible dates give null", () => {
    expect(nextCronTime("not a cron", 0)).toBeNull();
    expect(nextCronTime("61 * * * *", 0)).toBeNull();
    expect(nextCronTime("0 0 31 2 *", local(2026, 1, 1, 0, 0))).toBeNull();
  });
});
