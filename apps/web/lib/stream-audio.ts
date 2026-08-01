export type AudioMode = "sub" | "dub";

type StreamLike = {
  id: string;
  quality?: string;
  audio?: string;
  subtitles?: unknown[];
};

export function streamAudioMode(stream: StreamLike): AudioMode | null {
  const label = `${stream.quality ?? ""} ${stream.audio ?? ""}`;
  if (/\b(?:dub|dubbed)\b/i.test(label)) return "dub";
  if (/\b(?:sub|subbed|hsub)\b/i.test(label)) return "sub";
  if (/\b(?:english|eng)\b/i.test(stream.audio ?? "")) return "dub";
  if (stream.subtitles?.length) return "sub";
  return null;
}

export function pickAudioVariant<T extends StreamLike>(streams: T[], current: T | undefined, target: AudioMode): T | undefined {
  const candidates = streams.filter((stream) => streamAudioMode(stream) === target);
  if (!candidates.length) return undefined;
  if (!current) return candidates[0];

  const currentResolution = resolution(current.quality);
  const currentServer = serverLabel(current.quality);
  return [...candidates].sort((left, right) => score(right) - score(left))[0];

  function score(candidate: T) {
    return Number(Boolean(currentResolution) && resolution(candidate.quality) === currentResolution) * 4
      + Number(Boolean(currentServer) && serverLabel(candidate.quality) === currentServer) * 2;
  }
}

export function compatibleAudioStreams<T extends StreamLike>(streams: T[], target: AudioMode): T[] {
  const exactMatches = streams.filter((stream) => streamAudioMode(stream) === target);
  if (exactMatches.length) return exactMatches;
  return streams.filter((stream) => streamAudioMode(stream) === null);
}

function resolution(quality?: string): string | null {
  return quality?.match(/\b(2160|1440|1080|720|480|360)p\b/i)?.[1] ?? null;
}

function serverLabel(quality?: string): string | null {
  const label = quality?.split("-")[0]?.trim().toLowerCase();
  return label || null;
}
