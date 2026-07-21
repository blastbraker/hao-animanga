export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function normalizePlaybackSpeed(value: unknown): number {
  const speed = typeof value === "number" ? value : Number(value);
  return PLAYBACK_SPEEDS.includes(speed as (typeof PLAYBACK_SPEEDS)[number]) ? speed : 1;
}

export function nextPlaybackSpeed(current: number): number {
  const normalized = normalizePlaybackSpeed(current);
  const index = PLAYBACK_SPEEDS.indexOf(normalized as (typeof PLAYBACK_SPEEDS)[number]);
  return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length] ?? 1;
}
