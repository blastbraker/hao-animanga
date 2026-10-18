import { describe, expect, it, vi } from "vitest";
import { isPlayerFullscreen, togglePlayerFullscreen } from "./player-fullscreen";

describe("player fullscreen", () => {
  it("prefers the whole player even when native Apple video fullscreen is available", async () => {
    const enter = vi.fn();
    const request = vi.fn();
    await expect(togglePlayerFullscreen({}, { requestFullscreen: request }, { webkitEnterFullscreen: enter })).resolves.toBe("entered");
    expect(request).toHaveBeenCalledOnce();
    expect(enter).not.toHaveBeenCalled();
  });

  it("uses and exits standard fullscreen on supported browsers", async () => {
    const request = vi.fn();
    const exit = vi.fn();
    await expect(togglePlayerFullscreen({ fullscreenEnabled: true }, { requestFullscreen: request }, null)).resolves.toBe("entered");
    expect(request).toHaveBeenCalledOnce();
    await expect(togglePlayerFullscreen({ fullscreenElement: {}, exitFullscreen: exit }, {}, null)).resolves.toBe("exited");
    expect(exit).toHaveBeenCalledOnce();
  });

  it("tracks WebKit native video fullscreen", () => {
    expect(isPlayerFullscreen({}, { webkitDisplayingFullscreen: true })).toBe(true);
  });

  it("tries prefixed container fullscreen after the standard API rejects", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Unsupported"));
    const webkitRequest = vi.fn();
    await expect(togglePlayerFullscreen({}, { requestFullscreen: request, webkitRequestFullscreen: webkitRequest }, null)).resolves.toBe("entered");
    expect(webkitRequest).toHaveBeenCalledOnce();
  });

  it("uses the full-window fallback instead of hiding the overlay in native video fullscreen", async () => {
    const viewport = { active: false, enter: vi.fn(), exit: vi.fn() };
    const nativeEnter = vi.fn();
    await expect(togglePlayerFullscreen({ fullscreenEnabled: false }, {}, { webkitEnterFullscreen: nativeEnter }, viewport)).resolves.toBe("entered");
    expect(viewport.enter).toHaveBeenCalledOnce();
    expect(nativeEnter).not.toHaveBeenCalled();
    expect(isPlayerFullscreen({}, null, true)).toBe(true);
    await expect(togglePlayerFullscreen({}, {}, null, { ...viewport, active: true })).resolves.toBe("exited");
    expect(viewport.exit).toHaveBeenCalledOnce();
  });

  it("falls back cleanly when both container APIs reject", async () => {
    const viewport = { active: false, enter: vi.fn(), exit: vi.fn() };
    const reject = vi.fn().mockRejectedValue(new Error("Not allowed"));
    await expect(togglePlayerFullscreen({}, { requestFullscreen: reject, webkitRequestFullscreen: reject }, null, viewport)).resolves.toBe("entered");
    expect(viewport.enter).toHaveBeenCalledOnce();
  });

  it("exits an already-open native video player", async () => {
    const exit = vi.fn();
    await expect(togglePlayerFullscreen({}, {}, { webkitDisplayingFullscreen: true, webkitExitFullscreen: exit })).resolves.toBe("exited");
    expect(exit).toHaveBeenCalledOnce();
  });
});
