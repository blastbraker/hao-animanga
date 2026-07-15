export const BETA_ONBOARDING_STORAGE_KEY = "hao:beta-onboarding:v1";
export const OPEN_BETA_ONBOARDING_EVENT = "hao:open-beta-onboarding";

export function hasCompletedBetaOnboarding(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(BETA_ONBOARDING_STORAGE_KEY) === "complete";
}
