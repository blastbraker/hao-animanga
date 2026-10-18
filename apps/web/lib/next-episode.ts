import { normalizeIntroSkipInterval, type IntroSkipInterval } from "./intro-skip";

export const NEXT_EPISODE_NOTICE_SECONDS = 15;

export function normalizeOutroInterval(value: unknown, duration: number): IntroSkipInterval | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const interval = normalizeIntroSkipInterval(value, duration);
  return interval && interval.startTime >= duration / 2 && duration - interval.startTime <= 300 ? interval : null;
}

/** Follow the media clock so pausing, buffering and seeking cannot skip the ending. */
export function nextEpisodeCountdown(currentTime: number, duration: number, playbackRate = 1, outro: IntroSkipInterval | null = null): number | null {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0 || currentTime < 0) return null;
  const remaining = Math.max(0, duration - currentTime);
  // Very short clips should not show the prompt as soon as they start.
  const ending = normalizeOutroInterval(outro, duration);
  const outroStarted = ending !== null && currentTime >= ending.startTime;
  if (!outroStarted && remaining > Math.min(NEXT_EPISODE_NOTICE_SECONDS, duration / 2)) return null;
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return Math.ceil(remaining / rate);
}

export function shouldAutoplayNext(enabled: boolean, hasNextEpisode: boolean, dismissed: boolean): boolean {
  return enabled && hasNextEpisode && !dismissed;
}
