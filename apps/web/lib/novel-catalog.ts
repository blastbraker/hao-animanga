export type BlendedNovelItem<TAniList, TSource> =
  { kind: "anilist"; item: TAniList } | { kind: "source"; item: TSource };

export function blendNovelRankings<TAniList, TSource>(
  anilist: readonly TAniList[],
  source: readonly TSource[],
  groupSize = 3,
): BlendedNovelItem<TAniList, TSource>[] {
  if (!Number.isInteger(groupSize) || groupSize < 1) {
    throw new Error("Novel ranking group size must be a positive integer");
  }

  const blended: BlendedNovelItem<TAniList, TSource>[] = [];
  const length = Math.max(anilist.length, source.length);

  for (let offset = 0; offset < length; offset += groupSize) {
    anilist.slice(offset, offset + groupSize).forEach((item) => {
      blended.push({ kind: "anilist", item });
    });
    source.slice(offset, offset + groupSize).forEach((item) => {
      blended.push({ kind: "source", item });
    });
  }

  return blended;
}

export function novelSourceSearchQueries(work: {
  title: string;
  alternateTitles: readonly string[];
}): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const query = value.trim().replace(/\s+/g, " ");
    const key = normalizeTitle(query);
    if (query.length >= 3 && key && !seen.has(key)) {
      seen.add(key);
      queries.push(query);
    }
  };

  for (const title of [work.title, ...work.alternateTitles]) {
    add(title);
    const colon = title.indexOf(":");
    if (colon > 0) {
      add(title.slice(0, colon));
      add(title.slice(colon + 1));
    }
    add(title.replace(/\s*\([^)]{1,24}\)\s*$/, ""));
  }

  return queries;
}

export function confidentNovelSourceMatch<T extends { title: string }>(
  work: { title: string; alternateTitles: readonly string[] },
  items: readonly T[],
): T | null {
  const targetSignatures = new Set(
    [work.title, ...work.alternateTitles].flatMap(titleSignatures),
  );
  return (
    items.find((item) =>
      titleSignatures(item.title).some((signature) =>
        targetSignatures.has(signature),
      ),
    ) ?? null
  );
}

function titleSignatures(title: string): string[] {
  const normalized = normalizeTitle(title);
  const tokens = normalized.split(" ").filter(Boolean);
  return normalized ? [normalized, [...tokens].sort().join(" ")] : [];
}
import { normalizeTitle } from "@hao/domain";
