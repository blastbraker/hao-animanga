export type SavedPlaybackPosition = {
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
  completed: boolean;
};

export type ContinueWatchingEntry = {
  id: string;
  workId: string | null;
  sourceId: string;
  sourceName: string;
  animeId: string;
  animeTitle: string;
  thumbnailUrl: string | null;
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
};

export const CONTINUE_WATCHING_STORAGE_KEY = "hao:anime-continue:v1";
export const DISMISSED_CONTINUE_STORAGE_KEY = "hao:anime-continue-dismissed:v1";

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

export function continueWatchingId(sourceId: string, animeId: string): string {
  return `${encodeURIComponent(sourceId)}:${encodeURIComponent(animeId)}`;
}

export function parseContinueWatching(value: string | null): ContinueWatchingEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isContinueWatchingEntry).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 20);
  } catch {
    return [];
  }
}

export function updateContinueWatching(entries: ContinueWatchingEntry[], entry: ContinueWatchingEntry, completed = false): ContinueWatchingEntry[] {
  const remaining = entries.filter((item) => item.id !== entry.id);
  if (completed) return remaining;
  return [entry, ...remaining].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 20);
}

export function parseDismissedWorkIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function isContinueWatchingEntry(value: unknown): value is ContinueWatchingEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ContinueWatchingEntry>;
  return typeof item.id === "string" && typeof item.sourceId === "string" && typeof item.sourceName === "string"
    && typeof item.animeId === "string" && typeof item.animeTitle === "string" && typeof item.episodeId === "string"
    && typeof item.episodeTitle === "string" && typeof item.episodeNumber === "number" && Number.isFinite(item.episodeNumber)
    && typeof item.positionSeconds === "number" && Number.isFinite(item.positionSeconds) && item.positionSeconds >= 0
    && typeof item.durationSeconds === "number" && Number.isFinite(item.durationSeconds) && item.durationSeconds >= 0
    && typeof item.updatedAt === "string" && (item.workId === null || typeof item.workId === "string")
    && (item.thumbnailUrl === null || typeof item.thumbnailUrl === "string");
}
