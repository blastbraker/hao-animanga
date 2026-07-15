import { describe, expect, it } from "vitest";
import { bridgeResponseMessage } from "./api";

describe("Bridge error messages", () => {
  it("turns runtime failures into a recovery instruction", () => {
    expect(bridgeResponseMessage(500, "Bridge operation failed")).toContain("try another source or server");
  });

  it("explains invalid anime extension requests", () => {
    expect(bridgeResponseMessage(400, "Anime source request was invalid")).toContain("Search again");
  });

  it("distinguishes unavailable, busy, and missing source data", () => {
    expect(bridgeResponseMessage(503)).toContain("temporarily unavailable");
    expect(bridgeResponseMessage(429)).toContain("Wait a minute");
    expect(bridgeResponseMessage(404)).toContain("no longer available");
  });
});
