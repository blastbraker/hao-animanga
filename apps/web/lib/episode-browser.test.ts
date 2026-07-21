import { describe, expect, it } from "vitest";
import { browseEpisodes } from "./episode-browser";

const episodes = [
  { id: "3", number: 3, title: "I Can't Go Back" },
  { id: "1", number: 1, title: "A Goodbye Kiss" },
  { id: "2", number: 2, title: "The Black Water" },
];

describe("episode browser", () => {
  it("sorts episode numbers in either direction", () => {
    expect(browseEpisodes(episodes, "", "asc").map((episode) => episode.number)).toEqual([1, 2, 3]);
    expect(browseEpisodes(episodes, "", "desc").map((episode) => episode.number)).toEqual([3, 2, 1]);
  });

  it("filters by episode number or title", () => {
    expect(browseEpisodes(episodes, "black", "asc").map((episode) => episode.id)).toEqual(["2"]);
    expect(browseEpisodes(episodes, "3", "asc").map((episode) => episode.id)).toEqual(["3"]);
  });
});
