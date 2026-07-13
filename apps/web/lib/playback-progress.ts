export type SavedPlaybackPosition = {
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
  completed: boolean;
};

export function playbackStorageKey(sourceId: string, animeId: string, episodeId: string): string {
  return `hao:anime-progress:${encodeURIComponent(sourceId)}:${encodeURIComponent(animeId)}:${encodeURIComponent(episodeId)}`;
}

export function parsePlaybackPosition(value: string | null): SavedPlaybackPosition | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SavedPlaybackPosition>;
    if (!Number.isFinite(parsed.positionSeconds) || !Number.isFinite(parsed.durationSeconds)) return null;
    if ((parsed.positionSeconds ?? 0) < 0 || (parsed.durationSeconds ?? 0) <= 0) return null;
    return {
      positionSeconds: parsed.positionSeconds!,
      durationSeconds: parsed.durationSeconds!,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      completed: parsed.completed === true,
    };
  } catch {
    return null;
  }
}

export function resumablePosition(saved: SavedPlaybackPosition | null, currentDuration: number): number | null {
  if (!saved || saved.completed || saved.positionSeconds < 5) return null;
  const duration = Number.isFinite(currentDuration) && currentDuration > 0 ? currentDuration : saved.durationSeconds;
  if (duration - saved.positionSeconds < 10) return null;
  return Math.min(saved.positionSeconds, Math.max(0, duration - 1));
}

export function playbackPercent(positionSeconds: number, durationSeconds: number): number | null {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return Math.min(100, Math.max(0, (positionSeconds / durationSeconds) * 100));
}

export function completedEpisodeUnits(episodeNumber: number, completed: boolean): number {
  if (!Number.isFinite(episodeNumber)) return 0;
  return Math.max(0, completed ? episodeNumber : episodeNumber - 1);
}
