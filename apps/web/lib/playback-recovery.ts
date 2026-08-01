export type PlaybackCandidate =
  | { kind: "stream"; id: string }
  | { kind: "server"; id: string }
  | null;

export function nextPlaybackCandidate(
  streams: Array<{ id: string }>,
  streamId: string,
  servers: Array<{ id: string }>,
  serverId: string,
  failedStreamIds?: ReadonlySet<string>,
  eligibleStreamIds?: ReadonlySet<string>,
): PlaybackCandidate {
  const eligibleStreams = eligibleStreamIds
    ? streams.filter((item) => eligibleStreamIds.has(item.id))
    : streams;
  if (failedStreamIds) {
    const untriedStream = eligibleStreams.find((item) => item.id !== streamId && !failedStreamIds.has(item.id));
    if (untriedStream) return { kind: "stream", id: untriedStream.id };
  }
  const streamIndex = eligibleStreams.findIndex((item) => item.id === streamId);
  if (!failedStreamIds && streamIndex >= 0 && streamIndex < eligibleStreams.length - 1) return { kind: "stream", id: eligibleStreams[streamIndex + 1]!.id };
  const serverIndex = servers.findIndex((item) => item.id === serverId);
  if (serverIndex >= 0 && serverIndex < servers.length - 1) return { kind: "server", id: servers[serverIndex + 1]!.id };
  return null;
}

export function prioritizePlaybackItems<T extends { id: string }>(items: T[], preferredId: string): T[] {
  const preferred = items.find((item) => item.id === preferredId);
  return preferred ? [preferred, ...items.filter((item) => item.id !== preferredId)] : [...items];
}

export function playbackRecoveryPosition(
  pending: { episodeNumber: number; positionSeconds: number } | null,
  episodeNumber: number,
  durationSeconds: number,
): number | null {
  if (!pending || Math.abs(pending.episodeNumber - episodeNumber) > 0.001 || !Number.isFinite(pending.positionSeconds) || pending.positionSeconds <= 0) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return pending.positionSeconds;
  return Math.min(pending.positionSeconds, Math.max(0, durationSeconds - 0.25));
}
