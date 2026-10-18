export type SessionRole = "member" | "admin";
type SessionUser = { id: string; app_metadata?: Record<string, unknown> };
export type VerifiedSession<T> = { user: T | null; role: SessionRole | null | undefined; error: string };

/** Revalidate access without tearing down a verified account's active reader/player. */
export class SessionVerification<T extends SessionUser> {
  private revision = 0;
  private disposed = false;
  private state: VerifiedSession<T> = { user: null, role: null, error: "" };

  constructor(
    private readonly loadRole: (user: T) => Promise<SessionRole>,
    private readonly publish: (state: VerifiedSession<T>) => void,
  ) {}

  // Split publishing from fetching: Supabase auth callbacks must not await other auth calls.
  begin(user: T | null): () => Promise<void> {
    const revision = ++this.revision;
    const allowed = user && user.app_metadata?.must_change_password !== true;
    const retainedRole = allowed && this.state.user?.id === user.id ? this.state.role : undefined;
    this.state = { user, role: allowed ? retainedRole ?? undefined : null, error: "" };
    if (!this.disposed) this.publish(this.state);
    return async () => {
      if (!allowed || this.disposed || revision !== this.revision) return;
      try {
        const role = await this.loadRole(user);
        if (this.disposed || revision !== this.revision) return;
        this.state = { user, role, error: "" };
      } catch (cause) {
        if (this.disposed || revision !== this.revision) return;
        const status = (cause as { status?: number } | null)?.status;
        // A temporary network failure must not restart playback. Explicit access
        // denial still removes the protected page, including during token refresh.
        if (retainedRole && status !== 401 && status !== 403) return;
        this.state = { user, role: null, error: cause instanceof Error ? cause.message : "Your session could not be verified." };
      }
      this.publish(this.state);
    };
  }

  dispose() { this.disposed = true; this.revision += 1; }
}
