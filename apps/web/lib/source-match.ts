import { normalizeTitle, type Work } from "@hao/domain";

export function confidentSourceMatch<T extends { title: string }>(work: Pick<Work, "title" | "alternateTitles">, items: T[]): T | null {
  const titles = [work.title, ...work.alternateTitles].map(normalizeTitle).filter(Boolean);
  const ranked = items.map((item) => ({ item, score: matchScore(titles, normalizeTitle(item.title)) })).sort((left, right) => right.score - left.score);
  return ranked[0] && ranked[0].score >= .84 ? ranked[0].item : null;
}

export function sourceFallbackOrder<T extends { id: string }>(sources: T[], preferredSourceId: string): T[] {
  const preferred = sources.find((source) => source.id === preferredSourceId);
  return preferred ? [preferred, ...sources.filter((source) => source.id !== preferredSourceId)] : [...sources];
}

function matchScore(targets: string[], candidate: string): number {
  const targetSeasons = targets.map(seasonNumber).filter((value): value is number => value !== null);
  const candidateSeason = seasonNumber(candidate);
  const explicitTargetSequel = targetSeasons.find((value) => value > 1);
  if (explicitTargetSequel && candidateSeason !== explicitTargetSequel) return 0;
  if (!explicitTargetSequel && candidateSeason && candidateSeason > 1) return 0;
  if (targets.includes(candidate)) return 1;
  if (targets.some((target) => target.length >= 10 && (target.includes(candidate) || candidate.includes(target)))) return .9;
  const candidateTokens = new Set(candidate.split(" ").filter((token) => token.length > 1));
  return Math.max(0, ...targets.map((target) => {
    const targetTokens = new Set(target.split(" ").filter((token) => token.length > 1));
    const intersection = [...targetTokens].filter((token) => candidateTokens.has(token)).length;
    const union = new Set([...targetTokens, ...candidateTokens]).size;
    return union ? intersection / union : 0;
  }));
}

function seasonNumber(title: string): number | null {
  const numeric = title.match(/(?:season|part|s)\s*(\d{1,2})(?:\b|$)/)?.[1] ?? title.match(/\b(\d{1,2})(?:nd|rd|th)\s+season\b/)?.[1];
  if (numeric) return Number(numeric);
  const roman = title.match(/\b(?:season|part)\s+(ii|iii|iv|v)\b/)?.[1] ?? title.match(/\b(ii|iii|iv|v)\s*$/)?.[1];
  return roman ? ({ ii: 2, iii: 3, iv: 4, v: 5 } as const)[roman as "ii" | "iii" | "iv" | "v"] : null;
}
