type FullscreenDocument = {
  fullscreenElement?: unknown;
  fullscreenEnabled?: boolean;
  exitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: unknown;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenShell = {
  requestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export type FullscreenVideo = {
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

type FullscreenNavigator = {
  maxTouchPoints?: number;
  platform?: string;
  standalone?: boolean;
  userAgent?: string;
};

export function prefersNativeAppleVideoFullscreen(navigatorValue: FullscreenNavigator): boolean {
  const userAgent = navigatorValue.userAgent ?? "";
  const platform = navigatorValue.platform ?? "";
  return navigatorValue.standalone === true
    || /iPhone|iPad|iPod/i.test(userAgent)
    || (platform === "MacIntel" && (navigatorValue.maxTouchPoints ?? 0) > 1);
}

export function isPlayerFullscreen(documentValue: FullscreenDocument, video?: FullscreenVideo | null): boolean {
  return Boolean(documentValue.fullscreenElement || documentValue.webkitFullscreenElement || video?.webkitDisplayingFullscreen);
}

export async function togglePlayerFullscreen(
  documentValue: FullscreenDocument,
  shell: FullscreenShell,
  video: FullscreenVideo | null,
  navigatorValue: FullscreenNavigator,
): Promise<"entered" | "exited"> {
  if (video?.webkitDisplayingFullscreen) {
    video.webkitExitFullscreen?.();
    return "exited";
  }
  if (documentValue.fullscreenElement || documentValue.webkitFullscreenElement) {
    if (documentValue.exitFullscreen) await documentValue.exitFullscreen();
    else if (documentValue.webkitExitFullscreen) await documentValue.webkitExitFullscreen();
    return "exited";
  }

  const enterNativeVideoFullscreen = () => {
    if (!video?.webkitEnterFullscreen || video.webkitSupportsFullscreen === false) return false;
    video.webkitEnterFullscreen();
    return true;
  };

  // iPhone and installed iPad PWAs do not consistently allow a div to enter
  // fullscreen, but WebKit exposes a native fullscreen API on the video itself.
  if (prefersNativeAppleVideoFullscreen(navigatorValue) && enterNativeVideoFullscreen()) return "entered";

  if (shell.requestFullscreen && documentValue.fullscreenEnabled !== false) {
    try {
      await shell.requestFullscreen();
      return "entered";
    } catch {
      if (enterNativeVideoFullscreen()) return "entered";
    }
  }
  if (shell.webkitRequestFullscreen) {
    await shell.webkitRequestFullscreen();
    return "entered";
  }
  if (enterNativeVideoFullscreen()) return "entered";
  throw new Error("Fullscreen is not available in this browser.");
}
