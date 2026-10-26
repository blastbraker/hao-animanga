import { describe, expect, it, vi } from "vitest";
import { isPictureInPicture, pictureInPictureError, supportsPictureInPicture, togglePictureInPicture } from "./player-picture-in-picture";

const video = () => ({ readyState: 4, videoWidth: 1920, currentTime: 125, muted: false, playbackRate: 1.5, play: vi.fn(), load: vi.fn(), requestPictureInPicture: vi.fn().mockResolvedValue({}) });

describe("pop-out mini-player", () => {
  it("requests standard PiP synchronously without resetting playback", async () => {
    const media = video();
    const pending = togglePictureInPicture({ pictureInPictureEnabled: true }, media);
    expect(media.requestPictureInPicture).toHaveBeenCalledOnce();
    await pending;
    expect(media.currentTime).toBe(125);
    expect(media.muted).toBe(false);
    expect(media.playbackRate).toBe(1.5);
    expect(media.play).not.toHaveBeenCalled();
    expect(media.load).not.toHaveBeenCalled();
  });

  it("exits only this video's floating window, including before metadata is ready", async () => {
    const media = { ...video(), readyState: 0, videoWidth: 0 };
    const exitPictureInPicture = vi.fn().mockResolvedValue(undefined);
    const documentValue = { pictureInPictureElement: media, exitPictureInPicture };
    expect(isPictureInPicture(documentValue, media)).toBe(true);
    await togglePictureInPicture(documentValue, media);
    expect(exitPictureInPicture).toHaveBeenCalledOnce();
    expect(media.requestPictureInPicture).not.toHaveBeenCalled();
  });

  it("does not close another video's PiP window", async () => {
    const media = video();
    const exitPictureInPicture = vi.fn();
    await togglePictureInPicture({ pictureInPictureEnabled: true, pictureInPictureElement: {}, exitPictureInPicture }, media);
    expect(exitPictureInPicture).not.toHaveBeenCalled();
    expect(media.requestPictureInPicture).toHaveBeenCalledOnce();
  });

  it("leaves container fullscreen after opening PiP without consuming the initial click", async () => {
    const order: string[] = [];
    const media = { ...video(), requestPictureInPicture: vi.fn(async () => { order.push("pip"); }) };
    const documentValue = { pictureInPictureEnabled: true, fullscreenElement: {}, exitFullscreen: vi.fn(async () => { order.push("fullscreen-exit"); }) };
    await togglePictureInPicture(documentValue, media);
    expect(order).toEqual(["pip", "fullscreen-exit"]);
    documentValue.exitFullscreen.mockRejectedValue(new Error("Fullscreen already closed"));
    await expect(togglePictureInPicture(documentValue, media)).resolves.toBeUndefined();
  });

  it("supports Safari's presentation mode API and inline return", async () => {
    const media = { ...video(), webkitSupportsPresentationMode: vi.fn().mockReturnValue(true), webkitSetPresentationMode: vi.fn(), webkitPresentationMode: "inline" };
    expect(supportsPictureInPicture({}, media)).toBe(true);
    await togglePictureInPicture({}, media);
    expect(media.webkitSetPresentationMode).toHaveBeenCalledWith("picture-in-picture");
    media.webkitPresentationMode = "picture-in-picture";
    expect(isPictureInPicture({}, media)).toBe(true);
    await togglePictureInPicture({}, media);
    expect(media.webkitSetPresentationMode).toHaveBeenLastCalledWith("inline");
  });

  it("handles unsupported browsers and WebKit capability exceptions", async () => {
    const media = { ...video(), webkitSupportsPresentationMode: () => { throw new Error("Unsupported"); }, webkitSetPresentationMode: vi.fn() };
    expect(supportsPictureInPicture({}, media)).toBe(false);
    await expect(togglePictureInPicture({}, media)).rejects.toThrow("does not support");
    expect(media.requestPictureInPicture).not.toHaveBeenCalled();
  });

  it("respects disabled PiP and unloaded media", async () => {
    const media = { ...video(), disablePictureInPicture: true };
    expect(supportsPictureInPicture({ pictureInPictureEnabled: true }, media)).toBe(false);
    await expect(togglePictureInPicture({ pictureInPictureEnabled: true }, media)).rejects.toThrow("disabled");
    await expect(togglePictureInPicture({ pictureInPictureEnabled: true }, { ...video(), videoWidth: 0 })).rejects.toThrow("Wait for the video");
  });

  it("keeps rejected browser requests out of playback recovery", async () => {
    const media = video();
    media.requestPictureInPicture.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    await expect(togglePictureInPicture({ pictureInPictureEnabled: true }, media)).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(pictureInPictureError(new DOMException("Denied", "NotAllowedError"))).toContain("Start the video");
    expect(pictureInPictureError(new DOMException("Unsupported", "NotSupportedError"), true)).toContain("Safari");
    expect(pictureInPictureError(new DOMException("Blocked", "SecurityError"))).toContain("Playback can continue");
  });
});
