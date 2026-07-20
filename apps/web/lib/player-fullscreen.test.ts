import { describe, expect, it, vi } from "vitest";
import { isPlayerFullscreen, prefersNativeAppleVideoFullscreen, togglePlayerFullscreen } from "./player-fullscreen";

describe("player fullscreen", () => {
  it("recognizes iPhone and installed Safari apps", () => {
    expect(prefersNativeAppleVideoFullscreen({ userAgent: "Mozilla/5.0 (iPhone)", standalone: false })).toBe(true);
    expect(prefersNativeAppleVideoFullscreen({ userAgent: "Safari", standalone: true })).toBe(true);
    expect(prefersNativeAppleVideoFullscreen({ userAgent: "Chrome", platform: "Win32" })).toBe(false);
  });

  it("uses native video fullscreen in an installed Apple PWA", async () => {
    const enter = vi.fn();
    const request = vi.fn();
    await expect(togglePlayerFullscreen({}, { requestFullscreen: request }, { webkitEnterFullscreen: enter }, { standalone: true })).resolves.toBe("entered");
    expect(enter).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it("uses and exits standard fullscreen on supported browsers", async () => {
    const request = vi.fn();
    const exit = vi.fn();
    await expect(togglePlayerFullscreen({ fullscreenEnabled: true }, { requestFullscreen: request }, null, {})).resolves.toBe("entered");
    expect(request).toHaveBeenCalledOnce();
    await expect(togglePlayerFullscreen({ fullscreenElement: {}, exitFullscreen: exit }, {}, null, {})).resolves.toBe("exited");
    expect(exit).toHaveBeenCalledOnce();
  });

  it("tracks WebKit native video fullscreen", () => {
    expect(isPlayerFullscreen({}, { webkitDisplayingFullscreen: true })).toBe(true);
  });
});
