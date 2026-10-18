type FullscreenDocument = {
  fullscreenElement?: unknown;
  fullscreenEnabled?: boolean;
  exitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: unknown;
  webkitFullscreenEnabled?: boolean;
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

type ViewportFullscreen = { active: boolean; enter: () => void; exit: () => void };

export function isPlayerFullscreen(documentValue: FullscreenDocument, video?: FullscreenVideo | null, viewportFullscreen = false): boolean {
  return Boolean(viewportFullscreen || documentValue.fullscreenElement || documentValue.webkitFullscreenElement || video?.webkitDisplayingFullscreen);
}

export async function togglePlayerFullscreen(
  documentValue: FullscreenDocument,
  shell: FullscreenShell,
  video: FullscreenVideo | null,
  viewport?: ViewportFullscreen,
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
  if (viewport?.active) {
    viewport.exit();
    return "exited";
  }

  // Fullscreen the whole player, not only <video>: next-episode and subtitle
  // controls must remain in the fullscreen tree, including on Apple devices.
  if (shell.requestFullscreen && documentValue.fullscreenEnabled !== false) {
    try {
      await shell.requestFullscreen();
      return "entered";
    } catch {
      // Unsupported PWA/browser implementations can expose an API that rejects.
    }
  }
  if (shell.webkitRequestFullscreen && documentValue.webkitFullscreenEnabled !== false) {
    try {
      await shell.webkitRequestFullscreen();
      return "entered";
    } catch {
      // Keep custom controls in a full-window player if true fullscreen fails.
    }
  }
  if (viewport) {
    viewport.enter();
    return "entered";
  }
  // Legacy callers without a full-window implementation can still play video.
  if (video?.webkitEnterFullscreen && video.webkitSupportsFullscreen !== false) {
    video.webkitEnterFullscreen();
    return "entered";
  }
  throw new Error("Fullscreen is not available in this browser.");
}

/** Keep page navigation out of the tab order and preserve scroll while expanded. */
export function lockPlayerViewport(shell: HTMLElement): () => void {
  const documentValue = shell.ownerDocument;
  const windowValue = documentValue.defaultView;
  const scrollX = windowValue?.scrollX ?? 0;
  const scrollY = windowValue?.scrollY ?? 0;
  const root = documentValue.documentElement;
  const body = documentValue.body;
  const previous = { rootOverflow: root.style.overflow, bodyOverflow: body.style.overflow };
  root.style.overflow = "hidden";
  body.style.overflow = "hidden";
  const siblings: Array<{ element: HTMLElement; inert: boolean }> = [];
  for (let current: HTMLElement | null = shell; current?.parentElement && current !== body; current = current.parentElement) {
    for (const element of Array.from(current.parentElement.children)) {
      if (element === current || !(element instanceof HTMLElement)) continue;
      siblings.push({ element, inert: element.inert });
      element.inert = true;
    }
  }
  return () => {
    root.style.overflow = previous.rootOverflow;
    body.style.overflow = previous.bodyOverflow;
    for (const { element, inert } of siblings) element.inert = inert;
    windowValue?.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
  };
}
