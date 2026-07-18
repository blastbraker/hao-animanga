import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";

process.env.NODE_ENV = "test";
const app = buildApp();
const user = "00000000-0000-0000-0000-000000000001";
const admin = "00000000-0000-0000-0000-000000000099";
process.env.DEV_ADMIN_USER_ID = admin;

afterAll(() => app.close());

describe("API", () => {
  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ok");
  });
  it("returns seeded discovery", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/discover" });
    expect(response.json().featured).toHaveLength(4);
  });
  it("isolates library by user", async () => {
    const created = await app.inject({
      method: "PUT",
      url: "/v1/library",
      headers: { "x-user-id": user },
      payload: {
        workId: "10000000-0000-4000-8000-000000000001",
        status: "WATCHING_READING"
      }
    });
    expect(created.statusCode).toBe(200);
    const other = await app.inject({
      method: "GET",
      url: "/v1/library",
      headers: { "x-user-id": "00000000-0000-0000-0000-000000000002" }
    });
    expect(other.json().items).toHaveLength(0);
  });
  it("imports a selected extension title as a stable work", async () => {
    const payload = {
      kind: "MANGA",
      sourceId: "mangadex-en",
      externalId: "42",
      title: "Fixture Manga",
      synopsis: "A selected extension title",
      coverUrl: "https://bridge.example/v1/manga/42/thumbnail",
      status: "ONGOING",
      genres: ["Action"]
    };
    const first = await app.inject({ method: "POST", url: "/v1/works/import-extension", headers: { "x-user-id": user }, payload });
    const second = await app.inject({ method: "POST", url: "/v1/works/import-extension", headers: { "x-user-id": user }, payload });
    expect(first.statusCode).toBe(200);
    expect(first.json().work.id).toBe(second.json().work.id);
    expect(first.json().work.source.kind).toBe("MIHON_EXTENSION");
  });
  it("creates custom lists and records source reports", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/lists", headers: { "x-user-id": user }, payload: { name: "Weekend queue" } });
    expect(created.statusCode).toBe(201);
    const listId = created.json().id as string;
    const updated = await app.inject({ method: "PUT", url: `/v1/lists/${listId}/items/10000000-0000-4000-8000-000000000001`, headers: { "x-user-id": user }, payload: { included: true } });
    expect(updated.statusCode).toBe(200);
    const lists = await app.inject({ method: "GET", url: "/v1/lists", headers: { "x-user-id": user } });
    expect(lists.json().items[0].workIds).toContain("10000000-0000-4000-8000-000000000001");
    const report = await app.inject({ method: "POST", url: "/v1/source-reports", headers: { "x-user-id": user }, payload: { medium: "anime", sourceId: "fixture", sourceName: "Fixture", title: "Test title", detail: "No stream" } });
    expect(report.statusCode).toBe(201);
  });
  it("creates an email-and-password beta login", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/admin/invitations", headers: { "x-user-id": admin }, payload: { email: "password-tester@example.com" } });
    expect(response.statusCode).toBe(201);
    expect(response.json().email).toBe("password-tester@example.com");
    expect(response.json().temporaryPassword).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{20,}$/);
    expect(response.json().inviteUrl).toBeUndefined();
  });
  it("rejects development identity headers in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/library",
        headers: { "x-user-id": user }
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().message).toBe("Sign in required");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
  it("pairs a Bridge once and persists an acknowledged extension repository", async () => {
    const pairing = await app.inject({
      method: "POST",
      url: "/v1/bridges/pairing-code",
      headers: { "x-user-id": user }
    });
    const code = pairing.json().code as string;
    const completed = await app.inject({
      method: "POST",
      url: "/v1/bridges/complete",
      headers: { "x-user-id": user },
      payload: {
        code,
        deviceId: "20000000-0000-4000-8000-000000000001",
        publicKey: "A".repeat(64),
        name: "Test Bridge",
        endpoint: "http://127.0.0.1:4568"
      }
    });
    expect(completed.statusCode).toBe(201);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/bridges/complete",
      headers: { "x-user-id": user },
      payload: {
        code,
        deviceId: "20000000-0000-4000-8000-000000000001",
        publicKey: "A".repeat(64),
        name: "Test Bridge",
        endpoint: "http://127.0.0.1:4568"
      }
    });
    expect(replay.statusCode).toBe(400);
    const saved = await app.inject({
      method: "POST",
      url: "/v1/repositories",
      headers: { "x-user-id": user },
      payload: {
        bridgeId: "20000000-0000-4000-8000-000000000001",
        mediaKind: "ANIME",
        url: "https://example.com/anime/index.min.json",
        name: "Fixture anime repository",
        acknowledged: true
      }
    });
    expect(saved.statusCode).toBe(201);
    const repositories = await app.inject({
      method: "GET",
      url: "/v1/repositories",
      headers: { "x-user-id": user }
    });
    expect(repositories.json().items).toHaveLength(1);
  });

  it("gives a member shared Bridge access without administrator privileges", async () => {
    const pairing = await app.inject({
      method: "POST",
      url: "/v1/bridges/pairing-code",
      headers: { "x-user-id": admin }
    });
    const code = pairing.json().code as string;
    const bridgeId = "20000000-0000-4000-8000-000000000099";
    const completed = await app.inject({
      method: "POST",
      url: "/v1/bridges/complete",
      headers: { "x-user-id": admin },
      payload: {
        code,
        deviceId: bridgeId,
        publicKey: "B".repeat(64),
        name: "Managed Beta Bridge",
        endpoint: "https://1.1.1.1"
      }
    });
    expect(completed.statusCode).toBe(201);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          paired: true,
          managementProtected: true
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    try {
      const shared = await app.inject({
        method: "POST",
        url: "/v1/admin/shared-bridge",
        headers: { "x-user-id": admin },
        payload: { bridgeId }
      });
      expect(shared.statusCode).toBe(200);
      const visible = await app.inject({
        method: "GET",
        url: "/v1/bridges",
        headers: { "x-user-id": user }
      });
      expect(visible.json().items).toContainEqual(
        expect.objectContaining({
          id: bridgeId,
          scope: "beta",
          sharedBeta: true
        })
      );

      const memberSession = await app.inject({
        method: "GET",
        url: "/v1/session",
        headers: { "x-user-id": user }
      });
      expect(memberSession.statusCode).toBe(200);
      expect(memberSession.json()).toEqual(
        expect.objectContaining({
          inviteOnly: true,
          user: expect.objectContaining({ id: user, role: "member" })
        })
      );

      const memberAdminOverview = await app.inject({
        method: "GET",
        url: "/v1/admin/overview",
        headers: { "x-user-id": user }
      });
      expect(memberAdminOverview.statusCode).toBe(403);

      const overview = await app.inject({
        method: "GET",
        url: "/v1/admin/overview",
        headers: { "x-user-id": admin }
      });
      expect(overview.statusCode).toBe(200);
      expect(overview.json().bridges).toContainEqual(
        expect.objectContaining({
          id: bridgeId,
          scope: "personal",
          sharedBeta: true
        })
      );

      const forbidden = await app.inject({
        method: "POST",
        url: "/v1/admin/shared-bridge",
        headers: { "x-user-id": user },
        payload: { bridgeId: null }
      });
      expect(forbidden.statusCode).toBe(403);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
