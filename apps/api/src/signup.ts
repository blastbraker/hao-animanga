import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SignupSchema = z.object({
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(10).max(128)
    .regex(/[a-z]/, "Include a lowercase letter.")
    .regex(/[A-Z]/, "Include an uppercase letter.")
    .regex(/[0-9]/, "Include a number."),
  inviteCode: z.string().trim().min(1).max(128),
}).strict();

export function inviteCodeMatches(code: string, hash = process.env.HAO_BETA_INVITE_CODE_HASH): boolean {
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return false;
  return timingSafeEqual(createHash("sha256").update(code.trim()).digest(), Buffer.from(hash, "hex"));
}

// Hash identifiers before storing throttles. No email, IP, password, or code is logged.
export function signupRateKeys(ip: string, email: string) {
  const hash = (value: string) => createHash("sha256").update(`hao-signup:${value}`).digest("hex");
  return [
    { key: hash(`ip:${ip}`), limit: 5 },
    { key: hash(`email:${email.toLowerCase()}`), limit: 3 },
    { key: hash("global"), limit: 100 },
  ];
}
