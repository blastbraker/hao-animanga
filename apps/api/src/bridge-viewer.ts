import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { SignJWT } from "jose";
import { getWebOrigin } from "./supabase.js";

function signingKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("Bridge access signing is not configured");
  const seed = createHash("sha256").update(`hao-bridge-viewer-v1:${secret}`).digest();
  return createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
}

export function bridgeViewerKeys() {
  const key = createPublicKey(signingKey()).export({ format: "jwk" });
  return { keys: [{ ...key, kid: "hao-viewer-v1", alg: "EdDSA", use: "sig" }] };
}

export async function createBridgeViewerToken(userId: string, deviceId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 6 * 60 * 60;
  const token = await new SignJWT({ scope: "bridge:read" })
    .setProtectedHeader({ alg: "EdDSA", kid: "hao-viewer-v1" })
    .setIssuer(`${getWebOrigin()}/bridge-viewer`).setAudience(deviceId)
    .setSubject(userId).setIssuedAt().setExpirationTime(expiresAt).sign(signingKey());
  return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
}
