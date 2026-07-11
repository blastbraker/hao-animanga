import type { LibraryEntry, Progress, Work } from "@hao/domain";

export const demoWorks: Work[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    kind: "ANIME",
    title: "Violet Evergarden",
    alternateTitles: ["Violet Evergarden"],
    synopsis: "A former child soldier learns the meaning of the words left to her by someone dear.",
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21827-ubzq619ZA2E9.png",
    bannerUrl: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/21827-3EwjBS6ebj1C.jpg",
    year: 2018,
    status: "FINISHED",
    genres: ["Drama", "Fantasy", "Slice of Life"],
    maturityRating: "PG-13",
    averageScore: 85,
    source: { kind: "ANILIST", externalId: "21827" },
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    kind: "MANGA",
    title: "Witch Hat Atelier",
    alternateTitles: ["Tongari Boushi no Atelier"],
    synopsis: "Coco discovers that magic is drawn, not inherited, and enters a wondrous atelier.",
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx98263-3HNZP3X2FwYA.jpg",
    bannerUrl: null,
    year: 2016,
    status: "RELEASING",
    genres: ["Adventure", "Drama", "Fantasy"],
    maturityRating: "TEEN",
    averageScore: 84,
    source: { kind: "ANILIST", externalId: "98263" },
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    kind: "MANHWA",
    title: "Omniscient Reader",
    alternateTitles: ["Omniscient Reader's Viewpoint"],
    synopsis: "A lone reader realizes the web novel he followed has become reality.",
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx119257-hV2Y7bIDpLUr.jpg",
    bannerUrl: null,
    year: 2020,
    status: "RELEASING",
    genres: ["Action", "Adventure", "Fantasy"],
    maturityRating: "TEEN",
    averageScore: 83,
    source: { kind: "ANILIST", externalId: "119257" },
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    kind: "LIGHT_NOVEL",
    title: "Spice and Wolf",
    alternateTitles: ["Ookami to Koushinryou"],
    synopsis: "A traveling merchant and a harvest goddess journey toward her northern homeland.",
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx39196-rQTAeJz0FM1R.jpg",
    bannerUrl: null,
    year: 2006,
    status: "FINISHED",
    genres: ["Adventure", "Fantasy", "Romance"],
    maturityRating: "TEEN",
    averageScore: 83,
    source: { kind: "ANILIST", externalId: "39196" },
  },
];

export const workStore = new Map(demoWorks.map((work) => [work.id, work]));
export const libraryStore = new Map<string, LibraryEntry>();
export const progressStore = new Map<string, Progress>();

export const keyFor = (userId: string, workId: string) => `${userId}:${workId}`;
