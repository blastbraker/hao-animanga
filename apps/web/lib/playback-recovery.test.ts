import { describe, expect, it } from "vitest";
import { nextPlaybackCandidate, playbackRecoveryPosition, prioritizePlaybackItems } from "./playback-recovery";

describe("playback recovery", () => {
  const streams = [{ id: "auto" }, { id: "720p" }];
  const servers = [{ id: "default" }, { id: "backup" }];

  it("tries another quality before changing servers", () => {
    expect(nextPlaybackCandidate(streams, "auto", servers, "default")).toEqual({ kind: "stream", id: "720p" });
  });

  it("tries another server after qualities are exhausted", () => {
    expect(nextPlaybackCandidate(streams, "720p", servers, "default")).toEqual({ kind: "server", id: "backup" });
  });

  it("tries a healthy earlier stream when a saved preference is dead", () => {
    const preferredInMiddle = [{ id: "healthy-1080p" }, { id: "dead-preference" }, { id: "healthy-dub" }];
    expect(nextPlaybackCandidate(preferredInMiddle, "dead-preference", servers, "default", new Set(["dead-preference"])))
      .toEqual({ kind: "stream", id: "healthy-1080p" });
  });

  it("does not retry streams that already failed", () => {
    const attempted = new Set(["auto", "720p"]);
    expect(nextPlaybackCandidate(streams, "720p", servers, "default", attempted)).toEqual({ kind: "server", id: "backup" });
  });

  it("skips an earlier sub stream when recovery is locked to dub", () => {
    const mixedStreams = [{ id: "dub-720" }, { id: "sub-1080" }, { id: "dub-1080" }];
    const dubbedIds = new Set(["dub-720", "dub-1080"]);
    expect(nextPlaybackCandidate(mixedStreams, "dub-720", servers, "default", new Set(["dub-720"]), dubbedIds))
      .toEqual({ kind: "stream", id: "dub-1080" });
  });

  it("changes server instead of crossing a locked audio mode", () => {
    const mixedStreams = [{ id: "dub" }, { id: "sub-1080" }];
    expect(nextPlaybackCandidate(mixedStreams, "dub", servers, "default", new Set(["dub"]), new Set(["dub"])))
      .toEqual({ kind: "server", id: "backup" });
  });

  it("reports exhaustion after the final server", () => {
    expect(nextPlaybackCandidate(streams, "720p", servers, "backup")).toBeNull();
  });

  it("tries a preferred server first without dropping the others", () => {
    expect(prioritizePlaybackItems([{ id: "one" }, { id: "two" }, { id: "three" }], "two").map((item) => item.id)).toEqual(["two", "one", "three"]);
  });

  it("restores the same episode position after changing quality", () => {
    expect(playbackRecoveryPosition({ episodeNumber: 12, positionSeconds: 845.5 }, 12, 1_420)).toBe(845.5);
  });

  it("does not carry a recovery position into another episode", () => {
    expect(playbackRecoveryPosition({ episodeNumber: 12, positionSeconds: 845.5 }, 13, 1_420)).toBeNull();
  });

  it("keeps a recovered position inside the replacement duration", () => {
    expect(playbackRecoveryPosition({ episodeNumber: 12, positionSeconds: 1_500 }, 12, 1_420)).toBe(1_419.75);
  });
});
