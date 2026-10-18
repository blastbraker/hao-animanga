import { describe, expect, it, vi } from "vitest";
import { SessionVerification, type VerifiedSession } from "./session-verification";

const user = { id: "alice", app_metadata: {} };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("session verification without player remounts", () => {
  it("keeps a verified role during same-account SIGNED_IN/token refresh checks", async () => {
    const states: VerifiedSession<typeof user>[] = [];
    const check = vi.fn().mockResolvedValue("member");
    const verifier = new SessionVerification(check, (state) => states.push(state));
    await verifier.begin(user)();
    states.length = 0;
    await verifier.begin({ ...user })();
    expect(states.map((state) => state.role)).toEqual(["member", "member"]);
    expect(check).toHaveBeenCalledTimes(2); // Access is still revalidated.
  });

  it("does not run async auth inside begin/the auth callback", async () => {
    const check = vi.fn().mockResolvedValue("admin");
    const verifier = new SessionVerification(check, vi.fn());
    const verify = verifier.begin(user);
    expect(check).not.toHaveBeenCalled();
    await verify();
    expect(check).toHaveBeenCalledOnce();
  });

  it("blocks account changes and ignores the old account's in-flight result", async () => {
    const old = deferred<"admin">();
    const publish = vi.fn();
    const verifier = new SessionVerification(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue("member"), publish);
    const first = verifier.begin(user)();
    const second = verifier.begin({ id: "bob", app_metadata: {} });
    expect(publish).toHaveBeenLastCalledWith({ user: { id: "bob", app_metadata: {} }, role: undefined, error: "" });
    await second(); old.resolve("admin"); await first;
    expect(publish.mock.lastCall?.[0].role).toBe("member");
    expect(publish.mock.lastCall?.[0].user.id).toBe("bob");
  });

  it("signs out immediately even when a role request is still in flight", async () => {
    const pending = deferred<"admin">();
    const publish = vi.fn();
    const verifier = new SessionVerification(() => pending.promise, publish);
    const first = verifier.begin(user)();
    await verifier.begin(null)(); pending.resolve("admin"); await first;
    expect(publish).toHaveBeenLastCalledWith({ user: null, role: null, error: "" });
  });

  it("preserves playback on transient refresh failure, but removes revoked access", async () => {
    const load = vi.fn().mockResolvedValueOnce("member").mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(Object.assign(new Error("Access revoked"), { status: 403 }));
    const publish = vi.fn();
    const verifier = new SessionVerification(load, publish);
    await verifier.begin(user)();
    await verifier.begin(user)();
    expect(publish.mock.lastCall?.[0].role).toBe("member");
    await verifier.begin(user)();
    expect(publish.mock.lastCall?.[0]).toMatchObject({ role: null, error: "Access revoked" });
  });

  it("never opens an unverified account when its first request fails", async () => {
    const publish = vi.fn();
    const verifier = new SessionVerification(vi.fn().mockRejectedValue(new Error("offline")), publish);
    await verifier.begin(user)();
    expect(publish.mock.lastCall?.[0]).toMatchObject({ role: null, error: "offline" });
  });

  it("removes access for password setup and ignores responses after disposal", async () => {
    const publish = vi.fn();
    const load = vi.fn().mockResolvedValue("admin");
    const verifier = new SessionVerification(load, publish);
    await verifier.begin(user)();
    await verifier.begin({ ...user, app_metadata: { must_change_password: true } })();
    expect(publish.mock.lastCall?.[0].role).toBeNull();
    const verify = verifier.begin(user); verifier.dispose(); const count = publish.mock.calls.length;
    await verify();
    expect(publish).toHaveBeenCalledTimes(count);
    expect(load).toHaveBeenCalledOnce();
  });
});
