export type EpisodeLike = { number: number; title: string };

export function episodeNumberLabel(number: number): string {
  return Number.isInteger(number) ? String(number) : String(number).replace(/\.0+$/, "");
}

export function episodeDisplayName(episode: EpisodeLike): string {
  const number = episodeNumberLabel(episode.number);
  const sourceTitle = episode.title.trim();
  if (!sourceTitle) return `Episode ${number}`;

  const withoutPrefix = sourceTitle.replace(
    new RegExp(`^(?:episode|ep\\.?|e)\\s*0*${escapeRegExp(number)}(?:\\.0+)?(?:\\s*[-:|]\\s*|\\s+)`, "i"),
    "",
  ).trim();
  const candidate = withoutPrefix || sourceTitle;
  const metadataOnly = /^(?:episode|ep\.?)?\s*0*[\d.]+\s*(?:\((?:sub|dub|raw)\)|\[(?:sub|dub|raw)])?$/i.test(candidate)
    || /^(?:\((?:sub|dub|raw)\)|\[(?:sub|dub|raw)])$/i.test(candidate);
  return metadataOnly ? `Episode ${number}` : candidate;
}

export function episodeDisplayLabel(episode: EpisodeLike): string {
  const numberLabel = `Episode ${episodeNumberLabel(episode.number)}`;
  const name = episodeDisplayName(episode);
  return name === numberLabel ? numberLabel : `${name} · ${numberLabel}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
