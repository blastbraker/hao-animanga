const OWNER = "hao:account-owner:v1";
const ARCHIVE = "hao:account-cache:v1:";
const isPrivateHint = (key: string) => key.startsWith("hao:") && key !== OWNER &&
  !key.startsWith(ARCHIVE) && !key.startsWith("hao:session-role:") && key !== "hao:sidebar-collapsed";

/** Keep existing offline hints, but never show one account's hints to another. */
export function switchAccountCache(userId: string | null, storage: Storage): void {
  const owner = storage.getItem(OWNER);
  if (owner === userId) return;
  if (!owner && userId) { storage.setItem(OWNER, userId); return; } // Adopt pre-upgrade hints for the current member.
  const active: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && isPrivateHint(key)) active[key] = storage.getItem(key)!;
  }
  if (owner) storage.setItem(`${ARCHIVE}${owner}`, JSON.stringify(active));
  for (const key of Object.keys(active)) storage.removeItem(key);
  const restored = userId ? JSON.parse(storage.getItem(`${ARCHIVE}${userId}`) ?? "{}") as Record<string, unknown> : {};
  for (const [key, value] of Object.entries(restored)) if (isPrivateHint(key) && typeof value === "string") storage.setItem(key, value);
  // Preserve an explicit signed-out owner so a new account cannot adopt old hints.
  storage.setItem(OWNER, userId ?? "signed-out");
}
