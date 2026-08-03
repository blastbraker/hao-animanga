import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
  return client;
}

export type GeneratedInvite = {
  userId: string;
  inviteUrl: string;
};

export type PasswordInvitation = {
  userId: string;
  temporaryPassword: string;
};

export function buildInviteCallbackUrl(origin: string, tokenHash: string): string {
  const url = new URL("/auth/callback", `${origin.replace(/\/$/, "")}/`);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "invite");
  return url.toString();
}

export async function generateInviteLink(email: string): Promise<GeneratedInvite> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase administration is not configured");
  const redirectTo = `${getWebOrigin()}/auth/callback`;
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      redirectTo,
      data: { invited: true },
    },
  });
  if (error) throw error;
  if (!data.user?.id || !data.properties?.hashed_token) {
    throw new Error("Supabase did not return a usable invitation link");
  }
  return {
    userId: data.user.id,
    inviteUrl: buildInviteCallbackUrl(getWebOrigin(), data.properties.hashed_token),
  };
}

export function generateTemporaryPassword(): string {
  return `${randomPasswordPart()}aA1!`;
}

function randomPasswordPart(): string {
  return globalThis.crypto.getRandomValues(new Uint8Array(18)).reduce((value, byte) => value + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[byte % 62], "");
}

export async function createPasswordInvitation(email: string): Promise<PasswordInvitation> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase administration is not configured");
  const temporaryPassword = generateTemporaryPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    app_metadata: { invited: true, must_change_password: true },
    user_metadata: { invited: true },
  });
  if (error) throw error;
  if (!data.user?.id) throw new Error("Supabase did not create the invited account");
  return { userId: data.user.id, temporaryPassword };
}

export async function completePasswordSetup(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw error;
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { ...data.user.app_metadata, must_change_password: false },
  });
  if (updateError) throw updateError;
}

export function getWebOrigin(): string {
  const configured = process.env.WEB_ORIGIN?.split(",")[0]?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

export async function uploadEpub(storageKey: string, buffer: Buffer): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase storage is not configured");
  const { error } = await supabase.storage.from("epubs").upload(storageKey, buffer, {
    contentType: "application/epub+zip",
    upsert: false,
  });
  if (error) throw error;
}

export async function createSignedEpubUrl(storageKey: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase storage is not configured");
  const { data, error } = await supabase.storage.from("epubs").createSignedUrl(storageKey, 60);
  if (error || !data?.signedUrl) throw error ?? new Error("EPUB download could not be signed");
  return data.signedUrl;
}
