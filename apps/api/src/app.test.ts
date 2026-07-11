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
});
