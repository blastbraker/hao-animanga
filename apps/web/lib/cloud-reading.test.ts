import { describe, expect, it } from "vitest";
import type { ReadingState } from "@hao/domain";
import { newerReadingState, parseReadingStates } from "./cloud-reading";

const state = (updated: string): ReadingState => ({
  contentKey: "manga:1:2",
  mediaKind: "MANGA",
  workId: null,
  title: "Fixture",
  releaseLabel: "Chapter 1",
  positionPercent: 25,
  completed: false,
  state: {},
  clientUpdatedAt: updated,
});

describe("cloud reading state", () => {
  it("keeps the newest device update", () => {
    expect(newerReadingState(state("2026-01-01T00:00:00.000Z"), state("2026-01-02T00:00:00.000Z"))?.clientUpdatedAt).toContain("01-02");
  });
  it("ignores malformed local data", () => {
    expect(parseReadingStates("not-json")).toEqual({});
    expect(parseReadingStates(JSON.stringify({ bad: { nope: true } }))).toEqual({});
  });
});

