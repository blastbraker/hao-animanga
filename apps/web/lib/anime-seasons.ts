import type { Work } from "@hao/domain";

export function seasonHref(work: Work): string {
  const parameters = work.source.kind === "ANILIST" ? `?anilistId=${encodeURIComponent(work.source.externalId)}` : "";
  return `/title/${work.id}${parameters}`;
}

export function seasonOptionLabel(work: Work, index: number): string {
  const detected = work.title.match(/\bseason\s*(\d+)\b/i)?.[1]
    ?? work.title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i)?.[1];
  const season = detected ? `Season ${detected}` : `Season ${index + 1}`;
  return `${season} · ${work.title}${work.year ? ` (${work.year})` : ""}`;
}
