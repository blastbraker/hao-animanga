export type EpisodeBrowserItem = {
  id: string;
  number: number;
  title: string;
};

export type EpisodeOrder = "asc" | "desc";

export function browseEpisodes<T extends EpisodeBrowserItem>(episodes: T[], query: string, order: EpisodeOrder): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? episodes.filter((episode) => `${episode.number} ${episode.title}`.toLocaleLowerCase().includes(normalizedQuery))
    : episodes;
  return [...filtered].sort((left, right) => {
    const numberOrder = left.number - right.number;
    const result = numberOrder || left.title.localeCompare(right.title);
    return order === "asc" ? result : -result;
  });
}
