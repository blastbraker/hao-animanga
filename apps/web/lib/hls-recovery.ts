export type HlsRecoveryAttempts = {
  network: number;
  media: number;
};

export type HlsRecoveryAction = "retry-network" | "recover-media" | "fallback";

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
