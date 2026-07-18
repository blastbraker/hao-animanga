export type PlaybackCandidate =
  | { kind: "stream"; id: string }
  | { kind: "server"; id: string }
  | null;

export function nextPlaybackCandidate(
  streams: Array<{ id: string }>,
  streamId: string,
  servers: Array<{ id: string }>,
  serverId: string,
): PlaybackCandidate {
  const streamIndex = streams.findIndex((item) => item.id === streamId);
  if (streamIndex >= 0 && streamIndex < streams.length - 1) return { kind: "stream", id: streams[streamIndex + 1]!.id };
  const serverIndex = servers.findIndex((item) => item.id === serverId);
  if (serverIndex >= 0 && serverIndex < servers.length - 1) return { kind: "server", id: servers[serverIndex + 1]!.id };
  return null;
}
