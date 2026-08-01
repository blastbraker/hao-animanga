import { describe, expect, it } from "vitest";
import { compatibleAudioStreams, pickAudioVariant, streamAudioMode } from "./stream-audio";

describe("stream audio variants", () => {
  it("recognizes sub, hardsub, and dub labels", () => {
    expect(streamAudioMode({ id: "sub", quality: "HD-1 - Sub - 1080p" })).toBe("sub");
    expect(streamAudioMode({ id: "hsub", quality: "Vidstream - HSub - 720p" })).toBe("sub");
    expect(streamAudioMode({ id: "dub", quality: "HD-1 - Dub - 1080p" })).toBe("dub");
  });

  it("uses audio and subtitle metadata when quality is neutral", () => {
    expect(streamAudioMode({ id: "dub", audio: "English" })).toBe("dub");
    expect(streamAudioMode({ id: "sub", subtitles: [{}] })).toBe("sub");
  });

  it("keeps the closest server and resolution when switching", () => {
    const current = { id: "sub", quality: "HD-1 - Sub - 720p" };
    const streams = [
      current,
      { id: "dub-1080", quality: "HD-1 - Dub - 1080p" },
      { id: "dub-720", quality: "HD-1 - Dub - 720p" },
      { id: "other", quality: "Vidstream - Dub - 720p" }
    ];
    expect(pickAudioVariant(streams, current, "dub")?.id).toBe("dub-720");
  });

  it("keeps recovery inside the selected audio mode", () => {
    const streams = [
      { id: "dub-720", quality: "HD-1 - Dub - 720p" },
      { id: "sub-1080", quality: "HD-1 - Sub - 1080p" },
      { id: "dub-1080", quality: "HD-2 - Dub - 1080p" }
    ];
    expect(compatibleAudioStreams(streams, "dub").map((stream) => stream.id)).toEqual(["dub-720", "dub-1080"]);
  });

  it("allows neutral streams but never a known opposite audio mode", () => {
    const streams = [
      { id: "sub", quality: "Sub - 1080p" },
      { id: "neutral", quality: "Auto - 1080p" }
    ];
    expect(compatibleAudioStreams(streams, "dub").map((stream) => stream.id)).toEqual(["neutral"]);
  });
});
