import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { HaoRepository } from "@hao/database";

declare module "fastify" {
  interface FastifyRequest { user: { id: string; role: "member" | "admin"; email?: string } }
  interface FastifyInstance { haoRepository: HaoRepository | null }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function verifySupabaseToken(token: string) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (url) {
    jwks ??= createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
    return jwtVerify(token, jwks, { issuer: `${url}/auth/v1`, audience: "authenticated" });
  }
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("Supabase JWT verification is not configured");
  return jwtVerify(token, new TextEncoder().encode(secret), { audience: "authenticated" });
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const devUser = request.headers["x-user-id"];
  if (process.env.NODE_ENV !== "production" && typeof devUser === "string") {
    request.user = { id: devUser, role: devUser === process.env.DEV_ADMIN_USER_ID ? "admin" : "member" };
    return;
  }
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    await reply.code(401).send({ code: "UNAUTHORIZED", message: "Sign in required", retryable: false });
    return;
  }
  try {
    const verified = await verifySupabaseToken(token);
    if (!verified.payload.sub) throw new Error("Missing subject");
    const profile = await request.server.haoRepository?.getProfile(verified.payload.sub);
    if (request.server.haoRepository && !profile) throw new Error("Account is not invited");
    if (profile?.suspendedAt) throw new Error("Account suspended");
    const metadata = verified.payload.app_metadata as { role?: unknown } | undefined;
    request.user = {
      id: verified.payload.sub,
      role: profile?.role ?? (metadata?.role === "admin" ? "admin" : "member"),
      ...(typeof verified.payload.email === "string" ? { email: verified.payload.email } : {}),
    };
    if (request.user.email && request.server.haoRepository) await request.server.haoRepository.acceptInvitation(request.user.id, request.user.email);
  } catch {
    await reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid session", retryable: false });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply);
  if (!reply.sent && request.user.role !== "admin") await reply.code(403).send({ code: "UNAUTHORIZED", message: "Administrator access required", retryable: false });
}
