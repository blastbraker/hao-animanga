import { describe, expect, it, vi } from "vitest";
import { nextHlsRecoveryAction, supportsNativeHls } from "./hls-recovery";

describe("HLS recovery", () => {
  it("retries the first fatal network interruption", () => {
    expect(nextHlsRecoveryAction("networkError", { network: 0, media: 0 })).toBe("retry-network");
  });

  it("falls back after the network retry is exhausted", () => {
    expect(nextHlsRecoveryAction("networkError", { network: 1, media: 0 })).toBe("fallback");
  });

  it("asks hls.js to recover the first media decoder error", () => {
    expect(nextHlsRecoveryAction("mediaError", { network: 0, media: 0 })).toBe("recover-media");
  });

  it("falls back for unknown fatal errors", () => {
    expect(nextHlsRecoveryAction("muxError", { network: 0, media: 0 })).toBe("fallback");
  });

  it("prefers native HLS when the browser advertises it", () => {
    const canPlayType = vi.fn((type: string) => type === "application/vnd.apple.mpegurl" ? "probably" : "");
    expect(supportsNativeHls({ canPlayType } as Pick<HTMLVideoElement, "canPlayType">)).toBe(true);
  });
});
