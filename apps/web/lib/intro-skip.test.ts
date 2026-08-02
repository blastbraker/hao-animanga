import { describe, expect, it } from "vitest";
import { isIntroSkipVisible, normalizeIntroSkipInterval } from "./intro-skip";

describe("skip intro", () => {
  const interval = { startTime: 65, endTime: 155, source: "aniskip" as const };

  it("shows the control only while playback is inside the opening", () => {
    expect(isIntroSkipVisible(interval, 64.9)).toBe(false);
    expect(isIntroSkipVisible(interval, 65)).toBe(true);
    expect(isIntroSkipVisible(interval, 154.9)).toBe(true);
    expect(isIntroSkipVisible(interval, 155)).toBe(false);
  });

  it("rejects malformed and implausible intervals", () => {
    expect(normalizeIntroSkipInterval(interval, 1_420)).toEqual(interval);
    expect(normalizeIntroSkipInterval({ ...interval, endTime: 900 }, 1_420)).toBeNull();
    expect(normalizeIntroSkipInterval({ ...interval, source: "ed" }, 1_420)).toBeNull();
  });
});
