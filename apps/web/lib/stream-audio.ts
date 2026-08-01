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

export function selectAudioStreams<T extends StreamLike>(streams: T[], preferred: AudioMode | null, allowOpposite = false) {
  if (!preferred) return { candidates: streams, selectedMode: null, usedFallback: false };

  const compatible = compatibleAudioStreams(streams, preferred);
  if (compatible.length) return { candidates: compatible, selectedMode: preferred, usedFallback: false };
  if (!allowOpposite) return { candidates: [] as T[], selectedMode: null, usedFallback: false };

  const opposite: AudioMode = preferred === "dub" ? "sub" : "dub";
  const oppositeStreams = streams.filter((stream) => streamAudioMode(stream) === opposite);
  return {
    candidates: oppositeStreams,
    selectedMode: oppositeStreams.length ? opposite : null,
    usedFallback: oppositeStreams.length > 0,
  };
}

export function streamResolution(stream: StreamLike | undefined): number | null {
  const value = stream?.quality?.match(/\b(2160|1440|1080|720|480|360)p\b/i)?.[1];
  return value ? Number(value) : null;
}

export function pickQualityUpgrade<T extends StreamLike>(
  streams: T[],
  currentStreamId: string,
  targetResolution: number,
  targetAudioMode: AudioMode | null,
): T | undefined {
  const audioCandidates = targetAudioMode ? compatibleAudioStreams(streams, targetAudioMode) : streams;
  return audioCandidates
    .filter((stream) => stream.id !== currentStreamId && (streamResolution(stream) ?? 0) >= targetResolution)
    .sort((left, right) => {
      const leftDistance = Math.abs((streamResolution(left) ?? 0) - targetResolution);
      const rightDistance = Math.abs((streamResolution(right) ?? 0) - targetResolution);
      return leftDistance - rightDistance;
    })[0];
}

function resolution(quality?: string): string | null {
  return quality?.match(/\b(2160|1440|1080|720|480|360)p\b/i)?.[1] ?? null;
}

function serverLabel(quality?: string): string | null {
  const label = quality?.split("-")[0]?.trim().toLowerCase();
  return label || null;
}
