export type PictureInPictureDocument = {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: unknown;
  exitPictureInPicture?: () => Promise<void>;
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
};

export type PictureInPictureVideo = {
  readyState: number;
  videoWidth: number;
  disablePictureInPicture?: boolean;
  requestPictureInPicture?: () => Promise<unknown>;
  webkitPresentationMode?: string;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
};

function supportsWebKit(video: PictureInPictureVideo): boolean {
  try {
    return Boolean(video.webkitSetPresentationMode && video.webkitSupportsPresentationMode?.("picture-in-picture"));
  } catch { return false; }
}

export function supportsPictureInPicture(documentValue: PictureInPictureDocument, video: PictureInPictureVideo): boolean {
  if (video.disablePictureInPicture) return false;
  return Boolean((documentValue.pictureInPictureEnabled && video.requestPictureInPicture) || supportsWebKit(video));
}

export function isPictureInPicture(documentValue: PictureInPictureDocument, video: PictureInPictureVideo): boolean {
  return documentValue.pictureInPictureElement === video || video.webkitPresentationMode === "picture-in-picture";
}

async function leaveFullscreen(documentValue: PictureInPictureDocument): Promise<void> {
  // Enter PiP first so exiting fullscreen cannot consume the initiating click.
  // A fullscreen-exit failure must not report the already-open PiP as failed.
  try {
    if (documentValue.fullscreenElement) await documentValue.exitFullscreen?.();
    else if (documentValue.webkitFullscreenElement) await documentValue.webkitExitFullscreen?.();
  } catch { /* The viewer can still exit fullscreen using the browser controls. */ }
}

/** Call directly from a click, without awaiting other work that consumes activation. */
export async function togglePictureInPicture(documentValue: PictureInPictureDocument, video: PictureInPictureVideo): Promise<void> {
  if (documentValue.pictureInPictureElement === video && documentValue.exitPictureInPicture) {
    await documentValue.exitPictureInPicture();
    return;
  }
  if (video.webkitPresentationMode === "picture-in-picture" && video.webkitSetPresentationMode) {
    video.webkitSetPresentationMode("inline");
    return;
  }
  if (video.readyState < 1 || !video.videoWidth) throw new Error("Wait for the video to load, then try Mini-player again.");
  if (video.disablePictureInPicture) throw new Error("Mini-player is disabled for this video.");
  if (documentValue.pictureInPictureEnabled && video.requestPictureInPicture) {
    // Do not call play(), load(), or replace the element: keep time, audio and speed.
    await video.requestPictureInPicture();
    await leaveFullscreen(documentValue);
    return;
  }
  if (supportsWebKit(video)) {
    video.webkitSetPresentationMode!("picture-in-picture");
    await leaveFullscreen(documentValue);
    return;
  }
  throw new Error("This browser does not support the pop-out mini-player. Try its built-in picture-in-picture control or open HAO in Safari, Chrome, or Edge.");
}

export function pictureInPictureError(error: unknown, standalone = false): string {
  const name = typeof error === "object" && error !== null && "name" in error ? error.name : "";
  if (name === "NotAllowedError") return "Your browser blocked Mini-player. Start the video, then press Mini-player again.";
  if (name === "InvalidStateError") return "Wait for the video to load, then try Mini-player again.";
  if (standalone) return "Mini-player is unavailable in this installed app. Try opening this episode in your browser; on iPad or iPhone, use Safari.";
  if (name === "NotSupportedError" || name === "SecurityError") return "Mini-player is unavailable for this video or blocked by your browser settings. Playback can continue here.";
  return error instanceof Error && name === "Error" ? error.message : "Mini-player could not open. Playback can continue here; try again from the video controls.";
}
