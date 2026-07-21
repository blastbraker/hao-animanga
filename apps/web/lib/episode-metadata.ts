export type EpisodeGuideMetadata = {
  number: number;
  title: string;
  filler: boolean;
  recap: boolean;
  airedAt: string | null;
};

export type EnrichedEpisode<T> = T & {
  arc?: string;
  filler?: boolean;
  recap?: boolean;
  airedAt?: string | null;
};

export function enrichEpisodes<T extends { id: string; number: number; title: string }>(episodes: T[], guide: EpisodeGuideMetadata[]): Array<EnrichedEpisode<T>> {
  const guideByNumber = new Map(guide.map((item) => [item.number, item]));
  const enriched = new Map<string, EnrichedEpisode<T>>();
  let currentArc = "";
  for (const episode of [...episodes].sort((left, right) => left.number - right.number)) {
    const annotations = sourceAnnotations(episode.title);
    if (annotations.arc) currentArc = annotations.arc;
    const metadata = Number.isInteger(episode.number) ? guideByNumber.get(episode.number) : undefined;
    const title = shouldUseGuideTitle(episode.title, episode.number) && metadata?.title ? metadata.title : annotations.cleanTitle;
    enriched.set(episode.id, {
      ...episode,
      title,
      ...(currentArc ? { arc: currentArc } : {}),
      ...(annotations.filler || metadata?.filler ? { filler: true } : {}),
      ...(annotations.recap || metadata?.recap ? { recap: true } : {}),
      ...(metadata?.airedAt ? { airedAt: metadata.airedAt } : {}),
    });
  }
  return episodes.map((episode) => enriched.get(episode.id) ?? episode);
}

export function episodeGroupLabel(episode: { number: number; arc?: string }, maximumEpisode: number): { kind: "arc" | "range"; label: string } | null {
  if (episode.arc) return { kind: "arc", label: episode.arc };
  if (maximumEpisode <= 24 || !Number.isFinite(episode.number)) return null;
  const start = Math.floor(Math.max(0, episode.number - 1) / 25) * 25 + 1;
  return { kind: "range", label: `Episodes ${start}–${Math.min(maximumEpisode, start + 24)}` };
}

function sourceAnnotations(title: string): { arc: string; filler: boolean; recap: boolean; cleanTitle: string } {
  const arc = title.match(/\[(?:story\s+)?arc\s*:\s*([^\]]+)\]/i)?.[1]?.trim() ?? "";
  const filler = /\[(?:anime\s+)?filler\]|\((?:anime\s+)?filler\)/i.test(title);
  const recap = /\[recap\]|\(recap\)/i.test(title);
  const cleanTitle = title
    .replace(/\[(?:story\s+)?arc\s*:\s*[^\]]+\]/gi, "")
    .replace(/\[(?:anime\s+)?filler\]|\((?:anime\s+)?filler\)|\[recap\]|\(recap\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { arc, filler, recap, cleanTitle };
}

function shouldUseGuideTitle(title: string, number: number): boolean {
  const normalized = title.trim();
  if (!normalized) return true;
  const escapedNumber = String(number).replace(".", "\\.");
  return new RegExp(`^(?:episode|ep\\.?|e)?\\s*0*${escapedNumber}(?:\\.0+)?\\s*(?:\\((?:sub|dub|raw)\\)|\\[(?:sub|dub|raw)])?$`, "i").test(normalized);
}
