import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";

process.env.NODE_ENV = "test";
const app = buildApp();
const user = "00000000-0000-0000-0000-000000000001";

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
    const created = await app.inject({ method: "PUT", url: "/v1/library", headers: { "x-user-id": user }, payload: { workId: "10000000-0000-4000-8000-000000000001", status: "WATCHING_READING" } });
    expect(created.statusCode).toBe(200);
    const other = await app.inject({ method: "GET", url: "/v1/library", headers: { "x-user-id": "00000000-0000-0000-0000-000000000002" } });
    expect(other.json().items).toHaveLength(0);
  });
  it("pairs a Bridge once and persists an acknowledged extension repository", async () => {
    const pairing = await app.inject({ method: "POST", url: "/v1/bridges/pairing-code", headers: { "x-user-id": user } });
    const code = pairing.json().code as string;
    const completed = await app.inject({ method: "POST", url: "/v1/bridges/complete", headers: { "x-user-id": user }, payload: {
      code,
      deviceId: "20000000-0000-4000-8000-000000000001",
      publicKey: "A".repeat(64),
      name: "Test Bridge",
      endpoint: "http://127.0.0.1:4568",
    } });
    expect(completed.statusCode).toBe(201);
    const replay = await app.inject({ method: "POST", url: "/v1/bridges/complete", headers: { "x-user-id": user }, payload: {
      code,
      deviceId: "20000000-0000-4000-8000-000000000001",
      publicKey: "A".repeat(64),
      name: "Test Bridge",
      endpoint: "http://127.0.0.1:4568",
    } });
    expect(replay.statusCode).toBe(400);
    const saved = await app.inject({ method: "POST", url: "/v1/repositories", headers: { "x-user-id": user }, payload: {
      bridgeId: "20000000-0000-4000-8000-000000000001",
      mediaKind: "ANIME",
      url: "https://example.com/anime/index.min.json",
      name: "Fixture anime repository",
      acknowledged: true,
    } });
    expect(saved.statusCode).toBe(201);
    const repositories = await app.inject({ method: "GET", url: "/v1/repositories", headers: { "x-user-id": user } });
    expect(repositories.json().items).toHaveLength(1);
  });
});
