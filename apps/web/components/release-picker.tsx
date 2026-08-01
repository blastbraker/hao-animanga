"use client";

import type { Work } from "@hao/domain";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { isAnimeMovie, seasonHref, seasonOptionLabel } from "../lib/anime-seasons";

export function ReleasePicker({ current, items, className = "" }: { current: Work; items: Work[]; className?: string }) {
  if (items.length < 2) return null;

  const seasons = items.filter((item) => !isAnimeMovie(item));
  const movies = items.filter(isAnimeMovie);
  const activeSeasonIndex = Math.max(0, seasons.findIndex((item) => item.id === current.id));
  const activeLabel = seasonOptionLabel(current, activeSeasonIndex);

  return (
    <div className={`season-switcher ${className}`.trim()}>
      <span>Release</span>
      <details className="season-dropdown">
        <summary aria-label={`Choose a season or movie for ${current.title}`}>
          <span>{activeLabel}</span>
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="season-dropdown-menu" role="listbox" aria-label={`Seasons and movies for ${current.title}`}>
          {seasons.length > 0 && <span className="season-dropdown-group">Seasons</span>}
          {seasons.map((item, index) => <ReleaseOption key={item.id} item={item} current={current} index={index} />)}
          {movies.length > 0 && <span className="season-dropdown-group movie-group">Movies</span>}
          {movies.map((item) => <ReleaseOption key={item.id} item={item} current={current} index={0} />)}
        </div>
      </details>
    </div>
  );
}

function ReleaseOption({ item, current, index }: { item: Work; current: Work; index: number }) {
  const active = item.id === current.id;
  return (
    <Link
      href={seasonHref(item)}
      className={`season-dropdown-option ${active ? "active" : ""}`}
      role="option"
      aria-selected={active}
    >
      <span>{seasonOptionLabel(item, index)}</span>
      {active && <small>Current</small>}
    </Link>
  );
}
