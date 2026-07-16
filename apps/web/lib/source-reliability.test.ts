import { describe, expect, it } from "vitest";
import { dedupeSourceResults, parseSourceReliability, rankSourcesByReliability, updateSourceReliability } from "./source-reliability";

describe("source reliability", () => {
  it("orders fallback sources by successful history while preserving the requested source first", () => {
    let records = updateSourceReliability({}, "anime", "fast", true, 120, new Date("2026-01-01T00:00:00Z"));
    records = updateSourceReliability(records, "anime", "failing", false, 900, new Date("2026-01-01T00:01:00Z"));
    const sources = [{ id: "failing" }, { id: "requested" }, { id: "fast" }];
    expect(rankSourcesByReliability(sources, "anime", "requested", records).map((source) => source.id)).toEqual(["requested", "fast", "failing"]);
  });

  it("resets consecutive failures after a successful request", () => {
    let records = updateSourceReliability({}, "manga", "one", false, 500);
    records = updateSourceReliability(records, "manga", "one", true, 100);
    expect(records["manga:one"]?.consecutiveFailures).toBe(0);
    expect(records["manga:one"]?.averageLatencyMs).toBe(380);
  });

  it("deduplicates normalized titles while retaining the highest-ranked source result", () => {
    expect(dedupeSourceResults([{ title: "One Piece", source: "best" }, { title: "ONE-PIECE", source: "other" }, { title: "One Punch Man", source: "other" }])).toEqual([
      { title: "One Piece", source: "best" },
      { title: "One Punch Man", source: "other" },
    ]);
  });

  it("ignores malformed stored data", () => {
    expect(parseSourceReliability("[]")).toEqual({});
    expect(parseSourceReliability("not-json")).toEqual({});
  });
});
