import { describe, expect, it } from "vitest";
import { nextPlaybackCandidate, prioritizePlaybackItems } from "./playback-recovery";

describe("playback recovery", () => {
  const streams = [{ id: "auto" }, { id: "720p" }];
  const servers = [{ id: "default" }, { id: "backup" }];

  it("tries another quality before changing servers", () => {
    expect(nextPlaybackCandidate(streams, "auto", servers, "default")).toEqual({ kind: "stream", id: "720p" });
  });

  it("tries another server after qualities are exhausted", () => {
    expect(nextPlaybackCandidate(streams, "720p", servers, "default")).toEqual({ kind: "server", id: "backup" });
  });

  it("reports exhaustion after the final server", () => {
    expect(nextPlaybackCandidate(streams, "720p", servers, "backup")).toBeNull();
  });

  it("tries a preferred server first without dropping the others", () => {
    expect(prioritizePlaybackItems([{ id: "one" }, { id: "two" }, { id: "three" }], "two").map((item) => item.id)).toEqual(["two", "one", "three"]);
  });
});
