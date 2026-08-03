import type { MaturityLevel, ProfilePreferences, Work } from "@hao/domain";

export const PROFILE_CACHE_KEY = "hao:profile-preferences-v1";
const order: Record<MaturityLevel, number> = { GENERAL: 0, TEEN: 1, MATURE: 2, ADULT: 3 };

export function workMaturity(work: Pick<Work, "maturityRating" | "genres">): MaturityLevel | null {
  const value = work.maturityRating?.toUpperCase().replace(/[^A-Z0-9]+/g, "_") ?? "";
  if (work.genres.some((genre) => ["HENTAI", "ECCHI"].includes(genre.toUpperCase())) || /ADULT|HENTAI|18|RX/.test(value)) return "ADULT";
  if (/MATURE|R\+|R_17|TV_MA/.test(value)) return "MATURE";
  if (/TEEN|PG_?13|PG13/.test(value)) return "TEEN";
  if (/GENERAL|G|PG|EVERYONE/.test(value)) return "GENERAL";
  return null;
}

export function isWorkAllowed(work: Pick<Work, "maturityRating" | "genres">, preferences: Pick<ProfilePreferences, "maturityCeiling" | "hideUnrated">): boolean {
  const maturity = workMaturity(work);
  if (!maturity) return !preferences.hideUnrated;
  return order[maturity] <= order[preferences.maturityCeiling];
}

export function cacheProfilePreferences(preferences: ProfilePreferences) {
  window.localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(preferences));
}

export function cachedProfilePreferences(): ProfilePreferences | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) as ProfilePreferences : null;
  } catch {
    return null;
  }
}

