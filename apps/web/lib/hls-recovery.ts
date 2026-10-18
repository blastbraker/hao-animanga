export type HlsRecoveryAttempts = {
  network: number;
  media: number;
};

export type HlsRecoveryAction = "retry-network" | "recover-media" | "fallback";

// A modest forward cushion, with bounded retained media on memory-limited tablets.
// Native Safari HLS manages its own buffer; these settings apply to hls.js only.
export const PLAYBACK_HLS_CONFIG = {
  enableWorker: true,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  maxBufferSize: 60 * 1000 * 1000,
  backBufferLength: 30,
};

export function nextHlsRecoveryAction(errorType: string, attempts: HlsRecoveryAttempts): HlsRecoveryAction {
  if (errorType === "networkError" && attempts.network < 1) return "retry-network";
  if (errorType === "mediaError" && attempts.media < 1) return "recover-media";
  return "fallback";
}

export function supportsNativeHls(video: Pick<HTMLVideoElement, "canPlayType">): boolean {
  return Boolean(
    video.canPlayType("application/vnd.apple.mpegurl") ||
    video.canPlayType("application/x-mpegURL"),
  );
}
